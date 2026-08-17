import type { HistoryArtifact, LadderEntry } from './artifact';
import type { PairingStat } from './pairings';
import { fmtDur } from './render-report';

/**
 * Minimum dispatches a pairing must total before it may drive a ladder
 * promote/demote suggestion (feature J8 R3). A named constant — a value that
 * never changes is a constant, not a config knob (task 0574 Design).
 */
export const MIN_PAIRING_DISPATCHES = 5;

/** Rendered in place of any section whose input field is absent (additive artifact contract). */
const SECTION_UNAVAILABLE = 'section unavailable (artifact predates the pairings field; re-run spur history analyze)';

/**
 * The pairings report mode (task 0574): a pure `HistoryArtifact → string`
 * renderer consuming ONLY the additive `pairings` / `ladderSnapshot` fields
 * (0573) — no I/O, no `DbAdapter`, no config read, no schema-version compare.
 *
 * Two sections:
 *
 * 1. `## Pairings` — one ranked table per role, ordered by the shared precedence
 *    (feature J8 R2 Then): success rate desc → total escalations asc → cost asc.
 * 2. `## Ladder diff` — per tier, the snapshotted config order vs the measured
 *    order; every adjacent inversion prints a `suggest: promote … above …`
 *    line citing the underlying numbers. A rung totalling fewer than
 *    {@link MIN_PAIRING_DISPATCHES} dispatches is marked `insufficient-evidence`
 *    and never suggested (R3).
 *
 * Absence degradation (R6): an artifact lacking `pairings` or `ladderSnapshot`
 * renders {@link SECTION_UNAVAILABLE} in place of that section — never a throw,
 * never a fabricated row.
 */
