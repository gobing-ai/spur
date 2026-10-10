import { expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getEnvVar, getEnvVars, setEnvVar } from '@gobing-ai/ts-utils';
import {
    main,
    verdictFromTestingSection,
    WBS_PATTERN,
    WRAPUP_STEPS_USAGE,
    type WrapupStepsEnv,
    writeRouteReason,
} from '../scripts/wrapup-steps';

/**
 * 0824: execution pins for the wrapup-steps plugin script, migrated from the workflow
 * suite (`packages/app/tests/workflow/wrapup-pipeline.test.ts`), which now pins wrapper
 * delegation and fail-closed routing instead of the implementation. These tests call the
 * exported `main(argv, env, { cwd })` — the same entry the spawned script and its node
 * twin run under `import.meta.main`.
 */

interface FtStubOptions {
    syncOut: string;
    syncRc?: number;
    showStatus?: string;
    checkRc?: number;
}

function cleanup(cwd: string): void {
    rmSync(cwd, { recursive: true, force: true });
}

function capture(): { out: () => string; err: () => string; restore: () => void } {
    let out = '';
    let err = '';
    const outSpy = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        out += String(chunk);
        return true;
    });
    const errSpy = spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        err += String(chunk);
        return true;
    });
    return {
        out: () => out,
        err: () => err,
        restore: () => {
            outSpy.mockRestore();
            errSpy.mockRestore();
        },
    };
}

function writeResolveStub(cwd: string, json: string): string {
    const stub = join(cwd, 'stub-spur');
    writeFileSync(stub, `#!/bin/sh\necho '${json}'\n`);
    chmodSync(stub, 0o755);
    return stub;
}

/**
 * Stub `spur` whose `task show` prints a JSON payload file, so task content carrying
 * newlines and quotes survives the shell unescaped.
 */
function writeTaskShowStub(cwd: string, payload: unknown): string {
    const jsonFile = join(cwd, 'stub-payload.json');
    writeFileSync(jsonFile, JSON.stringify(payload));
    const stub = join(cwd, 'stub-spur');
    writeFileSync(stub, `#!/bin/sh\ncase "$1 $2" in "task show") cat '${jsonFile}';; esac\nexit 0\n`);
    chmodSync(stub, 0o755);
    return stub;
}

/** One metrics row written by a single-task run; throws when the run wrote none. */
function onlyMetricsRow(cwd: string): Record<string, string> {
    const raw = readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'), 'utf8').trim();
    return JSON.parse(raw.split('\n')[0] ?? '') as Record<string, string>;
}

/**
 * Stub spurBin dispatching `feature sync` / `feature show` / `feature check`, with a
 * failing `superskill` earlier on PATH so the producer chain deterministically takes the
 * plain `spur feature sync` branch (the temp cwd has no plugins/ scaffold).
 */
function stubFeatureEnv(cwd: string, opts: FtStubOptions): WrapupStepsEnv {
    const { syncOut, syncRc = 0, showStatus = 'active', checkRc = 0 } = opts;
    const stub = join(cwd, 'stub-spur');
    writeFileSync(
        stub,
        [
            '#!/bin/sh',
            'case "$1 $2" in',
            `  "feature sync") printf '%s' '${syncOut}'; exit ${syncRc};;`,
            `  "feature show") printf '{"status":"${showStatus}"}\\n'; exit 0;;`,
            `  "feature check") exit ${checkRc};;`,
            'esac',
            'exit 99',
            '',
        ].join('\n'),
    );
    chmodSync(stub, 0o755);
    const superskill = join(cwd, 'superskill');
    writeFileSync(superskill, '#!/bin/sh\nexit 1\n');
    chmodSync(superskill, 0o755);
    return {
        spurBin: stub,
        featureGateCmd: `${stub} feature check "$feature"`,
    };
}

/** Runs the script with a temp cwd plus a stub-first PATH (for the superskill probe). */
function runSteps(argv: string[], env: WrapupStepsEnv, cwd: string): { code: number; out: string; err: string } {
    const prevPath = getEnvVar('PATH');
    const cap = capture();
    setEnvVar('PATH', `${cwd}${prevPath ? `:${prevPath}` : ''}`);
    try {
        const code = main(argv, { ...getEnvVars(), ...env }, { cwd });
        return { code, out: cap.out(), err: cap.err() };
    } finally {
        setEnvVar('PATH', prevPath);
        cap.restore();
    }
}

test('0824 wrapup-steps rejects unknown subcommands with usage and exit 2', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-usage-'));
    try {
        const run = runSteps(['bogus'], {}, cwd);
        expect(run.code).toBe(2);
        expect(run.err).toContain(WRAPUP_STEPS_USAGE);
    } finally {
        cleanup(cwd);
    }
});

test('0824 wrapup-steps canonical WBS pattern is the four-digit anchored regex', () => {
    // Moved with the logic: the workflow suite may no longer inline this regex.
    expect(WBS_PATTERN.source).toBe('^[0-9]{4}$');
});

test('malformed JSON records FAIL and never produces a normalized list', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-resolve-'));
    try {
        const run = runSteps(['resolve'], { __runId: 'r-bad', tasks: '{oops', spurBin: 'true' }, cwd);
        expect(run.code).toBe(0);
        expect(run.err).toContain('canonical four-digit WBS strings');
        expect(readFileSync(join(cwd, '.spur/run/r-bad-wrapup-resolve.status'), 'utf8')).toContain('FAIL');
        expect(readFileSync(join(cwd, '.spur/run/r-bad-route-reason.txt'), 'utf8')).toContain(
            'failed:tasks is not a JSON array',
        );
        expect(() => readFileSync(join(cwd, '.spur/run/r-bad-wrapup-tasks.json'))).toThrow();
    } finally {
        cleanup(cwd);
    }
});

test('an empty run id fails loud instead of the legacy fixed-path fallback', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-resolve-'));
    try {
        const run = runSteps(['resolve'], { __runId: '', tasks: '[]', spurBin: 'true' }, cwd);
        expect(run.code).toBe(1);
        expect(run.err).toContain('__runId is empty');
    } finally {
        cleanup(cwd);
    }
});

test('a task that does not resolve to a completed status records FAIL', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-resolve-'));
    try {
        const run = runSteps(['resolve'], { __runId: 'r-unres', tasks: '["0001"]', spurBin: 'true' }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-unres-wrapup-resolve.status'), 'utf8')).toContain('FAIL');
        expect(readFileSync(join(cwd, '.spur/run/r-unres-route-reason.txt'), 'utf8')).toContain(
            'failed:unresolved or non-completed task',
        );
    } finally {
        cleanup(cwd);
    }
});

