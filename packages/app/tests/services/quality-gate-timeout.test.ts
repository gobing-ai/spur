import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuilderConfigSchema } from '@gobing-ai/spur-config';
import { qualityGateMain as main, runLightGate, runShellCommand } from '../../src/services/quality-gate';

// 1319 R1: a hung gate command is bounded. Before this, `runShellCommand` spawned `sh -c` with no
// deadline, so one infinite-loop test blocked the gate forever and left a core-burning orphan (the
// credit-sentry post-mortem). The bound is exit 2 / BLOCKED with the log tail, never a red gate, and
// never a receipt — a FAIL receipt at the tree would arm the no-progress skip and stop a retry.

function fixture(): { dir: string; run: (name: string) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'quality-gate-timeout-'));
    return { dir, run: (name: string) => join(dir, '.spur', 'run', name) };
}

/** Mute both streams so the suite output stays clean; stderr is captured for assertions. */
let capturedStderr = '';
function silenceStdout<T>(fn: () => T): T {
    const out = process.stdout.write;
    const err = process.stderr.write;
    capturedStderr = '';
    process.stdout.write = () => true;
    process.stderr.write = ((chunk: string | Uint8Array) => {
        capturedStderr += String(chunk);
        return true;
    }) as typeof process.stderr.write;
    try {
        return fn();
    } finally {
        process.stdout.write = out;
        process.stderr.write = err;
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
        expect(capturedStderr).toContain('quality gate BLOCKED — gate timeout after 300ms');
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
        expect(capturedStderr).toContain('quality gate BLOCKED — gate timeout after 300ms: sleep 5');
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

// 1319 AC2, light tier. Failure modes: the hung sub-check blocks the light run past its bound; the
// timeout is reported as a plain FAIL with no cause; a sibling check is skipped because one hung.
test('a light-tier sub-check timeout names the timeout on its log row and returns within the bound', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-gate-light-timeout-'));
    try {
        const sh = (cmd: string): void => {
            const result = runShellCommand(cmd, dir);
            if (result.code !== 0) throw new Error(`fixture: ${cmd} failed: ${result.output}`);
        };
        sh('git init -q -b main && git config user.email f@spur.dev && git config user.name f');
        writeFileSync(join(dir, '.gitignore'), '.spur/\n');
        mkdirSync(join(dir, 'pkg-a/src'), { recursive: true });
        writeFileSync(join(dir, 'pkg-a/package.json'), '{"name":"pkg-a"}\n');
        writeFileSync(join(dir, 'pkg-a/src/m.py'), 'x = 1\n');
        sh('git add . && git commit -qm init');
        writeFileSync(join(dir, 'pkg-a/src/m.py'), 'x = 2\n');
        const builder = BuilderConfigSchema.parse({
            preset: 'none',
            actions: { 'lint-changed': 'sleep 5', 'rules-pre': 'exit 0', 'rules-post': 'exit 0' },
        });

        const started = Date.now();
        const result = silenceStdout(() => runLightGate({ wbs: '1319l' }, { cwd: dir, builder, gateTimeoutMs: 300 }));
        expect(Date.now() - started).toBeLessThan(4000);
        expect(result.status).toBe('FAIL');
        const log = readFileSync(join(dir, result.logFile), 'utf8');
        expect(log).toMatch(/--- light format-lint:changed: FAIL \(timeout after 300ms, \d+ms elapsed\)/);
        expect(result.checks.map((check) => check.id)).toContain('rules:post');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
