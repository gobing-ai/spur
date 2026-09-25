import type { AgentFleet } from '@gobing-ai/spur-config';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { AgentCoordinationService, SendResult } from '../services/agent-coordination-service';
import type { FleetService, ResolvedFleet, ResolvedFleetMember } from '../services/fleet-service';

/**
 * One `agent.run` stage dispatched to a declared fleet member (task 0942, ADR-126).
 * The surface is opt-in: it is taken only when the run var selects it, never by default.
 */
export interface FleetDispatchInput {
    /** Declared Layer-1 role the member must match (R1). Pre-validated by the action. */
    role: string;
    /** Step prompt — persisted to a durable artifact (ADR-057); the message body names it. */
    prompt: string;
    /** Project the fleet resolves against; also where relative `expectFile` paths land. */
    projectPath: string;
    /** Durable completion artifact; the identity-pinned wait ends when it exists (R2). */
    expectFile?: string;
    /** Wait budget for `expectFile`; absent = wait unbounded, mirroring subprocess timeout semantics. */
    timeoutMs?: number;
    runId: string;
    state: string;
}

/** Deps for {@link dispatchToFleet} — injected so tests and hosts can substitute. */
export interface FleetDispatchDeps {
    fleet: FleetService;
    coordination: AgentCoordinationService;
    /** Resolve to `true` when `path` appeared before `timeoutMs` elapsed. */
    waitForFile(path: string, timeoutMs: number): Promise<boolean>;
    now(): number;
}

/**
 * Outcome of one fleet dispatch (R2/R3). A value, never an exception: every
 * infrastructure failure reads as `unavailable`, so the caller decides between
 * a declared fallback and an explicit fail — a silent downgrade is impossible.
 */
export type FleetDispatchResult =
    | { status: 'dispatched'; memberId: string; messageId: string; durationMs: number; promptPath: string }
    | { status: 'timeout'; memberId: string; messageId: string; durationMs: number; expectFile: string }
    | { status: 'unavailable'; reason: string };

/**
 * Roles that must land on a fresh member session per dispatch (ADR-121): a
 * reviewer judging work must not share the session that produced it. Verify
 * stages declare `role: reviewer`, so this one name covers both.
 */
const FRESH_SESSION_ROLES: readonly string[] = ['reviewer'];

/** Poll cadence for the default {@link waitForFileExists} — bounded by the declared timeout. */
const POLL_INTERVAL_MS = 100;

function hasReusableSession(member: ResolvedFleetMember): boolean {
    return member.session !== undefined && member.session.mode !== 'one-shot';
}

/** Wait (poll) until `path` exists or `timeoutMs` elapses. `Infinity` waits unbounded. */
export async function waitForFileExists(path: string, timeoutMs: number): Promise<boolean> {
    const fs = createNodeFileSystem();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await fs.exists(path)) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

/**
 * Map an `unavailable` dispatch to the action outcome (R3). Fallback to the
 * traditional subprocess surface happens ONLY when the run declares it
 * (`executorFallback: traditional`); otherwise the action fails explicitly
 * with the 0937 terminal reason `failed-agent` — never a silent downgrade.
 */
export function fleetUnavailableOutcome(
    reason: string,
    executorFallback: unknown,
): { mode: 'fallback'; fallbackReason: string } | { mode: 'fail'; error: string } {
    if (executorFallback === 'traditional') return { mode: 'fallback', fallbackReason: reason };
    return { mode: 'fail', error: `agent.run: fleet executor unavailable — ${reason} (terminal reason: failed-agent)` };
}

/**
 * Dispatch one `agent.run` stage to a fleet member over the G4 control plane
 * (task 0942, ADR-126). Resolves a member by role (R1), persists the prompt as
 * a durable artifact, posts the work message (keyed by run+state so a stage
 * retry replays the original submission instead of double-sending), then waits
 * identity-pinned — on the member's expectFile artifact, never on a terminal.
 * Never launches or drains members itself (ADR-116). Never throws.
 */
