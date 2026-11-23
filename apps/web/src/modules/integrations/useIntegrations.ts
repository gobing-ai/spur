import type { IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../../lib/rpc-client';
import { api, apiFetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { eventsHistoryUrl } from '../observability/events-history';
import {
    a2aRequests,
    type InboxRequestRow,
    type ProtocolEventRow,
    projectProtocolEvent,
    type ServerRuntime,
    sinceForWindow,
    type UsageWindow,
} from './helpers';

/**
 * The Integrations module's one data hook (task 1424).
 *
 * Owns the status read, the usage window and the two activity lists, so the shell can render
 * loading / empty / diagnostic states for the whole module rather than per tab. Every read is the
 * existing procedure or the existing `/api/events/history` endpoint — no new endpoint, no SSE
 * (that is out of scope for A82).
 */

/** Everything a tab renders, plus the module-level state the shell branches on. */
export interface IntegrationsData {
    status: IntegrationsStatus | null;
    usage: IntegrationsUsage | null;
    /** Recent `mcp.tool.*` rows, newest first. */
    mcpEvents: ProtocolEventRow[];
    /** Recent `a2a.*` and `auth.denied` rows, newest first. */
    a2aEvents: ProtocolEventRow[];
    /** Inbox request rows; the A2A tab filters them to the `a2a:` request-key family. */
    requests: InboxRequestRow[];
    /** Outbound receipts, one small list per declared outbound member. */
    receipts: Array<{ member: string; rows: InboxRequestRow[] }>;
    /** The served build's version + uptime; `null` when `/api/health` cannot be read. */
    server: ServerRuntime | null;
    loading: boolean;
    error: Error | null;
    window: UsageWindow;
    setWindow: (next: UsageWindow) => void;
    retry: () => void;
}

/**
 * The two seams the hook reads. Both default to the production client, and both are injected by a
 * test that must not depend on the process-global rpc/fetch mocks (bun's `mock.module` is not
 * per-file, so a suite-order change could otherwise swap the client underneath this module).
 */
export interface IntegrationsSeams {
    api?: ApiClient;
    fetchHistory?: (request: Request) => Promise<Response>;
}

/** Read one events-history page for a prefix family. */
async function readEvents(
    prefix: string,
    since: string | undefined,
    seams: IntegrationsSeams,
): Promise<ProtocolEventRow[]> {
    const url = eventsHistoryUrl({ prefix, since, limit: 50 });
    const res = await (seams.fetchHistory ?? apiFetchWithTimeout)(new Request(url));
    if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as { error?: string } | null;
        const detail = typeof errorBody?.error === 'string' && errorBody.error !== '' ? ` (${errorBody.error})` : '';
        throw new Error(`events/history answered ${res.status}${detail}`);
    }
    const body = (await res.json()) as { events?: unknown[] };
    return (body.events ?? []).flatMap((row) => {
        const projected = projectProtocolEvent(row);
        return projected === null ? [] : [projected];
    });
}

/**
 * Read the served build's identity (task 1437 R6).
 *
 * Deliberately tolerant: a stale or foreign server is exactly the case this must survive, so an
 * unreadable health route yields `null` instead of failing the module's whole read.
 */
async function readServerRuntime(seams: IntegrationsSeams): Promise<ServerRuntime | null> {
    try {
        const res = await (seams.fetchHistory ?? apiFetchWithTimeout)(new Request(`${resolveApiUrl()}/health`));
        if (!res.ok) return null;
        const body = (await res.json()) as { version?: unknown; uptime_seconds?: unknown };
        if (typeof body.version !== 'string' || typeof body.uptime_seconds !== 'number') return null;
        return { version: body.version, uptimeSeconds: body.uptime_seconds };
    } catch {
        return null;
    }
}

/** Load everything the module needs for one window. */
async function load(
    window: UsageWindow,
    seams: IntegrationsSeams,
): Promise<Omit<IntegrationsData, 'server' | 'loading' | 'error' | 'window' | 'setWindow' | 'retry'>> {
    const since = sinceForWindow(window);
    const client = seams.api ?? api;
    const [status, usage, mcpEvents, a2aEvents, authEvents, requestRows] = await Promise.all([
        client.integrations.status(),
        client.integrations.usage(since === undefined ? {} : { since }),
        readEvents('mcp', since, seams),
        readEvents('a2a', since, seams),
        readEvents('auth', since, seams),
        client.inbox.requests({ limit: 100, scope: 'all' }),
    ]);
    // One receipt page serves both the A2A task list and the per-member outbound receipts: the
    // receipt row IS the request row, so no second read and no N+1 per message.
    const receiptById = new Map(requestRows.map((row) => [row.messageId, row]));
    const receipts = await Promise.all(
        status.a2a.outbound.map(async (member) => {
            try {
                const page = await client.inbox.list({ member: member.member, direction: 'in', limit: 20 });
                // Only request rows are outbound traffic; plain chat is not a receipt.
                return {
                    member: member.member,
                    rows: page.messages
                        .filter((message) => message.kind === 'request')
                        .map((message) => receiptById.get(message.id) ?? deliveryRow(message)),
                };
            } catch {
                // One unreadable outbound member must not blank the whole tab.
                return { member: member.member, rows: [] };
            }
        }),
    );
    return {
        status,
        usage,
        mcpEvents,
        a2aEvents: [...a2aEvents, ...authEvents].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)),
        requests: a2aRequests(requestRows),
        receipts,
    };
}

