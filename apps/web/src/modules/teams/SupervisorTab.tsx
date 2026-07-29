import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardBody, Modal } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import {
    type ActivityRow,
    buildRosterIndex,
    enrichRowFromRoster,
    historyUrl,
    parseHistory,
    prependActivityRow,
    sseUrl,
    toRow,
} from './ActivityTab';
import { useTeamsData } from './useTeamsData';

// ── Control URLs (mirror TerminalTab.tsx:11-15) ──────────────────────────
const startUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/start`;
const stopUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/stop`;
const teamUpUrl = (teamId: string) => `${resolveApiUrl()}/team/${encodeURIComponent(teamId)}/up`;
const teamDownUrl = (teamId: string) => `${resolveApiUrl()}/team/${encodeURIComponent(teamId)}/down`;

// ── Per-member derived stats (R3) ────────────────────────────────────────
interface MemberStats {
    /** ISO timestamp of the most recent `team.member.started` event, or null. */
    startedAt: string | null;
    /** Most recent activity event for this member, or null. */
    lastActivity: { time: string; eventName: string } | null;
}

/** Format an uptime duration from milliseconds into a compact human string. */
function formatUptime(ms: number): string {
    if (ms < 0) return '-';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

/** Format an ISO timestamp into a compact local time string. */
function formatTime(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return iso;
    }
}

/**
 * Derive per-member uptime + last-activity from the enriched activity rows (R3).
 *
 * Keyed by `${teamId}:${memberLabel}`. `startedAt` comes from the most recent
 * `team.member.started` event; `lastActivity` is the single newest row matching
 * this member.
 */
function deriveMemberStats(rows: ActivityRow[]): Map<string, MemberStats> {
    const stats = new Map<string, MemberStats>();
    for (const row of rows) {
        if (!row.teamId || !row.memberLabel) continue;
        const key = `${row.teamId}:${row.memberLabel}`;
        let entry = stats.get(key);
        if (!entry) {
            entry = { startedAt: null, lastActivity: null };
            stats.set(key, entry);
        }
        // Track most recent team.member.started for uptime
        if (row.eventName === 'team.member.started') {
            if (!entry.startedAt || row.occurredAt > entry.startedAt) {
                entry.startedAt = row.occurredAt;
            }
        }
        // Track most recent activity of any kind
        if (!entry.lastActivity || row.occurredAt > entry.lastActivity.time) {
            entry.lastActivity = { time: row.occurredAt, eventName: row.eventName };
        }
    }
    return stats;
}

/**
 * Supervisor tab - per-team, per-member operational overview (0378).
 *
 * Landing view for the Teams module: shows each team's roster with live status,
 * per-member uptime + last activity derived from the `team.*` event family,
 * and inline start/stop/up/down controls. Reuses `useTeamsData` for the roster
 * (R8) and the ActivityTab fetch+SSE pattern for live events (R4).
 */
