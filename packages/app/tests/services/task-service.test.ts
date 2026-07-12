import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { sectionIsBare, TASK_ACTION_COMMANDS, type TaskActionJob, TaskService } from '../../src/services/task-service';

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

        test('filters by feature ID (the feature_id traceability edge)', async () => {
            await svc.create({ title: 'Feature-linked', featureId: 'A' });
            await svc.create({ title: 'Other-feature', featureId: 'B' });
            await svc.create({ title: 'Unlinked' });

            const linkedToA = await svc.list({ featureId: 'A' });
            expect(linkedToA.some((t) => t.name === 'Feature-linked')).toBe(true);
            expect(linkedToA.some((t) => t.name === 'Other-feature')).toBe(false);
            expect(linkedToA.some((t) => t.name === 'Unlinked')).toBe(false);
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

        // Strict mode (write-guard): only the EXACT corpus path is owned. A scratch
        // file that merely shares a `NNNN_` prefix must not be claimed (the bug behind
        // the false-positive Write deny on /tmp/0103_*.md).
        test('strict: a scratch file sharing a WBS prefix is NOT owned', async () => {
            const created = await svc.create({ title: 'Real corpus task' });
            const wbs = created.ref.id;

            const lenient = await svc.resolve(`/tmp/${wbs}_design.md`);
            expect(lenient).not.toBeNull(); // default Strategy 2 still claims it

            const strict = await svc.resolve(`/tmp/${wbs}_design.md`, { strict: true });
            expect(strict).toBeNull(); // strict refuses the basename-only match
        });

        test('strict: the real corpus file IS still owned (exact path)', async () => {
            const created = await svc.create({ title: 'Strict exact' });
            const result = await svc.resolve(created.ref.filePath, { strict: true });
            expect(result).not.toBeNull();
            expect(result?.wbs).toBe(created.ref.id);
        });

        test('strict: a relative path to the corpus file resolves (path normalized)', async () => {
            const created = await svc.create({ title: 'Strict relative' });
            // tasksDir is absolute in tests; make a path with a redundant `.` segment.
            const withDot = created.ref.filePath.replace(/\/([^/]+\.md)$/, '/./$1');
            const result = await svc.resolve(withDot, { strict: true });
            expect(result).not.toBeNull();
            expect(result?.wbs).toBe(created.ref.id);
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

            const { children, parentsWired } = await svc.batchCreate(batchFile);

            expect(children).toHaveLength(3);
            for (const r of children) {
                expect(r.ref.id).toMatch(/^\d{4}$/);
                expect(await fs.exists(r.ref.filePath)).toBe(true);
            }
            const thirdResult = children.at(2);
            expect(thirdResult).toBeDefined();
            if (thirdResult === undefined) throw new Error('expected third batch result');
            const taggedTask = await fs.readFile(thirdResult.ref.filePath);
            expect(taggedTask).toContain('tags: ["rd3-migration"]');
            // Item 3 has parent_wbs: '0042' — wire-up attempts roster+transition on
            // a non-existent parent. Both fail; the per-parent errors are recorded
            // without aborting the batch (children are already on disk).
            expect(parentsWired).toHaveLength(1);
            expect(parentsWired[0]?.wbs).toBe('0042');
            expect(parentsWired[0]?.rostered).toBe(false);
            expect(parentsWired[0]?.transitionedTo).toBeNull();
            expect(parentsWired[0]?.errors.length).toBeGreaterThan(0);
        });

        test('does not rewrite body lines that look like frontmatter keys (R2)', async () => {
            // WHY: patchFrontmatterField once matched the whole file; a body line
            // `priority: must-not-be-patched` would be rewritten when the key was
            // absent from frontmatter. Matching is constrained to the FM block.
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-r2-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const rawTemplate = [
                '---',
                'schema_version: 1',
                'name: "{{ NAME }}"',
                'description: ""',
                'status: backlog',
                'type: task',
                'template: standard',
                'feature_id: null',
                'parent_wbs: null',
                'tags: []',
                'dependencies: []',
                'created_at: "{{ CREATED_AT }}"',
                'updated_at: "{{ CREATED_AT }}"',
                '---',
                '',
                '### Background',
                '{{ BACKGROUND }}',
                '',
                '### Requirements',
                'priority: must-not-be-patched',
                '',
            ].join('\n');
            const isolateSvc = new TaskService({
                fs: isolateFs,
                tasksDir: dir,
                writeService,
                resolveTemplate: () => rawTemplate,
            });

            try {
                const batchFile = join(dir, 'batch-r2.json');
                await isolateFs.writeFile(batchFile, JSON.stringify([{ name: 'R2 body-key guard', priority: 'P0' }]));
                const { children } = await isolateSvc.batchCreate(batchFile);
                expect(children).toHaveLength(1);
                const first = children[0];
                if (first === undefined) throw new Error('expected batch child');
                const raw = await isolateFs.readFile(first.ref.filePath);
                expect(raw).toContain('priority: must-not-be-patched');
                const doc = MarkdownDocument.parse(raw, 'task');
                expect(doc.frontmatterData?.priority).toBe('P0');
            } finally {
                rmSync(root, { recursive: true, force: true });
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

                const { children, parentsWired } = await isolateSvc.batchCreate(batchFile);
                expect(children).toHaveLength(1);
                expect(parentsWired).toEqual([]); // no parent_wbs in the batch

                const first = children[0];
                if (!first) throw new Error('Expected at least one result');
                const raw = await isolateFs.readFile(first.ref.filePath);
                expect(raw).toContain('R1. Must do X.');
                const doc = MarkdownDocument.parse(raw, 'task');
                expect(doc.getSection('Requirements')).not.toContain('Keep empty until requirements are known');
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
                const { children, parentsWired } = await isolateSvc.batchCreate(batchFile);
                const first = children[0];
                if (!first) throw new Error('Expected a result');
                const raw = await isolateFs.readFile(first.ref.filePath);
                expect(raw).toContain('- R1. First.');
                expect(raw).toContain('- R2. Second.');
                expect(raw).toContain('- R3. Third.');
                expect(MarkdownDocument.parse(raw, 'task').getSection('Requirements')).not.toContain(
                    'Keep empty until requirements are known',
                );
                // A specified batch item lands at todo (ready to execute).
                expect(MarkdownDocument.parse(raw, 'task').frontmatterData?.status).toBe('todo');
                expect(parentsWired).toEqual([]); // no parent_wbs in this batch either
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

        test('auto-refreshes the parent sub-task roster and transitions parent todo→wip (R1/R2/R5)', async () => {
            // The 0178 wire-up pass: after a batch that names a parent_wbs, the
            // parent file must contain the roster marker + a row for the new child,
            // the parent's frontmatter `status` must be `wip`, and a second batch
            // (different child, same parent) leaves a single, valid roster region
            // listing both children.
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-wireup-'));
            const dir = join(root, 'tasks');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(dir);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const isolateSvc = new TaskService({ fs: isolateFs, tasksDir: dir, writeService });

            try {
                // Use the service to allocate a valid parent. The create path
                // renders a complete frontmatter (schema_version included),
                // required for the transition step's L1 validation. We then
                // rewind status to `todo` and add a `## Plan` section so the
                // wire-up pass has a roster block to host.
                const created = await isolateSvc.create({ title: 'Umbrella parent' });
                const parentWbs = created.ref.id;
                const parentPath = join(dir, `${parentWbs}_umbrella-parent.md`);
                if (created.ref.filePath !== parentPath) {
                    await isolateFs.writeFile(parentPath, await isolateFs.readFile(created.ref.filePath));
                    await isolateFs.deleteFile(created.ref.filePath);
                }
                const parentDoc = MarkdownDocument.parse(await isolateFs.readFile(parentPath), 'task');
                parentDoc.setFrontmatterField('status', 'todo');
                parentDoc.replaceSection('Plan', 'Decompose the work into shippable units.');
                await isolateFs.writeFile(parentPath, parentDoc.serialize());

                // First batch: a single child pointing at the parent.
                const batchFile1 = join(dir, 'batch-wireup-1.json');
                await isolateFs.writeFile(
                    batchFile1,
                    JSON.stringify([
                        {
                            name: 'First child',
                            parent_wbs: parentWbs,
                            background: 'Some context.',
                            requirements: 'R1. Do X.',
                        },
                    ]),
                );

                const { children: first, parentsWired: firstWired } = await isolateSvc.batchCreate(batchFile1);
                expect(first).toHaveLength(1);
                expect(firstWired).toHaveLength(1);
                const firstWire = firstWired[0];
                expect(firstWire).toBeDefined();
                if (firstWire === undefined) throw new Error('expected first parentsWired entry');
                expect(firstWire.wbs).toBe(parentWbs);
                expect(firstWire.rostered).toBe(true); // a roster block was written
                expect(firstWire.transitionedTo).toBe('wip'); // parent was `todo` → `wip`
                expect(firstWire.errors).toEqual([]);

                // Parent file now carries the marker-delimited roster with the first
                // child row, AND the frontmatter status is `wip`.
                const parentAfterFirst = await isolateFs.readFile(parentPath);
                expect(parentAfterFirst).toContain('<!-- AUTO-GENERATED by spur task refresh-roster -->');
                expect(parentAfterFirst).toContain('| First child |');
                const firstDoc = MarkdownDocument.parse(parentAfterFirst, 'task');
                expect(firstDoc.frontmatterData?.status).toBe('wip');

                // Second batch: a different child under the same parent.
                const batchFile2 = join(dir, 'batch-wireup-2.json');
                await isolateFs.writeFile(
                    batchFile2,
                    JSON.stringify([
                        {
                            name: 'Second child',
                            parent_wbs: parentWbs,
                            background: 'More context.',
                            requirements: 'R1. Do Y.',
                        },
                    ]),
                );

                const { children: second, parentsWired: secondWired } = await isolateSvc.batchCreate(batchFile2);
                expect(second).toHaveLength(1);
                const secondWire = secondWired[0];
                expect(secondWire).toBeDefined();
                if (secondWire === undefined) throw new Error('expected second parentsWired entry');
                // The parent is already `wip`; the transition step is skipped, the
                // roster is refreshed in place (idempotent — single marker region).
                expect(secondWire.transitionedTo).toBeNull();
                expect(secondWire.rostered).toBe(true);

                const parentAfterSecond = await isolateFs.readFile(parentPath);
                const starts = parentAfterSecond.match(/AUTO-GENERATED by spur task refresh-roster/g) ?? [];
                expect(starts).toHaveLength(1); // exactly one marker region
                expect(parentAfterSecond).toContain('| First child |');
                expect(parentAfterSecond).toContain('| Second child |');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    describe('refresh', () => {
        test('re-scans corpus and returns folder/task counts (A17: kanban.md retired)', async () => {
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

                const result = await isolateSvc.refresh();

                expect(result.folders).toBe(1);
                expect(result.tasks).toBe(3);
                // No kanban.md is generated anymore.
                expect(await isolateFs.exists(`${dir}/kanban.md`)).toBe(false);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test('does not write kanban.md to tasksDir', async () => {
            await svc.create({ title: 'Kanban file test' });
            await svc.refresh();

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const kanbanPath = `${tasksDir}/kanban.md`;
            expect(await fs.exists(kanbanPath)).toBe(false);
        });

        test('counts across every configured folder (R13 multi-folder)', async () => {
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-multi-'));
            const primary = join(root, 'tasks');
            const archive = join(root, 'archive');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(primary);
            await isolateFs.ensureDir(archive);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            // Active folder is `primary`; both folders are declared in foldersConfig.
            const isolateSvc = new TaskService({
                fs: isolateFs,
                tasksDir: primary,
                writeService,
                foldersConfig: {
                    active_folder: primary,
                    folders: {
                        [primary]: { base_counter: 0 },
                        [archive]: { base_counter: 0 },
                    },
                },
            });

            try {
                await isolateSvc.create({ title: 'Primary task', status: 'backlog' });

                const result = await isolateSvc.refresh();

                // Both folders are scanned, neither gets a kanban.md.
                expect(result.folders).toBe(2);
                expect(await isolateFs.exists(`${primary}/kanban.md`)).toBe(false);
                expect(await isolateFs.exists(`${archive}/kanban.md`)).toBe(false);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    describe('show across registered folders (R14)', () => {
        test('show resolves a task that lives only in a non-active folder', async () => {
            // WHY: AC R14 — spur task show must find any task that resolve finds
            // across all registered folders, not only tasksDir.
            const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-r14-'));
            const primary = join(root, 'tasks');
            const archive = join(root, 'archive');
            const isolateFs = createNodeFileSystem(root);
            await isolateFs.ensureDir(primary);
            await isolateFs.ensureDir(archive);
            const writeService = new PlanningWriteService({ fs: isolateFs });
            const isolateSvc = new TaskService({
                fs: isolateFs,
                tasksDir: primary,
                writeService,
                foldersConfig: {
                    active_folder: primary,
                    folders: {
                        [primary]: { base_counter: 0 },
                        [archive]: { base_counter: 0 },
                    },
                },
            });

            const now = new Date().toISOString();
            const wbs = '9876';
            const archivePath = join(archive, `${wbs}_secondary-only.md`);
            const body = [
                '---',
                'schema_version: 1',
                'name: "Secondary only"',
                'description: ""',
                'status: backlog',
                'type: task',
                'template: standard',
                'feature_id: null',
                'parent_wbs: null',
                'priority: P2',
                'tags: []',
                'dependencies: []',
                `created_at: "${now}"`,
                `updated_at: "${now}"`,
                '---',
                '',
                `## ${wbs}. Secondary only`,
                '',
                '### Background',
                '',
                'Lives only in archive folder.',
                '',
                '### History',
                '',
            ].join('\n');

            try {
                await isolateFs.writeFile(archivePath, body);

                // resolve by absolute path (Strategy 1 across all folders)
                const resolved = await isolateSvc.resolve(archivePath);
                expect(resolved).not.toBeNull();
                expect(resolved?.wbs).toBe(wbs);
                expect(resolved?.filePath).toBe(archivePath);

                // show / getFilePath must agree (both use multi-folder findTaskFileName)
                const shown = await isolateSvc.show(wbs);
                expect(shown.wbs).toBe(wbs);
                expect(shown.name).toBe('Secondary only');
                expect(shown.filePath).toBe(archivePath);

                const pathOnly = await isolateSvc.getFilePath(wbs);
                expect(pathOnly).toBe(archivePath);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
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

    describe('updateSection — leading-header strip (R1)', () => {
        const root = () => tasksDir.replace('/tasks', '');

        async function writeSource(name: string, content: string): Promise<string> {
            const fs = createNodeFileSystem(root());
            const path = join(tasksDir, `${name}.tmp.md`);
            await fs.writeFile(path, content);
            return path;
        }

        test('strips a leading ## SectionName header + trailing blanks (no duplicate, no triple newline)', async () => {
            const created = await svc.create({ title: 'R1 h2 strip' });
            const src = await writeSource('r1-h2', '## Background\n\nReal background content.\n');
            await svc.updateSection(created.ref.id, 'Background', src);

            const fs = createNodeFileSystem(root());
            const raw = await fs.readFile(created.ref.filePath);
            // Only the canonical ### heading remains — the ## duplicate is gone.
            // (Match a `##`-level heading at line start, not the `###` substring.)
            expect(raw).not.toMatch(/^## Background$/m);
            expect(raw).toContain('### Background');
            expect(raw).toContain('Real background content.');
            // No triple-newline gap between heading and first content line.
            expect(raw).not.toMatch(/### Background\n\n\n/);
        });

        test('strips a leading ### SectionName header matching the section name (same-level)', async () => {
            const created = await svc.create({ title: 'R1 h3 strip' });
            const src = await writeSource('r1-h3', '### Background\n\nContent after same-level header.\n');
            await svc.updateSection(created.ref.id, 'Background', src);

            const fs = createNodeFileSystem(root());
            const raw = await fs.readFile(created.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            // No phantom section, and the duplicate heading is not doubled.
            expect(doc.sectionNames.filter((s) => s === 'Background')).toHaveLength(1);
            expect(raw).toContain('Content after same-level header.');
        });

        test('does NOT strip a leading heading that does not match the section name', async () => {
            const created = await svc.create({ title: 'R1 no-match' });
            // A non-matching heading at a DIFFERENT level than the section level
            // is not a phantom risk (R2 only strips same-level) and must survive.
            const src = await writeSource('r1-nomatch', '#### Subsection\n\nBody text.\n');
            await svc.updateSection(created.ref.id, 'Background', src);

            const fs = createNodeFileSystem(root());
            const raw = await fs.readFile(created.ref.filePath);
            expect(raw).toContain('#### Subsection');
            expect(raw).toContain('Body text.');
        });
    });

    describe('updateField — scalar frontmatter write', () => {
        test('sets feature_id on an existing task', async () => {
            const created = await svc.create({ title: 'feature link test' });
            await svc.updateField(created.ref.id, 'feature_id', 'H2');

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const doc = MarkdownDocument.parse(await fs.readFile(created.ref.filePath), 'task');
            expect(doc.frontmatterData?.feature_id).toBe('H2');
        });

        test('sets priority on an existing task', async () => {
            const created = await svc.create({ title: 'priority set test' });
            await svc.updateField(created.ref.id, 'priority', 'P1');

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const doc = MarkdownDocument.parse(await fs.readFile(created.ref.filePath), 'task');
            expect(doc.frontmatterData?.priority).toBe('P1');
        });

        test('rejects a non-allow-listed field (e.g. status)', async () => {
            const created = await svc.create({ title: 'bad field test' });
            await expect(svc.updateField(created.ref.id, 'status', 'done')).rejects.toThrow(/not settable/);
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
            expect(capturedJob?.command).toBe(`/sp:dev-run ${wbs} --auto`);
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
            expect(capturedJob?.command).toBe(`/sp:dev-run ${wbs} --auto`);
            expect(capturedJob?.channel).toBeUndefined();
            expect(capturedJob?.skipDeps).toBeUndefined();
        });

        test('builds the expected command for every supported action', async () => {
            const created = await svc.create({ title: 'Action table task' });
            const wbs = created.ref.id;
            const commands: Record<string, string> = {};
            for (const action of Object.keys(TASK_ACTION_COMMANDS)) {
                await svc.fulfillAction(wbs, action, async (job) => {
                    commands[action] = job.command;
                    return `run-${action}`;
                });
            }
            expect(commands).toEqual({
                refine: `/sp:dev-refine ${wbs} --auto`,
                plan: `/sp:dev-plan ${wbs} --auto`,
                run: `/sp:dev-run ${wbs} --auto`,
                verify: `/sp:dev-verify ${wbs} --auto`,
                decompose: `/sp:dev-plan "Decompose task ${wbs} into implementation subtasks" --auto`,
                evaluate: `/sp:dev-review ${wbs} --auto`,
            });
        });

        test('rejects unsupported actions before enqueue', async () => {
            const created = await svc.create({ title: 'Unsupported action task' });
            await expect(svc.fulfillAction(created.ref.id, 'unknown', async () => 'never')).rejects.toThrow(
                'Unsupported task action: unknown',
            );
        });
    });
});

describe('sectionIsBare', () => {
    const doc = (bodyText: string) =>
        MarkdownDocument.parse(
            `---\nschema_version: 1\nname: test\nstatus: wip\n---\n\n## 9999. Test\n\n${bodyText}`,
            'task',
        );

    test('returns true when section is absent', () => {
        const d = doc('');
        expect(sectionIsBare(d, 'Solution')).toBe(true);
    });

    test('returns true when section body is empty whitespace', () => {
        const d = doc('### Solution\n   \n### Plan\n');
        expect(sectionIsBare(d, 'Solution')).toBe(true);
    });

    test('returns true for old pipeline placeholder', () => {
        const d = doc('### Testing\nPipeline run 0042 — see agent output above.\n### Plan\n');
        expect(sectionIsBare(d, 'Testing')).toBe(true);
    });

    test('returns true for guidance-comment-only scaffold', () => {
        const d = doc('### Review\n<!-- Filled during review: P1-P4 findings. -->\n### Plan\n');
        expect(sectionIsBare(d, 'Review')).toBe(true);
    });

    test('returns false when section has real content', () => {
        const d = doc('### Solution\n| File | Change |\n|------|--------|\n| x.ts | thing |\n\n### Plan\n');
        expect(sectionIsBare(d, 'Solution')).toBe(false);
    });

    test('returns false for non-empty section with non-pipeline text', () => {
        const d = doc('### Testing\n**Verdict: PASS** — 6/6 requirements MET\n\n### Review\n');
        expect(sectionIsBare(d, 'Testing')).toBe(false);
    });

    test('returns true when section body is null (absent)', () => {
        const d = doc('');
        expect(sectionIsBare(d, 'Review')).toBe(true);
    });

    // ── refreshRoster (0123): parent ## Plan sub-task roster generator ──
    describe('refreshRoster', () => {
        /** Build an isolated env with a parent (given Plan body) + child tasks. */
        function childFile(c: { wbs: string; status: string; name?: string }): string {
            const name = c.name ?? `Child ${c.wbs}`;
            return `---\nname: "${name}"\nstatus: ${c.status}\nparent_wbs: "0001"\n---\n\n## ${c.wbs}. ${name}\n`;
        }

        async function rosterEnv(opts: {
            parentPlan: string;
            children: { wbs: string; status: string; name?: string }[];
        }): Promise<{
            svc: TaskService;
            dir: string;
            cleanup: () => void;
            readParent: () => Promise<string>;
            writeChild: (c: { wbs: string; status: string; name?: string }) => Promise<void>;
        }> {
            const root = mkdtempSync(join(tmpdir(), 'spur-roster-'));
            const dir = join(root, 'tasks');
            const fs = createNodeFileSystem(root);
            await fs.ensureDir(dir);
            const svc = new TaskService({ fs, tasksDir: dir, writeService: new PlanningWriteService({ fs }) });
            await fs.writeFile(
                join(dir, '0001_parent.md'),
                `---\nname: "Parent"\nstatus: wip\n---\n\n## 0001. Parent\n\n### Plan\n\n${opts.parentPlan}\n`,
            );
            for (const c of opts.children) {
                await fs.writeFile(join(dir, `${c.wbs}_child.md`), childFile(c));
            }
            return {
                svc,
                dir,
                cleanup: () => rmSync(root, { recursive: true, force: true }),
                readParent: async () => fs.readFile(join(dir, '0001_parent.md')),
                writeChild: async (c) => fs.writeFile(join(dir, `${c.wbs}_child.md`), childFile(c)),
            };
        }

        test('inserts a marker-delimited roster block, preserving the hand-written Plan (R1)', async () => {
            const env = await rosterEnv({
                parentPlan: '- Implementation step',
                children: [
                    { wbs: '0002', status: 'wip' },
                    { wbs: '0003', status: 'done' },
                ],
            });
            const result = await env.svc.refreshRoster('0001');
            const body = await env.readParent();
            env.cleanup();

            expect(result).toEqual({ wbs: '0001', childCount: 2, written: true });
            expect(body).toContain('- Implementation step'); // hand-written content preserved
            expect(body).toContain('<!-- AUTO-GENERATED by spur task refresh-roster -->');
            expect(body).toContain('| 0002 | Child 0002 | wip |');
            expect(body).toContain('| 0003 | Child 0003 | done |');
        });

        test('is idempotent — a second refresh produces no duplicate marker region (R2)', async () => {
            const env = await rosterEnv({ parentPlan: '- step', children: [{ wbs: '0002', status: 'todo' }] });
            await env.svc.refreshRoster('0001');
            await env.svc.refreshRoster('0001');
            const body = await env.readParent();
            env.cleanup();

            const starts = body.match(/AUTO-GENERATED by spur task refresh-roster/g) ?? [];
            expect(starts).toHaveLength(1);
        });

        test('reflects updated child status on re-refresh (R3)', async () => {
            const env = await rosterEnv({ parentPlan: '- step', children: [{ wbs: '0002', status: 'todo' }] });
            await env.svc.refreshRoster('0001');
            // Flip the child to done and re-roster.
            await env.writeChild({ wbs: '0002', status: 'done' });
            await env.svc.refreshRoster('0001');
            const body = await env.readParent();
            env.cleanup();

            expect(body).toContain('| 0002 | Child 0002 | done |');
            expect(body).not.toContain('| 0002 | Child 0002 | todo |');
        });

        test('a task with zero children is a no-op (R4 — writes nothing)', async () => {
            const env = await rosterEnv({ parentPlan: '- step', children: [] });
            const before = await env.readParent();
            const result = await env.svc.refreshRoster('0001');
            const after = await env.readParent();
            env.cleanup();

            expect(result).toEqual({ wbs: '0001', childCount: 0, written: false });
            expect(after).toBe(before); // byte-identical — nothing written
            expect(after).not.toContain('AUTO-GENERATED');
        });

        test('errors when the parent has no ## Plan section', async () => {
            const root = mkdtempSync(join(tmpdir(), 'spur-roster-noplan-'));
            const dir = join(root, 'tasks');
            const fs = createNodeFileSystem(root);
            await fs.ensureDir(dir);
            const svc = new TaskService({ fs, tasksDir: dir, writeService: new PlanningWriteService({ fs }) });
            await fs.writeFile(
                join(dir, '0001_parent.md'),
                '---\nname: "Parent"\nstatus: wip\n---\n\n## 0001. Parent\n',
            );
            await fs.writeFile(
                join(dir, '0002_child.md'),
                '---\nname: "Child"\nstatus: wip\nparent_wbs: "0001"\n---\n\n## 0002. Child\n',
            );

            await expect(svc.refreshRoster('0001')).rejects.toThrow(/no ## Plan/);
            rmSync(root, { recursive: true, force: true });
        });
    });
});