test('a done task normalizes and dedupes into the run-scoped artifact with PASS', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-resolve-'));
    try {
        const spurBin = writeResolveStub(cwd, '{"frontmatter":{"status":"done"}}');
        const run = runSteps(['resolve'], { __runId: 'r-ok', tasks: '["0770","0770","0772"]', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-ok-wrapup-tasks.json'), 'utf8').trim()).toBe('["0770","0772"]');
        expect(readFileSync(join(cwd, '.spur/run/r-ok-wrapup-resolve.status'), 'utf8')).toContain('PASS');
    } finally {
        cleanup(cwd);
    }
});

test('malformed, non-array, non-string, whitespace and non-canonical entries all FAIL', () => {
    const badInputs = [
        '"0770"', // JSON string, not array
        '["0770", 770]', // non-string entry
        '["0770 "]', // trailing whitespace
        '[" 0770"]', // leading whitespace
        '["  "]', // whitespace-only
        '["07a0"]', // non-digit
        '["07700"]', // five digits
        '["770"]', // three digits
    ];
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-resolve-'));
    try {
        for (const tasks of badInputs) {
            const run = runSteps(['resolve'], { __runId: 'r-shape', tasks, spurBin: 'true' }, cwd);
            expect(run.code, tasks).toBe(0);
            expect(readFileSync(join(cwd, '.spur/run/r-shape-wrapup-resolve.status'), 'utf8'), tasks).toContain('FAIL');
            expect(() => readFileSync(join(cwd, '.spur/run/r-shape-wrapup-tasks.json')), tasks).toThrow();
        }
    } finally {
        cleanup(cwd);
    }
});

test('duplicate valid ids keep first-seen order (not sorted)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-resolve-'));
    try {
        const spurBin = writeResolveStub(cwd, '{"frontmatter":{"status":"done"}}');
        runSteps(['resolve'], { __runId: 'r-order', tasks: '["0772","0770","0772"]', spurBin }, cwd);
        expect(readFileSync(join(cwd, '.spur/run/r-order-wrapup-tasks.json'), 'utf8').trim()).toBe('["0772","0770"]');
    } finally {
        cleanup(cwd);
    }
});

test('an unresolvable task records FAIL — a missing row is not silently absorbed', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-miss-wrapup-tasks.json'), '["0001"]\n');
        const run = runSteps(['metrics'], { __runId: 'r-miss', spurBin: 'true' }, cwd);
        expect(run.code).toBe(0);
        expect(run.err).toContain('recording FAIL');
        expect(readFileSync(join(cwd, '.spur/run/r-miss-wrapup-metrics.status'), 'utf8')).toContain('FAIL');
    } finally {
        cleanup(cwd);
    }
});

test('0783 R3: a missing or corrupted capture refuses to record metrics', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        const spurBin = writeResolveStub(cwd, '{"frontmatter":{"status":"done"}}');
        const run = (runId: string, capturePayload?: string): string => {
            if (capturePayload !== undefined) {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                writeFileSync(join(cwd, `.spur/run/${runId}-wrapup-tasks.json`), capturePayload);
            }
            const result = runSteps(['metrics'], { __runId: runId, spurBin }, cwd);
            expect(result.code).toBe(0);
            return readFileSync(join(cwd, `.spur/run/${runId}-wrapup-metrics.status`), 'utf8');
        };
        expect(run('r-missing')).toContain('FAIL');
        expect(run('r-corrupt', '{oops')).toContain('FAIL');
        expect(run('r-noncanon', '["0783","x1"]')).toContain('FAIL');
        expect(() => readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'))).toThrow();
    } finally {
        cleanup(cwd);
    }
});

