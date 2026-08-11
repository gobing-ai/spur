import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

// ── Wire shapes from GET /api/team/processes ──

/** Supervisor-controlled row (start/stop/attach). */
interface SupervisedProcessRow {
    agentId: string;
    pid: number | null;
    status: string;
    startedAt: string;
    exitCode: number | null;
    teamId: string | null;
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

/** Unified table row for the Processes watch list (read-only; no row actions). */
interface WatchRow {
    key: string;
    label: string;
    agentId?: string;
    pid: number | null;
    status: string;
    startedAt: string;
    source: string;
    teamId: string | null;
}

const POLL_MS = 3_000;

const processesUrl = () => `${resolveApiUrl()}/team/processes`;

/**
 * Build a unified watch list: supervisor rows first, then
 * registry executions that are not already covered by a supervised agent/pid.
 * Rows are read-only — Terminal tab supplies all controls per 0269 Plan 4.
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
        teamId: p.teamId ?? null,
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
            teamId: e.teamId ?? null,
        });
    }
    return rows;
}

/** Filter state for the Processes watch list (spur#0267 R2). */
export interface WatchFilters {
    /** When true, hide rows whose status is not `running`. */
    runningOnly: boolean;
    /**
     * Source filter: `all` | `supervisor` | `one-shot` | `other`.
     * `other` matches any source that is neither `supervisor` nor `one-shot`.
     */
    source: string;
    /** Team filter: `all` | team id. `unassigned` selects rows with null teamId. */
    team: string;
}

/** Pure filter helper exported for unit testing (spur#0267 R2, R5). */
export function filterWatchRows(rows: WatchRow[], filters: WatchFilters): WatchRow[] {
    return rows.filter((row) => {
        if (filters.runningOnly && row.status !== 'running') return false;
        if (filters.source === 'other') {
            if (row.source === 'supervisor' || row.source === 'one-shot') return false;
        } else if (filters.source !== 'all' && row.source !== filters.source) {
            return false;
        }
        if (filters.team === 'unassigned') {
            if (row.teamId != null) return false;
        } else if (filters.team !== 'all') {
            if (row.teamId !== filters.team) return false;
        }
        return true;
    });
}

/**
 * Filter controls for the Processes watch list (spur#0267 R2).
 *
 * Native `<select>`/`<input type="checkbox">` — `@/ui` Select mock does not
 * fire `change` reliably under happy-dom + React 19 controlled components,
 * so we use native controls that the test harness can drive via `fireEvent`.
 */
function ProcessFilterControls({
    filters,
    onFilters,
    teamIds,
    totalCount,
    shownCount,
}: {
    filters: WatchFilters;
    onFilters: (next: WatchFilters) => void;
    teamIds: string[];
    totalCount: number;
    shownCount: number;
}) {
    return (
        <div className="flex flex-wrap items-center gap-3 mb-2 text-xs" data-processes-filters>
            <label className="flex items-center gap-1" data-processes-filter-running>
                <input
                    type="checkbox"
                    checked={filters.runningOnly}
                    onChange={(e) => onFilters({ ...filters, runningOnly: e.target.checked })}
                    data-processes-filter-running-input
                />
                <span>Running only</span>
            </label>

            <label className="flex items-center gap-1">
                <span>Source</span>
                <select
                    value={filters.source}
                    onChange={(e) => onFilters({ ...filters, source: e.target.value })}
                    className="border border-spur-border rounded px-1 py-0.5 bg-spur-bg text-spur-text"
                    data-processes-filter-source
                    aria-label="Source filter"
                >
                    <option value="all">all</option>
                    <option value="supervisor">supervisor</option>
                    <option value="one-shot">one-shot</option>
                    <option value="other">other</option>
                </select>
            </label>

            <label className="flex items-center gap-1">
                <span>Team</span>
                <select
                    value={filters.team}
                    onChange={(e) => onFilters({ ...filters, team: e.target.value })}
                    className="border border-spur-border rounded px-1 py-0.5 bg-spur-bg text-spur-text"
                    data-processes-filter-team
                    aria-label="Team filter"
                >
                    <option value="all">all teams</option>
                    <option value="unassigned">unassigned</option>
                    {teamIds.map((t) => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                </select>
            </label>

            <button
                type="button"
                className="border border-spur-border rounded px-2 py-0.5 text-spur-text hover:bg-base-200 transition-colors cursor-pointer"
                onClick={() => onFilters({ runningOnly: false, source: 'all', team: 'all' })}
                data-processes-filter-clear
            >
                Clear
            </button>

            <span className="text-spur-text-muted" data-processes-filter-count>
                {shownCount}/{totalCount} shown
            </span>
        </div>
    );
}
/**
 * Processes tab — process watch list for Teams (0262 + 0264).
 *
 * Polls GET /api/team/processes every 3s. Renders supervisor-managed members
 * plus other ProcessExecutor registry runs (read-only — controls live in Terminal).
 */
export default function ProcessesTab({ teamId }: { teamId?: string }) {
    const [snapshot, setSnapshot] = useState<ProcessesSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Ephemeral filter state (spur#0267 R3) — not persisted across remounts.
    const [filters, setFilters] = useState<WatchFilters>({ runningOnly: false, source: 'all', team: 'all' });
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

    const watchRows = useMemo(
        () => (snapshot ? buildWatchRows(snapshot.processes, snapshot.executions) : []),
        [snapshot],
    );

    const filteredRows = useMemo(() => {
        const scoped = teamId ? watchRows.filter((r) => r.teamId === teamId) : watchRows;
        return filterWatchRows(scoped, filters);
    }, [watchRows, filters, teamId]);

    // Unique teams from snapshot for the team filter dropdown (spur#0267 R2).
    const teamIds = useMemo(() => {
        const seen = new Set<string>();
        for (const p of snapshot?.processes ?? []) {
            if (p.teamId) seen.add(p.teamId);
        }
        for (const e of snapshot?.executions ?? []) {
            if (e.teamId) seen.add(e.teamId);
        }
        return [...seen].sort();
    }, [snapshot]);

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

    // R4: filters hide all rows — show controls so the user can widen the view.
    if (filteredRows.length === 0) {
        return (
            <div className="p-3 overflow-auto h-full" data-processes-tab data-processes-tab-filtered-empty>
                <ProcessFilterControls
                    filters={filters}
                    onFilters={setFilters}
                    teamIds={teamIds}
                    totalCount={watchRows.length}
                    shownCount={0}
                />
                <div className="p-4 text-sm text-spur-text-muted" data-processes-tab-no-matches>
                    No processes match the current filters. Adjust or clear filters to see rows.
                </div>
            </div>
        );
    }

    const supervisedCount = snapshot.processes.length;
    const otherCount = Math.max(0, watchRows.length - supervisedCount);

    return (
        <div className="p-3 overflow-auto h-full" data-processes-tab>
            <ProcessFilterControls
                filters={filters}
                onFilters={setFilters}
                teamIds={teamIds}
                totalCount={watchRows.length}
                shownCount={filteredRows.length}
            />
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
                        <th>Team</th>
                        <th>PID</th>
                        <th>Status</th>
                        <th>Started</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredRows.map((p) => {
                        const running = p.status === 'running';
                        return (
                            <tr key={p.key} data-processes-row={p.key}>
                                <td className="font-mono text-xs">{p.label}</td>
                                <td className="text-xs text-spur-text-muted" data-process-source={p.source}>
                                    {p.source}
                                </td>
                                <td
                                    className="font-mono text-xs text-spur-text-muted"
                                    data-process-team={p.teamId ?? ''}
                                >
                                    {p.teamId ?? '—'}
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
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