export async function dispatchToFleet(
    input: FleetDispatchInput,
    deps: FleetDispatchDeps,
): Promise<FleetDispatchResult> {
    let declaration: AgentFleet | null;
    let resolved: ResolvedFleet;
    try {
        declaration = await deps.fleet.load(input.projectPath);
        resolved = await deps.fleet.resolve(input.projectPath);
    } catch (error) {
        return { status: 'unavailable', reason: `fleet resolution failed: ${(error as Error).message}` };
    }
    if (declaration === null) {
        return {
            status: 'unavailable',
            reason: `no agent.fleet declaration at ${input.projectPath} (agent.fleet.enabled is false by default)`,
        };
    }
    if (!declaration.enabled) {
        return { status: 'unavailable', reason: 'fleet is disabled (agent.fleet.enabled: false)' };
    }
    const candidates = resolved.members.filter((member) => member.enabled && member.role === input.role);
    if (candidates.length === 0) {
        const memberIds = resolved.members.map((m) => m.instanceId).join(', ') || 'none';
        const missing = resolved.missing.join(', ') || 'none';
        return {
            status: 'unavailable',
            reason: `no enabled fleet member for role '${input.role}' (members: ${memberIds}; missing: ${missing})`,
        };
    }
    let pool = candidates;
    if (FRESH_SESSION_ROLES.includes(input.role)) {
        const fresh = candidates.filter((member) => !hasReusableSession(member));
        if (fresh.length === 0) {
            const carrying = candidates.map((m) => `${m.instanceId}:${m.session?.mode ?? 'unknown'}`).join(', ');
            return {
                status: 'unavailable',
                reason: `ADR-121: role '${input.role}' requires a fresh member session per dispatch and every candidate carries a reused session (${carrying}) — reset the member session or declare an idle member`,
            };
        }
        pool = fresh;
    }
    // R1 tie-breaking follows the declared strategy: `rest` keeps declaration
    // order; `gtd` prefers a member with no reusable session in flight (never
    // ran, or one-shot) and falls back to declaration order (stable sort).
    const member =
        declaration.strategy === 'gtd'
            ? [...pool].sort((a, b) => Number(hasReusableSession(a)) - Number(hasReusableSession(b)))[0]
            : pool[0];
    if (member === undefined) {
        // Unreachable (candidates is non-empty above); keeps the indexed access
        // from silently widening to undefined under noUncheckedIndexedAccess.
        return { status: 'unavailable', reason: `no enabled fleet member for role '${input.role}'` };
    }

    const fs = createNodeFileSystem(input.projectPath);
    const promptPath = fs.resolve('.spur', 'run', input.runId, 'prompts', `${input.state}.md`);
    const expectFileAbs = input.expectFile !== undefined ? fs.resolve(input.expectFile) : undefined;
    const startedAt = deps.now();
    // ADR-057 durable artifact: the step prompt itself is persisted under the run;
    // the message body only NAMES it (plus the expectFile contract) so the member
    // reads the task from the project, not from the mailbox body.
    try {
        await fs.writeFile(promptPath, input.prompt);
    } catch (error) {
        return {
            status: 'unavailable',
            reason: `prompt artifact write failed at ${promptPath}: ${(error as Error).message}`,
        };
    }
    const body = [
        '[spur fleet dispatch — agent.run]',
        `run: ${input.runId}`,
        `state: ${input.state}`,
        `role: ${input.role}`,
        `prompt artifact: ${promptPath}`,
        `expectFile: ${expectFileAbs ?? '(none declared)'}`,
        '',
        'Read your task prompt from the prompt artifact above.',
        ...(expectFileAbs !== undefined
            ? [
                  `On completion, write your result artifact to the expectFile path above; the dispatch wait ends when it exists.`,
              ]
            : []),
        '',
    ].join('\n');
    // Keyed send (0832): run+state pins the submission identity, so re-running
    // a stage replays the original message instead of dispatching twice.
    let send: SendResult;
    try {
        send = await deps.coordination.sendMessage(
            null,
            member.instanceId,
            body,
            undefined,
            `${input.runId}/${input.state}`,
        );
    } catch (error) {
        return {
            status: 'unavailable',
            reason: `message send to member '${member.instanceId}' failed: ${(error as Error).message}`,
        };
    }
    const durationMs = deps.now() - startedAt;
    if (expectFileAbs === undefined) {
        // R2: without a declared artifact there is nothing to wait on — the
        // dispatch is complete when the message is queued/injected.
        return { status: 'dispatched', memberId: member.instanceId, messageId: send.msgId, durationMs, promptPath };
    }
    const appeared = await deps.waitForFile(expectFileAbs, input.timeoutMs ?? Number.POSITIVE_INFINITY);
    if (!appeared) {
        return {
            status: 'timeout',
            memberId: member.instanceId,
            messageId: send.msgId,
            durationMs: deps.now() - startedAt,
            expectFile: expectFileAbs,
        };
    }
    return {
        status: 'dispatched',
        memberId: member.instanceId,
        messageId: send.msgId,
        durationMs: deps.now() - startedAt,
        promptPath,
    };
}