test('0783 R3: a malformed lookup output records FAIL instead of a row', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-badlookup-wrapup-tasks.json'), '["0783"]\n');
        const spurBin = writeResolveStub(cwd, '<html>service unavailable</html>');
        const run = runSteps(['metrics'], { __runId: 'r-badlookup', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-badlookup-wrapup-metrics.status'), 'utf8')).toContain('FAIL');
        expect(() => readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'))).toThrow();
    } finally {
        cleanup(cwd);
    }
});

test('0783 R3: an append failure records FAIL and prior valid rows survive', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        mkdirSync(join(cwd, '.spur/memory'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-appfail-wrapup-tasks.json'), '["0783"]\n');
        const prior = '{"wbs":"0770","feature_id":"D61","status":"done","verdict":"PASS","timestamp":"t"}\n';
        const metricsPath = join(cwd, '.spur/memory/wrapup-metrics.jsonl');
        writeFileSync(metricsPath, prior);
        chmodSync(metricsPath, 0o444);
        const spurBin = writeResolveStub(cwd, '{"frontmatter":{"status":"done"}}');
        const run = runSteps(['metrics'], { __runId: 'r-appfail', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(run.err).toContain('append failed');
        expect(readFileSync(join(cwd, '.spur/run/r-appfail-wrapup-metrics.status'), 'utf8')).toContain('FAIL');
        expect(readFileSync(metricsPath, 'utf8')).toBe(prior);
    } finally {
        cleanup(cwd);
    }
});

test('a resolvable task appends exactly one well-formed metrics row and PASSes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-m-ok-wrapup-tasks.json'), '["0770"]\n');
        const spurBin = writeResolveStub(cwd, '{"frontmatter":{"status":"done","feature_id":"D61"}}');
        const run = runSteps(['metrics'], { __runId: 'r-m-ok', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-m-ok-wrapup-metrics.status'), 'utf8')).toContain('PASS');
        const row = JSON.parse(readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'), 'utf8').trim()) as Record<
            string,
            string
        >;
        // 0783 R3: a missing verdict is UNKNOWN telemetry, never proof of completion.
        expect(row).toMatchObject({ wbs: '0770', feature_id: 'D61', status: 'done', verdict: 'UNKNOWN' });
        // Moved with the logic (stricter than the workflow pin): key order is the documented
        // row schema and the timestamp is UTC.
        expect(Object.keys(row)).toEqual(['wbs', 'feature_id', 'status', 'verdict', 'timestamp']);
        expect(row.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        // 0994 R3: with neither source present the run log names both the missing artifact and
        // the missing tracked verdict — the row stays UNKNOWN, never a silent blank.
        expect(run.err).toContain('.spur/run/0770-verdict.json');
    } finally {
        cleanup(cwd);
    }
});

test('0994 R1: a missing artifact derives the verdict from the tracked Testing section', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-tracked-wrapup-tasks.json'), '["0967"]\n');
        const spurBin = writeTaskShowStub(cwd, {
            frontmatter: { status: 'done', feature_id: 'G67' },
            content:
                '### Testing\n\n**Pipeline verify results**\n\n- Verdict: PASS (from verdict artifact)\n\n' +
                '| Requirement | Status | Evidence |\n|-------------|--------|----------|\n| R1 | MET | moved the symbols |\n',
        });
        const run = runSteps(['metrics'], { __runId: 'r-tracked', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-tracked-wrapup-metrics.status'), 'utf8')).toContain('PASS');
        expect(onlyMetricsRow(cwd)).toMatchObject({ wbs: '0967', feature_id: 'G67', verdict: 'PASS' });
        // A source was found: the honest-UNKNOWN diagnostic must not fire.
        expect(run.err).toBe('');
    } finally {
        cleanup(cwd);
    }
});

test('0994 R2: a mid-line verdict inside an evidence cell is not the Testing verdict', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-cell-wrapup-tasks.json'), '["0770"]\n');
        const spurBin = writeTaskShowStub(cwd, {
            frontmatter: { status: 'done', feature_id: 'D61' },
            content:
                '### Testing\n\n| Requirement | Status | Evidence |\n|-------------|--------|----------|\n' +
                '| R1 | UNMET | the pipeline reported Verdict: FAIL before remediation |\n',
        });
        const run = runSteps(['metrics'], { __runId: 'r-cell', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(onlyMetricsRow(cwd)).toMatchObject({ wbs: '0770', verdict: 'UNKNOWN' });
        expect(run.err).toContain('.spur/run/0770-verdict.json');
    } finally {
        cleanup(cwd);
    }
});

test('0994 R1: an existing artifact outranks the tracked Testing verdict', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-prec-wrapup-tasks.json'), '["0967"]\n');
        writeFileSync(join(cwd, '.spur/run/0967-verdict.json'), '{"verdict":"PARTIAL"}\n');
        const spurBin = writeTaskShowStub(cwd, {
            frontmatter: { status: 'done', feature_id: 'G67' },
            content: '### Testing\n\n- Verdict: PASS (from verdict artifact)\n',
        });
        const run = runSteps(['metrics'], { __runId: 'r-prec', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(onlyMetricsRow(cwd)).toMatchObject({ wbs: '0967', verdict: 'PARTIAL' });
    } finally {
        cleanup(cwd);
    }
});

test('canonical evidence survives scratch loss and malformed canonical evidence cannot fall back to PASS', () => {
    for (const [bytes, expected] of [
        ['{"verdict":"PARTIAL"}', 'PARTIAL'],
        ['{broken', 'UNKNOWN'],
    ]) {
        const cwd = mkdtempSync(join(tmpdir(), 'wrapup-durable-'));
        try {
            mkdirSync(join(cwd, '.spur/memory/evidence'), { recursive: true });
            writeFileSync(join(cwd, '.spur/memory/evidence/0967-verdict.json'), bytes as string);
            // Scratch is recreated only for the next command's temporary capture.
            mkdirSync(join(cwd, '.spur/run'), { recursive: true });
            writeFileSync(join(cwd, '.spur/run/r-durable-wrapup-tasks.json'), '["0967"]');
            const spurBin = writeTaskShowStub(cwd, {
                frontmatter: { status: 'done' },
                content: '### Testing\n- Verdict: PASS\n',
            });
            expect(runSteps(['metrics'], { __runId: 'r-durable', spurBin }, cwd).code).toBe(0);
            expect(onlyMetricsRow(cwd).verdict).toBe(expected);
        } finally {
            cleanup(cwd);
        }
    }
});

test('0994 R1: an artifact carrying no verdict falls back to the tracked Testing verdict', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-nofield-wrapup-tasks.json'), '["0967"]\n');
        writeFileSync(join(cwd, '.spur/run/0967-verdict.json'), '{"wbs":"0967"}\n');
        const spurBin = writeTaskShowStub(cwd, {
            frontmatter: { status: 'done', feature_id: 'G67' },
            content: '### Testing\n\n**Verdict: FAIL**\n',
        });
        const run = runSteps(['metrics'], { __runId: 'r-nofield', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(onlyMetricsRow(cwd)).toMatchObject({ wbs: '0967', verdict: 'FAIL' });
    } finally {
        cleanup(cwd);
    }
});

test('0783 R3: escaped JSON fields survive serialization as parseable rows', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-esc-wrapup-tasks.json'), '["0783"]\n');
        const payload = JSON.stringify({ frontmatter: { status: 'done', feature_id: 'D"61\\x' } });
        const jsonFile = join(cwd, 'stub-payload.json');
        writeFileSync(jsonFile, payload);
        const stub = join(cwd, 'stub-spur');
        // Spawned children inherit getEnvVars(), not the env object given to main(), so the
        // payload path is baked into the stub (same pattern as the quality-gate scripts).
        writeFileSync(stub, `#!/bin/sh\ncase "$1 $2" in "task show") cat '${jsonFile}';; esac\nexit 0\n`);
        chmodSync(stub, 0o755);
        const run = runSteps(['metrics'], { __runId: 'r-esc', spurBin: stub }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-esc-wrapup-metrics.status'), 'utf8')).toContain('PASS');
        const row = JSON.parse(readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'), 'utf8').trim()) as {
            feature_id: string;
        };
        expect(row.feature_id).toBe('D"61\\x');
    } finally {
        cleanup(cwd);
    }
});

const syncResult = (proposal: Record<string, unknown>, applied: boolean): string =>
    JSON.stringify({ proposal, applied, appliedHops: applied ? ['active->done'] : [] });

test('0783 R4: an applied, verified sync passes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-ft-'));
    try {
        const env = stubFeatureEnv(cwd, {
            syncOut: syncResult({ featureId: 'D6', from: 'active', to: 'done', reason: 'wrap' }, true),
            showStatus: 'done',
        });
        const run = runSteps(['feature-transition'], { ...env, __runId: 's-ok', feature: 'D6' }, cwd);
        expect(run.code).toBe(0);
        expect(run.out).toContain('feature gate PASS');
        expect(readFileSync(join(cwd, '.spur/run/s-ok-wrapup-sync.status'), 'utf8')).toContain('PASS');
    } finally {
        cleanup(cwd);
    }
});

test('0783 R4: a gate-blocked rc=0 sync is a failure, not a no-change success (F-04)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-ft-'));
    try {
        const env = stubFeatureEnv(cwd, {
            syncOut: syncResult(
                { featureId: 'D6', from: 'active', to: 'done', reason: 'L4 gate blocked', gateBlocked: true },
                false,
            ),
            showStatus: 'active',
        });
        const run = runSteps(['feature-transition'], { ...env, __runId: 's-blocked', feature: 'D6' }, cwd);
        expect(run.code).toBe(0);
        expect(run.err).toContain('gate-blocked');
        expect(readFileSync(join(cwd, '.spur/run/s-blocked-wrapup-sync.status'), 'utf8')).toContain('FAIL');
    } finally {
        cleanup(cwd);
    }
});

