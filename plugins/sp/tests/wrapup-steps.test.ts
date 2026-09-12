import { expect, spyOn, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, WBS_PATTERN, WRAPUP_STEPS_USAGE, type WrapupStepsEnv } from '../scripts/wrapup-steps';

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
    const prevPath = process.env.PATH;
    const cap = capture();
    process.env.PATH = `${cwd}${prevPath ? `:${prevPath}` : ''}`;
    try {
        const code = main(argv, { ...process.env, ...env }, { cwd });
        return { code, out: cap.out(), err: cap.err() };
    } finally {
        process.env.PATH = prevPath;
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
        // Spawned children inherit process.env, not the env object given to main(), so the
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
