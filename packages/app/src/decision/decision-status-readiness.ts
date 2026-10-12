/**
 * Readiness overlay for `spur decision status` — feature P11, design/
 * decision-observability-and-adoption.md §3.4. It separates the three marks an operator
 * actually needs, per decision and per maker:
 *
 * - **registered** — the maker registry holds the name (`DecisionStatus`).
 * - **configured** — a config key names it (`decisions.maker`, `decisions.makers.<id>`).
 * - **recorded** — the `decision.end` ledger holds rows, so it has served at least once.
 * - **working now** — the opt-in `probeDecisionMakers` run asks one liveness decision.
 *
 * The overlay itself constructs no maker: recorded evidence is read through the existing
 * reliability aggregation, and the probe is the single maker-calling path, opt-in and
 * bounded (see {@link probeDecisionMakers}).
 */

import type { SystemEventDao } from '@gobing-ai/spur-domain';
import { type DecisionReliabilityGroup, decisionReliability } from './decision-reliability';
import type { DecisionProbeOutcome, DecisionStatus, DecisionStatusRow } from './decision-service';

/** Recorded ledger evidence for one decision or one maker. */
export interface DecisionEvidence {
    /** `decision.end` rows recorded — one per invocation; 0 means never exercised. */
    recorded: number;
    /** Of those, rows served with `source: model` — the maker answered, no fallback taken. */
    accepted: number;
    /** Latest recorded row (ISO); null when the ledger holds none. */
    lastSeen: string | null;
}

/** One row of the readiness report's Makers table. */
export interface DecisionMakerReadiness {
    name: string;
    /** The registry holds this name. `false` with `configuredBy` non-empty is a config error. */
    registered: boolean;
    /** Config keys naming this maker: `decisions.maker`, `decisions.makers.<id>`. */
    configuredBy: string[];
    /** Decision ids whose effective maker is this one; empty when nothing uses it. */
    serves: string[];
    /** Folded over every decision this maker serves. */
    evidence: DecisionEvidence;
}

/** A {@link DecisionStatusRow} plus its recorded evidence. */
export interface DecisionStatusEvidenceRow extends DecisionStatusRow {
    evidence: DecisionEvidence;
}

/** The additive readiness overlay on {@link DecisionStatus}. */
export interface DecisionStatusReadiness {
    makers: DecisionMakerReadiness[];
    perDecision: DecisionStatusEvidenceRow[];
    /** Present only when the caller probed; one entry per probed maker, in report order. */
    probes?: DecisionProbeOutcome[];
}

/**
 * The seam {@link probeDecisionMakers} needs. `DecisionService` satisfies it; a test
 * substitutes it to reach the failure table without a live backend.
 */
export interface DecisionMakerProbe {
    /** Validate the liveness catalog entry before any maker is called. */
    describe(decisionId: string): unknown;
    probeMaker(
        decisionId: string,
        maker: string,
        input: Record<string, unknown>,
        backstopMs: number,
    ): Promise<DecisionProbeOutcome>;
}

/** Served by `spur decision status --probe` only; no workflow may reference it (task 1169). */
export const LIVENESS_DECISION_ID = 'maker-liveness';

/**
 * Rendered as the implicit `instructions` channel the probe entry declares. One sentence
 * the maker can answer from its own state: a probe never asks the maker to classify anything.
 */
export const LIVENESS_PROBE_QUESTION =
    'Liveness probe. Answer "ok" if you can serve a decision right now; answer "unclear" only if you cannot.';

/**
 * Wall-clock ceiling for one probed maker. Driver budgets come first (see
 * `DecisionService.probeMaker`); this only bounds a driver with no budget of its own, so it
 * sits above the 120 s local-model startup handshake rather than cutting a cold start short.
 */
export const DEFAULT_PROBE_BACKSTOP_MS = 180_000;

const NO_EVIDENCE: DecisionEvidence = { recorded: 0, accepted: 0, lastSeen: null };

/**
 * Map one `DecisionStatus` plus the recorded reliability groups onto the readiness
 * overlay. Pure: the same inputs always produce the same report, and no maker is built.
 *
 * Evidence is matched on `(decisionId, maker)`, never on the decision id alone: a decision
 * whose configured maker changed has no evidence for its *new* maker, which is the honest
 * answer to "is this maker working for this decision".
 */