test('0783 R4: confirmation-required and mismatched-proposal results fail explicitly', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-ft-'));
    try {
        const confirm = runSteps(
            ['feature-transition'],
            {
                ...stubFeatureEnv(cwd, {
                    syncOut: syncResult(
                        { featureId: 'D6', from: 'active', to: 'done', reason: 'r', requiresConfirm: true },
                        false,
                    ),
                    showStatus: 'active',
                }),
                __runId: 's-confirm',
                feature: 'D6',
            },
            cwd,
        );
        expect(readFileSync(join(cwd, '.spur/run/s-confirm-wrapup-sync.status'), 'utf8')).toContain('FAIL');
        runSteps(
            ['feature-transition'],
            {
                ...stubFeatureEnv(cwd, {
                    syncOut: syncResult({ featureId: 'D99', from: 'active', to: 'done', reason: 'r' }, true),
                    showStatus: 'done',
                }),
                __runId: 's-mismatch',
                feature: 'D6',
            },
            cwd,
        );
        expect(readFileSync(join(cwd, '.spur/run/s-mismatch-wrapup-sync.status'), 'utf8')).toContain('FAIL');
        expect(confirm.err).toContain('confirmation');
    } finally {
        cleanup(cwd);
    }
});

test('0783 R4: a partial sync fails even when the affected-feature gate passes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-ft-'));
    try {
        const env = stubFeatureEnv(cwd, {
            syncOut: syncResult({ featureId: 'D6', from: 'active', to: 'done', reason: 'partial' }, true),
            showStatus: 'active', // applied claimed done; observed status never reached the target
            checkRc: 0, // gate PASS cannot convert a failed sync into success
        });
        const run = runSteps(['feature-transition'], { ...env, __runId: 's-partial', feature: 'D6' }, cwd);
        expect(run.code).toBe(0);
        expect(run.err).toContain('did not land on the proposal target');
        expect(readFileSync(join(cwd, '.spur/run/s-partial-wrapup-sync.status'), 'utf8')).toContain('FAIL');
    } finally {
        cleanup(cwd);
    }
});

test('0783 R4: applied:false is a successful explicit no-change only for from==to observed', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-ft-'));
    try {
        const env = stubFeatureEnv(cwd, {
            syncOut: syncResult({ featureId: 'D6', from: 'done', to: 'done', reason: 'noop' }, false),
            showStatus: 'done',
        });
        const run = runSteps(['feature-transition'], { ...env, __runId: 's-noop', feature: 'D6' }, cwd);
        expect(run.code).toBe(0);
        expect(run.out).toContain('explicit no-change');
        expect(readFileSync(join(cwd, '.spur/run/s-noop-wrapup-sync.status'), 'utf8')).toContain('PASS');
        // Same proposal shape but the observed status is not the target: failure.
        const env2 = stubFeatureEnv(cwd, {
            syncOut: syncResult({ featureId: 'D6', from: 'done', to: 'done', reason: 'noop' }, false),
            showStatus: 'active',
        });
        runSteps(['feature-transition'], { ...env2, __runId: 's-noop-bad', feature: 'D6' }, cwd);
        expect(readFileSync(join(cwd, '.spur/run/s-noop-bad-wrapup-sync.status'), 'utf8')).toContain('FAIL');
    } finally {
        cleanup(cwd);
    }
});

test('0783 R4: malformed stdout (rc 0), a nonzero sync, and a failing gate all fail', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-ft-'));
    try {
        const malformed = runSteps(
            ['feature-transition'],
            {
                ...stubFeatureEnv(cwd, { syncOut: 'ok tuned (plain text)', showStatus: 'done' }),
                __runId: 's-malformed',
                feature: 'D6',
            },
            cwd,
        );
        expect(readFileSync(join(cwd, '.spur/run/s-malformed-wrapup-sync.status'), 'utf8')).toContain('FAIL');
        const nonzero = runSteps(
            ['feature-transition'],
            {
                ...stubFeatureEnv(cwd, {
                    syncOut: '{"proposal":{"featureId":"D6","from":"active","to":"done"},"applied":true}',
                    syncRc: 3,
                    showStatus: 'done',
                }),
                __runId: 's-nonzero',
                feature: 'D6',
            },
            cwd,
        );
        expect(readFileSync(join(cwd, '.spur/run/s-nonzero-wrapup-sync.status'), 'utf8')).toContain('FAIL');
        runSteps(
            ['feature-transition'],
            {
                ...stubFeatureEnv(cwd, {
                    syncOut: syncResult({ featureId: 'D6', from: 'active', to: 'done', reason: 'r' }, true),
                    showStatus: 'done',
                    checkRc: 7,
                }),
                __runId: 's-gatefail',
                feature: 'D6',
            },
            cwd,
        );
        expect(readFileSync(join(cwd, '.spur/run/s-gatefail-wrapup-sync.status'), 'utf8')).toContain('FAIL');
        expect(`${malformed.err}${nonzero.err}`).toContain('malformed or unreadable');
    } finally {
        cleanup(cwd);
    }
});

// ── 0944: route-reason subcommand — route table, drift-probe clean claim, attribution ──

function writeRouteFixture(
    cwd: string,
    runId: string,
    files: { tasks?: string; status?: string; probe?: string },
): void {
    mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
    if (files.tasks !== undefined) {
        writeFileSync(join(cwd, '.spur', 'run', `${runId}-wrapup-tasks.json`), files.tasks);
    }
    if (files.status !== undefined) {
        writeFileSync(join(cwd, '.spur', 'run', `${runId}-wrapup-resolve.status`), files.status);
    }
    if (files.probe !== undefined) {
        writeFileSync(join(cwd, '.spur', 'run', `${runId}-drift-probe.json`), files.probe);
    }
}

test('0944: a clean drift probe with mode=fast claims fast:drift-probe-clean', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-rr-clean-'));
    try {
        writeRouteFixture(cwd, 'rr-a', {
            tasks: '["0944"]\n',
            status: 'PASS\n',
            probe: '{"clean":true,"reasons":[],"paths":[]}\n',
        });
        const result = writeRouteReason({ __runId: 'rr-a', mode: 'fast' }, { cwd });
        expect(result.exitCode).toBe(0);
        expect(result.reason).toBe('fast:drift-probe-clean');
        expect(readFileSync(join(cwd, '.spur/run/rr-a-route-reason.txt'), 'utf8')).toBe('fast:drift-probe-clean\n');
        expect(readFileSync(join(cwd, '.spur/memory/wrapup-routes.log'), 'utf8')).toContain(
            'rr-a fast:drift-probe-clean',
        );
    } finally {
        cleanup(cwd);
    }
});

