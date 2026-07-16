import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Modal, Select } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { ATTACH_EVENT, consumePendingAttach } from './attach-bus';
import MemberTerminal from './MemberTerminal';
import { type TeamGroup, useTeamsData } from './useTeamsData';

// Team/member shapes and the polling fetch live in useTeamsData (0268 R1).
// This file owns only Terminal-scoped concerns: start/stop URLs, persisted
// selection, attach handling, and the team/member pickers.

const startUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/start`;
const stopUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/stop`;

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
export default function TerminalTab() {
    const { teams, error, reload: load } = useTeamsData();
    const [teamId, setTeamId] = useState<string>('');
    const [memberId, setMemberId] = useState<string>('');
    const [actionError, setActionError] = useState<string | null>(null);
    const [confirmStopFor, setConfirmStopFor] = useState<string | null>(null);
    const [actionPending, setActionPending] = useState(false);
    const [restoredRef] = useState<{ done: boolean }>({ done: false });

    // Latest teams snapshot available to the attach validator (0268 R3).
    const teamsRef = useRef<TeamGroup[]>([]);
    teamsRef.current = teams;

    /** Resolve `agentId` to its team and select it. False when no loaded team owns it. */
    const applyAttach = useCallback((agentId: string): boolean => {
        const team = teamsRef.current.find((t) => t.members.some((m) => m.id === agentId));
        if (!team) return false;
        setTeamId(team.teamId);
        setMemberId(agentId);
        // R5 persist is handled by the existing [teamId, memberId] effect below.
        return true;
    }, []);

    // ── Restore last persisted selection once after the first teams load (0263 R2) ──
    useEffect(() => {
        if (restoredRef.done) return;
        if (teams.length === 0) return;
        restoredRef.done = true;
        // An Attach clicked in Processes outranks the persisted selection: it is the
        // operator's most recent intent, and it is why this tab just became visible.
        const pending = consumePendingAttach();
        if (pending && applyAttach(pending)) return;
        const persisted = readPersistedSelection();
        if (!persisted) return;
        const team = teamsRef.current.find((t) => t.teamId === persisted.teamId);
        const member = team?.members.find((m) => m.id === persisted.memberId);
        if (!team || !member) {
            // Stale entry (team/member gone from config) — drop it so reloads stay clean.
            clearPersistedSelection();
            return;
        }
        setTeamId(persisted.teamId);
        setMemberId(persisted.memberId);
    }, [teams, restoredRef, applyAttach]);

    // ── Listen for Attach while already mounted (0265 R1–R3) ──
    // Covers the operator re-attaching once Terminal is the active tab. The mount-time
    // consume above covers the usual path (Attach clicked while Terminal is unmounted).
    useEffect(() => {
        const onAttach = (event: Event) => {
            const detail = (event as CustomEvent<{ agentId?: unknown }>).detail;
            const agentId = detail?.agentId;
            if (typeof agentId !== 'string' || !agentId) return;
            // Unknown agentId leaves the intent pending and selection unchanged (edge
            // scenario, no crash); a later teams load resolves it or drops it on consume.
            if (applyAttach(agentId)) consumePendingAttach();
        };
        globalThis.addEventListener(ATTACH_EVENT, onAttach);
        return () => {
            globalThis.removeEventListener(ATTACH_EVENT, onAttach);
        };
    }, [applyAttach]);

    // ── Cascade: when team changes, reset the member pick if it's no longer valid ──
    const currentTeam = teams.find((t) => t.teamId === teamId);
    const currentMember = currentTeam?.members.find((m) => m.id === memberId) ?? null;

    useEffect(() => {
        if (memberId && currentTeam && !currentTeam.members.some((m) => m.id === memberId)) {
            setMemberId('');
        }
    }, [memberId, currentTeam]);

    // Persist whenever a valid (teamId, memberId) is chosen (R6).
    useEffect(() => {
        if (teamId && memberId) {
            writePersistedSelection({ teamId, memberId });
        }
    }, [teamId, memberId]);

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

    // ── Empty / error states (R7) ──
    if (error && teams.length === 0) {
        return (
            <div className="p-4 text-sm text-error" role="alert" data-terminal-tab-error>
                Failed to load teams: {error}
            </div>
        );
    }
    if (teams.length === 0) {
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
                className="px-3 py-2 border-b border-spur-border bg-base-200 shrink-0 flex flex-wrap items-center gap-2"
                data-terminal-toolbar
            >
                <label className="flex items-center gap-1 text-xs" htmlFor="terminal-team-select">
                    <span className="text-spur-text-muted">Team</span>
                    <Select
                        id="terminal-team-select"
                        variant="bordered"
                        size="sm"
                        value={teamId}
                        onChange={(e) => {
                            setTeamId(e.target.value);
                            setMemberId('');
                        }}
                        data-terminal-team-select
                    >
                        <option value="">Select team…</option>
                        {teams.map((t) => (
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
                                {m.id} · {m.type} · {m.status}
                            </option>
                        ))}
                    </Select>
                </label>

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
        </div>
    );
}
