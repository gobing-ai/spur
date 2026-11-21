import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    applyFinalProvenance,
    type CacheProvenance,
    parseProvenance,
    refreshReport,
    stampReport,
} from '../../src/services/history-anatomy';

// 1326 R5/R6: the stamp state must describe the run that actually happened. These cases pin the
// two claims the published 2026-11-08 report got wrong: `validatedAt` taken from probe time (48.5
// min before the PASS) and executor/model taken from the `auto` selector instead of the receipts.

const GENERATED_AT = '2026-11-10T07:16:14.279Z';

function provenance(overrides: Partial<CacheProvenance> = {}): CacheProvenance {
    return {
        identity: {
            contractVersion: '1',
            mode: 'daily',
            date: '2026-11-08',
            timezone: 'America/Los_Angeles',
            bounds: { since: '2026-11-08T00:00:00.000-08:00', until: '2026-11-08T23:59:59.999-08:00' },
            sources: ['agy', 'claude', 'pi'],
        },
        windowState: 'closed',
        generatedAt: GENERATED_AT,
        validatedAt: GENERATED_AT,
        artifactDigest: 'sha256:current',
        baselineArtifactDigest: null,
        contractDigest: 'sha256:contract',
        skillDigest: 'sha256:skill',
        workflowDigest: 'sha256:workflow',
        helperDigest: 'sha256:helper',
        coverage: [{ source: 'claude', status: 'ok', lastImportedAt: '2026-11-09T00:00:40.137Z' }],
        runId: 'run-43a5034e',
        currentArtifactPath: '.spur/run/current.json',
        spurVersion: '0.4.30',
        schemaVersion: 1,
        cacheDisposition: 'forced-recompute',
        ...overrides,
    };
}

/** The trace shape `spur workflow trace <id> --json` persists: actions nested under `events`. */
function traceJson(): unknown {
    const action = (
        node: string,
        actionId: string,
        agent: string,
        model: string,
        extra: Record<string, unknown> = {},
    ) => ({
        kind: 'action',
        actionKind: 'agent.run',
        actionId,
        node,
        status: 'done',
        ok: true,
        invocation: { agent, model, timeoutMs: 3_600_000, source: 'stage', ...extra },
        result: { agent, ok: true },
    });
    return {
        run: { id: 'run-43a5034e', status: 'done' },
        events: [
            action('enrich', 'a1', 'agy', 'claude-opus-5-5-medium', { executor: 'agy-opus-5.5' }),
            action('validate', 'a2', 'agy', 'claude-opus-5-5-medium', { executor: 'agy-opus-5.5' }),
            { kind: 'action', actionKind: 'agent.run', actionId: 'a3', node: 'correct', status: 'failed', ok: false },
            action('correct', 'a4', 'grok', 'grok-4.7'),
            action('validate', 'a5', 'grok', 'grok-4.7'),
        ],
        outputArtifact: '.spur/memory/runs/run-43a5034e.md',
    };
}

function fixture(dir: string, verdict = 'Verdict: PASS\n'): { validationPath: string; tracePath: string } {
    const validationPath = join(dir, 'validation.txt');
    writeFileSync(validationPath, `Checked independently.\n\n${verdict}`);
    // The PASS landed 48.5 minutes after the probe wrote generatedAt.
    const passAt = new Date('2026-11-10T08:04:43.000Z');
    utimesSync(validationPath, passAt, passAt);
    const tracePath = join(dir, 'trace.json');
    writeFileSync(tracePath, JSON.stringify(traceJson(), null, 2));
    return { validationPath, tracePath };
}