test('0944: mode=safety claims safety:operator-forced doc-sync', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-rr-safety-'));
    try {
        writeRouteFixture(cwd, 'rr-b', { tasks: '["0944"]\n', status: 'PASS\n' });
        const result = writeRouteReason({ __runId: 'rr-b', mode: 'safety' }, { cwd });
        expect(result.reason).toBe('safety:operator-forced doc-sync');
    } finally {
        cleanup(cwd);
    }
});

test('0944: the former jq table is preserved one-for-one — fast, empty, unknown, conflict', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-rr-table-'));
    try {
        for (const [mode, expected] of [
            ['fast', 'fast:evidence complete+consistent'],
            ['', 'safety:missing evidence (mode empty)'],
            ['unknown', 'safety:unknown evidence quality'],
            ['conflict', 'safety:conflicting evidence'],
            ['bogus', 'safety:unrecognized evidence (mode=bogus)'],
        ] as const) {
            const runId = `rr-${mode === '' ? 'empty' : mode}`;
            writeRouteFixture(cwd, runId, { tasks: '["0944"]\n', status: 'PASS\n' });
            expect(writeRouteReason({ __runId: runId, mode }, { cwd }).reason).toBe(expected);
        }
    } finally {
        cleanup(cwd);
    }
});

test('0944: only a validated [] claims skipped; a missing capture never claims skip or clean', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-rr-skip-'));
    try {
        writeRouteFixture(cwd, 'rr-s0', { tasks: '[]\n', status: 'PASS\n' });
        expect(writeRouteReason({ __runId: 'rr-s0', mode: 'fast' }, { cwd }).reason).toBe('skipped:empty task list');
        // No tasks file at all: never 0, so no skipped claim; no probe verdict either,
        // so even mode=fast falls to the table instead of fast:drift-probe-clean.
        writeRouteFixture(cwd, 'rr-s1', { status: 'PASS\n' });
        expect(writeRouteReason({ __runId: 'rr-s1', mode: 'fast' }, { cwd }).reason).toBe(
            'fast:evidence complete+consistent',
        );
        expect(readFileSync(join(cwd, '.spur/run/rr-s1-route-reason.txt'), 'utf8')).not.toContain('skipped');
        // Corrupted capture: same refusal.
        writeRouteFixture(cwd, 'rr-s2', { tasks: '{oops', status: 'PASS\n' });
        expect(writeRouteReason({ __runId: 'rr-s2', mode: 'fast' }, { cwd }).reason).toBe(
            'fast:evidence complete+consistent',
        );
    } finally {
        cleanup(cwd);
    }
});

test('0944: a corrupted probe file can never yield a clean claim', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-rr-probe-'));
    try {
        writeRouteFixture(cwd, 'rr-p', { tasks: '["0944"]\n', status: 'PASS\n', probe: 'not json' });
        expect(writeRouteReason({ __runId: 'rr-p', mode: 'fast' }, { cwd }).reason).toBe(
            'fast:evidence complete+consistent',
        );
        writeRouteFixture(cwd, 'rr-p2', {
            tasks: '["0944"]\n',
            status: 'PASS\n',
            probe: '{"clean":false,"reasons":["x"],"paths":[]}',
        });
        expect(writeRouteReason({ __runId: 'rr-p2', mode: 'fast' }, { cwd }).reason).toBe(
            'fast:evidence complete+consistent',
        );
    } finally {
        cleanup(cwd);
    }
});

test('0944: a FAIL resolve keeps its own reason — the route-reason writer writes nothing', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-rr-fail-'));
    try {
        writeRouteFixture(cwd, 'rr-f', { tasks: '["0944"]\n', status: 'FAIL\n' });
        const result = writeRouteReason({ __runId: 'rr-f', mode: '' }, { cwd });
        expect(result.exitCode).toBe(0);
        const exists = (p: string): boolean => {
            try {
                readFileSync(join(cwd, p), 'utf8');
                return true;
            } catch {
                return false;
            }
        };
        expect(exists('.spur/run/rr-f-route-reason.txt')).toBe(false);
        expect(exists('.spur/memory/wrapup-routes.log')).toBe(false);
    } finally {
        cleanup(cwd);
    }
});

test('0944: an empty __runId is a hard mis-invocation (exit 1, nothing written)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-rr-empty-'));
    try {
        const seen: string[] = [];
        const original = process.stderr.write;
        process.stderr.write = ((chunk: unknown): boolean => {
            seen.push(String(chunk));
            return true;
        }) as typeof process.stderr.write;
        let code = -1;
        try {
            code = writeRouteReason({ __runId: '', mode: '' }, { cwd }).exitCode;
        } finally {
            process.stderr.write = original;
        }
        expect(code).toBe(1);
        expect(seen.join('')).toContain('__runId is empty');
    } finally {
        cleanup(cwd);
    }
});

/**
 * 0994 P3: parity guard for the hand-copied verdict parser. ADR-065 forces the copy, so the
 * guard reads both files and fails when either literal moves — without it, an edit to
 * `parseVerdictLine` or to the `Testing` slice in `extractTestingSection` splits the plugin
 * from the app silently, and the split only surfaces as a wrong metrics row much later.
 */
const TESTING_HEADING_LITERAL = String.raw`/^#{1,6}\s+Testing\s*$/m`;
const VERDICT_LINE_LITERAL = String.raw`/^(?:-\s*|\*\*)?Verdict:\s*(PASS|PARTIAL|FAIL|UNKNOWN)\b/i`;

/** The level-aware end anchor is a template literal, so compare the whole statement instead. */
function anchorStatement(source: string): string {
    return (source.split('\n').find((line) => line.includes('new RegExp(`^#{1,')) ?? '').trim();
}

test('0994 P3: the local verdict literals stay identical to the canonical parser', () => {
    const canonical = readFileSync(join(import.meta.dir, '../../../packages/app/src/services/task-record.ts'), 'utf8');
    const local = readFileSync(join(import.meta.dir, '../scripts/wrapup-steps.ts'), 'utf8');
    expect(canonical).toContain(TESTING_HEADING_LITERAL);
    expect(local).toContain(TESTING_HEADING_LITERAL);
    expect(canonical).toContain(VERDICT_LINE_LITERAL);
    expect(local).toContain(VERDICT_LINE_LITERAL);
    expect(anchorStatement(local)).not.toBe('');
    expect(anchorStatement(local)).toBe(anchorStatement(canonical));
});

/**
 * 0994 P3: the slice rule the pre-fix copy got wrong. The local `#{2,4}` heading and end anchor
 * read an `# Testing` section (or a verdict below an h4 subheading) as absent while the app saw
 * one — both degraded to honest UNKNOWN, but the two copies disagreed on reachable input.
 */
