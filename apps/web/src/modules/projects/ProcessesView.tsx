import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Loading, Tooltip } from '@/ui';
import ResizeHandle from '../../components/ResizeHandle';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import MemberDetail from './MemberDetail';

/** localStorage key for the user's last-set detail-panel width (px), shared with TaskDetail. */
const DETAIL_WIDTH_KEY = 'spur:detail-width';

import {
    type ProcessStatus,
    parseExecutions,
    parseProcessList,
    type RegistryExecution,
    STATUS_POLL_MS,
} from './MemberTerminal';
import { type MemberObservedState, type RosterEntry, sessionLabel } from './roster';
import type { MemberSession } from './useProjectContext';
import { useProjectContext } from './useProjectContext';

/** Unified table row for the Processes / Fleet watch list. */
export interface WatchRow {
    key: string;
    label: string;
    agentId?: string;
    pid: number | null;
    status: string;
    startedAt: string;
    source: string;
    teamId: string | null;
    command?: string;
    args?: string[];
    exitCode?: number | null;
    session?: MemberSession | null;
}

const processesUrl = () => `${resolveApiUrl()}/processes`;

/**
 * Build a unified watch list: supervisor rows first, then registry executions
 * not already covered by a supervised agentId/pid (dedup sets, as 0264).
 * Rows are read-only — start/stop/attach stay in the fleet's own surfaces.
 */
export function buildWatchRows(processes: ProcessStatus[], executions: RegistryExecution[]): WatchRow[] {
    const rows: WatchRow[] = processes.map((p) => ({
        key: `sup:${p.agentId}`,
        label: p.agentId,
        agentId: p.agentId,
        pid: p.pid,
        status: p.status,
        startedAt: p.startedAt,
        source: 'supervisor',
        teamId: p.teamId ?? null,
        exitCode: p.exitCode,
        session: (p as { session?: MemberSession }).session ?? null,
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
            command: e.command,
            args: e.args,
            exitCode: e.exitCode,
            session: null,
        });
    }
    return rows;
}

/** Filter state for the Processes watch list (0267 R2, restored by 0852 R3). */
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

/** Pure filter helper exported for unit testing (0267 R2/R5, restored by 0852 R3). */
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
 * Filter controls for the Processes watch list (0267 R2).
 *
 * Native `<select>`/`<input type="checkbox">` — the `@/ui` Select does not fire
 * `change` reliably under happy-dom + React 19 controlled components, so we use
 * native controls that the test harness can drive via `fireEvent`.
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

            {/* Team filter: hidden stale per design, preserved in DOM for test harness compatibility */}
            <label className="hidden">
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
 * Processes tab (Projects, 0852) — the Teams process watch list
 * (0262/0264/0267) retired with its module in 0849, restored here so the
 * capability stays reachable (feature G64 R5).
 *
 * Polls GET /api/processes every STATUS_POLL_MS and renders supervised
 * members plus ProcessExecutor registry one-shots through the single parse
 * module in `./MemberTerminal` (R4). Filters are ephemeral component state
 * (0267 R3); rows are read-only.
 */
