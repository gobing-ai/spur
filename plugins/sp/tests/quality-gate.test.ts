import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    extractFindings,
    isTransientLock,
    MAX_FINDINGS,
    main,
    parseCoverageThreshold,
    QUALITY_GATE_USAGE,
    type QualityGateResult,
    runQualityGate,
    runShellCommand,
    scanCoverageShortfalls,
    tailLines,
} from '../scripts/quality-gate';

/** Scratch repo dir with `.spur/run` pre-created; absolute paths baked into gate scripts. */
function scratch(prefix: string): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function executable(dir: string, name: string, body: string): string {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
}

function gate(
    mode: 'run' | 'recheck',
    dir: string,
    script: string,
    extra: Record<string, string> = {},
): QualityGateResult {
    // runQualityGate tees its retry/PASS/FAIL status lines to process.stdout; in-process
    // invocation would otherwise leak them into the bun test reporter stream.
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;
    try {
        return runQualityGate(
            mode,
            { wbs: '0823', qualityGateCmd: script, SPUR_QUALITY_GATE_RETRY_DELAY_MS: '0', ...extra },
            { cwd: dir },
        );
    } finally {
        process.stdout.write = originalWrite;
    }
}

describe('quality-gate script (0823 d)', () => {
    test('run mode: a lock failure retries, then passes when the lock clears', () => {
        const { dir, cleanup } = scratch('spur-qg-clear-');
        try {
            const counter = join(dir, 'counter');
            const script = executable(
                dir,
                'gate.sh',
                `n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "${counter}"; ` +
                    `if [ "$n" -eq 1 ]; then echo 'SQLiteError: database is locked' >&2; exit 1; fi; echo PASS`,
            );
            const result = gate('run', dir, script);
            expect(result.status).toBe('PASS');
            expect(result.attempts).toBe(2);
            expect(readFileSync(join(dir, '.spur/run/0823-test-gate.status'), 'utf8')).toBe('PASS\n');
            const log = readFileSync(join(dir, '.spur/run/0823-test-gate.log'), 'utf8');
            expect(log).toContain('SQLiteError: database is locked');
            expect(log).toContain('retrying (1/5)');
            // run mode resets the fix-attempt counter; the log carries the proof digest line.
            expect(readFileSync(join(dir, '.spur/run/0823-test-fix-attempt'), 'utf8')).toBe('0\n');
            expect(log).toContain('proof-digest:');
        } finally {
            cleanup();
        }
    });

    test('run mode: persistent lock failures stop after five attempts and keep the lock error', () => {
        const { dir, cleanup } = scratch('spur-qg-stuck-');
        try {
            const counter = join(dir, 'counter');
            const script = executable(
                dir,
                'gate.sh',
                `n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "${counter}"; ` +
                    `echo 'SQLiteError: database is locked' >&2; exit 1`,
            );
            const result = gate('run', dir, script);
            expect(result.status).toBe('FAIL');
            expect(result.attempts).toBe(5);
            expect(readFileSync(counter, 'utf8').trim()).toBe('5');
            expect(readFileSync(join(dir, '.spur/run/0823-test-gate.status'), 'utf8')).toBe('FAIL\n');
            expect(readFileSync(join(dir, '.spur/run/0823-test-gate.log'), 'utf8')).toContain(
                'SQLiteError: database is locked',
            );
        } finally {
            cleanup();
        }
    });

    test('run mode: non-lock failures fail on the first attempt without retrying', () => {
        const { dir, cleanup } = scratch('spur-qg-hard-');
        try {
            const counter = join(dir, 'counter');
            const script = executable(
                dir,
                'gate.sh',
                `n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "${counter}"; ` +
                    `echo 'ENOCONFIG: unrelated failure' >&2; exit 3`,
            );
            const result = gate('run', dir, script);
            expect(result.status).toBe('FAIL');
            expect(result.attempts).toBe(1);
            expect(readFileSync(counter, 'utf8').trim()).toBe('1');
        } finally {
            cleanup();
        }
    });

    test('recheck mode: a red probe is the verdict — the full gate is skipped (0587 R3)', () => {
        const { dir, cleanup } = scratch('spur-qg-probe-red-');
        try {
            const probe = executable(dir, 'probe.sh', 'echo lint-diagnostic; exit 1');
            const ran = join(dir, 'gate-ran');
            const full = executable(dir, 'gate.sh', `touch "${ran}"; exit 0`);
            const result = gate('recheck', dir, full, { gateProbeCmd: probe });
            expect(result.status).toBe('FAIL');
            expect(result.attempts).toBe(0);
            expect(existsSync(ran)).toBe(false);
            expect(readFileSync(join(dir, '.spur/run/0823-test-gate.log'), 'utf8')).toContain('lint-diagnostic');
            expect(readFileSync(join(dir, '.spur/run/0823-test-gate.status'), 'utf8')).toBe('FAIL\n');
        } finally {
            cleanup();
        }
    });

    test('recheck mode: a green probe runs the full gate', () => {
        const { dir, cleanup } = scratch('spur-qg-probe-green-');
        try {
            const probe = executable(dir, 'probe.sh', 'exit 0');
            const ran = join(dir, 'gate-ran');
            const full = executable(dir, 'gate.sh', `touch "${ran}"; exit 0`);
            const result = gate('recheck', dir, full, { gateProbeCmd: probe });
            expect(result.status).toBe('PASS');
            expect(result.attempts).toBe(1);
            expect(existsSync(ran)).toBe(true);
        } finally {
            cleanup();
        }
    });

    test('bounded summary (0772 R1): red prints the last 40 lines plus the log path; the log keeps everything', () => {
        const { dir, cleanup } = scratch('spur-qg-summary-');
        try {
            const script = executable(dir, 'gate.sh', 'for i in $(seq 1 60); do echo "line-$i"; done; exit 1');
            const result = gate('run', dir, script);
            expect(result.status).toBe('FAIL');
            const log = readFileSync(join(dir, '.spur/run/0823-test-gate.log'), 'utf8');
            expect(log).toContain('line-1');
            expect(log).toContain('line-60');
            // Findings file: unique anchors only (the loop echoes no file:line anchors).
            expect(readFileSync(join(dir, '.spur/run/0823-test-gate.findings'), 'utf8')).toBe('');
        } finally {
            cleanup();
        }
    });

    test('findings extraction: unique file:line anchors, sorted, capped at MAX_FINDINGS', () => {
        const anchors: string[] = [];
        for (let i = 0; i < MAX_FINDINGS + 10; i++) anchors.push(`src/mod${i}.ts:${i}`);
        const text = `${anchors.join('\n')}\n${anchors[0]}\nnoise without anchors\n`;
        const out = extractFindings(text);
        const parts = out.split(' ').filter(Boolean);
        expect(parts.length).toBe(MAX_FINDINGS);
        expect(new Set(parts).size).toBe(MAX_FINDINGS);
        expect(out.endsWith(' ')).toBe(true);
    });

    test('tailLines: keeps at most the requested trailing lines', () => {
        const text = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`).join('\n');
        const tail = tailLines(text, 40);
        expect(tail.split('\n').filter(Boolean).length).toBe(40);
        expect(tail).toContain('line-60');
        expect(tail).not.toContain('line-19\n');
    });

    test('lock classifier: lock families match, unrelated failures do not', () => {
        expect(isTransientLock('SQLiteError: database is locked')).toBe(true);
        expect(isTransientLock('SQLite database /tmp/x/.spur/spur.db is busy')).toBe(true);
        expect(isTransientLock('SQLITE_BUSY: checkpoint starvation')).toBe(true);
        expect(isTransientLock('ENOCONFIG: unrelated failure')).toBe(false);
        expect(isTransientLock('SQLITE_BUSY checkpoint starvation (code 5)')).toBe(true);
    });

    test('main: a bad mode and a missing wbs each exit 2 with the reason on stderr', () => {
        const writes: string[] = [];
        const original = process.stderr.write;
        process.stderr.write = ((chunk: Uint8Array | string): boolean => {
            writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
            return true;
        }) as typeof process.stderr.write;
        try {
            expect(main([], {})).toBe(2);
            expect(writes.join('')).toBe(`${QUALITY_GATE_USAGE}\n`);
            expect(main(['run'], { wbs: '' })).toBe(2);
            expect(writes.join('')).toContain('quality-gate: env `wbs` is required\n');
        } finally {
            process.stderr.write = original;
        }
    });

    test('runShellCommand: a spawn failure (missing cwd) returns code 1 with the error text', () => {
        const { dir, cleanup } = scratch('spur-qg-spawn-err-');
        try {
            const result = runShellCommand('echo should-not-run', join(dir, 'no-such-cwd'));
            expect(result.code).toBe(1);
            expect(result.output).toContain('sh -c failed: ');
            expect(result.output).toContain('ENOENT');
        } finally {
            cleanup();
        }
    });

    test('runShellCommand preserves mixed stream order and captures output beyond the pipe buffer', () => {
        const result = runShellCommand('printf first; printf second >&2; printf third', undefined);
        expect(result).toEqual({ code: 0, output: 'firstsecondthird' });
        const large = runShellCommand('head -c 2097152 /dev/zero', undefined);
        expect(large.code).toBe(0);
        expect(large.output.length).toBe(2097152);
    });
});

// ─── Coverage-only failure findings (0862 R2) ────────────────────────────────

/** Emits a bun-test summary with `0 fail` plus a coverage table, then exits non-zero. */
const COVERAGE_ONLY_GATE = [
    "printf '%s\\n' ' 3 pass'",
    "printf '%s\\n' ' 0 fail'",
    "printf '%s\\n' 'File             | % Funcs | % Lines | Uncovered Line #s'",
    "printf '%s\\n' ' src/short.ts    |   50.00 |   80.00 | 12,13'",
    "printf '%s\\n' ' src/ok.ts       |  100.00 |  100.00 |'",
    'exit 1',
].join('\n');

describe('coverage shortfall findings (0862 R2)', () => {
    test('a coverage-only failure names the under-threshold row as a findings anchor', () => {
        const { dir, cleanup } = scratch('spur-qg-coverage-');
        try {
            writeFileSync(join(dir, 'bunfig.toml'), '[test]\ncoverageThreshold = { lines = 0.9, functions = 0.9 }\n');
            const script = executable(dir, 'gate.sh', COVERAGE_ONLY_GATE);
            const result = gate('run', dir, script);

            expect(result.status).toBe('FAIL');
            const findings = readFileSync(join(dir, '.spur/run/0823-test-gate.findings'), 'utf8');
            expect(findings).toContain('src/short.ts:12');
            expect(findings).not.toContain('src/ok.ts');
            expect(readFileSync(join(dir, '.spur/run/0823-test-gate.log'), 'utf8')).toContain(
                'coverage shortfall src/short.ts:12 funcs=50.00 lines=80.00',
            );
        } finally {
            cleanup();
        }
    });

    test('a real test failure leaves the findings unchanged', () => {
        const { dir, cleanup } = scratch('spur-qg-real-fail-');
        try {
            writeFileSync(join(dir, 'bunfig.toml'), '[test]\ncoverageThreshold = { lines = 0.9, functions = 0.9 }\n');
            const script = executable(dir, 'gate.sh', `${COVERAGE_ONLY_GATE.replace("' 0 fail'", "' 1 fail'")}`);
            const result = gate('run', dir, script);

            expect(result.status).toBe('FAIL');
            const findings = readFileSync(join(dir, '.spur/run/0823-test-gate.findings'), 'utf8');
            expect(findings).not.toContain('src/short.ts');
        } finally {
            cleanup();
        }
    });

    test('no bunfig threshold leaves the findings unchanged', () => {
        const { dir, cleanup } = scratch('spur-qg-no-threshold-');
        try {
            const script = executable(dir, 'gate.sh', COVERAGE_ONLY_GATE);
            const result = gate('run', dir, script);

            expect(result.status).toBe('FAIL');
            expect(readFileSync(join(dir, '.spur/run/0823-test-gate.findings'), 'utf8')).not.toContain('src/short.ts');
        } finally {
            cleanup();
        }
    });

    test('parseCoverageThreshold: per-axis keys, absent setting, unparseable text', () => {
        expect(parseCoverageThreshold('coverageThreshold = { lines = 0.9, functions = 0.8 }')).toEqual({
            functions: 0.8,
            lines: 0.9,
        });
        expect(parseCoverageThreshold('coverageThreshold = { lines = 0.9 }')).toEqual({ lines: 0.9 });
        expect(parseCoverageThreshold('[test]\ncoverage = true\n')).toBeNull();
        expect(parseCoverageThreshold('coverageThreshold = { lines = nope }')).toBeNull();
    });

    test('scanCoverageShortfalls: first uncovered line, dedupe by path, `1` when the column is empty', () => {
        const table = [
            'File             | % Funcs | % Lines | Uncovered Line #s',
            ' src/a.ts       |   50.00 |   80.00 | 12,13',
            ' src/a.ts       |   50.00 |   80.00 | 12,13',
            ' src/b.ts       |   10.00 |   99.00 |',
            ' src/ok.ts      |  100.00 |  100.00 |',
            'All files        |   43.00 |   40.00 |',
        ].join('\n');

        expect(scanCoverageShortfalls(table, { lines: 0.9, functions: 0.9 })).toEqual([
            'quality gate: coverage shortfall src/a.ts:12 funcs=50.00 lines=80.00',
            'quality gate: coverage shortfall src/b.ts:1 funcs=10.00 lines=99.00',
        ]);
        // One axis only: b.ts's functions are low, a.ts clears the lines floor.
        expect(scanCoverageShortfalls(table, { lines: 0.9 })).toEqual([
            'quality gate: coverage shortfall src/a.ts:12 funcs=50.00 lines=80.00',
        ]);
    });
});

describe('check-receipt write on run (0939 R2)', () => {
    test('run with proofDigest writes a full-tier receipt bound to the digest', () => {
        const { dir, cleanup } = scratch('spur-qg-receipt-');
        try {
            const script = executable(dir, 'gate.sh', 'echo ok');
            const result = gate('run', dir, script, { proofDigest: 'digest-1' });
            expect(result.status).toBe('PASS');
            expect(result.receiptFile).toBe('.spur/run/0823-check-receipt.json');
            const stored = JSON.parse(readFileSync(join(dir, '.spur/run/0823-check-receipt.json'), 'utf8')) as Record<
                string,
                unknown
            >;
            expect(stored.schemaVersion).toBe('check-receipt/v1');
            expect(stored.wbs).toBe('0823');
            expect(stored.runId).toBe('pipeline-0823');
            expect(stored.tier).toBe('full');
            expect(stored.inputDigest).toBe('digest-1');
            expect(stored.status).toBe('PASS');
            expect(Number.isNaN(Date.parse(stored.completedAt as string))).toBe(false);
            expect(stored.checks).toEqual([
                {
                    id: 'test',
                    cmd: script,
                    status: 'PASS',
                    durationMs: expect.any(Number),
                    logPath: '.spur/run/0823-test-gate.log',
                },
            ]);
        } finally {
            cleanup();
        }
    });

    test('run honors an explicit runId; a FAIL run writes a FAIL receipt', () => {
        const { dir, cleanup } = scratch('spur-qg-receipt-id-');
        try {
            const script = executable(dir, 'gate.sh', 'exit 1');
            const result = gate('run', dir, script, { proofDigest: 'd', runId: 'run-42' });
            expect(result.status).toBe('FAIL');
            const stored = JSON.parse(readFileSync(join(dir, '.spur/run/0823-check-receipt.json'), 'utf8')) as Record<
                string,
                unknown
            >;
            expect(stored.runId).toBe('run-42');
            expect(stored.status).toBe('FAIL');
        } finally {
            cleanup();
        }
    });

    test('run without proofDigest writes no receipt and the log says why; recheck never writes one', () => {
        const { dir, cleanup } = scratch('spur-qg-receipt-absent-');
        try {
            const script = executable(dir, 'gate.sh', 'echo ok');
            gate('run', dir, script);
            expect(existsSync(join(dir, '.spur/run/0823-check-receipt.json'))).toBe(false);
            expect(readFileSync(join(dir, '.spur/run/0823-test-gate.log'), 'utf8')).toContain(
                'check-receipt: not written — env `proofDigest` is not set',
            );
            gate('recheck', dir, script, { proofDigest: 'digest-1' });
            expect(existsSync(join(dir, '.spur/run/0823-check-receipt.json'))).toBe(false);
        } finally {
            cleanup();
        }
    });
});
