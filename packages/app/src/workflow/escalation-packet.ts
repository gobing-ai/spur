/**
 * Canonical escalation packet (task 0709).
 *
 * A pure, deterministic projection from existing run evidence: when an
 * operational trip wire fires or a workflow run settles into terminal
 * failure, the projector renders ONE bounded packet that names the goal,
 * the correlation ids, the last failed gate, references to existing
 * evidence (never the evidence payloads themselves), and the single
 * unresolved operator decision. JSON is the source of truth; Markdown is
 * an optional render.
 */

import { createHash } from 'node:crypto';
import { bounded } from './observability';

/** Bump only for a breaking packet shape change. */
export const ESCALATION_PACKET_SCHEMA_VERSION = 1;

/** Closed vocabulary for the unresolved operator decision (R1). */
export type EscalationDecisionKind =
    | 'retry'
    | 'revise_requirements'
    | 'grant_capability'
    | 'raise_budget'
    | 'inspect_failure';

/** Deterministic trip-wire policy → decision mapping (closed catalog, 0708). */
const POLICY_DECISIONS: Readonly<Record<string, EscalationDecisionKind>> = {
    'retry-exhausted': 'retry',
    'hard-budget': 'raise_budget',
    'capability-denied': 'grant_capability',
    'proof-invalidated': 'inspect_failure',
    'output-drop': 'inspect_failure',
};

/** Decision for a gate; unknown gates default to inspecting the failure. */
export function decisionKindForGate(gateId: string): EscalationDecisionKind {
    return POLICY_DECISIONS[gateId] ?? 'inspect_failure';
}

/** What triggered the projection. */
export type EscalationTrigger = 'tripwire' | 'terminal-failure';

