import { resolveApiUrl } from './rpc-client';

/** Planning event parsed from the shared stream for task, feature, and queue consumers. */
export interface PlanningEvent {
    eventName: string;
    payload: unknown;
}

const eventListeners = new Set<(event: PlanningEvent) => void>();
const connectionListeners = new Set<(connected: boolean) => void>();
let source: EventSource | undefined;
let connected = false;

function notifyConnection(value: boolean): void {
    connected = value;
    for (const listener of connectionListeners) listener(value);
}

/** One browser-owned transport; query invalidation and progress correlation stay with consumers. */
function connect(): void {
    if (source || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const current = new EventSource(`${resolveApiUrl()}/events/planning`);
    source = current;
    current.onopen = () => {
        if (source === current) notifyConnection(true);
    };
    current.onerror = () => {
        if (source === current) notifyConnection(false);
    };
    current.onmessage = (frame) => {
        if (source !== current) return;
        let raw: unknown;
        try {
            raw = JSON.parse(frame.data);
        } catch {
            return;
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        const { eventName, payload } = raw as Record<string, unknown>;
        if (
            typeof eventName !== 'string' ||
            !['task.', 'feature.', 'queue.job.'].some((prefix) => eventName.startsWith(prefix))
        )
            return;
        const event: PlanningEvent = { eventName, payload };
        for (const listener of eventListeners) listener(event);
    };
}

function disconnectIfUnused(): void {
    if (eventListeners.size || connectionListeners.size) return;
    const previous = source;
    source = undefined;
    connected = false;
    if (previous) {
        previous.onmessage = null;
        previous.onopen = null;
        previous.onerror = null;
        previous.close();
    }
}

/** Subscribe to planning events; the returned cleanup releases this subscription's shared transport reference. */
export function subscribePlanningEvents(listener: (event: PlanningEvent) => void): () => void {
    // Each registration owns its own reference, even when callers reuse a callback.
    const subscription = (event: PlanningEvent) => listener(event);
    eventListeners.add(subscription);
    connect();
    return () => {
        eventListeners.delete(subscription);
        disconnectIfUnused();
    };
}

/** Report the current and subsequent connection states; the returned cleanup releases this subscription. */
export function subscribePlanningConnection(listener: (connected: boolean) => void): () => void {
    const subscription = (value: boolean) => listener(value);
    connectionListeners.add(subscription);
    listener(connected);
    connect();
    return () => {
        connectionListeners.delete(subscription);
        disconnectIfUnused();
    };
}
