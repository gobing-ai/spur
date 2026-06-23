import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { type TaskActionJob, TaskService } from '../../src/services/task-service';

let tasksDir: string;
let svc: TaskService;

beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-'));
    tasksDir = join(root, 'tasks');
    const fs = createNodeFileSystem(root);
    await fs.ensureDir(tasksDir);
    const writeService = new PlanningWriteService({ fs });
    svc = new TaskService({ fs, tasksDir, writeService });
});

afterAll(() => {
    rmSync(tasksDir.replace('/tasks', ''), { recursive: true, force: true });
});

describe('TaskService', () => {
    describe('create', () => {
        test('allocates a 4-digit WBS and creates a file', async () => {
            const result = await svc.create({ title: 'Test task' });

            expect(result.ref.kind).toBe('task');
            expect(result.ref.id).toMatch(/^\d{4}$/);
            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            expect(await fs.exists(result.ref.filePath)).toBe(true);
        });

        test('creates with feature_id in frontmatter', async () => {
            const result = await svc.create({ title: 'Feature task', featureId: 'A' });

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(result.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.feature_id).toBe('A');
        });

        test('creates with parent_wbs in frontmatter', async () => {
            const result = await svc.create({ title: 'Sub task', parentWbs: '0042' });

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(result.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.parent_wbs).toBe('0042');
        });

        test('defaults a bare task to backlog (still preparing)', async () => {
            // WHY: §2.3 semantics — a task with no spec is not yet executable.
            const result = await svc.create({ title: 'Default status' });

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(result.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.status).toBe('backlog');
        });

        test('a bare task carries only Background + History (backlog section set)', async () => {
            // WHY: a not-yet-prepared task should not ship empty Design/Solution
            // headings that would trip the format gate (the original dogfood bug).
            const result = await svc.create({ title: 'Bare sections' });
            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(result.ref.filePath);
            expect(raw).toContain('### Background');
            expect(raw).toContain('### History');
            expect(raw).not.toContain('### Solution');
            expect(raw).not.toContain('### Design');
        });

        test('a feature-spec task is created at todo with the HITL-review sections', async () => {
            // WHY: §2.3 — a task with a real spec is ready to execute (todo), and
            // todo is the HITL gate, so Design + Acceptance Criteria + Plan must be
            // present (as guidance placeholders) for review before any code.
            const result = await svc.create({ title: 'Spec task', featureId: 'A' });
            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(result.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.status).toBe('todo');
            expect(raw).toContain('### Acceptance Criteria');
            expect(raw).toContain('### Design');
            expect(raw).toContain('### Plan');
            // Solution is the implementation change-map — not present until wip.
            expect(raw).not.toContain('### Solution');
        });

        test('writes the template variant to frontmatter; bare → standard, feature → feature-impl', async () => {
            // WHY: `template` is the unified variant axis (§3.2) that drives both
            // creation sections and `task check`; it must be persisted.
            const bare = await svc.create({ title: 'Bare variant' });
            const feat = await svc.create({ title: 'Feat variant', featureId: 'A' });
            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const bareDoc = MarkdownDocument.parse(await fs.readFile(bare.ref.filePath), 'task');
            const featDoc = MarkdownDocument.parse(await fs.readFile(feat.ref.filePath), 'task');
            expect(bareDoc.frontmatterData?.template).toBe('standard');
            expect(featDoc.frontmatterData?.template).toBe('feature-impl');
        });

        test('an explicit --template wins and injects the variant template body', async () => {
            // WHY: per-variant boilerplate (review's P1–P4 table) is seeded from the
            // resolveTemplateBodies hook, not hardcoded — and only where the section exists.
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-tpl-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const isolateSvc = new TaskService({
                fs: isolateFs,
                tasksDir: dir,
                sectionMatrix: {
                    variants: { review: { wip: { required: ['Background', 'Review'] } } },
                },
                resolveTemplateBodies: (variant) =>
                    variant === 'review' ? { Review: '| Severity | File |\n| P1 | |' } : {},
                writeService,
            });
            try {
                // status wip so the review variant carries the Review section.
                const result = await isolateSvc.create({ title: 'Review task', template: 'review', status: 'wip' });
                const raw = await isolateFs.readFile(result.ref.filePath);
                const doc = MarkdownDocument.parse(raw, 'task');
                expect(doc.frontmatterData?.template).toBe('review');
                expect(raw).toContain('### Review');
                expect(raw).toContain('| P1');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    describe('show', () => {
        test('returns parsed frontmatter and body-only content (frontmatter stripped)', async () => {
            const created = await svc.create({ title: 'Show task' });
            const result = await svc.show(created.ref.id);

            expect(result.wbs).toBe(created.ref.id);
            expect(result.name).toBe('Show task');
            expect(result.status).toBe('backlog');
            expect(result.content).toContain('Show task');
            // R4 (0100): content must NOT include the raw YAML frontmatter block
            expect(result.content).not.toContain('status: backlog');
            expect(result.content).not.toMatch(/^---/m);
        });

        test('throws for non-existent WBS', async () => {
            await expect(svc.show('9999')).rejects.toThrow('not found');
        });
    });

    describe('list', () => {
        test('lists all tasks in the folder', async () => {
            await svc.create({ title: 'List test 1' });
            await svc.create({ title: 'List test 2' });

            const tasks = await svc.list();

            const listNames = tasks.map((t) => t.name);
            expect(listNames).toContain('List test 1');
            expect(listNames).toContain('List test 2');
        });

        test('filters by status', async () => {
            await svc.create({ title: 'Backlog only' });

            const backlog = await svc.list({ status: 'backlog' });
            const done = await svc.list({ status: 'done' });

            expect(backlog.some((t) => t.name === 'Backlog only')).toBe(true);
            expect(done.some((t) => t.name === 'Backlog only')).toBe(false);
        });

        test('filters by parent WBS', async () => {
            await svc.create({ title: 'Parented', parentWbs: '0042' });
            await svc.create({ title: 'Unparented' });

            const parented = await svc.list({ parentWbs: '0042' });
            expect(parented.some((t) => t.name === 'Parented')).toBe(true);
            expect(parented.some((t) => t.name === 'Unparented')).toBe(false);
        });

        test('filters by phase (legacy alias for status)', async () => {
            await svc.create({ title: 'Phase test', status: 'wip' });

            const wip = await svc.list({ phase: 'wip' });
            expect(wip.some((t) => t.name === 'Phase test')).toBe(true);
        });

        test('lists from an alternate folder within the planning workspace', async () => {
            // A sibling folder under the same root as tasksDir is a valid target —
            // the multi-folder switcher must read tasks from the chosen directory.
            const root = mkdtempSync(join(tmpdir(), 'spur-task-folder-'));
            const fs = createNodeFileSystem(root);
            await fs.ensureDir(join(root, 'tasks'));
            await fs.ensureDir(join(root, 'archive'));
            const altSvc = new TaskService({
                fs,
                tasksDir: join(root, 'tasks'),
                writeService: new PlanningWriteService({ fs }),
            });
            await fs.writeFile(
                join(root, 'archive', '0001_archived.md'),
                '---\nname: "Archived task"\nstatus: done\n---\n\n## 0001. Archived task\n',
            );

            const tasks = await altSvc.list({ folder: join(root, 'archive') });

            expect(tasks.map((t) => t.name)).toContain('Archived task');
            rmSync(root, { recursive: true, force: true });
        });

        test('rejects a folder that escapes the planning workspace', async () => {
            // An arbitrary folder over the wire must not enumerate the host
            // filesystem outside the workspace (path-traversal guard).
            await expect(svc.list({ folder: '../../../../etc' })).rejects.toThrow(/escapes the planning workspace/);
        });
    });

    describe('resolve', () => {
        test('finds a task by exact file path', async () => {
            const created = await svc.create({ title: 'Resolve me' });
            const result = await svc.resolve(created.ref.filePath);

            expect(result).not.toBeNull();
            expect(result?.wbs).toBe(created.ref.id);
        });

        test('returns null for unknown path', async () => {
            const result = await svc.resolve('/nonexistent/task.md');
            expect(result).toBeNull();
        });

        test('resolves a task by filename WBS parse', async () => {
            const created = await svc.create({ title: 'Resolve by name' });
            const wbs = created.ref.id;

            // Resolve using just the filename (no full path)
            const filename = `${wbs}_resolve-by-name.md`;
            const result = await svc.resolve(`/some/other/path/${filename}`);

            expect(result).not.toBeNull();
            expect(result?.wbs).toBe(wbs);
        });

        test('returns null for path outside tasksDir without WBS pattern', async () => {
            const result = await svc.resolve('/completely/unrelated/file.ts');
            expect(result).toBeNull();
        });
    });

    describe('batchCreate', () => {
        test('creates multiple tasks from a valid JSON file', async () => {
            const batchFile = `${tasksDir}/batch.json`;
            const json = JSON.stringify([
                { name: 'Batch task 1', priority: 'P0' },
                { name: 'Batch task 2', feature_id: 'A' },
                { name: 'Batch task 3', parent_wbs: '0042', tags: ['rd3-migration'] },
            ]);
            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            await fs.writeFile(batchFile, json);

            const results = await svc.batchCreate(batchFile);

            expect(results).toHaveLength(3);
            for (const r of results) {
                expect(r.ref.id).toMatch(/^\d{4}$/);
                expect(await fs.exists(r.ref.filePath)).toBe(true);
            }
        });

        test('rolls back all tasks on partial failure', async () => {
            // Use a fresh temp dir to avoid pollution from shared beforeAll state
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-rb-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const isolateSvc = new TaskService({ fs: isolateFs, tasksDir: dir, writeService });

            try {
                const batchFile = join(dir, 'batch-rollback.json');
                const json = JSON.stringify([{ name: 'Good task' }, { background: 'no name here' }]);
                await isolateFs.writeFile(batchFile, json);

                await expect(isolateSvc.batchCreate(batchFile)).rejects.toThrow('batch validation failed');

                // Verify no task files were created
                const entries = await isolateFs.readDir(dir);
                const taskFiles = entries.filter((e) => /^\d{4}_.+\.md$/.test(e));
                expect(taskFiles).toHaveLength(0);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test('rejects invalid JSON', async () => {
            const batchFile = `${tasksDir}/bad.json`;
            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            await fs.writeFile(batchFile, 'not json');

            await expect(svc.batchCreate(batchFile)).rejects.toThrow('not valid JSON');
        });

        test('rejects empty batch array', async () => {
            const batchFile = `${tasksDir}/empty.json`;
            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            await fs.writeFile(batchFile, '[]');

            await expect(svc.batchCreate(batchFile)).rejects.toThrow('batch validation failed');
        });

        test('writes background and requirements sections from batch items', async () => {
            // Use a fresh temp dir for isolation
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-sec-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const isolateSvc = new TaskService({ fs: isolateFs, tasksDir: dir, writeService });

            try {
                const batchFile = join(dir, 'batch-sections.json');
                const json = JSON.stringify([
                    {
                        name: 'Sectioned task',
                        background: 'Custom background text.',
                        requirements: 'R1. Must do X.\nR2. Must not do Y.',
                    },
                ]);
                await isolateFs.writeFile(batchFile, json);

                const results = await isolateSvc.batchCreate(batchFile);
                expect(results).toHaveLength(1);

                const first = results[0];
                if (!first) throw new Error('Expected at least one result');
                const raw = await isolateFs.readFile(first.ref.filePath);
                expect(raw).toContain('R1. Must do X.');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test('bulletizes a run-on R-numbered requirements paragraph into a list', async () => {
            // WHY: dogfood issue #2 — a single-line "R1. … R2. … R3. …" must render
            // as one bullet per requirement so it is legible in a markdown viewer.
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-bullet-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const isolateSvc = new TaskService({ fs: isolateFs, tasksDir: dir, writeService });

            try {
                const batchFile = join(dir, 'batch-bullet.json');
                await isolateFs.writeFile(
                    batchFile,
                    JSON.stringify([
                        {
                            name: 'Run-on reqs',
                            background: 'ctx',
                            requirements: 'R1. First. R2. Second. R3. Third.',
                        },
                    ]),
                );
                const results = await isolateSvc.batchCreate(batchFile);
                const first = results[0];
                if (!first) throw new Error('Expected a result');
                const raw = await isolateFs.readFile(first.ref.filePath);
                expect(raw).toContain('- R1. First.');
                expect(raw).toContain('- R2. Second.');
                expect(raw).toContain('- R3. Third.');
                // A specified batch item lands at todo (ready to execute).
                expect(MarkdownDocument.parse(raw, 'task').frontmatterData?.status).toBe('todo');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test('rolls back files already written when a later item fails mid-batch (R2)', async () => {
            // Failure here is NOT a schema violation (those abort before any write).
            // A write that throws on the 2nd item must leave zero files on disk —
            // exercising the post-write rollback path, not the pre-write guard.
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-midfail-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);

            // batchCreate allocates+writes via createAllocated (race-safe, inside the
            // create-lock), so inject the failure there — on the 2nd item's write.
            class FailOnSecondCreate extends PlanningWriteService {
                private calls = 0;
                override async createAllocated(
                    folder: string,
                    allocate: Parameters<PlanningWriteService['createAllocated']>[1],
                ) {
                    this.calls += 1;
                    if (this.calls === 2) throw new Error('simulated write failure on item 2');
                    return super.createAllocated(folder, allocate);
                }
            }
            const writeService = new FailOnSecondCreate({ fs: isolateFs });
            const isolateSvc = new TaskService({ fs: isolateFs, tasksDir: dir, writeService });

            try {
                const batchFile = join(dir, 'batch-midfail.json');
                await isolateFs.writeFile(batchFile, JSON.stringify([{ name: 'First ok' }, { name: 'Second fails' }]));

                await expect(isolateSvc.batchCreate(batchFile)).rejects.toThrow('simulated write failure');

                // The first item was written then must be rolled back — zero task files remain.
                const taskFiles = (await isolateFs.readDir(dir)).filter((e) => /^\d{4}_.+\.md$/.test(e));
                expect(taskFiles).toHaveLength(0);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    describe('refresh', () => {
        test('generates kanban.md with status headers', async () => {
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-ref-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const isolateSvc = new TaskService({ fs: isolateFs, tasksDir: dir, writeService });

            try {
                await isolateSvc.create({ title: 'Backlog item', status: 'backlog' });
                await isolateSvc.create({ title: 'In progress', status: 'wip' });
                await isolateSvc.create({ title: 'Done item', status: 'done' });

                const kanban = await isolateSvc.refresh();

                expect(kanban).toContain('# Kanban');
                expect(kanban).toContain('Auto-generated by');
                expect(kanban).toContain('## Backlog');
                expect(kanban).toContain('## Wip');
                expect(kanban).toContain('## Done');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test('groups tasks under parent_wbs', async () => {
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-grp-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const isolateSvc = new TaskService({ fs: isolateFs, tasksDir: dir, writeService });

            try {
                const parent = await isolateSvc.create({ title: 'Parent task' });
                const parentWbs = parent.ref.id;
                await isolateSvc.create({ title: 'Child 1', parentWbs, status: 'wip' });
                await isolateSvc.create({ title: 'Child 2', parentWbs, status: 'wip' });

                const kanban = await isolateSvc.refresh();

                expect(kanban).toContain(`**${parentWbs}**`);
                // Children should be indented under the parent
                expect(kanban).toContain('  - [');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test('deterministic ordering: same corpus produces identical output', async () => {
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-det-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const isolateSvc = new TaskService({ fs: isolateFs, tasksDir: dir, writeService });

            try {
                await isolateSvc.create({ title: 'Alpha', status: 'backlog' });
                await isolateSvc.create({ title: 'Beta', status: 'backlog' });

                const kanban1 = await isolateSvc.refresh();
                const kanban2 = await isolateSvc.refresh();

                expect(kanban1).toBe(kanban2);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test('kanban.md file is written to tasksDir', async () => {
            await svc.create({ title: 'Kanban file test' });
            await svc.refresh();

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const kanbanPath = `${tasksDir}/kanban.md`;
            expect(await fs.exists(kanbanPath)).toBe(true);
        });
    });

    describe('updateBody', () => {
        test('replaces the body region and preserves frontmatter + sections', async () => {
            const created = await svc.create({ title: 'Body write test' });
            const newBody = '## Updated body\n\nThis is the new preamble content.\n';

            const result = await svc.updateBody(created.ref.id, newBody);
            expect(result.ref.id).toBe(created.ref.id);

            // Read back and verify
            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(created.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');

            // Frontmatter preserved
            expect(doc.frontmatterData?.name).toBe('Body write test');
            expect(doc.frontmatterData?.status).toBe('backlog');

            // Preamble replaced
            expect(raw).toContain('This is the new preamble content');

            // Original sections preserved
            expect(raw).toContain('### Background');
            expect(raw).toContain('### History');
        });

        test('handles empty body', async () => {
            const created = await svc.create({ title: 'Empty body test' });
            const result = await svc.updateBody(created.ref.id, '');
            expect(result.ref.id).toBe(created.ref.id);

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(created.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.name).toBe('Empty body test');
        });
    });
    describe('fulfillAction', () => {
        test('passes channel and skipDeps to enqueue job', async () => {
            const created = await svc.create({ title: 'Action task' });
            const wbs = created.ref.id;
            let capturedJob: TaskActionJob | undefined;
            const result = await svc.fulfillAction(
                wbs,
                'run',
                async (job) => {
                    capturedJob = job;
                    return 'run-042';
                },
                { channel: 'codex', skipDeps: true },
            );
            expect(result.runId).toBe('run-042');
            expect(result.action).toBe('run');
            expect(result.status).toBe('queued');
            expect(capturedJob?.channel).toBe('codex');
            expect(capturedJob?.skipDeps).toBe(true);
        });

        test('works without options (backward compat)', async () => {
            const created = await svc.create({ title: 'Compat task' });
            const wbs = created.ref.id;
            let capturedJob: TaskActionJob | undefined;
            const result = await svc.fulfillAction(wbs, 'run', async (job) => {
                capturedJob = job;
                return 'run-043';
            });
            expect(result.runId).toBe('run-043');
            expect(capturedJob?.channel).toBeUndefined();
            expect(capturedJob?.skipDeps).toBeUndefined();
        });
    });
});