test('0994 R1: verdictFromTestingSection slices like the canonical extractTestingSection', () => {
    expect(verdictFromTestingSection('# Testing\n\n- Verdict: PARTIAL\n')).toBe('PARTIAL');
    expect(verdictFromTestingSection('## Testing\n\n#### Coverage\n\n- Verdict: FAIL\n')).toBe('FAIL');
    expect(verdictFromTestingSection('## Testing\n\nnothing here\n\n## Solution\n\n- Verdict: PASS\n')).toBeNull();
    expect(verdictFromTestingSection('## Solution\n\n- Verdict: PASS\n')).toBeNull();
    expect(verdictFromTestingSection('## Testing\n\nno verdict line here\n')).toBeNull();
});

/**
 * 0994 P4: an explicit `Verdict: UNKNOWN` is still an uncertified row, so it reports the way a
 * missing source does instead of passing silently through the log-based triage path.
 */
test('0994 P4: an explicit tracked UNKNOWN still reports the uncertified row', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-unknown-wrapup-tasks.json'), '["0770"]\n');
        const spurBin = writeTaskShowStub(cwd, {
            frontmatter: { status: 'done', feature_id: 'D61' },
            content: '### Testing\n\n- Verdict: UNKNOWN\n',
        });
        const run = runSteps(['metrics'], { __runId: 'r-unknown', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(onlyMetricsRow(cwd)).toMatchObject({ wbs: '0770', verdict: 'UNKNOWN' });
        expect(run.err).toContain('.spur/run/0770-verdict.json');
        expect(run.err).toContain('tracked Testing: UNKNOWN');
    } finally {
        cleanup(cwd);
    }
});

/** The canonical slice reaches `runMetrics` too, not only the exported helper. */
test('0994 R1: an h1 Testing heading reaches the metrics row', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-metrics-'));
    try {
        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
        writeFileSync(join(cwd, '.spur/run/r-h1-wrapup-tasks.json'), '["0967"]\n');
        const spurBin = writeTaskShowStub(cwd, {
            frontmatter: { status: 'done', feature_id: 'G67' },
            content: '# Testing\n\n- Verdict: FAIL\n',
        });
        const run = runSteps(['metrics'], { __runId: 'r-h1', spurBin }, cwd);
        expect(run.code).toBe(0);
        expect(onlyMetricsRow(cwd)).toMatchObject({ wbs: '0967', verdict: 'FAIL' });
        expect(run.err).toBe('');
    } finally {
        cleanup(cwd);
    }
});

/**
 * 1033 R2: argv-dispatching stub — `task show`, `feature sync --dry-run` and
 * `feature check` return distinct payload files; every argv is appended to a log file
 * so tests can assert a check was never made.
 */
function writeDispatchStub(
    cwd: string,
    files: { task?: string; sync?: string; check?: string; checkRc?: number },
): { stub: string; argvLog: string } {
    const stub = join(cwd, 'stub-spur');
    const argvLog = join(cwd, 'stub-argv.log');
    const branches = [
        files.task ? `  "task show") cat '${files.task}';;` : '',
        files.sync ? `  "feature sync") cat '${files.sync}';;` : '',
        files.check ? `  "feature check") cat '${files.check}'; exit ${files.checkRc ?? 0};;` : '',
    ].filter(Boolean);
    writeFileSync(
        stub,
        ['#!/bin/sh', `printf '%s\\n' "$*" >> '${argvLog}'`, 'case "$1 $2" in', ...branches, 'esac', 'exit 0', ''].join(
            '\n',
        ),
    );
    chmodSync(stub, 0o755);
    return { stub, argvLog };
}

function writeJsonFile(cwd: string, name: string, value: unknown): string {
    const file = join(cwd, name);
    writeFileSync(file, JSON.stringify(value));
    return file;
}

const DONE_TASK = { frontmatter: { status: 'done' } };

test('1033 R2: malformed JSON payloads and unexplained check failures cannot pass resolve', () => {
    const cases = [
        { sync: {}, check: [], reason: 'sync-unreadable' },
        { sync: { proposal: null }, check: [], reason: 'sync-unreadable' },
        { sync: { proposal: { from: 'active', to: 'done', hops: 'done' } }, check: [], reason: 'sync-unreadable' },
        { sync: { proposal: { from: 'active', to: 'done' } }, check: null, reason: 'check-unreadable' },
        { sync: { proposal: { from: 'active', to: 'done' } }, check: {}, reason: 'check-unreadable' },
        { sync: { proposal: { from: 'active', to: 'done' } }, check: [], reason: 'check-unreadable' },
        {
            sync: { proposal: { from: 'active', to: 'done' } },
            check: [{ findings: [null] }],
            reason: 'check-unreadable',
        },
        {
            sync: { proposal: { from: 'active', to: 'done' } },
            check: [{ findings: [] }],
            checkRc: 7,
            reason: 'check-unreadable',
        },
    ];
    for (const entry of cases) {
        const cwd = mkdtempSync(join(tmpdir(), 'wrapup-preflight-shape-'));
        try {
            const { stub } = writeDispatchStub(cwd, {
                task: writeJsonFile(cwd, 'task.json', DONE_TASK),
                sync: writeJsonFile(cwd, 'sync.json', entry.sync),
                check: writeJsonFile(cwd, 'check.json', entry.check),
                checkRc: entry.checkRc,
            });
            const run = runSteps(
                ['resolve'],
                { __runId: 'shape', tasks: '["0770"]', feature: 'D9', spurBin: stub },
                cwd,
            );
            expect(run.code).toBe(0);
            expect(readFileSync(join(cwd, '.spur/run/shape-wrapup-resolve.status'), 'utf8')).toBe('FAIL\n');
            expect(readFileSync(join(cwd, '.spur/run/shape-route-reason.txt'), 'utf8')).toBe(
                `failed:preflight:${entry.reason}`,
            );
        } finally {
            cleanup(cwd);
        }
    }
});

test('1033 R2 (a): a gate-blocked dry-run fails with the sorted unique error codes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-preflight-a-'));
    try {
        const syncFile = writeJsonFile(cwd, 'sync.json', {
            proposal: {
                gateBlocked: true,
                gateFindings: [
                    { severity: 'error', code: 'L2.frozen' },
                    { severity: 'warn', code: 'W.noise' },
                    { severity: 'error', code: 'L1.rule' },
                    { severity: 'error', code: 'L1.rule' },
                ],
            },
            applied: false,
            appliedHops: [],
        });
        const { stub } = writeDispatchStub(cwd, { task: writeJsonFile(cwd, 'task.json', DONE_TASK), sync: syncFile });
        const run = runSteps(['resolve'], { __runId: 'r-a', tasks: '["0770"]', feature: 'D9', spurBin: stub }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-a-route-reason.txt'), 'utf8')).toBe(
            'failed:preflight:gate-blocked L1.rule,L2.frozen',
        );
        expect(readFileSync(join(cwd, '.spur/run/r-a-wrapup-resolve.status'), 'utf8')).toContain('FAIL');
    } finally {
        cleanup(cwd);
    }
});