export function decisionStatusReadiness(
    status: DecisionStatus,
    groups: readonly DecisionReliabilityGroup[] = [],
): DecisionStatusReadiness {
    const byPair = new Map(groups.map((group) => [evidenceKey(group.decisionId, group.maker), group]));

    const perDecision: DecisionStatusEvidenceRow[] = status.perDecision.map((row) => ({
        ...row,
        evidence: toEvidence(byPair.get(evidenceKey(row.id, row.maker))),
    }));

    // Registered makers first (the registry is the authority), then any configured name the
    // registry does not hold — a config error that must stay visible in the Makers table
    // rather than disappearing from it.
    const names = new Set<string>(status.registeredMakers);
    if (status.configDefaultMaker !== undefined) names.add(status.configDefaultMaker);
    for (const row of status.perDecision) names.add(row.maker);
    for (const name of Object.values(status.configDecisionMakers)) names.add(name);

    const makers: DecisionMakerReadiness[] = [...names].map((name) => {
        const configuredBy: string[] = [];
        if (status.configDefaultMaker === name) configuredBy.push('decisions.maker');
        for (const [id, configured] of Object.entries(status.configDecisionMakers)) {
            if (configured === name) configuredBy.push(`decisions.makers.${id}`);
        }
        // Fold in every recorded group for this maker, in start order, so `lastSeen` is the
        // latest across all decisions and `recorded` is the maker's whole body of evidence.
        let evidence = NO_EVIDENCE;
        for (const group of groups) {
            if (group.maker !== name) continue;
            const seen = toEvidence(group);
            evidence = {
                recorded: evidence.recorded + seen.recorded,
                accepted: evidence.accepted + seen.accepted,
                lastSeen: latest(evidence.lastSeen, seen.lastSeen),
            };
        }
        return {
            name,
            registered: status.registeredMakers.includes(name),
            configuredBy,
            serves: perDecision.filter((row) => row.maker === name).map((row) => row.id),
            evidence,
        };
    });

    return { makers, perDecision };
}

/** {@link decisionStatusReadiness} over the project's recorded ledger. Reads; never calls a maker. */
export async function readDecisionStatusReadiness(
    dao: SystemEventDao,
    status: DecisionStatus,
): Promise<DecisionStatusReadiness> {
    const report = await decisionReliability(dao);
    return decisionStatusReadiness(status, report.groups);
}

/**
 * Probe each distinct registered effective maker once. Sequential on purpose: a probe is a
 * diagnostic an operator watches, and concurrent calls into one local backend would queue
 * against it — turning a latency signal into noise. `onResult` streams each outcome so a slow
 * maker is visible while it runs.
 *
 * Caller mistakes thrown by the seam (unknown decision id, unregistered maker, invalid input)
 * propagate: those are environment faults the command reports as failures, not probe data.
 */
export async function probeDecisionMakers(
    probe: DecisionMakerProbe,
    status: DecisionStatus,
    spec: { backstopMs?: number; onResult?: (result: DecisionProbeOutcome) => void } = {},
): Promise<DecisionProbeOutcome[]> {
    probe.describe(LIVENESS_DECISION_ID);
    const backstopMs = spec.backstopMs ?? DEFAULT_PROBE_BACKSTOP_MS;
    const makers = [...new Set(status.perDecision.filter((row) => row.registered).map((row) => row.maker))];
    const results: DecisionProbeOutcome[] = [];
    for (const maker of makers) {
        const result = await probe.probeMaker(
            LIVENESS_DECISION_ID,
            maker,
            { instructions: LIVENESS_PROBE_QUESTION },
            backstopMs,
        );
        results.push(result);
        spec.onResult?.(result);
    }
    return results;
}

function evidenceKey(decisionId: string, maker: string): string {
    return `${decisionId}\u0000${maker}`;
}

function toEvidence(group: DecisionReliabilityGroup | undefined): DecisionEvidence {
    if (group === undefined) return NO_EVIDENCE;
    return { recorded: group.samples, accepted: group.accepted, lastSeen: group.lastSeen };
}

/** Later of two optional ISO timestamps, ignoring nulls. */
function latest(a: string | null, b: string | null): string | null {
    if (a === null) return b;
    if (b === null) return a;
    return a >= b ? a : b;
}
