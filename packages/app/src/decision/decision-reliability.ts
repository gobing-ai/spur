/**
 * Decision reliability report over the recorded `decision.end` ledger — design/
 * decision-observability-and-adoption.md §3.4 (task 1096, slice S3, R2/R3).
 *
 * Reads recorded rows only: never constructs or calls a maker. Aggregation and
 * grouping live in `SystemEventDao.decisionSummary`; this service adds the
 * process-side math (nearest-rank percentiles, median, acceptance rate) and the
 * `evidence: 'none'` fill for catalog ids that have no recorded rows — the
 * evidence every P1 adoption slice cites before it starts (§5).
 */

import type { DecisionSummaryGroup, SystemEventDao } from '@gobing-ai/spur-domain';

/** Filter + fill options for {@link decisionReliability}. */
export interface DecisionReliabilitySpec {
    /** Inclusive lower bound (ISO timestamp); unset scans the whole ledger. */
    readonly since?: string;
    /** Restrict the report to one decision id (recorded groups and the fill alike). */
    readonly decisionId?: string;
    /**
     * Catalog ids the `evidence: 'none'` fill reports when they have no rows.
     * Callers pass the served catalog with each id's effective maker
     * (`DecisionService` → `status().perDecision`); absent, the report contains
     * only recorded groups.
     */
    readonly catalog?: ReadonlyArray<DecisionReliabilityCatalogEntry>;
}

/** One catalog entry the evidence-none fill needs: a served id and its effective maker. */
export interface DecisionReliabilityCatalogEntry {
    readonly decisionId: string;
    readonly maker: string;
}

/** One per-(decision × maker) row of {@link DecisionReliabilityReport}. */
export interface DecisionReliabilityGroup {
    decisionId: string;
    maker: string;
    /** `recorded` — aggregated from ledger rows; `none` — catalog id with zero rows. */
    evidence: 'recorded' | 'none';
    samples: number;
    accepted: number;
    /** `accepted / samples`; 0 when there are no samples. */
    acceptedRate: number;
    fallbacks: Record<string, number>;
    /** Median numeric confidence, nulls excluded; null when no sample carried one. */
    medianConfidence: number | null;
    p50DurationMs: number | null;
    p95DurationMs: number | null;
    firstSeen: string | null;
    lastSeen: string | null;
}

/** Report behind `spur decision status --reliability`. */
export interface DecisionReliabilityReport {
    generatedAt: string;
    groups: DecisionReliabilityGroup[];
}

/**
 * Build the reliability report for one ledger: recorded groups first (highest
 * sample count first), then every catalog id without rows as `evidence: 'none'`.
 * `spec.since` narrows the window; `spec.decisionId` narrows both the recorded
 * groups and the fill, so a filtered report stays self-consistent.
 */
export async function decisionReliability(
    dao: SystemEventDao,
    spec: DecisionReliabilitySpec = {},
): Promise<DecisionReliabilityReport> {
    const groups = await dao.decisionSummary({
        ...(spec.since !== undefined ? { since: spec.since } : {}),
        ...(spec.decisionId !== undefined ? { decisionId: spec.decisionId } : {}),
    });
    const reliability: DecisionReliabilityGroup[] = groups.map(toReliabilityGroup);

    const recordedIds = new Set(reliability.map((group) => group.decisionId));
    for (const entry of spec.catalog ?? []) {
        if (recordedIds.has(entry.decisionId)) continue;
        // A filtered report keeps the fill consistent with the filter.
        if (spec.decisionId !== undefined && spec.decisionId !== entry.decisionId) continue;
        recordedIds.add(entry.decisionId);
        reliability.push({
            decisionId: entry.decisionId,
            maker: entry.maker,
            evidence: 'none',
            samples: 0,
            accepted: 0,
            acceptedRate: 0,
            fallbacks: {},
            medianConfidence: null,
            p50DurationMs: null,
            p95DurationMs: null,
            firstSeen: null,
            lastSeen: null,
        });
    }

    return { generatedAt: new Date().toISOString(), groups: reliability };
}

/** Map one DAO group onto the report shape, computing rate, median and percentiles. */
function toReliabilityGroup(group: DecisionSummaryGroup): DecisionReliabilityGroup {
    return {
        decisionId: group.decisionId,
        maker: group.maker,
        evidence: 'recorded',
        samples: group.samples,
        accepted: group.accepted,
        acceptedRate: group.samples > 0 ? group.accepted / group.samples : 0,
        fallbacks: group.fallbacks,
        medianConfidence: nearestRank(group.confidence, 50),
        p50DurationMs: nearestRank(group.durationMs, 50),
        p95DurationMs: nearestRank(group.durationMs, 95),
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
    };
}

/**
 * Nearest-rank percentile over ascending-sorted input: rank ⌈p/100 · n⌉ clamped
 * to [1, n], so a single sample reports itself for every percentile (failure
 * list: "p95 on a single sample"). Empty input reports null.
 */
function nearestRank(values: number[], percentile: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.min(Math.max(Math.ceil((percentile / 100) * sorted.length), 1), sorted.length);
    const value = sorted[rank - 1];
    return value === undefined ? null : value;
}
