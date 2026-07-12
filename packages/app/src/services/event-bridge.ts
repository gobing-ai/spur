import type { EventBus, EventMap } from '@gobing-ai/ts-infra';

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
