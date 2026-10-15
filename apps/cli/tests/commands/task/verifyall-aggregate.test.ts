/**
 * Thin-wrapper integration tests for `spur task verifyall-aggregate` (apps/cli/src/commands/task/verifyall-aggregate.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-verifyall-aggregate-task-test-${Date.now()}`);
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
    // ── verdict ──
    // The verdict command reads the answer file and writes .spur/run/<wbs>-verdict.json
    // relative to the process cwd (not the test cwd), so we pass an absolute --from-answer
    // and clean the emitted artifact afterward to keep the repo tree clean.
    const verdictArtifacts: string[] = [];
    afterAll(() => {
        for (const p of verdictArtifacts) rmSync(p, { force: true });
    });

    // ── verifyall-aggregate (task 0341) ──────────────────────────────
    // Deterministic batch verdict rollup. Replaces agent-discretion prose
    // (dev-operations.md §3a). NOT-STARTED rows are excluded from the rollup
    // but reported in the summary so the operator sees them.
    async function writeBatchFile(rows: object[]): Promise<string> {
        const batchPath = join(cwd, '.spur', 'run', `batch-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        await mkdir(join(cwd, '.spur', 'run'), { recursive: true });
        await writeFile(batchPath, JSON.stringify(rows), 'utf-8');
        return batchPath;
    }

    // Cover the scaffold-tests action (function-coverage gate for task.ts)

    test('verifyall-aggregate: all-PASS rolls up to PASS, exit 0', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'PASS' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('PASS');
        expect(json.summary).toContain('2 PASS');
        expect(json.notStarted).toEqual([]);
    });
    test('verifyall-aggregate: NOT-STARTED excluded from rollup, batch still PASS (R2 dogfood)', async () => {
        // The bug 0341 fixed: 5 PASS + 2 NOT-STARTED must NOT roll up to FAIL.
        const batchPath = await writeBatchFile([
            { wbs: '0332', outcome: 'PASS' },
            { wbs: '0333', outcome: 'PASS' },
            { wbs: '0334', outcome: 'PASS' },
            { wbs: '0335', outcome: 'PASS' },
            { wbs: '0336', outcome: 'PASS' },
            { wbs: '0337', outcome: 'NOT-STARTED' },
            { wbs: '0338', outcome: 'NOT-STARTED' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('PASS');
        expect(json.notStarted.map((r: { wbs: string }) => r.wbs)).toEqual(['0337', '0338']);
        expect(json.summary).toContain('2 NOT-STARTED (excluded)');
    });
    test('verifyall-aggregate: any FAIL rolls up to FAIL, exit 1', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'FAIL' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath], { cwd, output });
        expect(exitCode).toBe(1);
        const msg = output.messages.join('\n');
        expect(msg).toContain('Batch verdict: FAIL');
    });
    test('verifyall-aggregate: all-NOT-STARTED rolls up to UNKNOWN, exit 0', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'NOT-STARTED' },
            { wbs: '0002', outcome: 'NOT-STARTED' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('UNKNOWN');
        expect(json.rolledUp).toEqual([]);
    });
    test('verifyall-aggregate: PARTIAL present (no FAIL) rolls up to PARTIAL', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'PARTIAL' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('PARTIAL');
    });
    test('verifyall-aggregate: UNKNOWN present rolls batch down to PARTIAL (cannot certify)', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'UNKNOWN' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('PARTIAL');
    });
    test('verifyall-aggregate: missing input file exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(
            ['task', 'verifyall-aggregate', '--from-file', join(cwd, 'nonexistent-batch.json')],
            { cwd, output },
        );
        expect(exitCode).toBe(1);
        expect(output.errors.join('\n')).toContain('Batch input file not found');
    });
    test('verifyall-aggregate: non-array JSON exits 1', async () => {
        const batchPath = join(cwd, '.spur', 'run', `obj-${Date.now()}.json`);
        await mkdir(join(cwd, '.spur', 'run'), { recursive: true });
        await writeFile(batchPath, JSON.stringify({ not: 'an array' }), 'utf-8');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('\n')).toContain('expected a JSON array');
    });
    test('verifyall-aggregate: non-JSON output surfaces NOT-STARTED WBS list explicitly', async () => {
        // The human-readable path must name the excluded NOT-STARTED tasks so the
        // operator sees them — not just the counts.
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'NOT-STARTED' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath], { cwd, output });
        expect(exitCode).toBe(0);
        const msg = output.messages.join('\n');
        expect(msg).toContain('Batch verdict: PASS');
        expect(msg).toContain('NOT-STARTED (excluded from rollup): 0002');
    });
    test('verifyall-aggregate: invalid outcome value exits 1', async () => {
        const batchPath = await writeBatchFile([{ wbs: '0001', outcome: 'BOGUS' }]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('\n')).toContain('Invalid outcome for 0001: BOGUS');
    });
});
