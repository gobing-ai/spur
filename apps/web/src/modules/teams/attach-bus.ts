/**
 * Attach signalling between the Processes tab and the Terminal tab (0265).
 *
 * `TeamsShell` renders only the active tab, so `TerminalTab` is **unmounted** at the
 * moment the operator clicks Attach in Processes. A bare CustomEvent would therefore
 * fire with no listener registered and be dropped — transient events are not replayed
 * to components that mount later. The pending-intent box below survives that gap:
 * Terminal consumes it once its teams snapshot is loaded.
 *
 * Both tabs talk to this module rather than to each other, keeping them decoupled and
 * leaving selection state local to TerminalTab (the M1 local-selection decision).
 */
export const ATTACH_EVENT = 'teams:attach-process';

/** Latest un-consumed attach intent. Survives the dispatch → Terminal-mount gap. */
let pendingAgentId: string | null = null;

/** Signal that the operator wants `agentId` opened in the Terminal tab. */
export function requestAttach(agentId: string): void {
    pendingAgentId = agentId;
    if (typeof globalThis.CustomEvent !== 'undefined') {
        globalThis.dispatchEvent(new CustomEvent(ATTACH_EVENT, { detail: { agentId } }));
    }
}

/**
 * Take the pending attach intent, clearing it. Returns `null` when there is none.
 * Clearing on read keeps a stale intent from hijacking a later manual selection.
 */
export function consumePendingAttach(): string | null {
    const agentId = pendingAgentId;
    pendingAgentId = null;
    return agentId;
}
