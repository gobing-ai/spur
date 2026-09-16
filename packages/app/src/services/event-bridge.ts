import type { AgentRunCorrelation } from '@gobing-ai/ts-ai-runner';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import type { EventBus, EventMap } from '@gobing-ai/ts-infra';
import type { AgentRoutingAttribution } from '../observability/agent-execution';
import { createWorkflowEventIdentity, decorateWorkflowEvent } from '../workflow/observability';

/**
 * Wrap a server EventBus into a typed EventBus shape.
 *
 * Three service classes (AgentService, RuleService, WorkflowService) hand-rolled
 * the same on/off/emit bridge for their respective type parameters. This helper
 * extracts the common pattern so there is one implementation.
 *
 * @param serverBus — the canonical EventBus injected into the service context.
 * @returns a typed EventBus that forwards every call through `serverBus`.
 */
export function bridgeEventBus<T extends EventMap>(
    serverBus: EventBus<Record<string, (event: unknown) => void>>,
): EventBus<T> {
    const bridge = {
        on: (event: string, listener: (event: unknown) => void) => serverBus.on(event, listener),
        off: (event: string, listener: (event: unknown) => void) => serverBus.off(event, listener),
        emit: (event: string, detail: unknown) => Promise.resolve(serverBus.emit(event, detail)),
    };
    // Single cast site for all EventBus structural mismatches (server→service maps).
    return bridge as unknown as EventBus<T>;
}

/**
 * Wrap a typed bridge so every `workflow.*` payload carries deterministic
 * workflow identity (task 0601 R3): `workflowName` always, plus `nodeLabel`
 * when the payload's step-bearing identifier resolves in the loaded definition.
 * Identity is derived once from the parsed `WorkflowDef` at the producer
 * fan-in — never per event, never from history. Non-object payloads pass
 * through untouched for the existing failure isolation.
 */
export function withWorkflowIdentity<T extends EventMap>(bridge: EventBus<T>, def: WorkflowDef): EventBus<T> {
    const identity = createWorkflowEventIdentity(def);
    const loose = bridge as unknown as EventBus<Record<string, (event: unknown) => void>>;
    const wrapped = {
        on: (event: string, listener: (event: unknown) => void) => loose.on(event, listener),
        off: (event: string, listener: (event: unknown) => void) => loose.off(event, listener),
        emit: (event: string, detail: unknown) =>
            Promise.resolve(loose.emit(event, decorateWorkflowEvent(identity, event, detail))),
    };
    return wrapped as unknown as EventBus<T>;
}

/**
 * Engine-native action-boundary names retired when the alias pairs collapsed
 * (task 0869 R2): `workflow.action.start`/`.done` double-named the same moment
 * the observability adapter's verb-form `workflow.action.started`/`.finished`
 * already describe. The retired aliases are deleted, not aliased — a filter
 * here keeps them off the shared bus so neither the tap nor the SSE stream
 * records a row that no longer has a meaning.
 */
const RETIRED_ACTION_BOUNDARY_ALIASES = new Set(['workflow.action.start', 'workflow.action.done']);

/**
 * Wrap a typed bridge so the retired action-boundary aliases never reach the
 * underlying bus. Everything else passes through unchanged, so engine-native
 * lifecycle names the adapter does not duplicate (run done/failed, guard,
 * HITL, custom, …) still flow exactly as before.
 */
export function dropRetiredActionBoundaryAliases<T extends EventMap>(bridge: EventBus<T>): EventBus<T> {
    const loose = bridge as unknown as EventBus<Record<string, (event: unknown) => void>>;
    const wrapped = {
        on: (event: string, listener: (event: unknown) => void) => loose.on(event, listener),
        off: (event: string, listener: (event: unknown) => void) => loose.off(event, listener),
        emit: (event: string, detail: unknown) => {
            if (RETIRED_ACTION_BOUNDARY_ALIASES.has(event)) return Promise.resolve();
            return Promise.resolve(loose.emit(event, detail));
        },
    };
    return wrapped as unknown as EventBus<T>;
}

/**
 * Wrap a typed bridge so `agent.invoke.*` payloads carry the dispatching run's
 * routing decision (task 0545 R1) and its correlation id (task 0869 R3). The
 * resolution funnel (`resolveExecutorSelector` and siblings) is the only place
 * that knows role, tier, executor, and source together; the AiRunner emits the
 * invoke lifecycle events the ledger persists. The per-run routing context is
 * merged here, at the one seam between decision and persistence — the facts
 * are never re-derived downstream.
 *
 * `readCorrelation` supplies the dispatching run's id when the AiRunner did
 * not attach one: the prompt dispatch carries `options.correlation` already,
 * but the resolution probes (`version`/`auth`) run before the dispatch and
 * emit invoke events without it. Stamping the same correlation keeps every
 * `agent.invoke.*` row attributable to the run that paid for it (R3); an
 * already-present correlation is never overwritten.
 *
 * `readRouting` is called at emit time so escalation hops re-stamp the payload
 * with the next decision before the re-dispatch. Payloads pass through
 * untouched for non-invoke events.
 */
export function withInvokeRouting<T extends EventMap>(
    bridge: EventBus<T>,
    readRouting: () => AgentRoutingAttribution | undefined,
    publishExit?: (detail: Record<string, unknown>) => Promise<void>,
    readCorrelation?: () => AgentRunCorrelation | undefined,
): EventBus<T> {
    // Loose reference for payload access; the wrapper is cast to the caller's
    // typed EventBus at the single structural cast site, like bridgeEventBus.
    const loose = bridge as unknown as EventBus<Record<string, (event: unknown) => void>>;
    const wrapped = {
        on: (event: string, listener: (event: unknown) => void) => loose.on(event, listener),
        off: (event: string, listener: (event: unknown) => void) => loose.off(event, listener),
        emit: (event: string, detail: unknown) => {
            if (
                (event === 'agent.invoke.start' || event === 'agent.invoke.exit') &&
                detail !== null &&
                typeof detail === 'object'
            ) {
                const record = detail as Record<string, unknown>;
                const routing = readRouting();
                const correlation = readCorrelation?.();
                const base =
                    correlation !== undefined && record.correlation === undefined ? { ...record, correlation } : record;
                const payload = { ...base, ...(routing !== undefined ? { routing } : {}) };
                if (event === 'agent.invoke.exit' && publishExit !== undefined) return publishExit(payload);
                return Promise.resolve(loose.emit(event, payload));
            }
            return Promise.resolve(loose.emit(event, detail));
        },
    };
    return wrapped as unknown as EventBus<T>;
}
