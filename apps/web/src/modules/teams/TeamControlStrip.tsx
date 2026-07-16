import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Modal, Select } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

// ── Team shapes returned by GET /api/team/teams (0256 R2) ──
// Local to this strip for v1; task 0268 will extract a shared useTeamsData hook.
interface TeamMember {
    id: string;
    type: string;
    status: string;
}

interface TeamGroup {
    teamId: string;
    name: string;
    members: TeamMember[];
}

/** Narrow an untrusted JSON body into the `{ teams: TeamGroup[] }` shape, or `null`. */
function parseTeamsResponse(body: unknown): TeamGroup[] | null {
    if (!body || typeof body !== 'object' || !('teams' in body)) return null;
    const raw = (body as { teams: unknown }).teams;
    if (!Array.isArray(raw)) return null;
    const teams: TeamGroup[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        if (typeof e.teamId !== 'string' || typeof e.name !== 'string') continue;
        if (!Array.isArray(e.members)) continue;
        const members: TeamMember[] = [];
        for (const m of e.members) {
            if (!m || typeof m !== 'object') continue;
            const r = m as Record<string, unknown>;
            if (typeof r.id !== 'string' || typeof r.type !== 'string' || typeof r.status !== 'string') continue;
            members.push({ id: r.id, type: r.type, status: r.status });
        }
        teams.push({ teamId: e.teamId, name: e.name, members });
    }
    return teams;
}

const teamsUrl = () => `${resolveApiUrl()}/team/teams`;
const teamUpUrl = (teamId: string) => `${resolveApiUrl()}/team/${encodeURIComponent(teamId)}/up`;
const teamDownUrl = (teamId: string) => `${resolveApiUrl()}/team/${encodeURIComponent(teamId)}/down`;

const TEAMS_POLL_MS = 5000;

/**
 * Team control strip — team-scoped bulk Up/Down (0266 R1–R5).
 *
 * Rendered above the tab panel in TeamsShell so the controls are visible from
 * every tab (R1: "without Roster" — bulk is not member-scoped). Calls the
 * existing POST /api/team/:team/up|down endpoints; Down is destructive and
 * gated by a confirm modal mirroring TerminalTab's stop-confirm pattern.
 */
export default function TeamControlStrip() {
    const [teams, setTeams] = useState<TeamGroup[]>([]);
    const [teamId, setTeamId] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [actionPending, setActionPending] = useState(false);
    const [confirmDownFor, setConfirmDownFor] = useState<string | null>(null);
    const mountedRef = useRef(true);

    const load = useCallback(async () => {
        try {
            const res = await fetchWithTimeout(new Request(teamsUrl()));
            if (!res.ok) throw new Error(`teams fetch failed: ${res.status}`);
            const body: unknown = await res.json();
            const parsed = parseTeamsResponse(body);
            if (parsed && mountedRef.current) {
                setTeams(parsed);
                setError(null);
            }
        } catch (err) {
            if (mountedRef.current) {
                setError(err instanceof Error ? err.message : String(err));
            }
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void load();
        const interval = setInterval(load, TEAMS_POLL_MS);
        return () => {
            mountedRef.current = false;
            clearInterval(interval);
        };
    }, [load]);

    const currentTeam = teams.find((t) => t.teamId === teamId) ?? null;
    const runningCount = currentTeam ? currentTeam.members.filter((m) => m.status === 'running').length : 0;
    const totalCount = currentTeam?.members.length ?? 0;

    const sendTeamAction = useCallback(
        async (id: string, action: 'up' | 'down') => {
            setActionPending(true);
            setNotice(null);
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
                    setError(msg);
                    return;
                }
                setError(null);
                setNotice(
                    action === 'up' ? `Team ${id} materialized + best-effort start issued` : `Team ${id} stopped`,
                );
                void load();
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setActionPending(false);
            }
        },
        [load],
    );

    // ── Empty / error states (no team picker rendered when there are no teams) ──
    if (error && teams.length === 0) {
        return (
            <div
                className="px-3 py-2 border-b border-spur-border bg-base-200 shrink-0 text-xs text-error"
                role="alert"
                data-team-control-error
            >
                Failed to load teams: {error}
            </div>
        );
    }
    if (teams.length === 0) {
        return null;
    }

    return (
        <div
            className="px-3 py-2 border-b border-spur-border bg-base-200 shrink-0 flex flex-wrap items-center gap-2"
            data-team-control-strip
        >
            <label className="flex items-center gap-1 text-xs" htmlFor="team-control-select">
                <span className="text-spur-text-muted">Team</span>
                <Select
                    id="team-control-select"
                    aria-label="team-control"
                    variant="bordered"
                    size="sm"
                    value={teamId}
                    onChange={(e) => {
                        setTeamId(e.target.value);
                        setNotice(null);
                    }}
                    data-team-control-select
                >
                    <option value="">Select team…</option>
                    {teams.map((t) => (
                        <option key={t.teamId} value={t.teamId}>
                            {t.name}
                        </option>
                    ))}
                </Select>
            </label>

            {currentTeam && (
                <>
                    <Badge variant={runningCount > 0 ? 'success' : 'ghost'} size="xs" data-team-control-status>
                        {runningCount}/{totalCount} running
                    </Badge>
                    <Button
                        type="button"
                        variant="primary"
                        size="xs"
                        disabled={actionPending}
                        onClick={() => void sendTeamAction(currentTeam.teamId, 'up')}
                        data-team-control-up
                    >
                        Up
                    </Button>
                    <Button
                        type="button"
                        variant="warning"
                        size="xs"
                        disabled={actionPending || totalCount === 0}
                        onClick={() => setConfirmDownFor(currentTeam.teamId)}
                        data-team-control-down
                    >
                        Down
                    </Button>
                </>
            )}

            {notice && !error && (
                <span className="text-xs text-success" data-team-control-notice>
                    {notice}
                </span>
            )}
            {error && (
                <span className="text-xs text-error" data-team-control-error-inline>
                    {error}
                </span>
            )}

            <Modal
                open={confirmDownFor !== null}
                variant="warning"
                onClose={() => setConfirmDownFor(null)}
                data-team-down-confirm-modal
            >
                <h3 className="text-lg font-bold text-warning">Stop team?</h3>
                <p className="py-3 text-sm text-spur-text">
                    Stopping team <span className="font-mono">{confirmDownFor}</span> will terminate all running member
                    processes for this team.
                </p>
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDownFor(null)}
                        data-team-down-confirm-cancel
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
                        data-team-down-confirm-confirm
                    >
                        Stop team
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
