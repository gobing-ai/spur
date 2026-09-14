/**
 * Declared⇄observed join for the Agents roster (0842, feature G63).
 *
 * A roster entry joins two independent facts: the member DECLARED in the
 * project's fleet snapshot (`ProjectFleetSnapshot.members`, 0840 wire of
 * FleetService 0835) and the process OBSERVED through the existing
 * `GET /api/team/processes` read (`ProcessStatus`, teams module). The two
 * facts come from different systems and disagree in both directions —
 * declared-but-not-running, and a live process with no declared member —
 * so they are never collapsed into one status (R2).
 */

import { OPERATOR_AGENT_ID } from './conversation';
import type { ProcessStatus } from './MemberTerminal';
import type { ProjectFleetSnapshot, ResolvedFleetMember } from './useProjectContext';

/** Observed liveness narrowed to the roster's three-state vocabulary. */
export type MemberObservedState = 'running' | 'exited' | 'not-started';

/**
 * Named roster issues, accumulated in this frozen order (task 0842 Design).
 * An entry may carry several; they are never collapsed into one status.
 * `executor-unavailable` and `capability-unknown` are DIFFERENT facts with
 * different next actions — 'unknown' grants nothing (0835) and is not a
 * failure, so it must never render as unavailable.
 */
export type MemberIssue =
    | 'executor-unavailable' // capabilityState is 'unavailable'
    | 'capability-unknown' // capabilityState is 'unknown' — no attestation, grants nothing
    | 'unresolved' // instanceId appears in ResolvedFleet.missing
    | 'undeclared' // a live process with no declared member
    | 'disabled'; // declared with enabled: false

/**
 * One roster card: the declared fleet member (null for an undeclared live
 * process) joined with its observed process facts, plus the issues that
 * accumulated in the frozen MemberIssue order.
 */
export interface RosterEntry {
    instanceId: string; // === ResolvedFleetMember.instanceId, verbatim
    declared: ResolvedFleetMember | null; // null for an undeclared live process
    observed: {
        status: MemberObservedState;
        pid: number | null;
        startedAt: string | null;
        exitCode: number | null;
    };
    isOrchestrator: boolean;
    issues: readonly MemberIssue[];
}

/**
 * Orchestrator marking (0842 join step 3): an entry is marked only when the
 * binding carries a matching instanceId. `missing`/`unresolvable` mark
 * NOTHING — the roster never guesses which member would be the orchestrator.
 */
export function isOrchestratorEntry(entry: Pick<RosterEntry, 'instanceId'>, snapshot: ProjectFleetSnapshot): boolean {
    const { state, instanceId } = snapshot.orchestrator;
    if (state !== 'bound-online' && state !== 'bound-offline') return false;
    return instanceId !== undefined && instanceId === entry.instanceId;
}

/** The declared⇄observed join. Pure and synchronous — the unit under test. */
export function buildRoster(snapshot: ProjectFleetSnapshot, processes: ProcessStatus[]): RosterEntry[] {
    const byAgent = new Map(processes.map((p) => [p.agentId, p] as const));
    const entries: RosterEntry[] = [];

    // 1-4: declared members, with observed liveness and accumulated issues.
    for (const member of snapshot.members) {
        const proc = byAgent.get(member.instanceId);
        const observed = {
            status: observedState(proc),
            pid: proc?.pid ?? null,
            startedAt: proc?.startedAt ?? null,
            exitCode: proc?.exitCode ?? null,
        };
        const issues: MemberIssue[] = [];
        if (member.enabled === false) issues.push('disabled');
        if (member.capabilityState === 'unavailable') issues.push('executor-unavailable');
        if (member.capabilityState === 'unknown') issues.push('capability-unknown');
        if (snapshot.capacity.missing.includes(member.instanceId)) issues.push('unresolved');
        entries.push({
            instanceId: member.instanceId,
            declared: member,
            observed,
            isOrchestrator: isOrchestratorEntry({ instanceId: member.instanceId }, snapshot),
            issues,
        });
    }

    // 5: processes matching no member are running-but-undeclared — appended so
    // a hand-started agent (or a member removed from fleet.json while its
    // process survives) is never silently hidden. The operator mailbox
    // (`board-operator`) is an address, not a member, and is excluded here.
    for (const proc of processes) {
        if (snapshot.members.some((m) => m.instanceId === proc.agentId)) continue;
        if (proc.agentId === OPERATOR_AGENT_ID) continue;
        entries.push({
            instanceId: proc.agentId,
            declared: null,
            observed: {
                status: observedState(proc),
                pid: proc.pid,
                startedAt: proc.startedAt,
                exitCode: proc.exitCode,
            },
            isOrchestrator: isOrchestratorEntry({ instanceId: proc.agentId }, snapshot),
            issues: ['undeclared'],
        });
    }

    // 6: orchestrator first, then instanceId ascending — stable across polls.
    entries.sort((a, b) => {
        if (a.isOrchestrator !== b.isOrchestrator) return a.isOrchestrator ? -1 : 1;
        return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
    });
    return entries;
}

function observedState(proc: ProcessStatus | undefined): MemberObservedState {
    if (proc === undefined) return 'not-started';
    return proc.status === 'running' ? 'running' : 'exited';
}
