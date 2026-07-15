import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { useTeamsSelection } from './TeamsContext';

interface TeamMember {
    id: string;
    type: string;
    status: string;
    pid?: number;
    autoStart?: boolean;
}

interface TeamGroup {
    teamId: string;
    name: string;
    members: TeamMember[];
}

const teamsUrl = () => `${resolveApiUrl()}/team/teams`;
const startUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/start`;
const stopUrl = (id: string) => `${resolveApiUrl()}/team/agents/${encodeURIComponent(id)}/stop`;
const upUrl = (team: string) => `${resolveApiUrl()}/team/${encodeURIComponent(team)}/up`;
const downUrl = (team: string) => `${resolveApiUrl()}/team/${encodeURIComponent(team)}/down`;

type TeamAction = 'up' | 'down' | 'start' | 'stop';

/**
 * Build a user-facing notice for a team action response. The Up/Down endpoints
 * return `{ started }` / `{ stopped, purged }`; the single start/stop endpoints
 * return `{ ok }`. The Up case explains a 0-started result so the operator sees
 * WHY nothing came up (no autostart members) instead of a silent no-op.
 */
function describeAction(kind: TeamAction, body: Record<string, unknown> | null, memberId?: string): string {
    if (kind === 'up') {
        const started = Array.isArray(body?.started) ? (body.started as Array<{ id: string; ok: boolean }>) : [];
        if (started.length === 0)
            return 'Up: 0 members started — none have autostart enabled. Use ▸ Start per member, or set autostart: true in .spur/config.yaml.';
        const ok = started.filter((s) => s.ok).map((s) => s.id);
        const fail = started.filter((s) => !s.ok).map((s) => s.id);
        return `Started ${ok.join(', ') || '0'}${fail.length ? ` — failed: ${fail.join(', ')}` : ''}`;
    }
    if (kind === 'down') {
        const stopped = Array.isArray(body?.stopped) ? (body.stopped as string[]) : [];
        const purged = Array.isArray(body?.purged) ? (body.purged as string[]) : [];
        return `Stopped ${stopped.length} member(s)${stopped.length ? `: ${stopped.join(', ')}` : ''}${purged.length ? ` · purged ${purged.length} spec(s)` : ''}`;
    }
    return kind === 'start' ? `Started ${memberId ?? 'member'}` : `Stopped ${memberId ?? 'member'}`;
}

/** Roster tab — teams → members with status, start/stop + up/down controls (R3). */
export default function RosterTab() {
    const [teams, setTeams] = useState<TeamGroup[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const { select, selectedMemberId } = useTeamsSelection();

    const showNotice = useCallback((text: string, tone: 'info' | 'error') => {
        setNotice({ text, tone });
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 8000);
    }, []);

    const load = useCallback(async () => {
        try {
            const res = await fetchWithTimeout(new Request(teamsUrl()));
            if (!res.ok) throw new Error(`teams fetch failed: ${res.status}`);
            const body: unknown = await res.json();
            if (body && typeof body === 'object' && 'teams' in body) {
                setTeams((body as { teams: TeamGroup[] }).teams);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        void load();
        const interval = setInterval(load, 5000);
        return () => clearInterval(interval);
    }, [load]);

    // Clear the notice timer on unmount so the timeout never fires after teardown.
    useEffect(
        () => () => {
            if (noticeTimer.current) clearTimeout(noticeTimer.current);
        },
        [],
    );

    const act = useCallback(
        async (url: string, kind: TeamAction, memberId?: string) => {
            try {
                const res = await fetchWithTimeout(new Request(url, { method: 'POST' }));
                const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
                if (!res.ok) {
                    showNotice((body as { error?: string } | null)?.error ?? `request failed (${res.status})`, 'error');
                } else {
                    showNotice(describeAction(kind, body, memberId), 'info');
                }
            } catch (err) {
                showNotice(err instanceof Error ? err.message : String(err), 'error');
            }
            void load();
        },
        [load, showNotice],
    );

    if (error)
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load teams: {error}
            </div>
        );
    if (teams.length === 0) return <div className="p-4 text-sm text-spur-text-muted">No teams found.</div>;

    return (
        <div className="flex flex-col h-full overflow-y-auto" data-roster-tab>
            {notice && (
                <div
                    className={`px-4 py-2 text-xs border-b border-spur-border ${notice.tone === 'error' ? 'text-error' : 'text-spur-text-muted'}`}
                    role={notice.tone === 'error' ? 'alert' : 'status'}
                    data-roster-notice
                >
                    {notice.text}
                </div>
            )}
            {teams.map((team) => (
                <div key={team.teamId} className="border-b border-spur-border p-3" data-team-group={team.teamId}>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-spur-text">{team.name}</span>
                        <Button
                            type="button"
                            variant="primary"
                            size="xs"
                            title="Start members with autostart enabled. Non-autostart members: use ▸ Start per member (or set autostart: true in .spur/config.yaml)."
                            onClick={() => act(upUrl(team.teamId), 'up')}
                        >
                            Up
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            title="Stop all running members."
                            onClick={() => act(downUrl(team.teamId), 'down')}
                        >
                            Down
                        </Button>
                    </div>
                    {!team.members.some((m) => m.autoStart) && (
                        <div className="px-1 pb-1 text-[11px] text-spur-text-muted" data-team-hint={team.teamId}>
                            Up starts only members with autostart enabled — none here. Use ▸ Start per member, or set
                            autostart: true in .spur/config.yaml.
                        </div>
                    )}
                    <ul className="space-y-1">
                        {team.members.map((m) => {
                            const isSelected = selectedMemberId === m.id;
                            return (
                                <li key={m.id}>
                                    <div
                                        className={`flex w-full items-center gap-2 px-2 py-1 rounded text-xs ${
                                            isSelected ? 'bg-spur-accent text-white' : 'hover:bg-base-300'
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            className="flex flex-1 items-center gap-2 text-left"
                                            onClick={() => select(team.teamId, m.id)}
                                            data-member-row={m.id}
                                        >
                                            <span className="font-mono">{m.id}</span>
                                            <span className="text-spur-text-muted">{m.type}</span>
                                            <Badge variant={m.status === 'running' ? 'success' : 'ghost'} size="xs">
                                                {m.status}
                                            </Badge>
                                        </button>
                                        <div className="flex gap-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="xs"
                                                title="Start this member."
                                                onClick={() => void act(startUrl(m.id), 'start', m.id)}
                                                disabled={m.status === 'running'}
                                            >
                                                Start
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="xs"
                                                title="Stop this member."
                                                onClick={() => void act(stopUrl(m.id), 'stop', m.id)}
                                                disabled={m.status !== 'running'}
                                            >
                                                Stop
                                            </Button>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}
