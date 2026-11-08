import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    citedTestFiles,
    formatReplayReport,
    REPLAY_MAX_FILES,
    replayCitedTests,
    replayWorkspace,
} from '../../src/services/verdict-replay';

// 1319 R4: a PASS must be re-earned from the evidence it cites. These cover the pure selection
// (which files, in what order, how many) and the runner's failure classification with an injected
// executor, so no real test suite runs here.

test('citedTestFiles keeps cited test files in first-cited order, deduped and capped', () => {
    const rows = [
        { evidence: '`apps/cli/tests/a.test.ts:10-20` proves it; `apps/cli/src/a.ts:5` is the source' },
        { evidence: 'also `apps/cli/tests/a.test.ts:30` and `packages/app/tests/b.spec.ts:1`' },
        { evidence: 'no anchor here' },
        { evidence: '`apps/cli/tests/c.test.ts:1`' },
        { evidence: '`apps/cli/tests/d.test.ts:1`' },
        { evidence: '`apps/cli/tests/e.test.ts:1`' },
        { evidence: '`apps/cli/tests/f.test.ts:1`' },
    ];

    const files = citedTestFiles(rows);

    expect(files.slice(0, 3)).toEqual([
        'apps/cli/tests/a.test.ts',
        'packages/app/tests/b.spec.ts',
        'apps/cli/tests/c.test.ts',
    ]);
    expect(files).toHaveLength(REPLAY_MAX_FILES);
    expect(files).not.toContain('apps/cli/src/a.ts');
});

test('replayWorkspace maps a cited path to its owning workspace', () => {
    expect(replayWorkspace('apps/cli/tests/a.test.ts')).toBe('apps/cli');
    expect(replayWorkspace('packages/app/tests/b.test.ts')).toBe('packages/app');
    expect(replayWorkspace('scripts/commands/x.test.ts')).toBe('.');
});

function stubExecutor(outcome: { exitCode: number | null; timedOut?: boolean }) {
    const calls: Array<{ command: string; args?: string[] }> = [];
    const executor = {
        run: async (options: { command: string; args?: string[] }) => {
            calls.push({ command: options.command, args: options.args });
            return {
                command: options.command,
                args: options.args ?? [],
                durationMs: 1,
                stdout: '',
                stderr: '',
                exitCode: outcome.exitCode,
                ...(outcome.timedOut === true ? { outcome: 'timeout' as const } : {}),
            };
        },
    } as unknown as Pick<ProcessExecutor, 'run'>;
    return { executor, calls };
}

function repo(files: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'verdict-replay-'));
    for (const file of files) {
        mkdirSync(join(dir, file, '..'), { recursive: true });
        writeFileSync(join(dir, file), '// cited\n');
    }
    return dir;
}

test('a cited file that passes produces no finding and is recorded as run', async () => {
    const cwd = repo(['apps/cli/tests/a.test.ts']);
    const { executor } = stubExecutor({ exitCode: 0 });
    try {
        const result = await replayCitedTests([{ evidence: '`apps/cli/tests/a.test.ts:1-2`' }], { cwd, executor });

        expect(result.files).toEqual(['apps/cli/tests/a.test.ts']);
        expect(result.ran).toEqual([{ file: 'apps/cli/tests/a.test.ts', exitCode: 0 }]);
        expect(result.findings).toEqual([]);
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});

test('a failing cited file and a missing one each produce a finding', async () => {
    const cwd = repo(['apps/cli/tests/a.test.ts']);
    const { executor } = stubExecutor({ exitCode: 1 });
    try {
        const result = await replayCitedTests(
            [{ evidence: '`apps/cli/tests/a.test.ts:1` and `apps/cli/tests/gone.test.ts:3`' }],
            { cwd, executor },
        );

        expect(result.findings).toContainEqual({
            anchor: 'apps/cli/tests/a.test.ts',
            file: 'apps/cli/tests/a.test.ts',
            exitCode: 1,
        });
        expect(result.findings).toContainEqual({
            anchor: 'apps/cli/tests/gone.test.ts',
            file: 'apps/cli/tests/gone.test.ts',
            missing: true,
        });
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});

test('a cited file that times out is reported as timedOut, not as a bare exit code', async () => {
    const cwd = repo(['apps/cli/tests/a.test.ts']);
    const { executor } = stubExecutor({ exitCode: null, timedOut: true });
    try {
        const result = await replayCitedTests([{ evidence: '`apps/cli/tests/a.test.ts:1`' }], { cwd, executor });

        expect(result.findings).toEqual([
            { anchor: 'apps/cli/tests/a.test.ts', file: 'apps/cli/tests/a.test.ts', timedOut: true, exitCode: null },
        ]);
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});

test('nothing cited means nothing runs', async () => {
    const { executor, calls } = stubExecutor({ exitCode: 0 });

    const result = await replayCitedTests([{ evidence: '`apps/cli/src/a.ts:10`' }], { executor });

    expect(result.files).toEqual([]);
    expect(calls).toEqual([]);
});

test('the replay report names each finding and counts both sides', () => {
    const report = formatReplayReport({
        files: ['apps/cli/tests/a.test.ts', 'apps/cli/tests/b.test.ts'],
        ran: [{ file: 'apps/cli/tests/a.test.ts', exitCode: 1 }],
        findings: [
            { anchor: 'apps/cli/tests/a.test.ts', file: 'apps/cli/tests/a.test.ts', exitCode: 1 },
            { anchor: 'apps/cli/tests/b.test.ts', file: 'apps/cli/tests/b.test.ts', missing: true },
            { anchor: 'apps/cli/tests/c.test.ts', file: 'apps/cli/tests/c.test.ts', timedOut: true, exitCode: null },
        ],
    });

    expect(report.summary).toBe('Replay: 2 cited test file(s), 3 finding(s)');
    expect(report.findings).toEqual([
        '  apps/cli/tests/a.test.ts: exit 1',
        '  apps/cli/tests/b.test.ts: missing',
        '  apps/cli/tests/c.test.ts: timed out',
    ]);
});

test('an unknown exit code is reported as unknown, never as success', () => {
    const report = formatReplayReport({
        files: ['apps/cli/tests/a.test.ts'],
        ran: [],
        findings: [{ anchor: 'apps/cli/tests/a.test.ts', file: 'apps/cli/tests/a.test.ts', exitCode: null }],
    });

    expect(report.findings).toEqual(['  apps/cli/tests/a.test.ts: exit unknown']);
});

test('an unbound test-changed binding skips the file instead of calling it missing', async () => {
    const cwd = repo(['apps/cli/tests/a.test.ts']);
    const { executor, calls } = stubExecutor({ exitCode: 0 });
    try {
        // `preset: none` with no declared binding resolves `test-changed` to unbound.
        const result = await replayCitedTests([{ evidence: '`apps/cli/tests/a.test.ts:1`' }], {
            cwd,
            executor,
            builder: { preset: 'none', actions: {} },
        });

        expect(result.files).toEqual(['apps/cli/tests/a.test.ts']);
        expect(result.ran).toEqual([]);
        expect(result.findings).toEqual([]);
        expect(calls).toEqual([]);
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
