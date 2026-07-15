import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

// ── Shape from GET /api/team/processes (supervisor list, also used by MemberTerminal) ──
interface ProcessRow {
    agentId: string;
    pid: number;
    status: string;
    startedAt: string;
    exitCode: number | null;
}

interface ProcessesSnapshot {
    processes: ProcessRow[];
    count: number;
}

const POLL_MS = 3_000;

const processesUrl = () => `${resolveApiUrl()}/team/processes`;
const startUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/start`;
const stopUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/stop`;

// TODO(task 0264): switch data source to full ProcessExecutor registry when available.
// v1 uses the supervisor-only /api/team/processes endpoint.

/**
 * Processes tab — v1 supervisor-focused watch list of team agent processes (0262 R1-R5).
 *
 * Polls GET /api/team/processes every 3s. Renders a table with agentId, pid, status
 * badge, startedAt, and per-row actions (Attach + Start/Stop). The "Attach" button
 * signals the agentId for Terminal tab's local selection (loose coupling — to be wired
 * once 0259 selector is stable).
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
            const body = json as ProcessesSnapshot;
            if (mountedRef.current) {
                setSnapshot({
                    processes: body.processes ?? [],
                    count: body.count ?? 0,
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
                // Refresh immediately after a toggle.
                const ctrl = new AbortController();
                void load(ctrl.signal);
            }
        },
        [load],
    );

    // ── Attach: signal Terminal tab's local selection (loose coupling) ──
    // TODO(0262+0259): wire to TerminalTab local state once the selector is stable.
    // For now, dispatch a custom event that TerminalTab can listen for.
    const attachToTerminal = useCallback((agentId: string) => {
        if (typeof globalThis.CustomEvent !== 'undefined') {
            globalThis.dispatchEvent(new CustomEvent('teams:attach-process', { detail: { agentId } }));
        }
    }, []);

    // ── Empty / error states ──
    if (error && (!snapshot || snapshot.processes.length === 0)) {
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

    if (snapshot.processes.length === 0) {
        return (
            <div className="p-4 text-sm text-spur-text-muted" data-processes-tab-empty>
                No supervised processes.
            </div>
        );
    }

    return (
        <div className="p-3 overflow-auto h-full" data-processes-tab>
            <div className="flex items-center gap-2 mb-2 text-xs text-spur-text-muted">
                <span>Supervised Processes ({snapshot.count})</span>
                <span className="italic">— v1 supervisor only (full ProcessExecutor registry: task 0264)</span>
            </div>

            <table className="table table-xs">
                <thead>
                    <tr>
                        <th>Agent</th>
                        <th>PID</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {snapshot.processes.map((p) => {
                        const running = p.status === 'running';
                        return (
                            <tr key={p.agentId}>
                                <td className="font-mono text-xs">{p.agentId}</td>
                                <td className="font-mono text-xs text-spur-text-muted">{p.pid}</td>
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
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="xs"
                                            onClick={() => attachToTerminal(p.agentId)}
                                            data-processes-attach-btn
                                        >
                                            Attach
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={running ? 'warning' : 'primary'}
                                            size="xs"
                                            disabled={actionPending === p.agentId}
                                            onClick={() => void toggleStatus(p.agentId, running)}
                                            data-processes-toggle-btn
                                        >
                                            {running ? 'Stop' : 'Start'}
                                        </Button>
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
