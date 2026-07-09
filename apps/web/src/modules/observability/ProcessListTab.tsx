import { useCallback, useEffect, useState } from 'react';
import { Badge, Loading } from '@/ui';
import { resolveApiUrl } from '../../lib/rpc-client';

/**
 * Wire shape of a process entry from GET /api/team/processes.
 */
interface ProcessRow {
    agentId: string;
    pid: number | null;
    status: string;
    startedAt: string;
    exitCode: number | null;
}

const apiUrl = () => `${resolveApiUrl()}/team/processes`;
const sseUrl = () => `${resolveApiUrl()}/events/planning`;

/**
 * Process List tab (task 0195/0210 wave D).
 *
 * Lists supervised agent processes from the team module's `/api/team/processes`
 * endpoint. Subscribes to `process.*` SSE events for live updates. Each row
 * shows agent id, pid, status badge, and uptime.
 */
export default function ProcessListTab() {
    const [processes, setProcesses] = useState<ProcessRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (signal: AbortSignal) => {
        try {
            const res = await fetch(`${apiUrl()}`, { signal });
            if (!res.ok) throw new Error(`process list fetch failed: ${res.status}`);
            const json: unknown = await res.json();
            const body = json as { processes: ProcessRow[]; count: number };
            setProcesses(body.processes ?? []);
            setError(null);
        } catch (err) {
            if (signal.aborted) return;
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    // Live tail: refetch on process.* SSE events.
    useEffect(() => {
        if (typeof EventSource === 'undefined') return;
        const es = new EventSource(sseUrl());
        es.onmessage = (frame) => {
            try {
                const raw: unknown = JSON.parse(frame.data);
                const name = (raw as { eventName?: string }).eventName;
                if (!name?.startsWith('process.')) return;
                void load(new AbortController().signal);
            } catch {
                // Malformed frame — drop silently.
            }
        };
        return () => es.close();
    }, [load]);

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load processes: {error}
            </div>
        );
    }
    if (processes === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading processes…
            </div>
        );
    }
    if (processes.length === 0) {
        return (
            <div className="p-4 text-sm text-spur-text-muted italic">
                No supervised processes. Use `spur serve` with `SPUR_TEAM_AUTOSTART` or `spur team start &lt;id&gt;` to
                launch agents.
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden" data-process-list-tab>
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                    Supervised Processes
                </span>
                <span className="ml-2 text-xs text-spur-text-muted">{processes.length} process(es)</span>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-1">
                {processes.map((p) => (
                    <li
                        key={p.agentId}
                        className="flex items-center gap-2 px-3 py-1.5 rounded bg-base-200 border border-spur-border"
                    >
                        <span className="text-sm font-medium text-spur-text">{p.agentId}</span>
                        <span className="text-xs text-spur-text-muted font-mono">pid={p.pid ?? '?'}</span>
                        <StatusBadge status={p.status} />
                        <span className="text-[10px] text-spur-text-muted ml-auto font-mono" title={p.startedAt}>
                            {formatUptime(p.startedAt)}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const variant = status === 'running' ? 'success' : status === 'exited' ? 'warning' : 'ghost';
    return (
        <Badge variant={variant} size="xs">
            {status}
        </Badge>
    );
}

function formatUptime(startedAt: string): string {
    const ms = Date.now() - new Date(startedAt).getTime();
    if (ms < 0) return '0s';
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    return `${Math.floor(ms / 3_600_000)}h`;
}
