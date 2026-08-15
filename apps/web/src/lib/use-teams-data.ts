import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from './rpc-client';

// ── Team/member shapes returned by GET /api/team/teams (0256 R2) ──
// Shared by TerminalTab, ActivityTab, and other Teams surfaces after 0268
// extracted the duplicated polling + parsing out of each consumer.
export interface TeamMember {
    id: string;
    type: string;
    status: string;
    /** Optional model override surfaced by GET /api/team/teams (R11). Omitted when unset. */
    model?: string;
    /** Surfaced so the Roster can hint when no member is autostart. */
    autoStart?: boolean;
    /** Process pid when the member is running. */
    pid?: number;
    /** Declared Layer-1 role (0544 R3). Omitted when unset — the roster renders `unset`, never inferred. */
    role?: string;
    /** Executor name the spec is bound to (0544 R3). */
    executor?: string;
}

/** A team and its members as surfaced by GET /api/team/teams. */
export interface TeamGroup {
    teamId: string;
    name: string;
    /** Resolved absolute work_dir, or null (R4). */
    workDir: string | null;
    /** True when the team's work_dir equals the server project cwd (R4). */
    isCurrentProject: boolean;
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
            members.push({
                id: r.id,
                type: r.type,
                status: r.status,
                ...(typeof r.model === 'string' && r.model.length > 0 ? { model: r.model } : {}),
                ...(typeof r.autoStart === 'boolean' ? { autoStart: r.autoStart } : {}),
                ...(typeof r.pid === 'number' ? { pid: r.pid } : {}),
                ...(typeof r.role === 'string' && r.role.length > 0 ? { role: r.role } : {}),
                ...(typeof r.executor === 'string' && r.executor.length > 0 ? { executor: r.executor } : {}),
            });
        }
        teams.push({
            teamId: e.teamId,
            name: e.name,
            workDir: typeof e.workDir === 'string' ? e.workDir : null,
            isCurrentProject: e.isCurrentProject === true,
            members,
        });
    }
    return teams;
}

const teamsUrl = () => `${resolveApiUrl()}/team/teams`;

/** Reconnect-after-respawn poll interval (ms) for the team/member status refresh. */
const TEAMS_POLL_MS = 5000;

/** Result of `useTeamsData`: live teams, last error, and an imperative refetch. */
export interface UseTeamsDataResult {
    teams: TeamGroup[];
    error: string | null;
    /** Force a fresh GET outside the 5s poll — used after mutations (start/stop/up/down). */
    reload: () => Promise<void>;
}

/**
 * Neutral shared teams feed (task 0197 R3). Moved out of the Teams module so
 * Teams, Inbox, and Workspace consume the same feed. Polls GET /api/team/teams
 * every 5s with an AbortController-free fetchWithTimeout; exposes a `reload`
 * for the post-mutation refetch path. Callers own selection state — this hook
 * is purely the data layer (0268 R1, R3).
 */
export function useTeamsData(): UseTeamsDataResult {
    const [teams, setTeams] = useState<TeamGroup[]>([]);
    const [error, setError] = useState<string | null>(null);
    const mountedRef = useRef(true);

    const reload = useCallback(async () => {
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
        void reload();
        const interval = setInterval(reload, TEAMS_POLL_MS);
        return () => {
            mountedRef.current = false;
            clearInterval(interval);
        };
    }, [reload]);

    return { teams, error, reload };
}
