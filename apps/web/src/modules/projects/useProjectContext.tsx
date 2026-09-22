import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

// ── Transport shapes (0840) ──
// Mirrors of the G62 runtime vocabulary (FleetService 0835/0836, StrategyRuntime
// 0838), field-for-field. The web app reaches the services only through the
// server (ADR-021 thin transports) — packages/app types are never imported here.

export type OrchestratorState = 'bound-online' | 'bound-offline' | 'missing' | 'unresolvable';

/**
 * Wire shape the server projects from the live claim (0840 review F1):
 * holderId is included; the raw ProjectClaim row is never sent.
 */
export interface OrchestratorBinding {
    state: OrchestratorState;
    instanceId?: string;
    holderId?: string;
    reason?: string;
}

export type StrategyName = 'rest' | 'gtd';

export interface ProjectStrategyInfo {
    name: StrategyName;
    version: number;
}

/** Field names mirror FleetService's ResolvedFleetMember (0835) exactly. */
export interface ResolvedFleetMember {
    instanceId: string;
    role?: string;
    executor: string;
    /** Resolved model; omitted when the executor profile declares none (0857 R5). */
    model?: string;
    enabled: boolean;
    writeCapable: boolean;
    capabilityState: string;
    /** Current agent session (0897): mode + resume id; absent when the member never ran. */
    session?: MemberSession;
}

/** Member agent session on the wire (0897). `id` rides only `resume` mode. */
export interface MemberSession {
    mode: 'persistent' | 'resume' | 'one-shot';
    id?: string;
}

/** Configured agent role from agent.roles. */
export interface ConfiguredAgentRole {
    name: string;
    tier: string;
    stages: string[];
    isCustom?: boolean;
    electedExecutor?: string | null;
}

/** Configured executor profile from agent.executors. */
export interface ConfiguredAgentExecutor {
    name: string;
    agent: string;
    model?: string;
    tier: string;
    disabled: boolean;
    disabledOwner?: string;
    disabledReason?: string;
    disabledSince?: string;
    installed?: boolean;
    usable?: boolean;
    version?: string | null;
    error?: string | null;
    elected?: string[];
    executionCapabilities?: Record<string, unknown>;
    sourceLayer?: 'project' | 'global';
    sourcePath?: string;
}

/** Wire shape of GET /api/project/fleet. `path` is null only off a project cwd (CF Worker). */
export interface ProjectFleetSnapshot {
    path: string | null;
    /** `agent.fleet.enabled` — the declared switch; false for an absent section too (0858 R5). */
    enabled: boolean;
    strategy: ProjectStrategyInfo | null;
    orchestrator: OrchestratorBinding;
    members: ResolvedFleetMember[];
    capacity: { total: number; enabled: number; writeCapable: number; missing: string[] };
    roles?: ConfiguredAgentRole[];
    executors?: ConfiguredAgentExecutor[];
}

/** Wire shape of GET /api/project. */
interface ProjectInfo {
    name?: string | null;
    path?: string | null;
}

// ── Context ──

export interface ProjectContextValue {
    /** Canonical worktree path — the identity key for every project-scoped surface. Null while loading or unresolvable. */
    path: string | null;
    /** Display label only, never a key. */
    name: string;
    /** Runtime header facts; null while loading or when the fleet fetch failed (degrades the header only). */
    fleet: ProjectFleetSnapshot | null;
    state: 'loading' | 'ready' | 'unresolvable';
}

const defaultValue: ProjectContextValue = { path: null, name: '', fleet: null, state: 'loading' };

/**
 * Board-wide project identity (0840 R4). Provided by `BoardLayout` — ABOVE the
 * module — so `GlobalAgentBar` (mounted outside `<Outlet/>`) reaches `path` from
 * every Board route; one fetch serves the whole board.
 */
export const ProjectContext = createContext<ProjectContextValue>(defaultValue);

/**
 * Fetch `/api/project` (identity) and `/api/project/fleet` (runtime facts).
 * A failed or path-less `/api/project` is `unresolvable`; a slow or failed
 * fleet fetch degrades the header only and never blocks tab rendering.
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
    const [value, setValue] = useState<ProjectContextValue>(defaultValue);

    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;

        fetchWithTimeout(new Request(`${resolveApiUrl()}/project`, { signal: controller.signal }))
            .then(async (res) => (res.ok ? ((await res.json()) as ProjectInfo) : null))
            .then((project) => {
                if (cancelled) return;
                if (!project?.path) {
                    setValue({ path: null, name: '', fleet: null, state: 'unresolvable' });
                    return;
                }
                const path = project.path;
                // Functional update (0840 review F2): the fleet fetch runs in
                // parallel and may already have landed — a plain set here would
                // clobber its snapshot back to null.
                setValue((prev) => ({ ...prev, path, name: project.name ?? '', state: 'ready' }));
            })
            .catch(() => {
                if (!cancelled) setValue({ path: null, name: '', fleet: null, state: 'unresolvable' });
            });

        fetchWithTimeout(new Request(`${resolveApiUrl()}/project/fleet`, { signal: controller.signal }))
            .then(async (res) => (res.ok ? ((await res.json()) as ProjectFleetSnapshot) : null))
            .then((fleet) => {
                if (cancelled || fleet === null) return;
                setValue((prev) => ({ ...prev, fleet }));
            })
            .catch(() => {
                // fleet facts stay null — the header names their absence
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, []);

    return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

/** Read the served project's identity + runtime facts. */
export function useProjectContext(): ProjectContextValue {
    return useContext(ProjectContext);
}
