import {
    type AgentExecutorConfig,
    EXECUTION_CAPABILITY_AXES,
    type ExecutionCapabilities,
    type ExecutionCapabilityAttestation,
    type ExecutionCapabilityAxis,
    type ExecutionCapabilityProvenance,
    type ExecutionCapabilityRequirement,
    type ExecutionCapabilityState,
    type RequiresCapabilities,
    RequiresCapabilitiesSchema,
    SESSION_CAPABILITY_AXES,
    type SessionCapabilityAxis,
} from '@gobing-ai/spur-config';

/** Re-exported for service/action call sites typing the parsed requirement map. */
export type { RequiresCapabilities, SessionCapabilityAxis };
export { SESSION_CAPABILITY_AXES };

/**
 * Executor capability attestation (task 0706): the shared comparison layer
 * between what an `agent.run` stage requires and what the resolved executor's
 * native platform attests. Pure and process-free — callers gate BEFORE spawn.
 *
 * Monotonic satisfaction (0706 Design): `enforced` satisfies any requirement;
 * `available` satisfies only availability requirements; `unavailable` and
 * `unknown` satisfy nothing. Missing attestation data is `unknown` with
 * `unattested` provenance — never a permissive default (0706 R2).
 */

/** Attestation used for every axis an executor (or its config entry) does not declare. */
export const UNATTESTED_CAPABILITY: ExecutionCapabilityAttestation = {
    state: 'unknown',
    provenance: 'unattested',
};

/** One evaluated axis: requirement (when declared), attested state, and outcome. */
export interface CapabilityEvaluationEntry {
    axis: ExecutionCapabilityAxis;
    /** Requirement level the stage declared; absent for axes the stage did not require. */
    required?: ExecutionCapabilityRequirement;
    /** Attested state after missing-data resolution. */
    state: ExecutionCapabilityState;
    /** Who asserted the state. */
    provenance: ExecutionCapabilityProvenance;
    /** Whether the attested state satisfies the requirement (always true when undeclared). */
    satisfied: boolean;
}

/** Result of comparing stage requirements against an executor's attestation. */
export interface CapabilityEvaluation {
    /** False when any required axis is `unavailable` or `unknown` (0706 R5 fail-closed). */
    ok: boolean;
    /** Closed-axis-ordered evaluation entries. */
    entries: CapabilityEvaluationEntry[];
}

/**
 * Resolve the effective per-axis attestation for an executor. An absent config
 * entry (binary-pin or legacy-priority resolution) attests nothing: every axis
 * is `unknown`/`unattested`.
 */
export function executorAttestation(
    executor?: AgentExecutorConfig,
): Record<ExecutionCapabilityAxis, ExecutionCapabilityAttestation> {
    const declared: ExecutionCapabilities | undefined = executor?.executionCapabilities;
    const attestation = {} as Record<ExecutionCapabilityAxis, ExecutionCapabilityAttestation>;
    for (const axis of EXECUTION_CAPABILITY_AXES) {
        attestation[axis] = declared?.axes[axis] ?? UNATTESTED_CAPABILITY;
    }
    return attestation;
}

/**
 * Monotonic satisfaction rule (0706 Design): `enforced` satisfies everything;
 * `available` satisfies only `available`; `unavailable`/`unknown` satisfy nothing.
 */
export function satisfiesRequirement(
    required: ExecutionCapabilityRequirement,
    state: ExecutionCapabilityState,
): boolean {
    if (required === 'enforced') return state === 'enforced';
    return state === 'available' || state === 'enforced';
}

/**
 * Compare a stage's declared requirements against an executor's attestation.
 * Iterates the closed axis vocabulary in declaration order so diagnostics and
 * evidence are deterministic. Axes the stage does not require are reported as
 * satisfied observations (bounded evidence, 0706 R7) and never fail the gate.
 */
export function evaluateCapabilities(
    requires: Partial<RequiresCapabilities>,
    executor?: AgentExecutorConfig,
): CapabilityEvaluation {
    const attestation = executorAttestation(executor);
    const entries: CapabilityEvaluationEntry[] = [];
    let ok = true;
    for (const axis of EXECUTION_CAPABILITY_AXES) {
        const required = requires[axis];
        const observed = attestation[axis];
        const satisfied = required === undefined ? true : satisfiesRequirement(required, observed.state);
        if (!satisfied) ok = false;
        entries.push({
            axis,
            ...(required !== undefined ? { required } : {}),
            state: observed.state,
            provenance: observed.provenance,
            satisfied,
        });
    }
    return { ok, entries };
}

/**
 * Axis-by-axis fail-closed diagnostic (0706 R5): names the executor/spec, each
 * required axis, the required state, the actual state, and the provenance.
 * Bounded — identifiers and states only, never config blobs or env values.
 */