/** A request message's delivery state, for the window before its receipt row exists. */
function deliveryRow(message: {
    id: string;
    requestKey: string | null;
    status: string;
    taskId: string | null;
}): InboxRequestRow {
    return {
        messageId: message.id,
        requestKey: message.requestKey,
        status: message.status,
        runId: null,
        taskId: message.taskId,
        outcome: null,
    };
}

/** The module's data hook; `retry()` re-runs the whole read. */
export function useIntegrations(seams: IntegrationsSeams = {}): IntegrationsData {
    const [window, setWindow] = useState<UsageWindow>('24h');
    const [state, setState] = useState<{
        status: IntegrationsStatus | null;
        usage: IntegrationsUsage | null;
        mcpEvents: ProtocolEventRow[];
        a2aEvents: ProtocolEventRow[];
        requests: InboxRequestRow[];
        receipts: Array<{ member: string; rows: InboxRequestRow[] }>;
        server: ServerRuntime | null;
        loading: boolean;
        error: Error | null;
    }>({
        status: null,
        usage: null,
        mcpEvents: [],
        a2aEvents: [],
        requests: [],
        receipts: [],
        server: null,
        loading: true,
        error: null,
    });
    const [attempt, setAttempt] = useState(0);
    // The seams are read through a ref: a caller passing an inline object must not re-run the read
    // on every render (the effect's identity is `window` + `attempt`, nothing else).
    const seamsRef = useRef(seams);
    seamsRef.current = seams;

    useEffect(() => {
        let cancelled = false;
        // A retry bumps `attempt`; this read belongs to that attempt and a superseded one is dropped.
        const forAttempt = attempt;
        setState((previous) => ({ ...previous, loading: true, error: null }));
        // Identity is read on its own so a failed status read still names the server behind it.
        void readServerRuntime(seamsRef.current).then((server) => {
            if (!cancelled && attempt === forAttempt) setState((previous) => ({ ...previous, server }));
        });
        void load(window, seamsRef.current).then(
            (data) => {
                if (!cancelled && attempt === forAttempt)
                    // `server` is owned by the identity read above, so the window read must not clear it.
                    setState((previous) => ({ ...previous, ...data, loading: false, error: null }));
            },
            (error: unknown) => {
                if (!cancelled && attempt === forAttempt) {
                    setState((previous) => ({
                        ...previous,
                        loading: false,
                        error: error instanceof Error ? error : new Error(String(error)),
                    }));
                }
            },
        );
        return () => {
            cancelled = true;
        };
    }, [window, attempt]);

    const retry = useCallback(() => setAttempt((value) => value + 1), []);
    return useMemo(() => ({ ...state, window, setWindow, retry }), [state, window, retry]);
}
