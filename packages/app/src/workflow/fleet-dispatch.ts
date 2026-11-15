import type { AgentFleet } from '@gobing-ai/spur-config';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { A2aMemberTransport } from '../services/a2a-member-transport';
import { a2aMutationReason } from '../services/a2a-member-transport';
import type { FleetDispatcher, FleetReceipt } from '../services/fleet-dispatcher';
import type { FleetService, ResolvedFleet, ResolvedFleetMember } from '../services/fleet-service';
import { resolveMemberAddress } from '../services/member-dispatch';

/**
 * One `agent.run` stage dispatched to a declared fleet member (task 0942, ADR-126).
 * The surface is opt-in: it is taken only when the run var selects it, never by default.
 *
 * G71 R5: this is now a thin adapter over the single {@link FleetDispatcher}
 * primitive. Role resolution, the durable prompt artifact and the optional
 * `expectFile` post-condition stay here; the enqueue and the completion wait
 * belong to the dispatcher, so the workflow and the strategy share one path.
 */
export interface FleetDispatchInput {
    /** Declared Layer-1 role the member must match (R1). Pre-validated by the action. */
    role: string;
    /**
     * A declared member the step addressed BY NAME (1333 R5, ADR-148 §3.1): the member id
     * (`coder`, or the full `<slug>-coder` instance id) wins over the role match. Naming a
     * member is explicit intent, so it is addressable even when `agent.fleet.enabled` is
     * off — the switch gates autostart, not addressing.
     */
    member?: string;
    /** Step prompt — persisted to a durable artifact (ADR-057); the message body names it. */
    prompt: string;
    /** Project the fleet resolves against; also where relative `expectFile` paths land. */
    projectPath: string;
    /** Optional completion ARTIFACT — a post-condition checked after a `completed` receipt, never the wait itself. */
    expectFile?: string;
    /** D65 work-item declarations, refused for an A2A member before anything is sent (1334 R7). */
    expectFiles?: string[];
    requireDiff?: boolean;
    ownedSections?: string[];
    /** Wait budget for the receipt; absent = wait unbounded, mirroring subprocess timeout semantics. */
    timeoutMs?: number;
    runId: string;
    state: string;
}

/** Deps for {@link dispatchToFleet} — injected so tests and hosts can substitute. */
export interface FleetDispatchDeps {
    fleet: FleetService;
    /**
     * The single fleet dispatch primitive (G71 R1). Enqueue and the receipt wait are
     * separate seams ON PURPOSE: a failed send may fall back to the subprocess,
     * while a failed WAIT after a successful send must not (the member holds the work).
     */
    dispatcher: Pick<FleetDispatcher, 'enqueue' | 'awaitReceipt'>;
    /** A2A turn driver; absence is a pre-enqueue refusal for an A2A member, never a local fallback. */
    a2a?: A2aMemberTransport;
    now(): number;
}

/**
 * Outcome of one fleet dispatch (R2/R3). A value, never an exception: every
 * infrastructure failure reads as `unavailable`, so the caller decides between
 * a declared fallback and an explicit fail — a silent downgrade is impossible.
 *
 * `outcome-unknown` is the honest result of a wait that stopped without a
 * definite receipt (G71 R2): never `failed`, never `not-started`, and never
 * re-dispatched until a definite receipt exists.
 */
export type FleetDispatchResult =
    | {
          status: 'completed';
          memberId: string;
          messageId: string;
          durationMs: number;
          promptPath: string;
          runId?: string;
          /** Present when the turn was A2A-driven; local work-item post-processing is then skipped. */
          member?: ResolvedFleetMember;
      }
    | {
          status: 'failed';
          memberId: string;
          messageId: string;
          reason: string;
          runId?: string;
          member?: ResolvedFleetMember;
      }
    /**
     * The member never claimed the request, so no work happened — the one definite
     * receipt the cold subprocess may take by default (1333 R3). `member` is what
     * carries the member's EXECUTOR to that subprocess (the CLI path rewrites
     * `--agent` to it; the workflow must do the same, 1333 review P2-2).
     */
    | { status: 'not-started'; memberId: string; messageId: string; member: ResolvedFleetMember }
    | { status: 'outcome-unknown'; memberId: string; messageId: string }
    /**
     * Nothing was dispatched. `member` is present whenever a member RESOLVED (the failure
     * was after resolution) — that is what makes it a `localMember` for the cold-fallback
     * default (1333 R3).
     */
    | { status: 'unavailable'; reason: string; member?: ResolvedFleetMember };

