/**
 * history-load.test — unit coverage for the /sp:dev-history-load sequence script (task 0567).
 *
 * The script shells `spur history import|analyze|report --json`. These tests stub a fake
 * `spur` binary (shell script) that records its argv to a calls file and emits realistic
 * JSON shapes, so flag routing, exit-code propagation, dry-run, the empty-window guard,
 * and the single-object --json contract are all asserted without touching a real DB.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'history-load.ts');

// ─── Stub harness ────────────────────────────────────────────────────────────

interface StubEnv {
    /** Import fan-out exit code (0 ok, 1 all-failed, 2 mixed/degraded — 0569). */
    importExit?: string;
    /** Message count the fake analyze reports (0 = empty window). */
    messages?: string;
}

function writeStub(dir: string, env: StubEnv): { stub: string; calls: string; artifactPath: string; latest: string } {
    const stub = join(dir, 'spur');
    const calls = join(dir, 'calls.txt');
    const artifactPath = join(dir, '.spur', 'reports', 'history', '2026-08-16', 'analyze-test.json');
    const latest = join(dir, '.spur', 'reports', 'history', 'latest.json');
    const importExit = env.importExit ?? '0';
    const messages = env.messages ?? '7';
    writeFileSync(
        stub,
        `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
case "$1 $2" in
  "history import")
    if [ "${importExit}" = "1" ]; then
      printf '%s\\n' '{"entries":[{"source":"codex","status":"failed","files":0,"messages":0,"parseErrors":0,"validationErrors":0}],"exitCode":1,"warnings":[{"code":"source-failed","source":"codex","detail":"boom"}]}'
      exit 1
    fi
    if [ "${importExit}" = "2" ]; then
      printf '%s\\n' '{"entries":[{"source":"agy","status":"degraded","messages":10,"parseErrors":203,"validationErrors":0},{"source":"pi","status":"ok","messages":5,"parseErrors":0,"validationErrors":0}],"exitCode":2,"warnings":[{"code":"source-degraded","source":"agy","detail":"imported 10 records but skipped 203 parse error(s)"}]}'
      exit 2
    fi
    printf '%s\\n' '{"entries":[{"source":"claude","status":"ok","files":3,"messages":${messages}}],"exitCode":0,"warnings":[]}'
    exit 0
    ;;
  "history analyze")
    mkdir -p "$(dirname "${artifactPath}")"
    printf '%s\\n' "{\\"totals\\":{\\"messages\\":${messages}}}" > "${artifactPath}"
    ln -sf "${artifactPath}" "${latest}"
    printf '%s\\n' "{\\"totals\\":{\\"messages\\":${messages}}}"
    exit 0
    ;;
  "history report")
    printf '%s\\n' "REPORT of $5"
    exit 0
    ;;
esac
exit 0
`,
    );
    chmodSync(stub, 0o755);
    return { stub, calls, artifactPath, latest };
}

function runScript(
    dir: string,
    args: string[],
    env: StubEnv = {},
): { exitCode: number; stdout: string; stderr: string; calls: string[] } {
    const { stub, calls } = writeStub(dir, env);
    // Multi-token form mirrors production resolveSpurBin launch (bun <cli>).
    const r = Bun.spawnSync(['bun', SCRIPT, ...args], {
        cwd: dir,
        env: { ...process.env, SPUR_BIN: `/bin/sh ${stub}` },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        exitCode: r.exitCode ?? -1,
        stdout: new TextDecoder().decode(r.stdout ?? new Uint8Array()),
        stderr: new TextDecoder().decode(r.stderr ?? new Uint8Array()),
        calls: existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [],
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('history-load — flag routing to the verb that accepts it (R2/R4)', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'history-load-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test('--session/--task/--since/--until never reach import; --source reaches both', () => {
        const { exitCode, calls } = runScript(dir, [
            '--source',
            'omp',
            '--session',
            'sess-1',
            '--task',
            '0123',
            '--since',
            '2026-08-01',
            '--until',
            '2026-08-15',
        ]);
        expect(exitCode).toBe(0);
        const importLine = calls.find((c) => c.startsWith('history import'));
        const analyzeLine = calls.find((c) => c.startsWith('history analyze'));
        // Import argv: --source yes, narrowing flags never.
        expect(importLine).toContain('--source omp');
        expect(importLine).not.toContain('--session');
        expect(importLine).not.toContain('--task');
        expect(importLine).not.toContain('--since');
        expect(importLine).not.toContain('--until');
        // Analyze argv: all narrowing flags plus --source.
        expect(analyzeLine).toContain('--source omp');
        expect(analyzeLine).toContain('--session sess-1');
        expect(analyzeLine).toContain('--task 0123');
        expect(analyzeLine).toContain('--since 2026-08-01');
        expect(analyzeLine).toContain('--until 2026-08-15');
    });

    test('bare invocation runs import then analyze, in that order', () => {
        const { exitCode, calls } = runScript(dir, []);
        expect(exitCode).toBe(0);
        const importIdx = calls.findIndex((c) => c.startsWith('history import'));
        const analyzeIdx = calls.findIndex((c) => c.startsWith('history analyze'));
        expect(importIdx).toBeGreaterThanOrEqual(0);
        expect(analyzeIdx).toBeGreaterThan(importIdx);
    });
});

