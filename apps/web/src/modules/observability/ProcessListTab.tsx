import { useCallback, useEffect, useState } from 'react';
import { Badge, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

/**
 * Wire shape of a process row from GET /api/observability/processes (task 0243).
 */
interface ProcessInventoryRow {
    pid: number;
    ppid: number;
    depth: number;
    source: 'serve' | 'supervisor' | 'descendant';
    label: string;
    agentId?: string;
    command: string;
    status: string;
    rssBytes: number;
    elapsedSeconds: number | null;
    startedAt: string | null;
}

interface ProcessInventorySnapshot {
    processes: ProcessInventoryRow[];
    rootPid: number;
    capturedAt: string;
}

const POLL_MS = 3_000;
const apiUrl = () => `${resolveApiUrl()}/observability/processes`;

/**
 * Process List tab (task 0243).
 *
 * Lists the spur serve process tree (OS walk + supervisor overlay) from
 * GET /api/observability/processes. Polls every 3s while mounted. Read-only.
 */
export default function ProcessListTab() {
    const [snapshot, setSnapshot] = useState<ProcessInventorySnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (signal: AbortSignal) => {
        try {
            const res = await fetchWithTimeout(new Request(apiUrl(), { signal }));
            if (!res.ok) {
                let detail = `process inventory fetch failed: ${res.status}`;
                try {
                    const body: unknown = await res.json();
                    const msg = (body as { error?: string }).error;
                    if (msg) detail = msg;
                } catch {
                    /* ignore non-JSON error body */
                }
                throw new Error(detail);
            }
            const json: unknown = await res.json();
            const body = json as ProcessInventorySnapshot;
            setSnapshot({
                processes: body.processes ?? [],
                rootPid: body.rootPid,
                capturedAt: body.capturedAt,
            });
            setError(null);
        } catch (err) {
            if (signal.aborted) return;
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        // One controller for the effect: polled loads share it, so an in-flight poll
        // is actually aborted on unmount instead of resolving into a dead component.
        const controller = new AbortController();
        void load(controller.signal);
        const timer = setInterval(() => {
            void load(controller.signal);
        }, POLL_MS);
        return () => {
            controller.abort();
            clearInterval(timer);
        };
    }, [load]);

    if (error && !snapshot) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load processes: {error}
            </div>
        );
    }
    if (snapshot === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading processes…
            </div>
        );
    }

    const { processes } = snapshot;

    return (
        <div className="flex flex-col h-full overflow-hidden" data-process-list-tab>
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0 flex items-center gap-2">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">Runtime Processes</span>
                <span className="text-xs text-spur-text-muted">{processes.length} process(es)</span>
                <span className="text-[10px] text-spur-text-muted ml-auto font-mono" title={snapshot.capturedAt}>
                    root pid={snapshot.rootPid}
                </span>
            </div>
            {error ? (
                <div className="px-4 py-1 text-xs text-warning" role="status">
                    Refresh warning: {error}
                </div>
            ) : null}
            {processes.length === 0 ? (
                <div className="p-4 text-sm text-spur-text-muted italic">
                    No processes in inventory (unexpected — serve root should always appear).
                </div>
            ) : (
                <div className="flex-1 overflow-auto">
                    <table className="table table-xs table-pin-rows w-full">
                        <thead>
                            <tr className="text-[10px] uppercase text-spur-text-muted">
                                <th>PID</th>
                                <th>PPID</th>
                                <th>Source</th>
                                <th>Name</th>
                                <th>Status</th>
                                <th>Memory</th>
                                <th>Duration</th>
                                <th>Command</th>
                            </tr>
                        </thead>
                        <tbody>
                            {processes.map((p) => (
                                <tr key={`${p.pid}-${p.ppid}`} className="border-spur-border">
                                    <td className="font-mono text-xs">{p.pid}</td>
                                    <td className="font-mono text-xs text-spur-text-muted">{p.ppid}</td>
                                    <td>
                                        <SourceBadge source={p.source} />
                                    </td>
                                    <td
                                        className="text-sm font-medium text-spur-text max-w-[10rem] truncate"
                                        style={{ paddingLeft: `${0.5 + p.depth * 0.75}rem` }}
                                        title={p.agentId ?? p.label}
                                    >
                                        {p.label}
                                    </td>
                                    <td>
                                        <StatusBadge status={p.status} />
                                    </td>
                                    <td className="font-mono text-xs whitespace-nowrap">{formatRss(p.rssBytes)}</td>
                                    <td className="font-mono text-xs whitespace-nowrap">
                                        {formatElapsed(p.elapsedSeconds, p.startedAt)}
                                    </td>
                                    <td
                                        className="font-mono text-[10px] text-spur-text-muted max-w-[20rem] truncate"
                                        title={p.command}
                                    >
                                        {p.command}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function SourceBadge({ source }: { source: ProcessInventoryRow['source'] }) {
    const variant = source === 'serve' ? 'primary' : source === 'supervisor' ? 'secondary' : 'ghost';
    return (
        <Badge variant={variant} size="xs">
            {source}
        </Badge>
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

function formatRss(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatElapsed(elapsedSeconds: number | null, startedAt: string | null): string {
    if (elapsedSeconds != null && elapsedSeconds >= 0) {
        if (elapsedSeconds < 60) return `${Math.floor(elapsedSeconds)}s`;
        if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m`;
        return `${Math.floor(elapsedSeconds / 3600)}h`;
    }
    if (startedAt) {
        const ms = Date.now() - new Date(startedAt).getTime();
        if (ms < 0) return '0s';
        if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
        if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
        return `${Math.floor(ms / 3_600_000)}h`;
    }
    return '—';
}