/**
 * Roles that must land on a fresh member session per dispatch (ADR-121): a
 * reviewer judging work must not share the session that produced it. Verify
 * stages declare `role: reviewer`, so this one name covers both.
 */
export const FRESH_SESSION_ROLES: readonly string[] = ['reviewer'];

function hasReusableSession(member: ResolvedFleetMember): boolean {
    return member.session !== undefined && member.session.mode !== 'one-shot';
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
    localMember = false,
): { mode: 'fallback'; fallbackReason: string } | { mode: 'fail'; error: string } {
    if (executorFallback === 'traditional') return { mode: 'fallback', fallbackReason: reason };
    // ADR-148 §3.2 / ADR-126 amendment: for a LOCAL member the cold subprocess rung is the
    // DEFAULT, not opt-in. An explicitly declared `executorFallback` of any other value keeps
    // today's semantics (fail), and a dispatch that never resolved a member is unchanged.
    if (executorFallback === undefined && localMember) return { mode: 'fallback', fallbackReason: reason };
    return { mode: 'fail', error: `agent.run: fleet executor unavailable — ${reason} (terminal reason: failed-agent)` };
}

/** Resolve the member for a role, or the reason no usable member exists (R1). */
function resolveMember(
    declaration: AgentFleet,
    resolved: ResolvedFleet,
    role: string,
): { member: ResolvedFleetMember } | { unavailable: string } {
    const candidates = resolved.members.filter((member) => member.enabled && member.role === role);
    if (candidates.length === 0) {
        const memberIds = resolved.members.map((m) => m.instanceId).join(', ') || 'none';
        const missing = resolved.missing.join(', ') || 'none';
        return {
            unavailable: `no enabled fleet member for role '${role}' (members: ${memberIds}; missing: ${missing})`,
        };
    }
    let pool = candidates;
    if (FRESH_SESSION_ROLES.includes(role)) {
        const fresh = candidates.filter((member) => !hasReusableSession(member));
        if (fresh.length === 0) {
            const carrying = candidates.map((m) => `${m.instanceId}:${m.session?.mode ?? 'unknown'}`).join(', ');
            return {
                unavailable: `ADR-121: role '${role}' requires a fresh member session per dispatch and every candidate carries a reused session (${carrying}) — reset the member session or declare an idle member`,
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
        return { unavailable: `no enabled fleet member for role '${role}'` };
    }
    return { member };
}

/**
 * Dispatch one `agent.run` stage to a fleet member over the G4 control plane
 * (task 0942, ADR-126; G71 R1/R2/R5). Resolves a member by role (R1), persists
 * the prompt as a durable artifact, enqueues one keyed inbox message through the
 * shared {@link FleetDispatcher}, and resolves on the `coordination_runs` receipt
 * linked to that message — never on a terminal, never on a filesystem poll.
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
    if (!declaration.enabled && input.member === undefined) {
        return { status: 'unavailable', reason: 'fleet is disabled (agent.fleet.enabled: false)' };
    }
    const resolution =
        input.member !== undefined
            ? resolveMemberAddress(resolved.members, input.member)
            : resolveMember(declaration, resolved, input.role);
    if ('unavailable' in resolution) {
        return { status: 'unavailable', reason: resolution.unavailable };
    }
    const member = resolution.member;
    if (member.a2a !== undefined) {
        const mutation = a2aMutationReason(input);
        if (mutation !== null) return { status: 'unavailable', reason: mutation, member };
        if (deps.a2a === undefined) {
            return { status: 'unavailable', reason: 'A2A turn service is not wired', member };
        }
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
            member,
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
            ? [`On completion, write your result artifact to the expectFile path above.`]
            : []),
        '',
    ].join('\n');
    let messageId: string;
    try {
        // `fromId` is the dispatching RUN, never null: a member may reply, and
        // `replyToMessage` refuses a null sender — so the reply path must be real.
        // Session review: it was `workflow:<runId>`, and `validateAgentId` (2-64 chars, lowercase
        // alnum / `_` / `-`) rejects a colon — so every workflow→fleet dispatch failed at the
        // enqueue and the fleet executor could never be used. Dashes keep the id readable and valid.
        ({ messageId } = await deps.dispatcher.enqueue({
            member: member.instanceId,
            // G11 R7: a workflow has no member identity, so it sends as `spur` — the system
            // address. The dispatching run rides `parentRunId` instead of faking an address.
            fromId: 'spur',
            body,
            requestKey: `${input.runId}/${input.state}`,
            parentRunId: input.runId,
        }));
    } catch (error) {
        // Nothing was queued, so a declared `executorFallback: traditional` may
        // safely re-run the stage on the subprocess surface.
        return {
            status: 'unavailable',
            reason: `message send to member '${member.instanceId}' failed: ${(error as Error).message}`,
            member,
        };
    }
    const durationMs = deps.now() - startedAt;
    if (member.a2a !== undefined) {
        // With no serve this completes the claimed request in-process; a live member uses the
        // same transport in its loop. A stored remote task id makes a replay re-attach, not resend.
        const turn = await deps.a2a?.runMessage(member, messageId, {
            ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
            work: input,
        });
        if (turn === undefined) return { status: 'outcome-unknown', memberId: member.instanceId, messageId };
        if (turn.status === 'completed') {
            return {
                status: 'completed',
                memberId: member.instanceId,
                messageId,
                durationMs,
                promptPath,
                member,
                ...(turn.runId !== undefined ? { runId: turn.runId } : {}),
            };
        }
        if (turn.status === 'failed') {
            return {
                status: 'failed',
                memberId: member.instanceId,
                messageId,
                reason: turn.reason ?? 'a2a-failed',
                member,
                ...(turn.runId !== undefined ? { runId: turn.runId } : {}),
            };
        }
        if (turn.status === 'not-started') {
            return {
                status: 'not-started',
                memberId: member.instanceId,
                messageId,
                member,
            };
        }
        return { status: 'outcome-unknown', memberId: member.instanceId, messageId };
    }
    let receipt: FleetReceipt;
    try {
        receipt = await deps.dispatcher.awaitReceipt(messageId, member.instanceId, {
            timeoutMs: input.timeoutMs ?? Number.POSITIVE_INFINITY,
        });
    } catch (error) {
        // The message IS queued: the member may already be working. This is
        // outcome-unknown, NEVER `unavailable` — an unavailable result authorizes a
        // declared fallback, and re-running the stage on the subprocess while the
        // member holds the same request executes it twice.
        void error;
        return { status: 'outcome-unknown', memberId: member.instanceId, messageId };
    }
    switch (receipt.status) {
        case 'completed': {
            if (expectFileAbs !== undefined && !(await fs.exists(expectFileAbs))) {
                return {
                    status: 'failed',
                    memberId: member.instanceId,
                    messageId: receipt.messageId,
                    reason: 'missing-artifact',
                    ...(receipt.runId !== undefined ? { runId: receipt.runId } : {}),
                };
            }
            return {
                status: 'completed',
                memberId: member.instanceId,
                messageId: receipt.messageId,
                durationMs,
                promptPath,
                ...(receipt.runId !== undefined ? { runId: receipt.runId } : {}),
            };
        }
        case 'failed':
            return {
                status: 'failed',
                memberId: member.instanceId,
                messageId: receipt.messageId,
                reason: 'errored',
                ...(receipt.runId !== undefined ? { runId: receipt.runId } : {}),
            };
        case 'not-started':
            return { status: 'not-started', memberId: member.instanceId, messageId: receipt.messageId, member };
        default:
            return { status: 'outcome-unknown', memberId: member.instanceId, messageId: receipt.messageId };
    }
}
