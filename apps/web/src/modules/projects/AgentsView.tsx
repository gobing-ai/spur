import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import MemberDetail from './MemberDetail';
import { parseProcessList, STATUS_POLL_MS } from './MemberTerminal';
import { buildRoster, formatUptime, type MemberIssue, type RosterEntry, sessionLabel } from './roster';
import type { ConfiguredAgentExecutor, ConfiguredAgentRole, ProjectFleetSnapshot } from './useProjectContext';
import { useProjectContext } from './useProjectContext';

const fleetUrl = () => `${resolveApiUrl()}/project/fleet`;
const processesUrl = () => `${resolveApiUrl()}/processes`;

const DEFAULT_ROLES: ConfiguredAgentRole[] = [
    { name: 'scribe', tier: 'cheap', stages: ['changelog'], isCustom: false },
    { name: 'coder', tier: 'standard', stages: ['implement', 'test', 'wrap'], isCustom: false },
    { name: 'reviewer', tier: 'capable-1', stages: ['verify', 'review', 'dogfood'], isCustom: false },
    { name: 'planner', tier: 'capable-2', stages: ['plan', 'refine', 'brainstorm'], isCustom: false },
];

/**
 * Runtime-gate the fleet payload before the join trusts it (ADR-021: network
 * input is untrusted). A payload failing the gate skips the tick.
 */
function isFleetSnapshot(v: unknown): v is ProjectFleetSnapshot {
    if (v === null || typeof v !== 'object') return false;
    const f = v as Record<string, unknown>;
    const cap = f.capacity as Record<string, unknown> | null | undefined;
    return (
        Array.isArray(f.members) &&
        f.members.every(
            (m) => m !== null && typeof m === 'object' && typeof (m as Record<string, unknown>).instanceId === 'string',
        ) &&
        cap !== null &&
        typeof cap === 'object' &&
        Array.isArray(cap.missing) &&
        f.orchestrator !== null &&
        typeof f.orchestrator === 'object'
    );
}

/** Icon + text per issue (0842 Design table — 0844/0845 freeze on this text; never colour-alone). */
const ISSUE_FACTS: Record<MemberIssue, { icon: string; label: string; action: string }> = {
    'executor-unavailable': {
        icon: '⛔',
        label: 'executor unavailable',
        action: "the executor cannot run here — check the executor's install/attestation",
    },
    'capability-unknown': {
        icon: '❔',
        label: 'capability unknown',
        action: 'no attestation exists; it grants nothing and is not a failure',
    },
    unresolved: {
        icon: '⚠️',
        label: 'unresolved',
        action: 'the instance is listed in the fleet capacity as missing',
    },
    undeclared: {
        icon: '❗',
        label: 'undeclared',
        action: 'a live process with no declared member',
    },
    disabled: {
        icon: '⏸️',
        label: 'disabled',
        action: 'declared with enabled: false',
    },
};

/**
 * The observed fact's label + next action (R5). `executor-unavailable` and
 * `capability-unknown` are their own states with their own actions; plain
 * not-running suggests start; a stale orchestrator claim is named as such.
 */
function observedFact(entry: RosterEntry, orchestratorOffline: boolean): { label: string; action: string | null } {
    if (entry.observed.status === 'running') return { label: 'running', action: null };
    if (orchestratorOffline && entry.isOrchestrator)
        return {
            label: 'orchestrator offline',
            action: 'its claim is held but stale — see project_claims',
        };
    const capabilityIssue =
        entry.issues.includes('executor-unavailable') || entry.issues.includes('capability-unknown');
    if (!capabilityIssue) return { label: 'not running', action: 'start it' };
    return {
        label: entry.observed.status === 'exited' ? 'exited' : 'not started',
        action: null,
    };
}

function tierBadgeClass(tier: string): string {
    switch (tier) {
        case 'cheap':
            return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
        case 'standard':
            return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
        case 'capable-1':
            return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
        case 'capable-2':
            return 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
        case 'capable-3':
            return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
        default:
            return 'bg-spur-surface-3 text-spur-text-muted border border-spur-border';
    }
}

type AgentsSection = 'all' | 'roles' | 'executors' | 'fleet';

/**
 * Agents tab: displays configured agent roles, executor profiles, and the
 * project's fleet roster joined with observed live processes.
 */
