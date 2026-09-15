import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import MemberDetail from './MemberDetail';
import { parseProcessList, STATUS_POLL_MS } from './MemberTerminal';
import { buildRoster, formatUptime, type MemberIssue, type RosterEntry } from './roster';
import type { ProjectFleetSnapshot } from './useProjectContext';
import { useProjectContext } from './useProjectContext';

const fleetUrl = () => `${resolveApiUrl()}/project/fleet`;
const processesUrl = () => `${resolveApiUrl()}/team/processes`;

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

/**
 * Agents tab (0842 R1/R2, feature G63): the served project's fleet as a roster
 * of cards, each joining the DECLARED member (`/api/project/fleet`) with the
 * OBSERVED process (`GET /api/team/processes`) as two labeled facts — never
 * one dot. Both reads ride one poll tick so the two facts in a card are never
 * more than one tick apart. Detail is a pane (MemberDetail), not a route.
 */
export default function AgentsView({ pollMs = STATUS_POLL_MS }: { pollMs?: number }) {
    const project = useProjectContext();
    const [entries, setEntries] = useState<RosterEntry[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [orchOffline, setOrchOffline] = useState(false); // per-tick, from the fleet fetch — never ProjectProvider's mount-time snapshot
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

    const selected = entries?.find((e) => e.instanceId === selectedId) ?? null;
    return (
        <div className="flex flex-col h-full overflow-hidden bg-spur-bg" data-agents-view>
            <div className="flex-1 overflow-y-auto p-2">
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
                {entries !== null && entries.length === 0 && (
                    <div className="p-4 text-sm text-spur-text-muted italic" data-roster-empty>
                        No agents for this project — declare members in{' '}
                        <code className="font-mono">{`${project.path ?? 'this project'}/.spur/fleet.json`}</code>.
                    </div>
                )}
                {entries !== null && entries.length > 0 && (
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
            </div>
            {selected !== null && <MemberDetail entry={selected} onClose={closeDetail} />}
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
