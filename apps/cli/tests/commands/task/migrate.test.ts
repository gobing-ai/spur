/**
 * Thin-wrapper integration tests for `spur task migrate` (apps/cli/src/commands/task/migrate.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-migrate-task-test-${Date.now()}`);
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

/** The last captured message, or a throwing guard for empty output. */
function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

const LEGACY_MIGRATION_TASK = `---
name: "Legacy migration task"
description: "Legacy migration task"
status: Done
created_at: 2026-05-09T04:48:47.680Z
updated_at: 2026-05-11T00:00:00.000Z
folder: docs/tasks
type: task
feature-id: F-1.4.1
impl_progress:
  planning: done
---

## 0050. Legacy migration task

### Background

This prose must survive migration unchanged.

### Requirements

R1. Keep body prose.
`;

async function seedMigrationCorpus(): Promise<{ root: string; tasksDir: string; taskPath: string }> {
    const root = await mkdtemp(join(tmpdir(), 'spur-task-migrate-cli-'));
    const tasksDir = join(root, 'docs', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    const taskPath = join(tasksDir, '0050_Legacy_migration_task.md');
    await writeFile(taskPath, LEGACY_MIGRATION_TASK);
    return { root, tasksDir, taskPath };
}

describe('spur task CLI', () => {
    // ── verdict ──
    // The verdict command reads the answer file and writes .spur/run/<wbs>-verdict.json
    // relative to the process cwd (not the test cwd), so we pass an absolute --from-answer
    // and clean the emitted artifact afterward to keep the repo tree clean.
    const verdictArtifacts: string[] = [];
    afterAll(() => {
        for (const p of verdictArtifacts) rmSync(p, { force: true });
    });

    // Cover the scaffold-tests action (function-coverage gate for task.ts)

    test('migrate --dry-run reports M1-M8 and writes nothing', async () => {
        const { root, tasksDir, taskPath } = await seedMigrationCorpus();
        try {
            const before = await readFile(taskPath, 'utf8');
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'migrate', '--dry-run', '--folder', tasksDir], { cwd: root, output });

            expect(exitCode).toBe(0);
            expect(await readFile(taskPath, 'utf8')).toBe(before);
            const text = output.messages.join('\n');
            expect(text).toContain('Task corpus migration dry-run complete');
            for (const rule of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) {
                expect(text).toContain(`  ${rule}:`);
            }
            expect(text).toContain('50: modified');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    test('migrate --dry-run --json returns the full report envelope', async () => {
        const { root, tasksDir } = await seedMigrationCorpus();
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'migrate', '--dry-run', '--folder', tasksDir, '--json'], {
                cwd: root,
                output,
            });

            expect(exitCode).toBe(0);
            const parsed = JSON.parse(lastMessage(output));
            expect(parsed.ok).toBe(true);
            expect(parsed.dryRun).toBe(true);
            expect(parsed.corpusDir).toBe(tasksDir);
            expect(parsed.filesScanned).toBe(1);
            expect(parsed.filesModified).toBe(1);
            expect(parsed.fileReports[0].modified).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    test('migrate is idempotent on a fixture corpus', async () => {
        const { root, tasksDir, taskPath } = await seedMigrationCorpus();
        try {
            const firstOutput = createCapturedOutput();
            const firstExit = await main(['task', 'migrate', '--folder', tasksDir, '--json'], {
                cwd: root,
                output: firstOutput,
            });
            expect(firstExit).toBe(0);
            const firstReport = JSON.parse(lastMessage(firstOutput));
            expect(firstReport.filesModified).toBe(1);
            const afterFirst = await readFile(taskPath, 'utf8');

            const secondOutput = createCapturedOutput();
            const secondExit = await main(['task', 'migrate', '--folder', tasksDir, '--json'], {
                cwd: root,
                output: secondOutput,
            });
            expect(secondExit).toBe(0);
            const secondReport = JSON.parse(lastMessage(secondOutput));
            expect(secondReport.filesModified).toBe(0);
            expect(await readFile(taskPath, 'utf8')).toBe(afterFirst);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
