import { describe, expect, test } from 'bun:test';
import type { HistoryArtifact, LadderEntry } from '../../src/analytics/artifact';
import { HISTORY_ARTIFACT_SCHEMA_VERSION } from '../../src/analytics/artifact';
import type { PairingStat } from '../../src/analytics/pairings';
import { MIN_PAIRING_DISPATCHES, renderPairings } from '../../src/analytics/render-pairings';
import { REPORT_MODES, resolveReportMode, UnknownReportModeError } from '../../src/analytics/report-modes';

// ---------------------------------------------------------------------------
// Fixtures — a minimal full artifact whose only populated inputs are the two
// additive 0573 fields this renderer consumes.
// ---------------------------------------------------------------------------

function emptyTokens() {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        records: 0,
        recordsWithUsage: 0,
        messages: 0,
        toolCalls: 0,
        durationMs: 0,
        durationUnmeasured: 0,
        assistantDurationMs: 0,
        assistantDurationUnmeasured: 0,
    };
}

function pairing(overrides: Partial<PairingStat>): PairingStat {
    return {
        executor: 'exec',
        role: 'coder',
        agent: 'agent',
        model: 'model',
        dispatches: 10,
        successRate: 0.8,
        escalations: {},
        totalCostUsd: 1.0,
        meanDurationMs: 2000,
        ...overrides,
    };
}

function ladderEntry(overrides: Partial<LadderEntry>): LadderEntry {
    return { name: 'exec', tier: 'standard', order: 0, ...overrides };
}

function artifact(pairings?: PairingStat[], ladderSnapshot?: LadderEntry[]): HistoryArtifact {
    return {
        schemaVersion: HISTORY_ARTIFACT_SCHEMA_VERSION,
        generatedAt: '2026-08-16T00:00:00Z',
        spurVersion: '1.0.0',
        selector: { since: null, until: null, sources: null, sessionId: null, runId: null, taskWbs: null },
        coverage: [],
        totals: { ...emptyTokens() },
        bySource: {},
        byModel: {},
        daily: [],
        byTool: [],
        bySession: [],
        loops: [],
        warnings: [],
        ...(pairings !== undefined ? { pairings } : {}),
        ...(ladderSnapshot !== undefined ? { ladderSnapshot } : {}),
    };
}

// ---------------------------------------------------------------------------
// R1 — the ranked table
// ---------------------------------------------------------------------------