export function renderPairings(artifact: HistoryArtifact): string {
    const lines: string[] = [];
    lines.push(...renderPairingsSection(artifact));
    lines.push(...renderLadderDiffSection(artifact));
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section 1 — ## Pairings
// ---------------------------------------------------------------------------

/** The shared ranking precedence: success desc, then escalations asc, then cost asc. */
function comparePairings(a: PairingStat, b: PairingStat): number {
    return (
        b.successRate - a.successRate || totalEscalations(a) - totalEscalations(b) || a.totalCostUsd - b.totalCostUsd
    );
}

function renderPairingsSection(artifact: HistoryArtifact): string[] {
    const lines = ['## Pairings', ''];
    const pairings = artifact.pairings;
    if (pairings === undefined) {
        lines.push(SECTION_UNAVAILABLE, '');
        return lines;
    }
    if (pairings.length === 0) {
        lines.push('(no pairings in selection)', '');
        return lines;
    }
    for (const role of [...new Set(pairings.map((p) => p.role))].sort()) {
        const rows = pairings.filter((p) => p.role === role).sort(comparePairings);
        lines.push(`### role: ${role}`, '');
        lines.push(
            '| executor | agent | model | dispatches | success | escalations | cost | mean dur |',
            '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
        );
        for (const p of rows) {
            lines.push(
                `| ${p.executor} | ${p.agent} | ${p.model ?? 'n/a'} | ${p.dispatches} | ${pct(p.successRate)} | ` +
                    `${fmtEscalations(p)} | ${usd(p.totalCostUsd)} | ${fmtDuration(p.meanDurationMs)} |`,
            );
        }
        lines.push('');
    }
    return lines;
}

/** Escalations as `N (trigger:count, …)`, or `0` when the pairing never escalated. */
function fmtEscalations(p: PairingStat): string {
    const total = totalEscalations(p);
    if (total === 0) return '0';
    const breakdown = Object.entries(p.escalations)
        .map(([trigger, count]) => `${trigger}:${count}`)
        .join(', ');
    return `${total} (${breakdown})`;
}

/** Sum of escalation counts across triggers. */
function totalEscalations(p: PairingStat): number {
    return Object.values<number>(p.escalations).reduce((sum, count) => sum + count, 0);
}

// ---------------------------------------------------------------------------
// Section 2 — ## Ladder diff
// ---------------------------------------------------------------------------

/** One executor's measured standing, aggregated across all its pairings. */
interface ExecutorMeasure {
    entry: LadderEntry;
    dispatches: number;
    successRate: number;
    escalations: number;
    costUsd: number;
}

/**
 * Aggregate an executor's pairings (any role) into a single measured point: the
 * ladder ranks executors, not executor+role pairs, so the diff needs one
 * standing per rung. Successes are re-derived from `successRate * dispatches`
 * so the rate is dispatch-weighted across roles.
 */
function measureExecutor(entry: LadderEntry, pairings: PairingStat[]): ExecutorMeasure {
    const owned = pairings.filter((p) => p.executor === entry.name);
    const dispatches = owned.reduce((sum, p) => sum + p.dispatches, 0);
    const successes = owned.reduce((sum, p) => sum + p.successRate * p.dispatches, 0);
    return {
        entry,
        dispatches,
        successRate: dispatches > 0 ? successes / dispatches : 0,
        escalations: owned.reduce((sum, p) => sum + totalEscalations(p), 0),
        costUsd: owned.reduce((sum, p) => sum + p.totalCostUsd, 0),
    };
}

/** The same shared precedence, applied to measured executors. Negative = `a` measures better. */
function compareMeasured(a: ExecutorMeasure, b: ExecutorMeasure): number {
    return b.successRate - a.successRate || a.escalations - b.escalations || a.costUsd - b.costUsd;
}

function renderLadderDiffSection(artifact: HistoryArtifact): string[] {
    const lines = ['## Ladder diff', ''];
    const pairings = artifact.pairings;
    const ladder = artifact.ladderSnapshot;
    if (pairings === undefined || ladder === undefined) {
        lines.push(SECTION_UNAVAILABLE, '');
        return lines;
    }
    if (ladder.length === 0) {
        lines.push('(no executor ladder configured)', '');
        return lines;
    }
    for (const tier of [...new Set(ladder.map((e) => e.tier))].sort()) {
        const entries = ladder.filter((e) => e.tier === tier).sort((a, b) => a.order - b.order);
        const measured = entries.map((e) => measureExecutor(e, pairings));
        const measuredOrder = [...measured].sort(compareMeasured);

        lines.push(`### tier: ${tier}`, '');
        lines.push(`configured: ${entries.map((e) => e.name).join(', ')}`);
        lines.push(`measured:   ${measuredOrder.map((m) => m.entry.name).join(', ')}`);
        lines.push('');

        // Adjacent-inversion scan over the configured order: when the lower
        // configured rung measures strictly better than the rung above it, that
        // is one concrete reorder. A pair involving a below-floor rung never
        // suggests — the floor blocks reorderings driven by unreliable data.
        // noUncheckedIndexedAccess: index access yields `T | undefined`, so each
        // slot is narrowed with an explicit guard before use (never a `!`).
        for (let i = 1; i < measured.length; i++) {
            const above = measured[i - 1];
            const below = measured[i];
            if (above === undefined || below === undefined) continue;
            if (above.dispatches < MIN_PAIRING_DISPATCHES || below.dispatches < MIN_PAIRING_DISPATCHES) continue;
            if (compareMeasured(below, above) < 0) {
                lines.push(
                    `suggest: promote ${below.entry.name} above ${above.entry.name} ` +
                        `(dispatches=${below.dispatches}, success=${pct(below.successRate)} vs ` +
                        `${pct(above.successRate)}, cost=${usd(below.costUsd)} vs ${usd(above.costUsd)})`,
                );
            }
        }

        // Name every below-floor rung with its evidence gap — marked, never suggested.
        for (const m of measured) {
            if (m.dispatches < MIN_PAIRING_DISPATCHES) {
                lines.push(`${m.entry.name}: insufficient-evidence (N=${m.dispatches}<${MIN_PAIRING_DISPATCHES})`);
            }
        }
        lines.push('');
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Success rate as a percent string, one decimal: `0.9` → `90.0%`. */
function pct(rate: number): string {
    return `${(rate * 100).toFixed(1)}%`;
}

/** Cost as a dollar string: `1` → `$1.00`. */
function usd(cost: number): string {
    return `$${cost.toFixed(2)}`;
}

/** Mean duration via the shared formatter; `0` = none measured → `n/a` (never a fabricated zero). */
function fmtDuration(ms: number): string {
    return ms > 0 ? fmtDur(ms) : 'n/a';
}