test('1033 R2 (b): a done-gate error on an active feature fails with its codes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-preflight-b-'));
    try {
        const syncFile = writeJsonFile(cwd, 'sync.json', { proposal: { from: 'active', to: 'done' }, appliedHops: [] });
        const checkFile = writeJsonFile(cwd, 'check.json', [
            {
                findings: [
                    { severity: 'error', code: 'L4.dogfood-missing' },
                    { severity: 'warn', code: 'W.noise' },
                ],
            },
        ]);
        const { stub } = writeDispatchStub(cwd, {
            task: writeJsonFile(cwd, 'task.json', DONE_TASK),
            sync: syncFile,
            check: checkFile,
        });
        const run = runSteps(['resolve'], { __runId: 'r-b', tasks: '["0770"]', feature: 'D9', spurBin: stub }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-b-route-reason.txt'), 'utf8')).toBe(
            'failed:preflight:done-gate L4.dogfood-missing',
        );
        // Diagnosis artifact carries the full check JSON.
        expect(JSON.parse(readFileSync(join(cwd, '.spur/run/r-b-wrapup-preflight.json'), 'utf8'))).toEqual([
            {
                findings: [
                    { severity: 'error', code: 'L4.dogfood-missing' },
                    { severity: 'warn', code: 'W.noise' },
                ],
            },
        ]);
    } finally {
        cleanup(cwd);
    }
});

test('1033 R2 (c): receipt-only errors on an active feature are ignored and resolve passes', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-preflight-c-'));
    try {
        const syncFile = writeJsonFile(cwd, 'sync.json', { proposal: { from: 'active', to: 'done' }, appliedHops: [] });
        const checkFile = writeJsonFile(cwd, 'check.json', [
            { findings: [{ severity: 'error', code: 'L4.feature-receipt-missing' }] },
        ]);
        const { stub } = writeDispatchStub(cwd, {
            task: writeJsonFile(cwd, 'task.json', DONE_TASK),
            sync: syncFile,
            check: checkFile,
        });
        const run = runSteps(['resolve'], { __runId: 'r-c', tasks: '["0770"]', feature: 'D9', spurBin: stub }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-c-wrapup-resolve.status'), 'utf8')).toContain('PASS');
    } finally {
        cleanup(cwd);
    }
});

test('1033 R2 (d): a receipt error on a verifying feature is not ignored', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-preflight-d-'));
    try {
        const syncFile = writeJsonFile(cwd, 'sync.json', {
            proposal: { from: 'verifying', to: 'done' },
            appliedHops: ['done'],
        });
        const checkFile = writeJsonFile(cwd, 'check.json', [
            { findings: [{ severity: 'error', code: 'L4.feature-receipt-missing' }] },
        ]);
        const { stub } = writeDispatchStub(cwd, {
            task: writeJsonFile(cwd, 'task.json', DONE_TASK),
            sync: syncFile,
            check: checkFile,
        });
        const run = runSteps(['resolve'], { __runId: 'r-d', tasks: '["0770"]', feature: 'D9', spurBin: stub }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-d-route-reason.txt'), 'utf8')).toBe(
            'failed:preflight:done-gate L4.feature-receipt-missing',
        );
    } finally {
        cleanup(cwd);
    }
});

test('1033 R2 (e): a proposal that does not reach done makes no check call', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-preflight-e-'));
    try {
        const syncFile = writeJsonFile(cwd, 'sync.json', {
            proposal: { from: 'active', to: 'active' },
            appliedHops: [],
        });
        const { stub, argvLog } = writeDispatchStub(cwd, {
            task: writeJsonFile(cwd, 'task.json', DONE_TASK),
            sync: syncFile,
        });
        const run = runSteps(['resolve'], { __runId: 'r-e', tasks: '["0770"]', feature: 'D9', spurBin: stub }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-e-wrapup-resolve.status'), 'utf8')).toContain('PASS');
        const argv = readFileSync(argvLog, 'utf8');
        expect(argv).toContain('feature sync');
        expect(argv).not.toContain('feature check');
    } finally {
        cleanup(cwd);
    }
});

test('1033 R2 (f): unparsable sync or check output fails closed', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-preflight-f1-'));
    try {
        const syncFile = join(cwd, 'sync-garbage.json');
        writeFileSync(syncFile, 'not json at all');
        const { stub } = writeDispatchStub(cwd, { task: writeJsonFile(cwd, 'task.json', DONE_TASK), sync: syncFile });
        const run = runSteps(['resolve'], { __runId: 'r-f1', tasks: '["0770"]', feature: 'D9', spurBin: stub }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-f1-route-reason.txt'), 'utf8')).toBe(
            'failed:preflight:sync-unreadable',
        );
    } finally {
        cleanup(cwd);
    }
    const cwd2 = mkdtempSync(join(tmpdir(), 'wrapup-steps-preflight-f2-'));
    try {
        const syncFile = writeJsonFile(cwd2, 'sync.json', {
            proposal: { from: 'active', to: 'done' },
            appliedHops: [],
        });
        const checkFile = join(cwd2, 'check-garbage.json');
        writeFileSync(checkFile, '<html>nope</html>');
        const { stub } = writeDispatchStub(cwd2, {
            task: writeJsonFile(cwd2, 'task.json', DONE_TASK),
            sync: syncFile,
            check: checkFile,
        });
        const run = runSteps(['resolve'], { __runId: 'r-f2', tasks: '["0770"]', feature: 'D9', spurBin: stub }, cwd2);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd2, '.spur/run/r-f2-route-reason.txt'), 'utf8')).toBe(
            'failed:preflight:check-unreadable',
        );
    } finally {
        cleanup(cwd2);
    }
});

/** Committed git repo holding `files` at repo-relative paths — the scope check diffs against it. */
function initGitRepo(files: Record<string, string>): string {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-doc-sync-scope-'));
    for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(cwd, rel)), { recursive: true });
        writeFileSync(join(cwd, rel), body);
    }
    spawnSync('git', ['init', '-q'], { cwd });
    spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A'], { cwd });
    spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd });
    return cwd;
}

function readStatus(cwd: string, runId: string, suffix: string): string {
    return readFileSync(join(cwd, '.spur', 'run', `${runId}-${suffix}`), 'utf8');
}

