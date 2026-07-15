import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { requestAttach } from './attach-bus';

// ── Wire shapes from GET /api/team/processes ──

/** Supervisor-controlled row (start/stop/attach). */
interface SupervisedProcessRow {
    agentId: string;
    pid: number | null;
    status: string;
    startedAt: string;
    exitCode: number | null;
}

/** ProcessRegistry execution row (ts-runtime 0.4.10 / spur#0264). */
interface RegistryExecutionRow {
    id: string;
    label: string;
    command: string;
    args: string[];
    pid: number | null;
    status: string;
    startedAt: string;
    exitedAt: string | null;
    exitCode: number | null;
    source: string;
    teamId: string | null;
    agentId: string | null;
}

interface ProcessesSnapshot {
    processes: SupervisedProcessRow[];
    count: number;
    executions: RegistryExecutionRow[];
    executionsCount: number;
}

/** Unified table row for the Processes watch list. */
interface WatchRow {
    key: string;
    label: string;
    agentId?: string;
    pid: number | null;
    status: string;
    startedAt: string;
    source: string;
    canControl: boolean;
    canAttach: boolean;
}

const POLL_MS = 3_000;

const processesUrl = () => `${resolveApiUrl()}/team/processes`;
const startUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/start`;
const stopUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/stop`;

/**
 * Build a unified watch list: supervisor rows first (with controls), then
 * registry executions that are not already covered by a supervised agent/pid.
 */
export function buildWatchRows(processes: SupervisedProcessRow[], executions: RegistryExecutionRow[]): WatchRow[] {
    const rows: WatchRow[] = processes.map((p) => ({
        key: `sup:${p.agentId}`,
        label: p.agentId,
        agentId: p.agentId,
        pid: p.pid,
        status: p.status,
        startedAt: p.startedAt,
        source: 'supervisor',
        canControl: true,
        canAttach: true,
    }));

    const coveredAgents = new Set(processes.map((p) => p.agentId));
    const coveredPids = new Set(processes.map((p) => p.pid).filter((p): p is number => p != null));

    for (const e of executions) {
        if (e.agentId && coveredAgents.has(e.agentId)) continue;
        if (e.pid != null && coveredPids.has(e.pid)) continue;
        rows.push({
            key: `reg:${e.id}`,
            label: e.label || e.command,
            agentId: e.agentId ?? undefined,
            pid: e.pid,
            status: e.status,
            startedAt: e.startedAt,
            source: e.source,
            canControl: false,
            canAttach: Boolean(e.agentId),
        });
    }
    return rows;
}

/**
 * Processes tab — process watch list for Teams (0262 + 0264).
 *
 * Polls GET /api/team/processes every 3s. Renders supervisor-managed members
 * (with Attach + Start/Stop) plus other ProcessExecutor registry runs
 * (one-shots / other) from the shared serve-local registry.
 */
