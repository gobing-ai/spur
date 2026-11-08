import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualityGateMain as main, runShellCommand } from '../../src/services/quality-gate';

// 1319 R1: a hung gate command is bounded. Before this, `runShellCommand` spawned `sh -c` with no
// deadline, so one infinite-loop test blocked the gate forever and left a core-burning orphan (the
// credit-sentry post-mortem). The bound is exit 2 / BLOCKED with the log tail, never a red gate, and
// never a receipt — a FAIL receipt at the tree would arm the no-progress skip and stop a retry.

function fixture(): { dir: string; run: (name: string) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'quality-gate-timeout-'));
    return { dir, run: (name: string) => join(dir, '.spur', 'run', name) };
}

function silenceStdout<T>(fn: () => T): T {
    const original = process.stdout.write;
    process.stdout.write = () => true;
    try {
        return fn();
    } finally {
        process.stdout.write = original;
    }
}

test('runShellCommand reports a timeout instead of blocking, and keeps the partial output', () => {
    const startedAtMs = Date.now();
    const result = runShellCommand('printf partial; sleep 5', undefined, undefined, 200);
    const elapsedMs = Date.now() - startedAtMs;

    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('partial');
    expect(elapsedMs).toBeLessThan(4_000);
});

test('runShellCommand leaves a fast command untouched', () => {
    const result = runShellCommand('printf done', undefined, undefined, 5_000);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.output).toBe('done');
});

test('a full-tier timeout writes BLOCKED + the findings tail and no receipt, exiting 2', () => {
    const { dir, run } = fixture();
    try {
        const code = silenceStdout(() =>
            main(
                ['run'],
                { wbs: '1319', qualityGateCmd: 'printf "hang start\\n"; sleep 5', gateTimeoutMs: '300' },
                { cwd: dir },
            ),
        );

        expect(code).toBe(2);
        expect(readFileSync(run('1319-test-gate.status'), 'utf8')).toBe('BLOCKED\n');
        const findings = readFileSync(run('1319-test-gate.findings'), 'utf8');
        expect(findings.startsWith('gate timeout after 300ms: printf "hang start\\n"; sleep 5')).toBe(true);
        expect(findings).toContain('hang start');
        expect(existsSync(run('1319-check-receipt.json'))).toBe(false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a recheck probe timeout is BLOCKED too, exiting 2', () => {
    const { dir, run } = fixture();
    try {
        // A green command keeps the tree clean; the probe is what hangs.
        writeFileSync(join(dir, 'bunfig.toml'), '');
        const code = silenceStdout(() =>
            main(
                ['recheck'],
                { wbs: '1319', qualityGateCmd: 'exit 0', gateProbeCmd: 'sleep 5', gateTimeoutMs: '300' },
                { cwd: dir },
            ),
        );

        expect(code).toBe(2);
        expect(readFileSync(run('1319-test-gate.status'), 'utf8')).toBe('BLOCKED\n');
        expect(readFileSync(run('1319-test-gate.findings'), 'utf8')).toContain('gate timeout after 300ms: sleep 5');
        expect(existsSync(run('1319-check-receipt.json'))).toBe(false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a malformed gateTimeoutMs is a usage error, never a silent default', () => {
    const writes: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: Uint8Array | string): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
        return true;
    }) as typeof process.stderr.write;
    try {
        for (const value of ['abc', '0', '-5']) {
            expect(main(['status'], { wbs: '1319', gateTimeoutMs: value })).toBe(2);
        }
        expect(writes.join('')).toContain('gateTimeoutMs must be a positive number');
    } finally {
        process.stderr.write = original;
    }
});
