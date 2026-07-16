import { useCallback, useState } from 'react';
import { Badge, Button, Modal, Select } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { useTeamsData } from './useTeamsData';

const teamUpUrl = (teamId: string) => `${resolveApiUrl()}/team/${encodeURIComponent(teamId)}/up`;
const teamDownUrl = (teamId: string) => `${resolveApiUrl()}/team/${encodeURIComponent(teamId)}/down`;

/**
 * Team control strip — team-scoped bulk Up/Down (0266 R1–R5).
 *
 * Rendered above the tab panel in TeamsShell so the controls are visible from
 * every tab (R1: "without Roster" — bulk is not member-scoped). Calls the
 * existing POST /api/team/:team/up|down endpoints; Down is destructive and
 * gated by a confirm modal mirroring TerminalTab's stop-confirm pattern.
 */
export default function TeamControlStrip() {
    const { teams, error, reload: load } = useTeamsData();
    const [teamId, setTeamId] = useState<string>('');
    const [notice, setNotice] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionPending, setActionPending] = useState(false);
    const [confirmDownFor, setConfirmDownFor] = useState<string | null>(null);

    const currentTeam = teams.find((t) => t.teamId === teamId) ?? null;
    const runningCount = currentTeam ? currentTeam.members.filter((m) => m.status === 'running').length : 0;
    const totalCount = currentTeam?.members.length ?? 0;

    const sendTeamAction = useCallback(
        async (id: string, action: 'up' | 'down') => {
            setActionPending(true);
            setNotice(null);
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
                    return;
                }
                setNotice(
                    action === 'up' ? `Team ${id} materialized + best-effort start issued` : `Team ${id} stopped`,
                );
                void load();
            } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
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

            {notice && !actionError && (
                <span className="text-xs text-success" data-team-control-notice>
                    {notice}
                </span>
            )}
            {actionError && (
                <span className="text-xs text-error" data-team-control-error-inline>
                    {actionError}
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