export default function ProcessesView({ pollMs = STATUS_POLL_MS }: { pollMs?: number }) {
    const [snapshot, setSnapshot] = useState<{ processes: ProcessStatus[]; executions: RegistryExecution[] } | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);
    // Ephemeral filter state (0267 R3) — not persisted across remounts.
    const [filters, setFilters] = useState<WatchFilters>({ runningOnly: false, source: 'all', team: 'all' });
    const mountedRef = useRef(true);

    // Sync detail panel width with TaskDetail (spur:detail-width)
    const [detailWidth, setDetailWidth] = useState(() => {
        const fallback = typeof window !== 'undefined' ? Math.min(1728, window.innerWidth * 0.8) : 1728;
        if (typeof window === 'undefined') return fallback;
        try {
            const stored = Number.parseFloat(window.localStorage.getItem(DETAIL_WIDTH_KEY) ?? '');
            if (Number.isFinite(stored) && stored > 0) {
                return Math.min(stored, window.innerWidth * 0.8);
            }
        } catch {
            // localStorage unavailable (private mode / disabled) — use fallback.
        }
        return fallback;
    });

    useEffect(() => {
        document.documentElement.style.setProperty('--detail-w', `${detailWidth}px`);
    }, [detailWidth]);

    const load = useCallback(async (signal: AbortSignal) => {
        try {
            const res = await fetchWithTimeout(new Request(processesUrl(), { signal }));
            if (!res.ok) throw new Error(`processes fetch failed: ${res.status}`);
            const json: unknown = await res.json();
            // R4: both wire halves parse through the MemberTerminal module — a
            // malformed payload skips the tick rather than clearing the view.
            const processes = parseProcessList(json);
            const executions = parseExecutions(json) ?? [];
            if (!processes) return;
            if (mountedRef.current) {
                setSnapshot({ processes, executions });
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
        const interval = setInterval(poll, pollMs);
        return () => {
            mountedRef.current = false;
            active?.abort();
            clearInterval(interval);
        };
    }, [load, pollMs]);

    const watchRows = useMemo(
        () => (snapshot ? buildWatchRows(snapshot.processes, snapshot.executions) : []),
        [snapshot],
    );

    const filteredRows = useMemo(() => filterWatchRows(watchRows, filters), [watchRows, filters]);

    // Unique teams from both halves for the team filter dropdown (0267 R2).
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

    const project = useProjectContext();
    const [selectedRow, setSelectedRow] = useState<WatchRow | null>(null);
    const openerRef = useRef<HTMLElement | null>(null);

    const openDetail = (row: WatchRow, opener?: HTMLElement) => {
        if (opener) openerRef.current = opener;
        setSelectedRow(row);
    };

    const closeDetail = useCallback(() => {
        setSelectedRow(null);
        openerRef.current?.focus();
    }, []);

    const selectedEntry: RosterEntry | null = useMemo(() => {
        if (!selectedRow) return null;
        const agentId = selectedRow.agentId ?? selectedRow.label;
        const declaredMember = project.fleet?.members.find((m) => m.instanceId === agentId) ?? null;
        const process = snapshot?.processes.find((p) => p.agentId === agentId);
        return {
            instanceId: agentId,
            declared: declaredMember,
            observed: {
                status: (selectedRow.status === 'running'
                    ? 'running'
                    : selectedRow.status === 'exited'
                      ? 'exited'
                      : 'not-started') as MemberObservedState,
                pid: selectedRow.pid,
                startedAt: selectedRow.startedAt,
                exitCode: selectedRow.exitCode ?? process?.exitCode ?? null,
                session: selectedRow.session ?? process?.session ?? null,
            },
            isOrchestrator: project.fleet?.orchestrator.instanceId === agentId,
            issues: declaredMember ? [] : ['undeclared'],
        };
    }, [selectedRow, project.fleet, snapshot]);

    const selectedExecution = useMemo(() => {
        if (!selectedRow || selectedRow.source === 'supervisor') return null;
        const id = selectedRow.key.replace(/^reg:/, '');
        return snapshot?.executions.find((e) => e.id === id) ?? null;
    }, [selectedRow, snapshot]);

    const selectedFullCommand = useMemo(() => {
        if (!selectedRow) return undefined;
        if (selectedRow.command) {
            return `${selectedRow.command}${selectedRow.args && selectedRow.args.length > 0 ? ` ${selectedRow.args.join(' ')}` : ''}`;
        }
        return `spur agent run ${selectedRow.agentId ?? selectedRow.label}`;
    }, [selectedRow]);

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
                No processes. Start an agent from the Agents tab or via{' '}
                <code className="font-mono">spur agent start</code>.
            </div>
        );
    }

    // R3: filters hide all rows — show controls so the user can widen the view.
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
        <div className="p-3 overflow-auto h-full relative" data-processes-tab>
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
                        <th>Agent / Instance</th>
                        <th>Role</th>
                        <th>Stages</th>
                        <th>Executor</th>
                        <th>Session</th>
                        <th>Command</th>
                        <th>PID</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Source</th>
                        <th className="hidden">Team</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredRows.map((p) => {
                        const running = p.status === 'running';
                        const agentId = p.agentId ?? p.label;
                        const member = project.fleet?.members.find((m) => m.instanceId === agentId);
                        const isOrchestrator = project.fleet?.orchestrator.instanceId === agentId;

                        const roleName = member?.role ?? (p.agentId ? 'agent' : 'process');
                        const roleConfig = project.fleet?.roles?.find((r) => r.name === roleName);

                        const stages: string[] =
                            roleConfig?.stages && roleConfig.stages.length > 0
                                ? roleConfig.stages
                                : (project.fleet?.stages?.filter((s) => s.role === roleName).map((s) => s.id) ?? []);

                        const executorName =
                            member?.executor ??
                            roleConfig?.electedExecutor ??
                            (p.source === 'supervisor' ? 'spur' : null);
                        const executor = project.fleet?.executors?.find(
                            (e) => e.name === executorName || e.name === member?.executor,
                        );
                        const codingAgent =
                            executor?.agent ??
                            member?.executor ??
                            (p.source === 'supervisor' ? 'spur' : (p.command ?? 'cli'));
                        const model = member?.model ?? executor?.model ?? '—';
                        const tier = (executor as { tier?: string } | undefined)?.tier ?? roleConfig?.tier;

                        const executorTooltip = [
                            `Agent: ${codingAgent || '—'}`,
                            `Model: ${model || '—'}`,
                            tier ? `Tier: ${tier}` : '',
                        ]
                            .filter(Boolean)
                            .join('\n');

                        const session = p.session ?? member?.session;
                        const sessionStr = sessionLabel(session);

                        const fullCmd = p.command
                            ? `${p.command}${p.args && p.args.length > 0 ? ` ${p.args.join(' ')}` : ''}`
                            : `spur agent run ${agentId}`;

                        return (
                            <tr
                                key={p.key}
                                data-processes-row={p.key}
                                data-g6="open-member"
                                data-roster-entry={agentId}
                                tabIndex={0}
                                aria-haspopup="dialog"
                                className="hover:bg-spur-surface-2/40 cursor-pointer transition-colors focus:outline-none focus:bg-spur-surface-2/60"
                                onClick={(e) => openDetail(p, e.currentTarget)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        openDetail(p, e.currentTarget);
                                    }
                                }}
                            >
                                <td>
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-mono text-xs font-semibold text-spur-text">
                                            {p.label}
                                        </span>
                                        {isOrchestrator && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-spur-accent/20 text-spur-accent tracking-wide uppercase">
                                                lead
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-spur-accent/15 text-spur-accent">
                                        {roleName}
                                    </span>
                                </td>
                                <td>
                                    {stages.length > 0 ? (
                                        <div className="flex items-center gap-1 flex-wrap max-w-[200px]">
                                            {stages.map((st) => (
                                                <span
                                                    key={st}
                                                    className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-base-200 text-spur-text-muted border border-spur-border/60"
                                                >
                                                    {st}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="font-mono text-xs text-spur-text-muted/60">—</span>
                                    )}
                                </td>
                                <td>
                                    <Tooltip
                                        position="top"
                                        tip={executorTooltip}
                                        className="inline-flex! z-30 [&:before]:whitespace-pre-line! [&:before]:text-left! [&:before]:font-mono [&:before]:text-[11px] [&:before]:p-2 [&:before]:rounded-lg [&:before]:shadow-xl after:whitespace-pre-line after:text-left after:font-mono after:text-[11px]"
                                    >
                                        <span
                                            className="font-mono text-xs font-semibold text-spur-text cursor-help hover:text-spur-accent transition-colors"
                                            title={executorTooltip}
                                            data-process-executor={executorName ?? 'none'}
                                        >
                                            {executorName ?? '—'}
                                        </span>
                                    </Tooltip>
                                </td>
                                <td>
                                    <span className="font-mono text-xs text-spur-text-muted">{sessionStr ?? '—'}</span>
                                </td>
                                <td className="max-w-[240px]">
                                    <span
                                        className="font-mono text-xs text-spur-text-muted truncate block"
                                        title={fullCmd}
                                    >
                                        {fullCmd}
                                    </span>
                                </td>
                                <td className="font-mono text-xs text-spur-text-muted">{p.pid ?? '—'}</td>
                                <td>
                                    <Badge variant={running ? 'success' : 'ghost'} size="xs">
                                        {p.status}
                                    </Badge>
                                </td>
                                <td className="text-xs text-spur-text-muted whitespace-nowrap">
                                    {new Date(p.startedAt).toLocaleTimeString()}
                                </td>
                                <td className="text-xs text-spur-text-muted" data-process-source={p.source}>
                                    {p.source}
                                </td>
                                <td
                                    className="hidden font-mono text-xs text-spur-text-muted"
                                    data-process-team={p.teamId ?? ''}
                                >
                                    {p.teamId ?? '—'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {/* Slide-over floating drawer (matching Tasks module TaskDetail width & resize handle) */}
            {selectedEntry && (
                <>
                    <button
                        type="button"
                        aria-label="Close process detail"
                        className="fixed inset-0 z-50 bg-black/50 border-0 p-0 cursor-default"
                        onClick={closeDetail}
                    />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Process detail"
                        className="fixed top-0 right-0 h-full z-50 bg-spur-surface border-l border-spur-border shadow-2xl flex"
                        style={{ width: 'var(--detail-w)', minWidth: '36rem', maxWidth: '80vw' }}
                    >
                        <ResizeHandle
                            targetVar="--detail-w"
                            onResizeEnd={(px) => {
                                const clamped = Math.max(576, Math.min(px, window.innerWidth * 0.8));
                                setDetailWidth(clamped);
                                try {
                                    window.localStorage.setItem(DETAIL_WIDTH_KEY, String(clamped));
                                } catch {
                                    // localStorage unavailable — width still applies for this session.
                                }
                            }}
                            direction="horizontal"
                            invert
                        />
                        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                            <MemberDetail
                                entry={selectedEntry}
                                onClose={closeDetail}
                                execution={selectedExecution}
                                fullCommand={selectedFullCommand}
                                className="h-full"
                            />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export { ProcessesView as FleetView };
