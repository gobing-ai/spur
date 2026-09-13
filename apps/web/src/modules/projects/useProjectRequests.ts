/**
 * Durable results feed for the global input (0844 R1/R5, feature G63).
 *
 * Reads `GET /api/project/requests` — the read-only receipt projection — and
 * exposes it as a `messageId → RequestReceipt` map. The read refetches when
 * the orchestrator identity changes and then on a `STATUS_POLL_MS` (15s)
 * interval (the same identity convention ConversationView's inbox reads use)
 * and never leaks a previous project's rows: an unbound orchestrator clears
 * the map. A failed read is a NAMED state (`failed`), never a silent empty
 * result.
 */
import { useEffect, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import type { RequestReceipt } from './receipt';

/** Result-state refresh cadence for the always-mounted bar (0844 R5). */
const STATUS_POLL_MS = 15_000;

/** Wire shape of GET /api/project/requests. */
interface RequestsResponse {
    requests?: unknown;
}

function parseRequestReceipt(value: unknown): RequestReceipt | null {
    if (value === null || typeof value !== 'object') return null;
    const r = value as Record<string, unknown>;
    if (typeof r.messageId !== 'string' || r.messageId.length === 0) return null;
    if (typeof r.deliveryStatus !== 'string') return null;
    if (typeof r.injectAttempts !== 'number') return null;
    return {
        messageId: r.messageId,
        requestKey: typeof r.requestKey === 'string' ? r.requestKey : null,
        deliveryStatus: r.deliveryStatus,
        injectAttempts: r.injectAttempts,
        injectError: typeof r.injectError === 'string' ? r.injectError : null,
        runId: typeof r.runId === 'string' ? r.runId : null,
        taskId: typeof r.taskId === 'string' ? r.taskId : null,
        outcome:
            r.outcome === 'run-exit-only' || r.outcome === 'errored' || r.outcome === 'verified' ? r.outcome : null,
        reason: typeof r.reason === 'string' ? (r.reason as RequestReceipt['reason']) : null,
        hold: typeof r.hold === 'string' ? (r.hold as RequestReceipt['hold']) : null,
    };
}

/** Projection returned by `useProjectRequests`: receipt rows by requestKey, plus the named feed-failure flag. */
export interface ProjectRequests {
    requests: Map<string, RequestReceipt>;
    /** The feed could not be read — a named state (never a silent empty map). */
    failed: boolean;
}

/** Polls `/api/project/requests` for the bound orchestrator instance (0844) every `STATUS_POLL_MS` (override via `pollMs` for tests); unbind clears, feed failure sets `failed` — never a silent empty map. */
export function useProjectRequests(
    instanceId: string | null | undefined,
    pollMs: number = STATUS_POLL_MS,
): ProjectRequests {
    const [requests, setRequests] = useState<Map<string, RequestReceipt>>(() => new Map());
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (instanceId === null || instanceId === undefined) {
            // Unbound orchestrator: nothing to read results for — clear, don't leak.
            setRequests(new Map());
            setFailed(false);
            return;
        }
        const controller = new AbortController();
        let cancelled = false;
        const url = `${resolveApiUrl()}/project/requests`;
        const read = (): void => {
            fetchWithTimeout(new Request(url, { signal: controller.signal }))
                .then(async (res) => {
                    if (!res.ok) throw new Error(`requests fetch failed: ${res.status}`);
                    const body: unknown = (await res.json()) as RequestsResponse;
                    const rows = (body as RequestsResponse).requests;
                    const parsed = Array.isArray(rows)
                        ? rows.map(parseRequestReceipt).filter((r): r is RequestReceipt => r !== null)
                        : [];
                    if (!cancelled) {
                        setRequests(new Map(parsed.map((r) => [r.messageId, r])));
                        setFailed(false);
                    }
                })
                .catch(() => {
                    if (!cancelled) setFailed(true);
                });
        };
        read();
        const timer = setInterval(read, pollMs);
        return () => {
            cancelled = true;
            clearInterval(timer);
            controller.abort();
        };
    }, [instanceId, pollMs]);

    return { requests, failed };
}
