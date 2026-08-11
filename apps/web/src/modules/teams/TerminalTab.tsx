import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Modal, Select } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { useTeamsData } from '../../lib/use-teams-data';
import MemberTerminal from './MemberTerminal';

// Team/member shapes and the polling fetch live in useTeamsData (0268 R1).
// This file owns only Terminal-scoped concerns: start/stop URLs, persisted
// selection, and the team/member pickers. Up/Down merged from TeamControlStrip (0269 R3).

const startUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/start`;
const stopUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/stop`;

const teamUpUrl = (teamId: string) => `${resolveApiUrl()}/team/${encodeURIComponent(teamId)}/up`;
const teamDownUrl = (teamId: string) => `${resolveApiUrl()}/team/${encodeURIComponent(teamId)}/down`;

/** localStorage key shared with the 0263 polish — stable across reloads. */
const LAST_SELECTION_KEY = 'spur:board:teams:lastTerminal';

interface PersistedSelection {
    teamId: string;
    memberId: string;
}

function readPersistedSelection(): PersistedSelection | null {
    try {
        const raw = globalThis.localStorage?.getItem(LAST_SELECTION_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (
            parsed &&
            typeof parsed === 'object' &&
            'teamId' in parsed &&
            'memberId' in parsed &&
            typeof (parsed as Record<string, unknown>).teamId === 'string' &&
            typeof (parsed as Record<string, unknown>).memberId === 'string'
        ) {
            const obj = parsed as Record<string, unknown>;
            return { teamId: obj.teamId as string, memberId: obj.memberId as string };
        }
    } catch {
        // Bad JSON or localStorage unavailable — fall back to no selection.
    }
    return null;
}

function writePersistedSelection(selection: PersistedSelection): void {
    try {
        globalThis.localStorage?.setItem(LAST_SELECTION_KEY, JSON.stringify(selection));
    } catch {
        // Non-fatal: persistence is a UX nicety, not a correctness gate.
    }
}

function clearPersistedSelection(): void {
    try {
        globalThis.localStorage?.removeItem(LAST_SELECTION_KEY);
    } catch {
        // Non-fatal: storage may be unavailable (private mode / quota).
    }
}

/**
 * Terminal tab — owns its own team/member pickers (R1–R7) per the M1 wayfind
 * decision: selection is local to this view and never routes through a shared
 * selection context. (The old `TeamsContext` selection was removed in 0268 once
 * its last writer — Roster — was gone in 0260 and the 0261 local-selection
 * work landed.)
 *
 * The toolbar renders Team → Member cascading dropdowns with live status
 * badges, a toggle control that confirms before stopping a running member,
 * and persists the last selection to localStorage.
 */
export default function TerminalTab({ teamId: scopeTeamId }: { teamId?: string }) {
    const { teams, error, reload: load } = useTeamsData();
    const [teamId, setTeamId] = useState<string>('');
    const [memberId, setMemberId] = useState<string>('');
    const [actionError, setActionError] = useState<string | null>(null);
    const [confirmStopFor, setConfirmStopFor] = useState<string | null>(null);
    const [confirmDownFor, setConfirmDownFor] = useState<string | null>(null);
    const [actionPending, setActionPending] = useState(false);
    const [restoredRef] = useState<{ done: boolean }>({ done: false });

    // ── Cascade: when team changes, reset the member pick if it's no longer valid ──
    const scopedTeams = useMemo(
        () => (scopeTeamId ? teams.filter((t) => t.teamId === scopeTeamId) : teams),
        [teams, scopeTeamId],
    );
    const effectiveTeamId = scopeTeamId ?? teamId;

    // ── Restore last persisted selection once after the first teams load (0263 R2) ──
    useEffect(() => {
        if (restoredRef.done) return;
        if (scopedTeams.length === 0) return;
        restoredRef.done = true;
        const persisted = readPersistedSelection();
        if (!persisted) return;
        const team = scopedTeams.find((t) => t.teamId === persisted.teamId);
        const member = team?.members.find((m) => m.id === persisted.memberId);
        if (!team || !member) {
            // Stale entry (team/member gone from config) — drop it so reloads stay clean.
            clearPersistedSelection();
            return;
        }
        setTeamId(persisted.teamId);
        setMemberId(persisted.memberId);
    }, [scopedTeams, restoredRef]);

    const currentTeam = scopedTeams.find((t) => t.teamId === effectiveTeamId);
    const currentMember = currentTeam?.members.find((m) => m.id === memberId) ?? null;

    useEffect(() => {
        if (memberId && currentTeam && !currentTeam.members.some((m) => m.id === memberId)) {
            setMemberId('');
        }
    }, [memberId, currentTeam]);

    // Persist whenever a valid (teamId, memberId) is chosen (R6).
    useEffect(() => {
        if (effectiveTeamId && memberId) {
            writePersistedSelection({ teamId: effectiveTeamId, memberId });
        }
    }, [effectiveTeamId, memberId]);

    const toggleMemberStatus = useCallback(
        async (id: string, running: boolean) => {
            setActionPending(true);
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
                void load();
            }
        },
        [load],
    );

    // ── Team-scoped Up/Down (from former TeamControlStrip, 0269 R3) ──
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
                void load();
            }
        },
        [load],
    );

    // ── Roster chip click sets focused member (0269 R4) ──
    const handleChipClick = useCallback((id: string) => {
        setMemberId(id);
    }, []);

    // ── Empty / error states (R7) ──
    if (error && scopedTeams.length === 0) {
        return (
            <div className="p-4 text-sm text-error" role="alert" data-terminal-tab-error>
                Failed to load teams: {error}
            </div>
        );
    }
    if (scopedTeams.length === 0) {
        return (
            <div className="p-4 text-sm text-spur-text-muted" data-terminal-tab-empty>
                No teams defined in <code className="font-mono">.spur/config.yaml</code>. Configure{' '}
                <code className="font-mono">agent.team</code> entries to open a terminal.
            </div>
        );
    }

    const isRunning = currentMember?.status === 'running';

    return (
        <div className="flex flex-col h-full overflow-hidden" data-terminal-tab>
            <div
                className="px-3 py-2 border-b border-spur-border bg-base-200 shrink-0 flex items-center justify-between"
                data-terminal-toolbar
            >
                {/* LEFT: data-terminal-focus */}
                <div className="flex items-center gap-2" data-terminal-focus>
                    <label className="flex items-center gap-1 text-xs" htmlFor="terminal-team-select">
                        <span className="text-spur-text-muted">Team</span>
                        <Select
                            id="terminal-team-select"
                            variant="bordered"
                            size="sm"
                            disabled={!!scopeTeamId}
                            value={effectiveTeamId}
                            onChange={(e) => {
                                setTeamId(e.target.value);
                                setMemberId('');
                            }}
                            data-terminal-team-select
                        >
                            {!scopeTeamId && <option value="">Select team…</option>}
                            {scopedTeams.map((t) => (
                                <option key={t.teamId} value={t.teamId}>
                                    {t.name}
                                </option>
                            ))}
                        </Select>
                    </label>

                    <label className="flex items-center gap-1 text-xs" htmlFor="terminal-member-select">
                        <span className="text-spur-text-muted">Member</span>
                        <Select
                            id="terminal-member-select"
                            variant="bordered"
                            size="sm"
                            value={memberId}
                            onChange={(e) => setMemberId(e.target.value)}
                            disabled={!currentTeam}
                            data-terminal-member-select
                        >
                            <option value="">Select member…</option>
                            {currentTeam?.members.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.id} · {m.type}
                                </option>
                            ))}
                        </Select>
                    </label>

                    {currentMember?.model ? (
                        <span className="text-xs text-spur-text-muted font-mono" data-terminal-model>
                            {currentMember.model}
                        </span>
                    ) : null}

                    {currentMember && (
                        <>
                            <Badge variant={isRunning ? 'success' : 'ghost'} size="xs" data-terminal-status-badge>
                                {currentMember.status}
                            </Badge>
                            <Button
                                type="button"
                                variant={isRunning ? 'warning' : 'primary'}
                                size="xs"
                                disabled={actionPending}
                                onClick={() => {
                                    if (isRunning) {
                                        setConfirmStopFor(currentMember.id);
                                    } else {
                                        void toggleMemberStatus(currentMember.id, false);
                                    }
                                }}
                                data-terminal-toggle-btn
                            >
                                {isRunning ? 'Stop' : 'Start'}
                            </Button>
                        </>
                    )}
                </div>

                {/* RIGHT: data-terminal-roster */}
                <div className="flex items-center gap-2" data-terminal-roster>
                    {currentTeam?.members.map((m) => (
                        <button
                            key={m.id}
                            type="button"
                            title={`${m.id} · ${m.type}`}
                            onClick={() => handleChipClick(m.id)}
                            className="cursor-pointer p-0 bg-transparent border-0"
                            data-terminal-roster-chip
                        >
                            <Badge
                                variant={m.id === memberId ? 'accent' : m.status === 'running' ? 'success' : 'ghost'}
                                size="xs"
                            >
                                {m.id}
                            </Badge>
                        </button>
                    ))}
                    <div className="border-l border-spur-border mx-1 h-5" aria-hidden="true" />
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={actionPending || !currentTeam}
                        onClick={() => currentTeam && sendTeamAction(currentTeam.teamId, 'up')}
                        data-terminal-up-btn
                    >
                        Up
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={actionPending || !currentTeam}
                        onClick={() => currentTeam && setConfirmDownFor(currentTeam.teamId)}
                        data-terminal-down-btn
                    >
                        Down
                    </Button>
                </div>
            </div>
            {actionError && (
                <div className="px-3 py-1 text-xs text-error" role="alert" data-terminal-tab-action-error>
                    {actionError}
                </div>
            )}

            {memberId && currentMember ? (
                <MemberTerminal agentId={memberId} />
            ) : (
                <div className="p-4 text-sm text-spur-text-muted italic" data-terminal-tab-prompt>
                    Choose a team and member above to open a terminal.
                </div>
            )}

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