describe('applyFinalProvenance (1326 R5/R6)', () => {
    test('validatedAt is the validation artifact mtime, later than generatedAt', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-final-'));
        try {
            const p = applyFinalProvenance(provenance(), fixture(dir));
            expect(p.validatedAt).toBe(statSync(join(dir, 'validation.txt')).mtime.toISOString());
            expect(Date.parse(p.validatedAt)).toBeGreaterThan(Date.parse(p.generatedAt));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('one dispatch row per successful agent.run, failed actions excluded, repeats distinct', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-final-'));
        try {
            const p = applyFinalProvenance(provenance(), fixture(dir));
            expect(p.dispatches?.map((d) => `${d.node}:${d.actionId}`)).toEqual([
                'enrich:a1',
                'validate:a2',
                'correct:a4',
                'validate:a5',
            ]);
            expect(p.dispatches?.[0]).toEqual({
                node: 'enrich',
                actionId: 'a1',
                agent: 'agy',
                executor: 'agy-opus-5.5',
                model: 'claude-opus-5-5-medium',
                timeoutMs: 3_600_000,
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('top-level executor/model name the FINAL validation invocation, profile kept separately', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-final-'));
        try {
            const p = applyFinalProvenance(provenance(), fixture(dir));
            // The source-run shape: Antigravity first, Grok last. `auto` never appears.
            expect(p.executor).toBe('grok');
            expect(p.model).toBe('grok-4.7');
            expect(p.executorProfile).toBe('not available: invocation executor absent');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('an absent executor or model renders a stated reason, never a bare not-available', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-final-'));
        try {
            const tracePath = join(dir, 'trace.json');
            writeFileSync(
                tracePath,
                JSON.stringify({
                    events: [
                        {
                            actionKind: 'agent.run',
                            actionId: 'a1',
                            node: 'validate',
                            ok: true,
                            invocation: { agent: 'pi', timeoutMs: null },
                        },
                    ],
                }),
            );
            const validationPath = join(dir, 'validation.txt');
            writeFileSync(validationPath, 'Verdict: PASS\n');
            const p = applyFinalProvenance(provenance(), { validationPath, tracePath });
            expect(p.model).toBe('not available: invocation model absent');
            expect(p.dispatches?.[0]?.executor).toBe('not available: invocation executor absent');
            expect(p.dispatches?.[0]?.timeoutMs).toBe('unbounded');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails closed when the validation artifact does not end with Verdict: PASS', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-final-'));
        try {
            const f = fixture(dir, 'Verdict: PASS\nand then some prose\n');
            expect(() => applyFinalProvenance(provenance(), f)).toThrow(/Verdict: PASS/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails closed when the trace records no successful agent.run', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-final-'));
        try {
            const f = fixture(dir);
            writeFileSync(f.tracePath, JSON.stringify({ events: [] }));
            expect(() => applyFinalProvenance(provenance(), f)).toThrow(/no successful agent.run/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the rendered frontmatter round-trips dispatches, and a cache hit preserves them', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-final-'));
        try {
            const p = applyFinalProvenance(provenance(), fixture(dir));
            const stamped = stampReport('# Body\n', p);
            const parsed = parseProvenance(stamped);
            expect(parsed?.dispatches).toEqual(p.dispatches);
            expect(parsed?.executor).toBe('grok');
            expect(parsed?.executorProfile).toBe('not available: invocation executor absent');
            expect(parsed?.spurVersion).toBe('0.4.30');
            // R5 cache-hit path: only validatedAt, disposition, and the banner move.
            const refreshed = refreshReport(stamped, '2026-11-11T00:00:00.000Z', 'hit');
            const after = parseProvenance(refreshed);
            expect(after?.validatedAt).toBe('2026-11-11T00:00:00.000Z');
            expect(after?.generatedAt).toBe(p.generatedAt);
            expect(after?.dispatches).toEqual(p.dispatches);
            expect(after?.artifactDigest).toBe(p.artifactDigest);
            expect(readFileSync(join(dir, 'trace.json'), 'utf8')).toContain('agent.run');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// 1420: stamped identity, failover, and the body placeholder
// ---------------------------------------------------------------------------

describe('1420 stamped provenance identity', () => {
    const EXECUTOR = 'pi-commandcode-dsv4.1';

    function traceFile(
        dir: string,
        result: Record<string, unknown> = {},
    ): { validationPath: string; tracePath: string } {
        const validationPath = join(dir, 'validation.txt');
        writeFileSync(validationPath, 'Checked independently.\n\nVerdict: PASS\n');
        const tracePath = join(dir, 'trace.json');
        writeFileSync(
            tracePath,
            JSON.stringify({
                events: [
                    {
                        actionKind: 'agent.run',
                        actionId: 'a1',
                        node: 'enrich',
                        ok: true,
                        invocation: {
                            agent: 'pi',
                            model: 'commandcode/deepseek/deepseek-v4.1-flash',
                            executor: EXECUTOR,
                            tier: 'standard',
                            role: 'coder',
                            timeoutMs: 3_600_000,
                        },
                        result: { agent: 'pi', ...result },
                    },
                ],
            }),
        );
        return { validationPath, tracePath };
    }

    test('AC1 — the elected executor profile lands on the dispatch row and the frontmatter', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-1420-'));
        try {
            const p = applyFinalProvenance(provenance(), traceFile(dir));
            expect(p.dispatches?.[0]?.executor).toBe(EXECUTOR);
            expect(p.executorProfile).toBe(EXECUTOR);
            const stamped = stampReport('## Scope and provenance\n\nbody\n', p);
            expect(stamped).toContain(`executorProfile: "${EXECUTOR}"`);
            expect(stamped).toContain(`executor: ${EXECUTOR},`);
            expect(parseProvenance(stamped)?.dispatches?.[0]?.executor).toBe(EXECUTOR);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('AC2 — failover is rendered, omitted when absent, and round-trips', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-1420-'));
        try {
            const withFailover = applyFinalProvenance(
                provenance(),
                traceFile(dir, { failover: 'pi-volc→pi-commandcode-dsv4.1' }),
            );
            expect(withFailover.dispatches?.[0]?.failover).toBe('pi-volc→pi-commandcode-dsv4.1');
            const stamped = stampReport('body\n', withFailover);
            expect(stamped).toContain('failover: pi-volc→pi-commandcode-dsv4.1');
            expect(parseProvenance(stamped)?.dispatches?.[0]?.failover).toBe('pi-volc→pi-commandcode-dsv4.1');

            const withoutFailover = applyFinalProvenance(provenance(), traceFile(dir));
            expect(withoutFailover.dispatches?.[0]?.failover).toBeUndefined();
            expect(stampReport('body\n', withoutFailover)).not.toContain('failover:');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('AC3 — the body placeholder is resolved at stamp time', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-1420-'));
        try {
            const p = applyFinalProvenance(provenance(), traceFile(dir));
            const body = [
                '## Scope and provenance',
                '',
                'Executor is `pending: executor resolved at stamp`. Model is `pending: model resolved at stamp`.',
                'Legacy: `not available: probe did not receive an executor` / `not available: probe did not receive a model`.',
                '',
            ].join('\n');
            const stamped = stampReport(body, p);
            expect(stamped).toContain(`Executor is \`${EXECUTOR}\``);
            expect(stamped).toContain('Model is `commandcode/deepseek/deepseek-v4.1-flash`');
            expect(stamped).not.toContain('pending: executor resolved at stamp');
            expect(stamped).not.toContain('pending: model resolved at stamp');
            expect(stamped).not.toContain('not available: probe did not receive');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('AC3 — a stamp without receipts (no executorProfile) never writes "undefined" into the body', () => {
        // The `anatomy-stamp` call without --validation/--trace stamps the probe JSON directly,
        // and the probe never sets `executorProfile`.
        const body =
            'Executor is `pending: executor resolved at stamp`. Model is `pending: model resolved at stamp`.\n';
        const named = stampReport(body, provenance({ executor: 'pi', model: 'commandcode/m' }));
        expect(named).toContain('Executor is `pi`');
        expect(named).toContain('Model is `commandcode/m`');
        const unnamed = stampReport(
            body,
            provenance({ executor: 'pending: executor resolved at stamp', model: 'pending: model resolved at stamp' }),
        );
        for (const out of [named, unnamed]) {
            expect(out).not.toContain('undefined');
            expect(out).not.toContain('resolved at stamp`');
        }
    });

    test('AC4 — a cache-hit republish rewrites a placeholder identity, keeps a real one', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ha-1420-'));
        try {
            const p = applyFinalProvenance(provenance(), traceFile(dir));
            const legacy = stampReport(
                'body\n',
                provenance({
                    executor: 'not available: probe did not receive an executor',
                    model: 'not available: probe did not receive a model',
                }),
            );
            const refreshed = refreshReport(legacy, '2026-11-21T00:00:00.000Z', 'hit');
            expect(refreshed).toContain('not-applicable: cache hit, no agent stage ran');
            expect(refreshed).not.toContain('not available: probe did not receive');

            const real = stampReport('body\n', p);
            const kept = refreshReport(real, '2026-11-21T00:00:00.000Z', 'hit');
            expect(kept).toContain(EXECUTOR);
            expect(parseProvenance(kept)?.validatedAt).toBe('2026-11-21T00:00:00.000Z');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
