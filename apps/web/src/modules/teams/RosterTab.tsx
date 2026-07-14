import { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { useTeamsSelection } from './TeamsContext';

interface TeamMember {
    id: string;
    type: string;
    status: string;
    pid?: number;
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

/** Roster tab — teams → members with status, start/stop + up/down controls (R3). */
export default function RosterTab() {
    const [teams, setTeams] = useState<TeamGroup[]>([]);
    const [error, setError] = useState<string | null>(null);
    const { select, selectedMemberId } = useTeamsSelection();

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

    const act = useCallback(
        async (url: string) => {
            try {
                await fetchWithTimeout(new Request(url, { method: 'POST' }));
                void load();
            } catch {
                // Non-fatal — UI will retry on next poll.
            }
        },
        [load],
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
            {teams.map((team) => (
                <div key={team.teamId} className="border-b border-spur-border p-3" data-team-group={team.teamId}>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-spur-text">{team.name}</span>
                        <Button type="button" variant="primary" size="xs" onClick={() => act(upUrl(team.teamId))}>
                            Up
                        </Button>
                        <Button type="button" variant="ghost" size="xs" onClick={() => act(downUrl(team.teamId))}>
                            Down
                        </Button>
                    </div>
                    <ul className="space-y-1">
                        {team.members.map((m) => {
                            const isSelected = selectedMemberId === m.id;
                            return (
                                <li key={m.id}>
                                    <button
                                        type="button"
                                        className={`flex w-full items-center gap-2 px-2 py-1 rounded text-xs ${
                                            isSelected ? 'bg-spur-accent text-white' : 'hover:bg-base-300'
                                        }`}
                                        onClick={() => select(team.teamId, m.id)}
                                        data-member-row={m.id}
                                    >
                                        <span className="font-mono">{m.id}</span>
                                        <span className="text-spur-text-muted">{m.type}</span>
                                        <Badge variant={m.status === 'running' ? 'success' : 'ghost'} size="xs">
                                            {m.status}
                                        </Badge>
                                        <div className="ml-auto flex gap-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="xs"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void act(startUrl(m.id));
                                                }}
                                                disabled={m.status === 'running'}
                                            >
                                                Start
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="xs"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void act(stopUrl(m.id));
                                                }}
                                                disabled={m.status !== 'running'}
                                            >
                                                Stop
                                            </Button>
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}