describe('history-load — failure paths (R5)', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'history-load-fail-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test('non-zero import exit skips analyze and propagates the exit code', () => {
        const { exitCode, stderr, calls } = runScript(dir, ['--source', 'codex'], { importExit: '1' });
        expect(exitCode).toBe(1);
        expect(stderr).toContain('codex');
        expect(calls.some((c) => c.startsWith('history analyze'))).toBe(false);
    });

    test('exit 1 (all-failed) bare run — analyze is never invoked, exit 1 propagates (0569 R2)', () => {
        const { exitCode, stderr, calls } = runScript(dir, [], { importExit: '1' });
        expect(exitCode).toBe(1);
        expect(stderr).toContain('codex');
        expect(calls.some((c) => c.startsWith('history analyze'))).toBe(false);
    });

    test('a zero-row window exits non-zero and names the empty window', () => {
        const { exitCode, stderr } = runScript(dir, ['--since', '2026-01-01', '--until', '2026-01-02'], {
            messages: '0',
        });
        expect(exitCode).toBe(1);
        expect(stderr).toContain('zero messages');
    });

    test('unknown flags are a hard error (exit 2)', () => {
        const { exitCode } = runScript(dir, ['--bogus']);
        expect(exitCode).toBe(2);
    });
});

describe('history-load — output contracts (R4/R7)', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'history-load-out-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test('--dry-run runs import --dry-run, writes no artifact, prints the sequence', () => {
        const { exitCode, stdout, calls } = runScript(dir, ['--dry-run', '--report']);
        expect(exitCode).toBe(0);
        expect(calls.find((c) => c.startsWith('history import'))).toContain('--dry-run');
        expect(calls.some((c) => c.startsWith('history analyze'))).toBe(false);
        expect(existsSync(join(dir, '.spur', 'reports', 'history', 'latest.json'))).toBe(false);
        expect(stdout).toContain('[dry-run]');
        expect(stdout).toContain('history analyze');
        expect(stdout).toContain('history report --mode forensics');
    });

    test('--json emits exactly one object with import, artifact, reported, status', () => {
        const { exitCode, stdout } = runScript(dir, ['--json']);
        expect(exitCode).toBe(0);
        const lines = stdout.trim().split('\n');
        expect(lines).toHaveLength(1);
        const obj = JSON.parse(lines[0] as string) as {
            import: { entries: Array<{ status: string; messages: number }> };
            artifact: string;
            reported: boolean;
            status: string;
        };
        expect(obj.status).toBe('ok');
        expect(obj.artifact).toContain('.spur/reports/history');
        expect(obj.reported).toBe(false);
        expect(obj.import.entries[0]?.status).toBe('ok');
        expect(obj.import.entries[0]?.messages).toBe(7);
    });

    test('--report renders the forensics report against the written artifact', () => {
        const { exitCode, stdout } = runScript(dir, ['--report']);
        expect(exitCode).toBe(0);
        expect(stdout).toContain('artifact:');
        expect(stdout).toContain('REPORT of');
    });
});

describe('history-load — degraded fan-out tolerance (0569 R1/R2)', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'history-load-degraded-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test('exit 2 proceeds to analyze, exits 0, and the JSON payload carries warnings naming the degraded source', () => {
        const { exitCode, stdout, stderr, calls } = runScript(dir, ['--json'], { importExit: '2' });
        expect(exitCode).toBe(0);
        expect(calls.some((c) => c.startsWith('history analyze'))).toBe(true);
        const lines = stdout.trim().split('\n');
        expect(lines).toHaveLength(1);
        const obj = JSON.parse(lines[0] as string) as {
            status: string;
            warnings?: Array<{
                source: string;
                status: string;
                parseErrors: number;
                validationErrors: number;
                detail: string;
            }>;
        };
        expect(obj.status).toBe('ok');
        expect(obj.warnings).toHaveLength(1);
        const w = obj.warnings?.[0];
        expect(w?.source).toBe('agy');
        expect(w?.status).toBe('degraded');
        expect(w?.parseErrors).toBe(203);
        expect(w?.validationErrors).toBe(0);
        expect(w?.detail).toContain('203 parse error(s)');
        // JSON mode must not interleave the human warning into the single-object contract.
        expect(stderr).toBe('');
    });

    test('exit 2 in human mode warns on stderr naming the degraded source and its counts', () => {
        const { exitCode, stderr, calls } = runScript(dir, [], { importExit: '2' });
        expect(exitCode).toBe(0);
        expect(calls.some((c) => c.startsWith('history analyze'))).toBe(true);
        expect(stderr).toContain('degraded');
        expect(stderr).toContain('agy');
        expect(stderr).toContain('203');
        expect(stderr).toContain('validationErrors=0');
    });

    test('a clean fan-out payload has no warnings field (R5: clean-run payload unchanged)', () => {
        const { exitCode, stdout } = runScript(dir, ['--json'], { importExit: '0' });
        expect(exitCode).toBe(0);
        const obj = JSON.parse(stdout.trim()) as { warnings?: unknown };
        expect(obj.warnings).toBeUndefined();
    });
});