export function capabilityDiagnostic(selector: string, evaluation: CapabilityEvaluation): string {
    const failures = evaluation.entries.filter((entry) => entry.satisfied === false);
    const detail = failures
        .map(
            (entry) => `${entry.axis}: required=${entry.required} actual=${entry.state} provenance=${entry.provenance}`,
        )
        .join('; ');
    return `agent dispatch blocked by capability attestation (0706 R5): executor/spec '${selector}' cannot satisfy required capabilities — ${detail}. Attest the executor's executionCapabilities in agent config, or lower the stage's requiresCapabilities; unknown never satisfies a requirement.`;
}

/** Bounded, redacted evidence payload for routing/start events (0706 R7). */
export type CapabilityEvidenceEntry = Pick<
    CapabilityEvaluationEntry,
    'axis' | 'required' | 'state' | 'provenance' | 'satisfied'
>;

/** Projection of an evaluation safe for persisted events (identifiers + states only). */
export function capabilityEvidence(evaluation: CapabilityEvaluation): CapabilityEvidenceEntry[] {
    return evaluation.entries.map((entry) => ({ ...entry }));
}

/**
 * Runner-declared session capability for one agent (B8 R4): the four booleans
 * the record carries. Structural twin of `AgentSessionCapability` minus the
 * provenance fields — keeps this module process-free and decoupled from the
 * runner import so evaluation stays pure.
 */
export interface SessionCapabilityRecord {
    readonly supportsResumeById: boolean;
    readonly supportsSessionDir: boolean;
    readonly supportsPersistentStdin: boolean;
    readonly supportsStructuredOutput: boolean;
    /** Recorded reason for a `false` (runner record carries it; surfaced in diagnostics). */
    readonly note?: string;
}

/** Session axis id → the record flag that attests it. */
const SESSION_AXIS_FLAG: Record<SessionCapabilityAxis, keyof SessionCapabilityRecord> = {
    resumeById: 'supportsResumeById',
    sessionDir: 'supportsSessionDir',
    persistentStdin: 'supportsPersistentStdin',
    structuredOutput: 'supportsStructuredOutput',
};

/** Result of comparing stage session-axis requirements against a runner record. */
export interface SessionCapabilityEvaluation {
    /** False when a required axis is `false` in the record or the record is missing. */
    ok: boolean;
    /** Bounded fail-closed reason naming the executor agent and each missing capability. */
    reason: string;
    /** Machine-readable observed value for the ADR-118 contract-violation payload. */
    observed: string;
}

/**
 * Compare stage session-axis requirements against the runner's capability
 * record (B8 R4). A `true` record satisfies both requirement levels; `false`
 * or a missing record satisfies neither — unknown never satisfies (0706 R2
 * rule applied to runner-declared axes). Pure and process-free: callers gate
 * BEFORE spawn.
 */
export function evaluateSessionCapabilities(
    requires: Partial<RequiresCapabilities>,
    record: SessionCapabilityRecord | undefined,
    agentName: string,
): SessionCapabilityEvaluation {
    const required = SESSION_CAPABILITY_AXES.filter((axis) => requires[axis] !== undefined) as [
        SessionCapabilityAxis,
        ...SessionCapabilityAxis[],
    ];
    if (required.length === 0) return { ok: true, reason: '', observed: 'no session-axis requirement' };
    const missing = required.filter((axis) => record === undefined || record[SESSION_AXIS_FLAG[axis]] !== true);
    if (missing.length === 0) {
        return { ok: true, reason: '', observed: `session capabilities verified for ${agentName}` };
    }
    const detail = missing
        .map((axis) =>
            record === undefined
                ? `${axis}: no capability record for agent '${agentName}'`
                : `${axis}: declared false${record.note !== undefined ? ` (${record.note})` : ''}`,
        )
        .join('; ');
    return {
        ok: false,
        reason: `agent '${agentName}' cannot satisfy session capability requirements — ${detail}`,
        observed: `missing: ${missing.join(', ')}`,
    };
}

/**
 * Parse + validate a `requiresCapabilities` option value (0706 R4/R8). Accepts
 * the object shape at the action boundary and returns a closed-vocabulary
 * error naming the offending axis/level otherwise.
 */
export function parseRequiresCapabilities(
    raw: unknown,
): { ok: true; requires: Partial<RequiresCapabilities> } | { ok: false; error: string } {
    if (raw === undefined) return { ok: true, requires: {} };
    const parsed = RequiresCapabilitiesSchema.safeParse(raw);
    if (parsed.success) return { ok: true, requires: parsed.data };
    const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
    return {
        ok: false,
        error: `invalid requiresCapabilities (axes: ${[...EXECUTION_CAPABILITY_AXES, ...SESSION_CAPABILITY_AXES].join('|')}; levels: available|enforced) — ${issues}`,
    };
}