export default function SupervisorTab() {
    const { teams, error, reload } = useTeamsData();
    const [activityRows, setActivityRows] = useState<ActivityRow[] | null>(null);
    const [eventError, setEventError] = useState<string | null>(null);
    const [actionPending, setActionPending] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [confirmStopFor, setConfirmStopFor] = useState<string | null>(null);
    const [confirmDownFor, setConfirmDownFor] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const roster = useMemo(() => buildRosterIndex(teams), [teams]);

    // ── Load activity history (R4) ────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchWithTimeout(new Request(historyUrl()));
                if (cancelled) return;
                if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
                const parsed = parseHistory(await res.json());
                if (cancelled) return;
                if (!parsed) throw new Error('events response failed schema validation');
                setActivityRows(parsed);
            } catch (err) {
                if (cancelled) return;
                setEventError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // ── Live SSE tail (R4) ────────────────────────────────────────────────
    useEffect(() => {
        if (typeof EventSource === 'undefined') return;
        const es = new EventSource(sseUrl());
        es.onmessage = (frame) => {
            try {
                const row = toRow(JSON.parse(frame.data));
                if (row) setActivityRows((prev) => prependActivityRow(prev, row));
            } catch {
                // Malformed frame - drop silently.
            }
        };
        return () => es.close();
    }, []);

    // ── Uptime re-render tick (R3) ────────────────────────────────────────
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    // ── Enrich rows with roster identity + derive per-member stats (R3) ────
    const enrichedRows = useMemo(
        () => (activityRows === null ? null : activityRows.map((row) => enrichRowFromRoster(row, roster))),
        [activityRows, roster],
    );
    const memberStats = useMemo(
        () => (enrichedRows === null ? new Map<string, MemberStats>() : deriveMemberStats(enrichedRows)),
        [enrichedRows],
    );

    // ── Inline start/stop controls (R5) ───────────────────────────────────
    const toggleMemberStatus = useCallback(
        async (id: string, running: boolean) => {
            setActionPending(true);
            setActionError(null);
            try {
                const url = running ? stopUrl(id) : startUrl(id);
                const res = await fetchWithTimeout(new Request(url, { method: 'POST' }));
                if (!res.ok) {
                    const body: unknown = await res.json().catch(() => null);
                    const msg =
                        body &&
                        typeof body === 'object' &&
                        'error' in body &&
                        typeof (body as Record<string, unknown>).error === 'string'
                            ? ((body as Record<string, unknown>).error as string)
                            : `request failed (${res.status})`;
                    setActionError(msg);
                }
            } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
            } finally {
                setActionPending(false);
                void reload();
            }
        },
        [reload],
    );

    // ── Inline up/down controls (R5) ──────────────────────────────────────
    const sendTeamAction = useCallback(
        async (id: string, action: 'up' | 'down') => {
            setActionPending(true);
            setActionError(null);
            try {
                const url = action === 'up' ? teamUpUrl(id) : teamDownUrl(id);
                const res = await fetchWithTimeout(new Request(url, { method: 'POST' }));
                if (!res.ok) {
                    const body: unknown = await res.json().catch(() => null);
                    const msg =
                        body &&
                        typeof body === 'object' &&
                        'error' in body &&
                        typeof (body as Record<string, unknown>).error === 'string'
                            ? ((body as Record<string, unknown>).error as string)
                            : `request failed (${res.status})`;
                    setActionError(msg);
                }
            } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
            } finally {
                setActionPending(false);
                void reload();
            }
        },
        [reload],
    );

    return (
        <div className="flex flex-col h-full overflow-y-auto" data-supervisor-tab>
            {/* Roster error banner (R7) - keep teams + activity visible */}
            {error && teams.length === 0 ? (
                <div className="p-4 text-sm text-error" role="alert" data-supervisor-tab-error>
                    Failed to load teams: {error}. Event-derived activity remains available below.
                </div>
            ) : (
                error && (
                    <div
                        className="px-3 py-1 text-xs text-error bg-error/10 border-b border-error/30"
                        role="alert"
                        data-supervisor-roster-error
                    >
                        Roster feed error: {error}. Showing last-known state.
                    </div>
                )
            )}
            {teams.length === 0 && !error && (
                <div className="p-4 text-sm text-spur-text-muted" data-supervisor-tab-loading>
                    Loading teams…
                </div>
            )}
            {actionError && (
                <div className="px-3 py-1 text-xs text-error" role="alert" data-supervisor-action-error>
                    {actionError}
                </div>
            )}
            {eventError && (
                <div className="px-3 py-1 text-xs text-warning" role="alert" data-supervisor-event-error>
                    Activity feed error: {eventError}. Live updates may be delayed.
                </div>
            )}

            {/* Team cards (R2) */}
            <div className="p-2 space-y-2">
                {teams.map((team) => (
                    <Card key={team.teamId} variant="compact" className="bg-base-200 border border-spur-border">
                        <CardBody className="p-3 gap-2">
                            {/* Team header + up/down controls (R5) */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-spur-text">{team.name}</span>
                                <Badge variant="outline" size="xs">
                                    {team.teamId}
                                </Badge>
                                <span className="text-[10px] text-spur-text-muted">
                                    {team.members.length} member(s)
                                </span>
                                <div className="ml-auto flex items-center gap-1">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="xs"
                                        disabled={actionPending}
                                        onClick={() => void sendTeamAction(team.teamId, 'up')}
                                        data-supervisor-team-up={team.teamId}
                                    >
                                        Up
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="xs"
                                        disabled={actionPending}
                                        onClick={() => setConfirmDownFor(team.teamId)}
                                        data-supervisor-team-down={team.teamId}
                                    >
                                        Down
                                    </Button>
                                </div>
                            </div>

                            {/* Empty roster (R6) */}
                            {team.members.length === 0 ? (
                                <div
                                    className="text-xs text-spur-text-muted italic py-2"
                                    data-supervisor-empty-roster={team.teamId}
                                >
                                    No members configured for this team.
                                </div>
                            ) : (
                                /* Member rows (R2, R3) */
                                <ul className="space-y-1">
                                    {team.members.map((member) => {
                                        const isRunning = member.status === 'running';
                                        const key = `${team.teamId}:${member.id}`;
                                        const stats = memberStats.get(key);
                                        const uptime =
                                            isRunning && stats?.startedAt
                                                ? formatUptime(now - Date.parse(stats.startedAt))
                                                : '-';
                                        const lastActivity = stats?.lastActivity ?? null;
                                        return (
                                            <li
                                                key={member.id}
                                                className="text-xs flex items-center gap-2 flex-wrap py-1 border-b border-spur-border/50 last:border-b-0"
                                                data-supervisor-member-row={member.id}
                                            >
                                                <Badge variant={isRunning ? 'success' : 'ghost'} size="xs">
                                                    {member.status}
                                                </Badge>
                                                <span className="font-mono text-spur-text">{member.id}</span>
                                                <Badge variant="outline" size="xs">
                                                    {member.type}
                                                </Badge>
                                                {/* Uptime (R3) */}
                                                <span
                                                    className="text-[10px] text-spur-text-muted font-mono"
                                                    data-supervisor-uptime={member.id}
                                                >
                                                    up {uptime}
                                                </span>
                                                {/* Last activity (R3) */}
                                                {lastActivity ? (
                                                    <span
                                                        className="text-[10px] text-spur-text-muted"
                                                        data-supervisor-last-activity={member.id}
                                                    >
                                                        last: {formatTime(lastActivity.time)} ({lastActivity.eventName})
                                                    </span>
                                                ) : (
                                                    <span
                                                        className="text-[10px] text-spur-text-muted"
                                                        data-supervisor-last-activity={member.id}
                                                    >
                                                        last: -
                                                    </span>
                                                )}
                                                {/* Start/Stop control (R5) */}
                                                <Button
                                                    type="button"
                                                    variant={isRunning ? 'ghost' : 'primary'}
                                                    size="xs"
                                                    disabled={actionPending}
                                                    className="ml-auto"
                                                    onClick={() => {
                                                        if (isRunning) {
                                                            setConfirmStopFor(member.id);
                                                        } else {
                                                            void toggleMemberStatus(member.id, false);
                                                        }
                                                    }}
                                                    data-supervisor-toggle={member.id}
                                                >
                                                    {isRunning ? 'Stop' : 'Start'}
                                                </Button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </CardBody>
                    </Card>
                ))}
            </div>

            {/* Event-derived activity survives a roster outage (R7 / AC R24). */}
            {enrichedRows !== null && (
                <section
                    className="border-t border-spur-border bg-base-300/40"
                    aria-label="Recent team activity"
                    data-supervisor-activity
                >
                    <div className="px-3 py-2 text-[10px] uppercase tracking-wide font-semibold text-spur-text-muted">
                        Recent team activity
                    </div>
                    {enrichedRows.length === 0 ? (
                        <div className="px-3 pb-3 text-xs text-spur-text-muted italic">No team activity yet.</div>
                    ) : (
                        <ul className="px-3 pb-3 space-y-1">
                            {enrichedRows.slice(0, 20).map((row) => (
                                <li
                                    key={row.id}
                                    className="flex items-center gap-2 flex-wrap text-[10px] text-spur-text-muted"
                                    data-supervisor-activity-row={row.eventName}
                                >
                                    <span className="font-mono">{formatTime(row.occurredAt)}</span>
                                    <Badge variant="outline" size="xs">
                                        {row.eventName}
                                    </Badge>
                                    {row.teamId && <span>{row.teamId}</span>}
                                    {row.memberLabel && <span className="font-mono">{row.memberLabel}</span>}
                                    {row.actor && <span>{row.actor}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            {/* Stop confirm modal (R5) - mirrors TerminalTab.tsx:336-373 */}
            <Modal
                open={confirmStopFor !== null}
                variant="warning"
                onClose={() => setConfirmStopFor(null)}
                data-stop-confirm-modal
            >
                <h3 className="text-lg font-bold text-warning">Stop member?</h3>
                <p className="py-3 text-sm text-spur-text">
                    Stopping <span className="font-mono">{confirmStopFor}</span> will terminate its running process.
                    Input to this member will be disabled until it is restarted.
                </p>
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmStopFor(null)}
                        data-stop-confirm-cancel
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="warning"
                        size="sm"
                        disabled={actionPending}
                        onClick={() => {
                            if (!confirmStopFor) return;
                            const id = confirmStopFor;
                            setConfirmStopFor(null);
                            void toggleMemberStatus(id, true);
                        }}
                        data-stop-confirm-confirm
                    >
                        Stop
                    </Button>
                </div>
            </Modal>

            {/* Down confirm modal (R5) - mirrors TerminalTab.tsx:375-411 */}
            <Modal
                open={confirmDownFor !== null}
                variant="warning"
                onClose={() => setConfirmDownFor(null)}
                data-down-confirm-modal
            >
                <h3 className="text-lg font-bold text-warning">Bring team down?</h3>
                <p className="py-3 text-sm text-spur-text">
                    This will stop all running members of <span className="font-mono">{confirmDownFor}</span>.
                </p>
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDownFor(null)}
                        data-down-confirm-cancel
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="warning"
                        size="sm"
                        disabled={actionPending}
                        onClick={() => {
                            if (!confirmDownFor) return;
                            const id = confirmDownFor;
                            setConfirmDownFor(null);
                            void sendTeamAction(id, 'down');
                        }}
                        data-down-confirm-confirm
                    >
                        Bring Down
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