export default function ProcessesTab() {
    const [snapshot, setSnapshot] = useState<ProcessesSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [actionPending, setActionPending] = useState<string | null>(null);
    const mountedRef = useRef(true);

    const load = useCallback(async (signal: AbortSignal) => {
        try {
            const res = await fetchWithTimeout(new Request(processesUrl(), { signal }));
            if (!res.ok) throw new Error(`processes fetch failed: ${res.status}`);
            const json: unknown = await res.json();
            const body = json as Partial<ProcessesSnapshot>;
            if (mountedRef.current) {
                setSnapshot({
                    processes: body.processes ?? [],
                    count: body.count ?? 0,
                    executions: body.executions ?? [],
                    executionsCount: body.executionsCount ?? 0,
                });
                setError(null);
            }
        } catch (err) {
            if (signal.aborted) return;
            if (mountedRef.current) {
                setError(err instanceof Error ? err.message : String(err));
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        let active: AbortController | null = null;
        const poll = () => {
            active?.abort();
            active = new AbortController();
            void load(active.signal);
        };
        poll();
        const interval = setInterval(poll, POLL_MS);
        return () => {
            mountedRef.current = false;
            active?.abort();
            clearInterval(interval);
        };
    }, [load]);

    const toggleStatus = useCallback(
        async (agentId: string, running: boolean) => {
            setActionPending(agentId);
            try {
                const url = running ? stopUrl(agentId) : startUrl(agentId);
                const res = await fetchWithTimeout(new Request(url, { method: 'POST' }));
                if (!res.ok) {
                    const body: unknown = await res.json().catch(() => null);
                    const msg =
                        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
                            ? body.error
                            : undefined;
                    setError(msg ?? `request failed (${res.status})`);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setActionPending(null);
                const ctrl = new AbortController();
                void load(ctrl.signal);
            }
        },
        [load],
    );

    // Attach: signal Terminal tab's local selection (loose coupling via attach-bus).
    const attachToTerminal = useCallback((agentId: string) => {
        requestAttach(agentId);
    }, []);

    const watchRows = useMemo(
        () => (snapshot ? buildWatchRows(snapshot.processes, snapshot.executions) : []),
        [snapshot],
    );

    // ── Empty / error states ──
    if (error && (!snapshot || watchRows.length === 0)) {
        return (
            <div className="p-4 text-sm text-error" role="alert" data-processes-tab-error>
                Failed to load processes: {error}
            </div>
        );
    }

    if (!snapshot) {
        return (
            <div className="p-4" data-processes-tab-loading>
                <Loading size="sm" />
            </div>
        );
    }

    if (watchRows.length === 0) {
        return (
            <div className="p-4 text-sm text-spur-text-muted" data-processes-tab-empty>
                No processes. Start a team agent from the Terminal tab or via{' '}
                <code className="font-mono">spur team start</code>.
            </div>
        );
    }

    const supervisedCount = snapshot.processes.length;
    const otherCount = Math.max(0, watchRows.length - supervisedCount);

    return (
        <div className="p-3 overflow-auto h-full" data-processes-tab>
            <div className="flex items-center gap-2 mb-2 text-xs text-spur-text-muted">
                <span data-processes-header>
                    Process watch list ({watchRows.length}
                    {supervisedCount > 0 || otherCount > 0
                        ? ` · ${supervisedCount} supervised${otherCount > 0 ? ` · ${otherCount} other` : ''}`
                        : ''}
                    )
                </span>
                <span className="italic">— ProcessExecutor registry (ts-runtime)</span>
            </div>

            <table className="table table-xs">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Source</th>
                        <th>PID</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {watchRows.map((p) => {
                        const running = p.status === 'running';
                        return (
                            <tr key={p.key} data-processes-row={p.key}>
                                <td className="font-mono text-xs">{p.label}</td>
                                <td className="text-xs text-spur-text-muted" data-process-source={p.source}>
                                    {p.source}
                                </td>
                                <td className="font-mono text-xs text-spur-text-muted">{p.pid ?? '—'}</td>
                                <td>
                                    <Badge variant={running ? 'success' : 'ghost'} size="xs">
                                        {p.status}
                                    </Badge>
                                </td>
                                <td className="text-xs text-spur-text-muted">
                                    {new Date(p.startedAt).toLocaleTimeString()}
                                </td>
                                <td>
                                    <div className="flex items-center gap-1">
                                        {p.canAttach && p.agentId ? (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="xs"
                                                onClick={() => attachToTerminal(p.agentId as string)}
                                                data-processes-attach-btn
                                            >
                                                Attach
                                            </Button>
                                        ) : null}
                                        {p.canControl && p.agentId ? (
                                            <Button
                                                type="button"
                                                variant={running ? 'warning' : 'primary'}
                                                size="xs"
                                                disabled={actionPending === p.agentId}
                                                onClick={() => void toggleStatus(p.agentId as string, running)}
                                                data-processes-toggle-btn
                                            >
                                                {running ? 'Stop' : 'Start'}
                                            </Button>
                                        ) : null}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