/** Stable failure fingerprint: same run + trigger + gate + evidence ⇒ same id. */
export function escalationFingerprint(parts: {
    runId: string;
    trigger: EscalationTrigger;
    gateId: string;
    evidenceRefs: readonly string[];
}): string {
    const material = [parts.runId, parts.trigger, parts.gateId, ...parts.evidenceRefs].join('\n');
    return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** The versioned packet (R1). All string fields are bounded + redacted (R3). */
export interface EscalationPacket {
    readonly schemaVersion: typeof ESCALATION_PACKET_SCHEMA_VERSION;
    readonly fingerprint: string;
    readonly createdAt: string;
    readonly trigger: EscalationTrigger;
    /** The goal: what the workflow was driving at. */
    readonly goal: { readonly workflow: string; readonly node?: string };
    /** Planning identity, best-effort resolved from existing run links. */
    readonly identity: { readonly wbs?: string; readonly task?: string; readonly feature?: string };
    /** Execution correlation ids. */
    readonly ids: { readonly runId: string; readonly actionId?: string };
    /** Lifecycle state at projection time. */
    readonly lifecycleState: 'failed' | 'tripwire-fail' | 'tripwire-continue';
    /** Proof digest referenced by the evidence, when one exists. */
    readonly proofDigest?: string;
    /** Attempt/budget summary in the owning contract's terms. */
    readonly attempts: { readonly observed?: string; readonly threshold?: string };
    /** The gate that fired last. */
    readonly lastFailedGate: {
        readonly id: string;
        readonly kind?: string;
        readonly observed?: string;
    };
    /** References to existing evidence only — never logs/prompts/output (R2). */
    readonly evidence: { readonly artifactRefs: readonly string[]; readonly eventRefs: readonly string[] };
    /** The ONE unresolved operator decision (R1). */
    readonly decision: { readonly kind: EscalationDecisionKind; readonly reason: string };
}

/** Input to the projector; ids/refs come from existing stores and events. */
export interface EscalationPacketInput {
    readonly trigger: EscalationTrigger;
    readonly runId: string;
    readonly workflowName?: string;
    readonly node?: string;
    readonly actionId?: string;
    /** Gate identity: trip-wire policy id, or `terminal-failure`. */
    readonly gateId: string;
    readonly gateKind?: string;
    /** Causal event id (e.g. the tripwire's eventId) backing the packet. */
    readonly eventRef?: string;
    readonly observed?: string;
    readonly threshold?: string;
    readonly response?: 'fail' | 'continue';
    readonly evidenceRefs?: readonly string[];
    /** The exact next decision text (trip-wire `nextDecision` / failure reason). */
    readonly decisionReason: string;
    readonly identity?: { readonly wbs?: string; readonly task?: string; readonly feature?: string };
    readonly now: string;
}

const PROOF_DIGEST_PATTERN = /sha256:[0-9a-f]{16,}/;

/** Extract a proof digest from evidence refs, when one is referenced. */
export function extractProofDigest(evidenceRefs: readonly string[]): string | undefined {
    for (const ref of evidenceRefs) {
        const hit = ref.match(PROOF_DIGEST_PATTERN);
        if (hit !== null) return hit[0];
    }
    return undefined;
}

/**
 * Length-only bound for identifiers (workflow/node/wbs/paths). `bounded()`'s
 * secret pattern is for operator-facing free text; applied to identifiers it
 * would mangle legitimate values like `task-pipeline` (matches `sk-…`).
 */
function boundId(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : value.slice(0, maxLength);
}

/** Project the bounded packet (R1/R2/R3). Pure: no io, no clock. */
export function buildEscalationPacket(input: EscalationPacketInput): EscalationPacket {
    const evidenceRefs = (input.evidenceRefs ?? []).map((ref) => boundId(ref, 200));
    const lifecycleState: EscalationPacket['lifecycleState'] =
        input.trigger === 'terminal-failure'
            ? 'failed'
            : input.response === 'continue'
              ? 'tripwire-continue'
              : 'tripwire-fail';
    const gateId = boundId(input.gateId, 100);
    return {
        schemaVersion: ESCALATION_PACKET_SCHEMA_VERSION,
        fingerprint: escalationFingerprint({
            runId: input.runId,
            trigger: input.trigger,
            gateId: input.gateId,
            evidenceRefs: input.evidenceRefs ?? [],
        }),
        createdAt: input.now,
        trigger: input.trigger,
        goal: {
            workflow: boundId(input.workflowName ?? '', 120),
            ...(input.node !== undefined ? { node: boundId(input.node, 100) } : {}),
        },
        identity: {
            ...(input.identity?.wbs !== undefined ? { wbs: boundId(input.identity.wbs, 32) } : {}),
            ...(input.identity?.task !== undefined ? { task: bounded(input.identity.task, 120) } : {}),
            ...(input.identity?.feature !== undefined ? { feature: boundId(input.identity.feature, 32) } : {}),
        },
        ids: {
            runId: input.runId,
            ...(input.actionId !== undefined ? { actionId: boundId(input.actionId, 100) } : {}),
        },
        lifecycleState,
        ...(extractProofDigest(evidenceRefs) !== undefined ? { proofDigest: extractProofDigest(evidenceRefs) } : {}),
        attempts: {
            ...(input.observed !== undefined ? { observed: bounded(input.observed, 300) } : {}),
            ...(input.threshold !== undefined ? { threshold: bounded(input.threshold, 120) } : {}),
        },
        lastFailedGate: {
            id: gateId,
            ...(input.gateKind !== undefined ? { kind: boundId(input.gateKind, 100) } : {}),
            ...(input.observed !== undefined ? { observed: bounded(input.observed, 300) } : {}),
        },
        evidence: { artifactRefs: evidenceRefs, eventRefs: [boundId(input.eventRef ?? input.gateKind ?? gateId, 100)] },
        decision: { kind: decisionKindForGate(input.gateId), reason: bounded(input.decisionReason, 600) },
    };
}

/** Optional human render (R4). The JSON artifact remains the source of truth. */
export function renderEscalationMarkdown(packet: EscalationPacket): string {
    const lines = [
        `# Escalation ${packet.fingerprint}`,
        '',
        `- **Workflow:** ${packet.goal.workflow || '(unknown)'}`,
        ...(packet.goal.node !== undefined ? [`- **Node:** ${packet.goal.node}`] : []),
        ...(packet.identity.wbs !== undefined ? [`- **Task:** ${packet.identity.wbs}`] : []),
        ...(packet.identity.feature !== undefined ? [`- **Feature:** ${packet.identity.feature}`] : []),
        `- **Run:** ${packet.ids.runId}`,
        `- **Lifecycle:** ${packet.lifecycleState}`,
        ...(packet.proofDigest !== undefined ? [`- **Proof digest:** ${packet.proofDigest}`] : []),
        `- **Last failed gate:** ${packet.lastFailedGate.id}`,
        ...packet.evidence.artifactRefs.map((ref) => `- **Evidence:** ${ref}`),
        '',
        '## Operator decision required',
        '',
        `**${packet.decision.kind}** — ${packet.decision.reason}`,
        '',
    ];
    return lines.join('\n');
}