export default function AgentsView({ pollMs = STATUS_POLL_MS }: { pollMs?: number }) {
    const project = useProjectContext();
    const [entries, setEntries] = useState<RosterEntry[] | null>(null);
    const [roles, setRoles] = useState<ConfiguredAgentRole[]>(DEFAULT_ROLES);
    const [executors, setExecutors] = useState<ConfiguredAgentExecutor[]>([]);
    const [fleetSnapshot, setFleetSnapshot] = useState<ProjectFleetSnapshot | null>(null);
    const [failed, setFailed] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [orchOffline, setOrchOffline] = useState(false);
    const [activeSection, setActiveSection] = useState<AgentsSection>('all');
    const [executorFilter, setExecutorFilter] = useState('');
    const openerRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        let active: AbortController | null = null;

        const tick = async (): Promise<void> => {
            active?.abort();
            active = new AbortController();
            const signal = active.signal;
            try {
                const [fleetRes, procRes] = await Promise.all([
                    fetchWithTimeout(new Request(fleetUrl(), { signal })),
                    fetchWithTimeout(new Request(processesUrl(), { signal })),
                ]);
                if (cancelled || !fleetRes.ok || !procRes.ok) return;
                const fleetJson: unknown = await fleetRes.json();
                const procJson: unknown = await procRes.json();
                if (cancelled || !isFleetSnapshot(fleetJson)) return;
                const list = parseProcessList(procJson);
                if (!list) return; // malformed process payload — skip the tick, never clear the roster
                setEntries(buildRoster(fleetJson, list));
                if (fleetJson.roles && fleetJson.roles.length > 0) {
                    setRoles(fleetJson.roles);
                }
                setExecutors(fleetJson.executors ?? []);
                setFleetSnapshot(fleetJson);
                setOrchOffline(fleetJson.orchestrator.state === 'bound-offline');
                setFailed(false);
            } catch {
                if (!cancelled) setFailed(true);
            }
        };

        void tick();
        const interval = setInterval(() => void tick(), pollMs);
        return () => {
            cancelled = true;
            clearInterval(interval);
            active?.abort();
        };
    }, [pollMs]);

    // R4 focus contract: opening records the triggering card; Escape and the
    // explicit close both restore focus to it BEFORE the pane unmounts.
    const openDetail = useCallback((entry: RosterEntry, opener: HTMLButtonElement) => {
        openerRef.current = opener;
        setSelectedId(entry.instanceId);
    }, []);
    const closeDetail = useCallback(() => {
        setSelectedId(null);
        openerRef.current?.focus();
    }, []);

    const filteredExecutors = useMemo(() => {
        if (!executorFilter.trim()) return executors;
        const q = executorFilter.toLowerCase();
        return executors.filter(
            (e) =>
                e.name.toLowerCase().includes(q) ||
                e.agent.toLowerCase().includes(q) ||
                Boolean(e.model?.toLowerCase().includes(q)) ||
                e.tier.toLowerCase().includes(q),
        );
    }, [executors, executorFilter]);

    const selected = entries?.find((e) => e.instanceId === selectedId) ?? null;
    return (
        <div className="flex flex-col h-full overflow-hidden bg-spur-bg" data-agents-view>
            <div className="flex-1 overflow-y-auto p-3 space-y-6">
                {entries === null && !failed && (
                    <div className="p-4 text-sm text-spur-text-muted italic" data-roster-loading>
                        Loading fleet roster…
                    </div>
                )}
                {failed && (
                    <div className="p-4 text-sm text-spur-text-muted" data-roster-fetch-failed role="alert">
                        Fleet roster unavailable — the fleet or process feed could not be read.
                    </div>
                )}

                {entries !== null && (
                    <>
                        {/* Sub-navigation / Filter Strip */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-spur-border/50">
                            <div className="flex items-center gap-1.5 p-1 bg-spur-surface-2 rounded-xl border border-spur-border">
                                <button
                                    type="button"
                                    onClick={() => setActiveSection('all')}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                                        activeSection === 'all'
                                            ? 'bg-spur-accent text-white shadow-sm'
                                            : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                                    }`}
                                    data-section-filter="all"
                                >
                                    All
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveSection('roles')}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                                        activeSection === 'roles'
                                            ? 'bg-spur-accent text-white shadow-sm'
                                            : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                                    }`}
                                    data-section-filter="roles"
                                >
                                    <span>Roles</span>
                                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">
                                        {roles.length}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveSection('executors')}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                                        activeSection === 'executors'
                                            ? 'bg-spur-accent text-white shadow-sm'
                                            : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                                    }`}
                                    data-section-filter="executors"
                                >
                                    <span>Executors</span>
                                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">
                                        {executors.length}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveSection('fleet')}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                                        activeSection === 'fleet'
                                            ? 'bg-spur-accent text-white shadow-sm'
                                            : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                                    }`}
                                    data-section-filter="fleet"
                                >
                                    <span>Fleet</span>
                                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">
                                        {entries.length}
                                    </span>
                                </button>
                            </div>

                            {activeSection === 'executors' && executors.length > 0 && (
                                <input
                                    type="text"
                                    placeholder="Filter executors by name, agent, model..."
                                    value={executorFilter}
                                    onChange={(e) => setExecutorFilter(e.target.value)}
                                    className="px-3 py-1.5 bg-spur-surface border border-spur-border rounded-lg text-xs text-spur-text placeholder:text-spur-text-muted/60 focus:outline-none focus:ring-1 focus:ring-spur-accent min-w-[240px]"
                                />
                            )}
                        </div>

                        {/* Section 1: Agent Roles */}
                        {(activeSection === 'all' || activeSection === 'roles') && (
                            <section className="space-y-3" data-roles-section>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-sm font-semibold tracking-tight text-spur-text">
                                            Agent Roles
                                        </h2>
                                        <code className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-spur-surface-2 border border-spur-border text-spur-accent">
                                            agent.roles
                                        </code>
                                    </div>
                                    <span className="text-xs text-spur-text-muted">
                                        Routing roles mapped to capability tiers and folded stages
                                    </span>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-roles-grid>
                                    {roles.map((role) => (
                                        <RoleCard key={role.name} role={role} />
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Section 2: Agent Executors */}
                        {(activeSection === 'all' || activeSection === 'executors') && (
                            <section className="space-y-3" data-executors-section>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-sm font-semibold tracking-tight text-spur-text">
                                            Agent Executors
                                        </h2>
                                        <code className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-spur-surface-2 border border-spur-border text-spur-accent">
                                            agent.executors
                                        </code>
                                        {executors.length > 0 && (
                                            <span className="text-xs text-spur-text-muted">
                                                ({executors.filter((e) => !e.disabled).length} active,{' '}
                                                {executors.filter((e) => e.disabled).length} disabled)
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs text-spur-text-muted">
                                        Execution profiles pairing CLI runtimes with models and capability tiers
                                    </span>
                                </div>
                                {filteredExecutors.length === 0 ? (
                                    <div className="p-4 rounded-xl bg-spur-surface border border-spur-border text-xs text-spur-text-muted">
                                        {executors.length === 0
                                            ? 'No executor profiles defined in config.'
                                            : 'No executors match filter.'}
                                    </div>
                                ) : (
                                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-executors-grid>
                                        {filteredExecutors.map((ex) => (
                                            <ExecutorCard key={ex.name} executor={ex} />
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Section 3: Agent Fleet */}
                        {(activeSection === 'all' || activeSection === 'fleet') && (
                            <section className="space-y-3" data-fleet-section>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-sm font-semibold tracking-tight text-spur-text">
                                            Agent Fleet
                                        </h2>
                                        <code className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-spur-surface-2 border border-spur-border text-spur-accent">
                                            agent.fleet
                                        </code>
                                    </div>
                                    {fleetSnapshot && (
                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                            <span
                                                className={`px-2 py-0.5 rounded-md font-medium text-[11px] ${
                                                    fleetSnapshot.enabled
                                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                        : 'bg-spur-surface-2 border border-spur-border text-spur-text-muted'
                                                }`}
                                            >
                                                {fleetSnapshot.enabled ? 'Fleet Enabled' : 'Fleet Disabled'}
                                            </span>
                                            {fleetSnapshot.strategy && (
                                                <span className="px-2 py-0.5 rounded-md bg-spur-surface-2 border border-spur-border text-spur-text text-[11px]">
                                                    strategy:{' '}
                                                    <strong className="font-mono text-spur-accent">
                                                        {fleetSnapshot.strategy.name}
                                                    </strong>
                                                </span>
                                            )}
                                            <span className="px-2 py-0.5 rounded-md bg-spur-surface-2 border border-spur-border text-spur-text text-[11px]">
                                                orchestrator:{' '}
                                                <span className="font-mono text-spur-text-muted">
                                                    {fleetSnapshot.orchestrator.state}
                                                </span>
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {entries.length === 0 && (
                                    <div
                                        className="p-4 text-sm text-spur-text-muted italic bg-spur-surface border border-spur-border rounded-xl"
                                        data-roster-empty
                                    >
                                        No agents for this project — declare members under{' '}
                                        <code className="font-mono text-spur-accent">agent.fleet</code> in{' '}
                                        <code className="font-mono text-spur-accent">{`${project.path ?? 'this project'}/.spur/config.yaml`}</code>
                                        .
                                    </div>
                                )}

                                {entries.length > 0 && (
                                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-roster-grid>
                                        {entries.map((entry) => (
                                            <RosterCard
                                                key={entry.instanceId}
                                                entry={entry}
                                                orchestratorOffline={orchOffline}
                                                onOpen={openDetail}
                                            />
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}
                    </>
                )}
            </div>
            {selected !== null && <MemberDetail entry={selected} onClose={closeDetail} />}
        </div>
    );
}

function RoleCard({ role }: { role: ConfiguredAgentRole }) {
    const roleIcons: Record<string, string> = {
        scribe: '✍️',
        coder: '💻',
        reviewer: '🔍',
        planner: '📋',
    };
    const icon = roleIcons[role.name.toLowerCase()] ?? '🤖';

    return (
        <div
            className="p-3 bg-spur-surface border border-spur-border rounded-xl flex flex-col justify-between gap-2.5 hover:border-spur-accent/30 transition-colors"
            data-role-card={role.name}
        >
            <div>
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="text-base" aria-hidden="true">
                            {icon}
                        </span>
                        <span className="font-semibold text-sm capitalize text-spur-text">{role.name}</span>
                    </div>
                    <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-medium ${tierBadgeClass(role.tier)}`}
                    >
                        {role.tier}
                    </span>
                </div>

                <div className="mt-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-spur-text-muted font-medium mb-1">
                        Stages
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {role.stages.map((stage) => (
                            <span
                                key={stage}
                                className="px-1.5 py-0.5 rounded bg-spur-surface-2 border border-spur-border/60 text-[11px] font-mono text-spur-text"
                            >
                                {stage}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            <div className="pt-2 border-t border-spur-border/40 flex flex-col gap-1 text-[11px] text-spur-text-muted">
                {role.electedExecutor && (
                    <div className="flex items-center justify-between text-spur-accent">
                        <span>elected</span>
                        <span className="font-mono font-medium">⭐ {role.electedExecutor}</span>
                    </div>
                )}
                <div className="flex items-center justify-between">
                    <span>source</span>
                    <span className="font-mono text-spur-text">
                        {role.isCustom ? 'project override' : 'built-in / global'}
                    </span>
                </div>
            </div>
        </div>
    );
}

function ExecutorCard({ executor }: { executor: ConfiguredAgentExecutor }) {
    const axes = executor.executionCapabilities?.axes as Record<string, { state: string }> | undefined;
    const capabilities = axes
        ? Object.keys(axes).filter((k) => axes[k]?.state === 'available' || axes[k]?.state === 'enforced')
        : [];

    return (
        <div
            className="p-3 bg-spur-surface border border-spur-border rounded-xl flex flex-col justify-between gap-2.5 hover:border-spur-accent/30 transition-colors"
            data-executor-card={executor.name}
        >
            <div>
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-sm text-spur-text">{executor.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-spur-surface-2 border border-spur-border/60 text-[11px] font-mono text-spur-accent">
                            {executor.agent}
                        </span>
                    </div>
                    <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-medium ${tierBadgeClass(executor.tier)}`}
                    >
                        {executor.tier}
                    </span>
                </div>

                <div className="mt-2 text-xs flex flex-wrap items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 truncate">
                        <span className="text-spur-text-muted">model:</span>
                        <span className="font-mono text-spur-text truncate">{executor.model ?? 'default'}</span>
                    </div>
                    {executor.version && (
                        <span className="text-[10px] font-mono text-spur-text-muted/80 bg-spur-surface-2 px-1.5 py-0.5 rounded">
                            {executor.version}
                        </span>
                    )}
                </div>

                {executor.elected && executor.elected.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-amber-400 font-medium">Elected:</span>
                        {executor.elected.map((role) => (
                            <span
                                key={role}
                                className="px-1.5 py-0.2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] font-mono text-amber-300 flex items-center gap-0.5"
                            >
                                <span>⭐</span>
                                <span>{role}</span>
                            </span>
                        ))}
                    </div>
                )}

                {capabilities.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {capabilities.map((cap) => (
                            <span
                                key={cap}
                                className="px-1.5 py-0.5 rounded bg-spur-surface-2 border border-spur-border/40 text-[10px] font-mono text-spur-text-muted"
                            >
                                {cap}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="pt-2 border-t border-spur-border/40 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                    <span
                        className={`w-2 h-2 rounded-full ${
                            executor.disabled
                                ? 'bg-amber-500'
                                : executor.installed === false
                                  ? 'bg-rose-500'
                                  : 'bg-emerald-500'
                        }`}
                    />
                    <span
                        className={
                            executor.disabled
                                ? 'text-amber-400'
                                : executor.installed === false
                                  ? 'text-rose-400'
                                  : 'text-emerald-400'
                        }
                    >
                        {executor.disabled ? 'Disabled' : executor.installed === false ? 'CLI Missing' : 'Ready'}
                    </span>
                </span>
                {executor.disabled && (
                    <span
                        className="text-[11px] text-spur-text-muted truncate max-w-[160px]"
                        title={executor.disabledReason ?? executor.disabledOwner ?? 'disabled'}
                    >
                        {executor.disabledReason ?? executor.disabledOwner ?? 'disabled'}
                    </span>
                )}
            </div>
        </div>
    );
}

function RosterCard({
    entry,
    orchestratorOffline,
    onOpen,
}: {
    entry: RosterEntry;
    orchestratorOffline: boolean;
    onOpen: (entry: RosterEntry, opener: HTMLButtonElement) => void;
}) {
    const observed = observedFact(entry, orchestratorOffline);
    // AC1: running + derivable start time only; null for exited/not-started/null startedAt.
    const uptime = entry.observed.status === 'running' ? formatUptime(entry.observed.startedAt) : null;
    return (
        <button
            type="button"
            className="text-left p-3 bg-spur-surface border border-spur-border rounded-xl hover:bg-spur-surface-2 focus:outline-none focus:ring-1 focus:ring-spur-accent"
            data-roster-entry={entry.instanceId}
            data-g6="open-member"
            aria-haspopup="dialog"
            onClick={(e) => onOpen(entry, e.currentTarget)}
        >
            <div className="flex items-center gap-2">
                <span data-roster-role className="font-medium text-spur-text text-sm">
                    {entry.declared?.role ?? 'member'}
                </span>
                {entry.isOrchestrator && (
                    <span data-roster-orchestrator className="text-xs px-1 rounded bg-spur-accent/20 text-spur-accent">
                        orchestrator
                    </span>
                )}
            </div>
            <div className="mt-1 text-xs text-spur-text-muted">
                executor{' '}
                <span data-roster-executor className="font-mono text-spur-text">
                    {entry.declared?.executor ?? '—'}
                </span>
            </div>
            {/* R2: two labeled facts, never one combined status. */}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span data-roster-declared>
                    <span className="text-spur-text-muted">declared:</span>{' '}
                    <span className="text-spur-text">
                        {entry.declared === null
                            ? 'none'
                            : `${entry.declared.enabled ? 'enabled' : 'disabled'} · capability ${entry.declared.capabilityState}`}
                    </span>
                </span>
                <span data-roster-observed>
                    <span className="text-spur-text-muted">observed:</span>{' '}
                    <span className="text-spur-text">
                        {entry.observed.status}
                        {entry.observed.pid !== null ? ` — pid ${entry.observed.pid}` : ''}
                        {entry.observed.exitCode !== null ? ` — exit ${entry.observed.exitCode}` : ''}
                    </span>
                </span>
            </div>
            {uptime !== null && (
                <div data-roster-uptime className="mt-1 text-xs text-spur-text-muted">
                    {uptime}
                </div>
            )}
            {/* 0897 R3: the member's agent session, read-only text — process feed
                first, fleet snapshot member as fallback. No interaction. */}
            <div data-roster-session className="mt-1 text-xs text-spur-text-muted">
                session{' '}
                <span className="font-mono text-spur-text">
                    {sessionLabel(entry.observed.session ?? entry.declared?.session) ?? '—'}
                </span>
            </div>
            {entry.issues.length > 0 && (
                <div className="mt-1 space-y-0.5">
                    {entry.issues.map((issue) => (
                        <div key={issue} data-roster-issue={issue} className="text-xs">
                            <span aria-hidden="true">{ISSUE_FACTS[issue].icon}</span>{' '}
                            <span className="text-spur-text">{ISSUE_FACTS[issue].label}</span>
                            <span className="text-spur-text-muted"> — {ISSUE_FACTS[issue].action}</span>
                        </div>
                    ))}
                </div>
            )}
            {observed.action !== null && (
                <div data-roster-next-action className="mt-1 text-xs text-spur-text-muted">
                    next: {observed.action}
                </div>
            )}
        </button>
    );
}