describe('renderPairings (task 0574)', () => {
    test('R1: registers as the pairings report mode with the frozen dispatch floor', () => {
        expect(MIN_PAIRING_DISPATCHES).toBe(5);
        expect(REPORT_MODES.pairings).toBe(renderPairings);
        expect(resolveReportMode('pairings')).toBe(renderPairings);
    });

    test('R1: ranks pairings within a role by success desc, then escalations asc, then cost asc', () => {
        const out = renderPairings(
            artifact([
                // Same role so they compete for one ranking.
                pairing({
                    executor: 'd-low-esc-costy',
                    successRate: 0.8,
                    escalations: { 'gate-fail': 2 },
                    totalCostUsd: 0.5,
                }),
                pairing({ executor: 'c-zero-esc-costy', successRate: 0.8, escalations: {}, totalCostUsd: 3.0 }),
                pairing({ executor: 'b-zero-esc-cheap', successRate: 0.8, escalations: {}, totalCostUsd: 1.0 }),
                pairing({ executor: 'a-top', successRate: 0.9, escalations: { 'gate-fail': 5 }, totalCostUsd: 9.0 }),
            ]),
        );
        // Index of each row line in the rendered body = row order.
        const idx = (executor: string) => out.indexOf(`| ${executor} |`);
        expect(idx('a-top')).toBeGreaterThan(-1);
        expect(idx('a-top')).toBeLessThan(idx('b-zero-esc-cheap'));
        expect(idx('b-zero-esc-cheap')).toBeLessThan(idx('c-zero-esc-costy'));
        expect(idx('c-zero-esc-costy')).toBeLessThan(idx('d-low-esc-costy'));
    });

    test('R1: groups rows into one ranked table per role', () => {
        const out = renderPairings(
            artifact([
                pairing({ executor: 'cheap-exec', role: 'scribe', successRate: 0.6 }),
                pairing({ executor: 'std-exec', role: 'coder', successRate: 0.9 }),
            ]),
        );
        expect(out).toContain('### role: coder');
        expect(out).toContain('### role: scribe');
        // Each role's table only lists its own pairing.
        expect(out.indexOf('| std-exec |')).toBeLessThan(out.indexOf('### role: scribe'));
    });

    test('R1: renders the escalation per-trigger breakdown and n/a duration for unmeasured', () => {
        const out = renderPairings(
            artifact([
                pairing({
                    executor: 'codex',
                    successRate: 0.5,
                    escalations: { 'gate-fail': 1, 'resource-exhaustion': 2 },
                    meanDurationMs: 0,
                }),
            ]),
        );
        expect(out).toContain('3 (gate-fail:1, resource-exhaustion:2)');
        expect(out).toContain('| n/a |');
    });

    // -----------------------------------------------------------------------
    // R2 — the ladder diff
    // -----------------------------------------------------------------------

    test('R2: prints a promote suggestion citing dispatches, rates, and cost', () => {
        const out = renderPairings(
            artifact(
                [
                    pairing({ executor: 'codex', role: 'coder', successRate: 0.5, totalCostUsd: 3.0 }),
                    pairing({ executor: 'pi', role: 'coder', successRate: 0.9, totalCostUsd: 1.0 }),
                ],
                [ladderEntry({ name: 'codex', order: 0 }), ladderEntry({ name: 'pi', order: 1 })],
            ),
        );
        expect(out).toContain('suggest: promote pi above codex');
        expect(out).toContain('(dispatches=10, success=90.0% vs 50.0%, cost=$1.00 vs $3.00)');
    });

    test('R2: aggregates an executor across roles into one measured standing', () => {
        const out = renderPairings(
            artifact(
                [
                    // codex: 4 coder (0.75) + 6 scribe (1.0) = 10 dispatches, weighted 0.90.
                    pairing({ executor: 'codex', role: 'coder', dispatches: 4, successRate: 0.75, totalCostUsd: 2.0 }),
                    pairing({ executor: 'codex', role: 'scribe', dispatches: 6, successRate: 1.0, totalCostUsd: 0.5 }),
                    pairing({ executor: 'pi', role: 'coder', successRate: 0.5, totalCostUsd: 3.0 }),
                ],
                [ladderEntry({ name: 'codex', order: 0 }), ladderEntry({ name: 'pi', order: 1 })],
            ),
        );
        // codex weighted rate = (0.75*4 + 1.0*6)/10 = 0.90 > pi 0.50 → promote codex? No:
        // codex is already above pi in config; pi is NOT better, so no suggestion.
        expect(out).not.toContain('suggest:');
        // configured vs measured orders both shown for the tier.
        expect(out).toContain('configured: codex, pi');
    });

    // -----------------------------------------------------------------------
    // R3 — the insufficient-evidence floor
    // -----------------------------------------------------------------------

    test('R3: a below-floor rung is marked insufficient-evidence and never suggested', () => {
        const out = renderPairings(
            artifact(
                [
                    // codex has only 3 dispatches (below the 5 floor) but a perfect rate.
                    pairing({ executor: 'codex', dispatches: 3, successRate: 1.0, totalCostUsd: 0.1 }),
                    pairing({ executor: 'pi', dispatches: 10, successRate: 0.5, totalCostUsd: 2.0 }),
                ],
                [ladderEntry({ name: 'codex', order: 0 }), ladderEntry({ name: 'pi', order: 1 })],
            ),
        );
        expect(out).toContain(`insufficient-evidence (N=3<${MIN_PAIRING_DISPATCHES})`);
        // codex measures "better" but is below the floor — the pair must not suggest.
        expect(out).not.toContain('suggest:');
    });

    // -----------------------------------------------------------------------
    // R6 — absence degradation
    // -----------------------------------------------------------------------

    test('R6: an artifact without pairings/ladderSnapshot renders the section-unavailable notice', () => {
        const out = renderPairings(artifact());
        const notice = 'section unavailable (artifact predates the pairings field; re-run spur history analyze)';
        expect(out).toContain('## Pairings');
        expect(out).toContain(notice);
        expect(out).toContain('## Ladder diff');
        expect(out).not.toContain('| executor |');
    });

    test('R6: a present-but-empty pairings array renders an honest empty note, not the absence notice', () => {
        const out = renderPairings(artifact([], [ladderEntry({ name: 'codex', order: 0 })]));
        expect(out).toContain('(no pairings in selection)');
        expect(out).not.toContain('section unavailable');
    });

    test('R6: a present-but-empty ladder snapshot renders an honest empty note, not the absence notice', () => {
        const out = renderPairings(artifact([pairing({ executor: 'codex' })], []));
        expect(out).toContain('(no executor ladder configured)');
        expect(out).not.toContain('section unavailable');
    });

    // -----------------------------------------------------------------------
    // Registry — unknown modes fail loudly
    // -----------------------------------------------------------------------

    test('R1: an unknown mode name still fails naming the registered set', () => {
        try {
            resolveReportMode('spend');
            expect.unreachable('resolveReportMode must throw');
        } catch (e) {
            expect(e).toBeInstanceOf(UnknownReportModeError);
            const msg = (e as Error).message;
            expect(msg).toContain("'spend'");
            expect(msg).toContain('pairings');
        }
    });
});
