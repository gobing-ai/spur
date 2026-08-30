/**
 * Bounded routing identity recorded for one completed `agent.run` (R3): the
 * resolved executor plus any declared model override. Persisted under the
 * workflow var `__agentRouting_<node>` as bounded JSON — no prompts, no output.
 */
export interface AgentRoutingIdentity {
    /** Executor entry name that won resolution (post-resolution, R3). */
    agent: string;
    /** Declared model override, when the step set one. */
    model?: string;
}

/**
 * Review/verify independence policy (task 0710).
 *
 * R1/R2 enforce fresh context at the dispatch boundary; this module owns the
 * pure decision surfaces the runner and tests share:
 *
 * - R3: {@link parseAgentRoutingIdentity} parses the bounded routing evidence a
 *   completed `agent.run` persists under `__agentRouting_<node>`. Malformed or
 *   missing evidence is "unknown", never permissive.
 * - R4: {@link requiresDistinctExecutor} encodes the risk policy — P0/P1 tasks
 *   demand that review/verify resolve a DIFFERENT executor spec than the
 *   implementation stage; lower priorities (and unknown priorities) require
 *   fresh context only, with executor reuse allowed when no alternative exists.
 * - R5: {@link checkExecutorIndependence} evaluates distinctness AFTER routing
 *   and BEFORE dispatch, failing closed with a remedy that names the missing
 *   role/capability configuration.
 */

/** The priority risk tier that demands a distinct reviewer/verifier executor (R4). */
const DISTINCT_EXECUTOR_PRIORITIES = ['P0', 'P1'] as const;

/** True when the task's priority tier requires review/verify on a different executor spec (R4). */
export function requiresDistinctExecutor(priority: unknown): boolean {
    return typeof priority === 'string' && (DISTINCT_EXECUTOR_PRIORITIES as readonly string[]).includes(priority);
}

/**
 * Parse persisted `__agentRouting_<node>` evidence into its identity shape.
 * Returns undefined for missing or malformed values — callers treat that as
 * "cannot prove distinctness" and fail closed when the policy demands it (R5).
 */
export function parseAgentRoutingIdentity(value: unknown): AgentRoutingIdentity | undefined {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    if (typeof record.agent !== 'string' || record.agent.length === 0) return undefined;
    return {
        agent: record.agent,
        ...(typeof record.model === 'string' && record.model.length > 0 ? { model: record.model } : {}),
    };
}

/** Verdict shape for the fail-closed distinctness evaluation (R5). */
export type ExecutorIndependenceVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Fail-closed distinctness evaluation (R5). Every violation names the exact
 * configuration remedy so the operator can repair the routing instead of
 * guessing why a review step refused to dispatch.
 */
export function checkExecutorIndependence(input: {
    priority: string;
    requireDistinct: boolean;
    /** Routing evidence recorded by the implementation stage (may be missing). */
    prior?: AgentRoutingIdentity;
    /** Reviewer/verifier routing resolved pre-dispatch. */
    current: AgentRoutingIdentity | undefined;
    /** Workflow var name the prior evidence was read from, for exact remediation messages. */
    priorVar?: string;
}): ExecutorIndependenceVerdict {
    if (!input.requireDistinct) return { ok: true };
    if (input.prior === undefined) {
        return {
            ok: false,
            reason:
                `agent.run: distinct-executor policy (priority ${input.priority}) requires review/verify to resolve ` +
                'an executor different from implementation, but no implementation routing evidence was recorded ' +
                `(missing or malformed ${input.priorVar ?? '__agentRouting_<node>'} var); ` +
                're-run the implement stage so routing evidence is persisted (0710 R5)',
        };
    }
    if (input.current === undefined || input.current.agent.length === 0) {
        return {
            ok: false,
            reason:
                `agent.run: distinct-executor policy (priority ${input.priority}) could not resolve the reviewer/verifier ` +
                'executor routing (fail closed, 0710 R5); verify the executor registry and the reviewer role configuration',
        };
    }
    if (input.current.agent === input.prior.agent) {
        return {
            ok: false,
            reason:
                `agent.run: distinct-executor policy (priority ${input.priority}) requires review/verify to resolve a ` +
                `different executor than implementation ('${input.prior.agent}'), but routing resolved the same executor; ` +
                'configure a distinct reviewer/verifier executor (roles.reviewer tier override or an explicit agent pin) (0710 R4)',
        };
    }
    return { ok: true };
}