/**
 * 1147 R1/R2: the doc-sync write-scope guard is deterministic, not prompt wording. The
 * snapshot is taken at doc-sync entry; the post-doc-sync check diffs the working listing
 * against it and fails the step (status file) on any path outside `docs/**` minus the
 * task/feature corpus, plus the declared learnings capture.
 */
test('1147 AC1: an in-scope docs edit passes; out-of-scope, corpus and untracked paths fail naming the path', () => {
    const runId = 'r1147-scope';
    const cwd = initGitRepo({
        'docs/design/keep.md': 'a\n',
        'docs/tasks5/1147_probe.md': 'a\n',
        'docs/features/H1_probe.md': 'a\n',
        'apps/app/tests/decision/decision-log-query.test.ts': 'a\n',
    });
    try {
        expect(runSteps(['doc-sync-snapshot'], { __runId: runId }, cwd).code).toBe(0);
        // In scope: the prompt's own declared surface.
        writeFileSync(join(cwd, 'docs/design/keep.md'), 'edited in scope\n');
        expect(runSteps(['doc-sync-scope'], { __runId: runId }, cwd).code).toBe(0);
        expect(readStatus(cwd, runId, 'wrapup-doc-sync-scope.status')).toBe('PASS\n');

        // Out of scope: an unrelated test edit (the 1132 defect) fails naming the path.
        writeFileSync(join(cwd, 'apps/app/tests/decision/decision-log-query.test.ts'), 'edited out of scope\n');
        expect(runSteps(['doc-sync-scope'], { __runId: runId }, cwd).code).toBe(0);
        const outOfScope = readStatus(cwd, runId, 'wrapup-doc-sync-scope.status');
        expect(outOfScope).toContain('scope-violation: apps/app/tests/decision/decision-log-query.test.ts');

        // The corpus is never doc-sync's to write; an untracked out-of-scope file is caught
        // too (an untracked path git reports individually, not just a tracked modification).
        writeFileSync(join(cwd, 'docs/tasks5/1147_probe.md'), 'edited corpus\n');
        writeFileSync(join(cwd, 'docs/features/H1_probe.md'), 'edited corpus\n');
        writeFileSync(join(cwd, 'apps/app/tests/decision/untracked-probe.test.ts'), 'brand new\n');
        expect(runSteps(['doc-sync-scope'], { __runId: runId }, cwd).code).toBe(0);
        const corpus = readStatus(cwd, runId, 'wrapup-doc-sync-scope.status');
        expect(corpus).toContain('docs/tasks5/1147_probe.md');
        expect(corpus).toContain('docs/features/H1_probe.md');
        expect(corpus).toContain('apps/app/tests/decision/untracked-probe.test.ts');
        expect(corpus).toContain('apps/app/tests/decision/decision-log-query.test.ts');
    } finally {
        cleanup(cwd);
    }
});

test('1147 AC1: the declared learnings capture is allowed and pre-existing dirt is never attributed', () => {
    const runId = 'r1147-allow';
    const cwd = initGitRepo({ 'apps/cli/src/commands/feature.ts': 'a\n', 'docs/design/keep.md': 'a\n' });
    try {
        // Dirt that predates doc-sync (a sibling task's uncommitted work) is in the snapshot.
        writeFileSync(join(cwd, 'apps/cli/src/commands/feature.ts'), 'sibling task work\n');
        expect(runSteps(['doc-sync-snapshot'], { __runId: runId }, cwd).code).toBe(0);
        writeFileSync(join(cwd, '.spur', 'run', `${runId}-wrapup-learnings.md`), '- 1147: captured\n');
        expect(runSteps(['doc-sync-scope'], { __runId: runId }, cwd).code).toBe(0);
        expect(readStatus(cwd, runId, 'wrapup-doc-sync-scope.status')).toBe('PASS\n');
    } finally {
        cleanup(cwd);
    }
});

test('1147 AC1: a missing entry snapshot fails the check closed instead of passing it', () => {
    const runId = 'r1147-nosnap';
    const cwd = initGitRepo({ 'docs/design/keep.md': 'a\n' });
    try {
        expect(runSteps(['doc-sync-scope'], { __runId: runId }, cwd).code).toBe(0);
        expect(readStatus(cwd, runId, 'wrapup-doc-sync-scope.status')).toContain('scope-violation: snapshot-missing');
    } finally {
        cleanup(cwd);
    }
});

test('1147 AC2: the supersession pin runs after doc-sync and fails the check naming the pin', () => {
    const runId = 'r1147-pins';
    const cwd = initGitRepo({ 'docs/design/keep.md': 'a\n' });
    const pinDir = join(cwd, 'repo-wide-tests');
    try {
        // No pin in this project: the check skips (PASS), never failing a consumer.
        expect(runSteps(['doc-supersession'], { __runId: runId }, cwd).code).toBe(0);
        expect(readStatus(cwd, runId, 'wrapup-doc-supersession.status')).toBe('PASS\n');

        // A genuine drift (a re-added delinked row) fails the pin and is attributed here.
        mkdirSync(pinDir, { recursive: true });
        writeFileSync(
            join(pinDir, 'adr-supersession.test.ts'),
            "import { expect, test } from 'bun:test';\ntest('g2 delinked row', () => { expect('re-added').toBe('absent'); });\n",
        );
        expect(runSteps(['doc-supersession'], { __runId: runId }, cwd).code).toBe(0);
        expect(readStatus(cwd, runId, 'wrapup-doc-supersession.status')).toContain(
            'supersession-pin-failed: repo-wide-tests/adr-supersession.test.ts',
        );

        // A clean pin records PASS.
        writeFileSync(
            join(pinDir, 'adr-supersession.test.ts'),
            "import { expect, test } from 'bun:test';\ntest('g2 delinked row', () => { expect('absent').toBe('absent'); });\n",
        );
        expect(runSteps(['doc-supersession'], { __runId: runId }, cwd).code).toBe(0);
        expect(readStatus(cwd, runId, 'wrapup-doc-supersession.status')).toBe('PASS\n');
    } finally {
        cleanup(cwd);
    }
});

test('1033 R2 (g): an unset feature skips the pre-flight entirely', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-steps-preflight-g-'));
    try {
        const { stub, argvLog } = writeDispatchStub(cwd, { task: writeJsonFile(cwd, 'task.json', DONE_TASK) });
        const run = runSteps(['resolve'], { __runId: 'r-g', tasks: '["0770"]', spurBin: stub }, cwd);
        expect(run.code).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r-g-wrapup-resolve.status'), 'utf8')).toContain('PASS');
        expect(readFileSync(argvLog, 'utf8')).not.toContain('feature sync');
    } finally {
        cleanup(cwd);
    }
});
