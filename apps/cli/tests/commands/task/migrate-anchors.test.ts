/**
 * Thin-wrapper integration tests for `spur task migrate-anchors` (apps/cli/src/commands/task/migrate-anchors.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-migrate-anchors-task-test-${Date.now()}`);
    await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
    // Materialize the file the fixtures cite as their evidence anchor. Since the 0994
    // follow-up a live record's Testing/Solution `file:line` anchor must RESOLVE at the
    // `--as done` guard (`L4.anchor-unresolved` is an error there), so a fixture citing a
    // path that does not exist would be denied by the anchor gate before the behaviour
    // each test below exists to exercise. Every fixture cites line 1 of this file.
    const evidenceTarget = join(cwd, 'apps', 'cli', 'src', 'commands', 'task.ts');
    await mkdir(join(evidenceTarget, '..'), { recursive: true });
    await writeFile(evidenceTarget, '// fixture evidence target (no real code)\nexport {};\n', 'utf-8');
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

describe('spur task CLI', () => {
    describe('migrate-anchors', () => {
        test('runs with --json and --dry-run', async () => {
            const isoCwd = join(
                join(import.meta.dir, '..'),
                '..',
                `.tmp-migrate-anchors-task-migrate-anchors-${Date.now()}`,
            );
            await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
            try {
                const output = createCapturedOutput();
                const exitCode = await main(['task', 'migrate-anchors', '--json', '--dry-run'], {
                    cwd: isoCwd,
                    output,
                });
                expect(exitCode).toBe(0);
                const parsed = JSON.parse(output.messages[0] ?? '{}');
                expect(parsed.ok).toBe(true);
                expect(parsed.dryRun).toBe(true);
            } finally {
                rmSync(isoCwd, { recursive: true, force: true });
            }
        });

        test('runs in non-json mode with --dry-run and apply', async () => {
            // OUTSIDE the repo: this fixture runs `git init`, and a nested `.git` inside
            // the working tree pollutes `git status` and makes `git rev-parse
            // --show-toplevel` order-dependent for anything that still resolves a repo
            // root from cwd. The rest of this file's in-repo `.tmp-migrate-anchors-*` fixtures are fine
            // because they never create a repo.
            const isoCwd = await mkdtemp(join(tmpdir(), 'spur-task-migrate-anchors-apply-'));
            await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
            await mkdir(join(isoCwd, 'src'), { recursive: true });
            await writeFile(join(isoCwd, 'src', 'bar.ts'), 'export const bar = 1;\n');
            // Schema-valid frontmatter is REQUIRED here: apply writes through
            // PlanningWriteService.updateSection, which validates before writing. The
            // earlier minimal fixture made the apply fail with "Frontmatter validation
            // failed", and that was invisible only because the pass was not yet scoped
            // to the fixture and so never attempted a write.
            const taskContent = `---
template: standard
schema_version: 1
name: "Anchor task"
description: "fixture"
status: todo
type: task
profile: standard
parent_wbs: null
priority: P3
tags: []
dependencies: []
created_at: "2026-08-10T00:00:00.000Z"
updated_at: "2026-08-10T00:00:00.000Z"
---

## 0001. Anchor task

### Testing

- Evidence: \`bar.ts:1\`
`;
            await writeFile(join(isoCwd, 'docs', 'tasks', '0001_anchor-task.md'), taskContent);
            Bun.spawnSync(['git', 'init'], { cwd: isoCwd });
            Bun.spawnSync(['git', 'add', '.'], { cwd: isoCwd });
            try {
                const dryOut = createCapturedOutput();
                const dryCode = await main(['task', 'migrate-anchors', '--dry-run', '--json'], {
                    cwd: isoCwd,
                    output: dryOut,
                });
                expect(dryCode).toBe(0);

                const dryOutText = createCapturedOutput();
                const dryCodeText = await main(['task', 'migrate-anchors', '--dry-run'], {
                    cwd: isoCwd,
                    output: dryOutText,
                });
                expect(dryCodeText).toBe(0);
                expect(dryOutText.messages[0]).toContain('Anchor qualification dry-run complete');

                const applyOut = createCapturedOutput();
                const applyCode = await main(['task', 'migrate-anchors'], { cwd: isoCwd, output: applyOut });
                expect(applyCode).toBe(0);
                expect(applyOut.messages[0]).toContain('Anchor qualification apply complete');
                // Non-vacuous: assert the citation was actually qualified. Without this
                // the test passes when the pass rewrites NOTHING, which is exactly how a
                // broken apply path stayed green.
                const applied = await readFile(join(isoCwd, 'docs', 'tasks', '0001_anchor-task.md'), 'utf8');
                expect(applied).toContain('`src/bar.ts:1`');
                expect(applied).not.toContain('`bar.ts:1`');
            } finally {
                rmSync(isoCwd, { recursive: true, force: true });
            }
        });

        // ADR-137 / 1190 R6: anchor migration is a section write, never a status move, so the
        // deprecated freeze must not block it — and it must leave the status untouched.
        test('qualifies anchors on a deprecated task and leaves it deprecated', async () => {
            const isoCwd = await mkdtemp(join(tmpdir(), 'spur-task-migrate-anchors-deprecated-'));
            await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
            await mkdir(join(isoCwd, 'src'), { recursive: true });
            await writeFile(join(isoCwd, 'src', 'bar.ts'), 'export const bar = 1;\n');
            const taskPath = join(isoCwd, 'docs', 'tasks', '0001_frozen-task.md');
            await writeFile(
                taskPath,
                `---
template: standard
schema_version: 1
name: "Frozen task"
description: "fixture"
status: deprecated
type: task
profile: standard
parent_wbs: null
priority: P3
tags: []
dependencies: []
created_at: "2026-08-10T00:00:00.000Z"
updated_at: "2026-08-10T00:00:00.000Z"
---

## 0001. Frozen task

### Testing

- Evidence: \`bar.ts:1\`
`,
            );
            Bun.spawnSync(['git', 'init'], { cwd: isoCwd });
            Bun.spawnSync(['git', 'add', '.'], { cwd: isoCwd });
            try {
                const applyOut = createCapturedOutput();
                const applyCode = await main(['task', 'migrate-anchors', '--wbs', '0001'], {
                    cwd: isoCwd,
                    output: applyOut,
                });
                expect(applyCode).toBe(0);
                const applied = await readFile(taskPath, 'utf8');
                expect(applied).toContain('`src/bar.ts:1`');
                expect(applied).toContain('status: deprecated');
            } finally {
                rmSync(isoCwd, { recursive: true, force: true });
            }
        });

        // 1109 R1/R2: `--wbs` scopes the pass to one task file. The failure cases are
        // asserted first (a sibling that must NOT be touched, an ambiguous anchor that must
        // NOT be guessed at, an unknown wbs that must fail loudly) because the unscoped pass
        // rewrites the whole corpus in one call — the scope is the whole point of the flag.
        // 1140 R1–R3: the `done_reason` verdict-pointer class. The durable copy wins, the
        // tracked Testing section is the fallback, and a pointer with neither owner is
        // reported as unresolved and left byte-identical (AC1/AC3/AC4).
        test('retargets scratch verdict pointers to durable evidence and reports the unresolved one', async () => {
            const isoCwd = await mkdtemp(join(tmpdir(), 'spur-task-migrate-anchors-done-reason-'));
            await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
            await mkdir(join(isoCwd, '.spur', 'memory', 'evidence'), { recursive: true });
            await writeFile(join(isoCwd, '.spur', 'memory', 'evidence', '0001-verdict.json'), '{}\n');
            const task = (wbs: string, reason: string, testing: string): string => `---
template: standard
schema_version: 1
name: "t${wbs}"
description: "fixture"
status: done
type: task
profile: standard
parent_wbs: null
priority: P3
tags: []
dependencies: []
created_at: "2026-08-10T00:00:00.000Z"
updated_at: "2026-08-10T00:00:00.000Z"
done_reason: "${reason}"
---

## ${wbs}. t${wbs}

### Testing

${testing}
`;
            const durablePath = join(isoCwd, 'docs', 'tasks', '0001_durable.md');
            await writeFile(durablePath, task('0001', 'PASS artifact at .spur/run/0001-verdict.json', 'green'));
            await writeFile(
                join(isoCwd, 'docs', 'tasks', '0002_tracked.md'),
                task('0002', 'Verified with PASS verdict in .spur/run/0002-verdict.json', '`suite` green'),
            );
            const unresolvedPath = join(isoCwd, 'docs', 'tasks', '0003_unresolved.md');
            await writeFile(unresolvedPath, task('0003', 'Closed at .spur/run/0003-verdict.json', ''));
            const unresolvedBefore = await readFile(unresolvedPath, 'utf8');
            Bun.spawnSync(['git', 'init'], { cwd: isoCwd });
            Bun.spawnSync(['git', 'add', '.'], { cwd: isoCwd });
            try {
                const dryOut = createCapturedOutput();
                const dryCode = await main(['task', 'migrate-anchors', '--dry-run', '--json'], {
                    cwd: isoCwd,
                    output: dryOut,
                });
                expect(dryCode).toBe(0);
                const dry = JSON.parse(dryOut.messages[0] ?? '{}');
                expect(dry.reasons).toHaveLength(2);
                expect(dry.unresolvedReasons).toHaveLength(1);
                expect(dry.unresolvedReasons[0]).toContain('0003');
                expect(await readFile(durablePath, 'utf8')).toContain('.spur/run/0001-verdict.json');

                const applyOut = createCapturedOutput();
                const applyCode = await main(['task', 'migrate-anchors'], { cwd: isoCwd, output: applyOut });
                expect(applyCode).toBe(0);
                expect(applyOut.messages[0]).toContain('2 done_reason rewrite(s)');

                // Durable copy wins; the pointer substring changes and its surroundings do not.
                // (The write pipeline re-emits the scalar unquoted and stamps `updated_at` —
                // `planning-write-service.ts` sets it at the write step for every corpus write.)
                const durable = await readFile(durablePath, 'utf8');
                expect(durable).toContain('done_reason: PASS artifact at .spur/memory/evidence/0001-verdict.json');
                expect(durable).toContain('### Testing\n\ngreen');
                expect(durable).not.toContain('.spur/run/0001-verdict.json');
                // No durable copy but a non-empty Testing section → the tracked owner.
                const tracked = await readFile(join(isoCwd, 'docs', 'tasks', '0002_tracked.md'), 'utf8');
                expect(tracked).toContain('tracked Testing section (scratch verdict not retained)');
                // Neither owner → byte-identical, reported only.
                expect(await readFile(unresolvedPath, 'utf8')).toBe(unresolvedBefore);
            } finally {
                rmSync(isoCwd, { recursive: true, force: true });
            }
        });

        test('--wbs qualifies only the named task and leaves a sibling fixture untouched', async () => {
            const isoCwd = await mkdtemp(join(tmpdir(), 'spur-task-migrate-anchors-scoped-'));
            await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
            await mkdir(join(isoCwd, 'src'), { recursive: true });
            await writeFile(join(isoCwd, 'src', 'bar.ts'), 'export const bar = 1;\n');
            const fixture = (wbs: string, name: string) => `---
template: standard
schema_version: 1
name: "${name}"
description: "fixture"
status: todo
type: task
profile: standard
parent_wbs: null
priority: P3
tags: []
dependencies: []
created_at: "2026-08-10T00:00:00.000Z"
updated_at: "2026-08-10T00:00:00.000Z"
---

## ${wbs}. ${name}

### Testing

- Evidence: \`bar.ts:1\`
`;
            const targetPath = join(isoCwd, 'docs', 'tasks', '0001_anchor-target.md');
            const siblingPath = join(isoCwd, 'docs', 'tasks', '0002_anchor-sibling.md');
            await writeFile(targetPath, fixture('0001', 'Anchor target'));
            await writeFile(siblingPath, fixture('0002', 'Anchor sibling'));
            Bun.spawnSync(['git', 'init'], { cwd: isoCwd });
            Bun.spawnSync(['git', 'add', '.'], { cwd: isoCwd });
            try {
                const scopedOut = createCapturedOutput();
                const scopedCode = await main(['task', 'migrate-anchors', '--wbs', '0001', '--json'], {
                    cwd: isoCwd,
                    output: scopedOut,
                });
                expect(scopedCode).toBe(0);
                const scoped = JSON.parse(scopedOut.messages[0] ?? '{}');
                expect(scoped.wbs).toBe('0001');
                // Only the named task's file appears in the report, and only it was rewritten.
                expect(scoped.fileReports.map((r: { path: string }) => basename(r.path))).toEqual([
                    '0001_anchor-target.md',
                ]);
                const appliedTarget = await readFile(targetPath, 'utf8');
                const untouchedSibling = await readFile(siblingPath, 'utf8');
                expect(appliedTarget).toContain('`src/bar.ts:1`');
                expect(appliedTarget).not.toContain('`bar.ts:1`');
                expect(untouchedSibling).toContain('`bar.ts:1`');
                expect(untouchedSibling).not.toContain('`src/bar.ts:1`');
            } finally {
                rmSync(isoCwd, { recursive: true, force: true });
            }
        });

        test('--wbs reports an ambiguous anchor instead of guessing and fails on an unknown wbs', async () => {
            const isoCwd = await mkdtemp(join(tmpdir(), 'spur-task-migrate-anchors-ambig-'));
            await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
            await mkdir(join(isoCwd, 'src', 'a'), { recursive: true });
            await mkdir(join(isoCwd, 'src', 'b'), { recursive: true });
            // Two tracked files share the basename: the qualifier cannot know which is meant.
            await writeFile(join(isoCwd, 'src', 'a', 'dup.ts'), 'export const a = 1;\n');
            await writeFile(join(isoCwd, 'src', 'b', 'dup.ts'), 'export const b = 1;\n');
            const taskPath = join(isoCwd, 'docs', 'tasks', '0007_ambiguous.md');
            await writeFile(
                taskPath,
                `---
template: standard
schema_version: 1
name: "Ambiguous"
description: "fixture"
status: todo
type: task
profile: standard
parent_wbs: null
priority: P3
tags: []
dependencies: []
created_at: "2026-08-10T00:00:00.000Z"
updated_at: "2026-08-10T00:00:00.000Z"
---

## 0007. Ambiguous

### Testing

- Evidence: \`dup.ts:1\`
`,
            );
            Bun.spawnSync(['git', 'init'], { cwd: isoCwd });
            Bun.spawnSync(['git', 'add', '.'], { cwd: isoCwd });
            try {
                const ambOut = createCapturedOutput();
                const ambCode = await main(['task', 'migrate-anchors', '--wbs', '0007', '--json'], {
                    cwd: isoCwd,
                    output: ambOut,
                });
                expect(ambCode).toBe(0);
                const amb = JSON.parse(ambOut.messages[0] ?? '{}');
                expect(amb.ambiguous.length).toBe(1);
                expect(amb.qualified.length).toBe(0);
                const untouched = await readFile(taskPath, 'utf8');
                expect(untouched).toContain('`dup.ts:1`');

                const unknownOut = createCapturedOutput();
                const unknownCode = await main(['task', 'migrate-anchors', '--wbs', '0404', '--json'], {
                    cwd: isoCwd,
                    output: unknownOut,
                });
                expect(unknownCode).toBe(1);
                expect(unknownOut.errors.join(' ')).toContain('0404');
            } finally {
                rmSync(isoCwd, { recursive: true, force: true });
            }
        });
    });
});
