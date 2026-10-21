import {
    DeliveryReconciler,
    FleetGuestService,
    FleetService,
    type InboxMessage,
    MessageNotFoundError,
    normalizeProjectPath,
    OPERATOR_INBOX_ID,
    RequestKeyConflictError,
    SPUR_INBOX_ID,
    StrategyRuntime,
} from '@gobing-ai/spur-app';
import { contract } from '@gobing-ai/spur-contracts';
import { implement, ORPCError } from '@orpc/server';
import type { ServerContext } from '../../context';

const os = implement(contract);

/** Project one inbox message onto the transport DTO (never the domain shape). */
function toMessageDto(row: InboxMessage) {
    return {
        id: row.id,
        fromId: row.fromId,
        toId: row.toId,
        body: row.body,
        kind: row.kind,
        status: row.status,
        attempts: row.attempts,
        error: row.error,
        claimedAt: row.claimedAt,
        deliveredAt: row.deliveredAt,
        readAt: row.readAt,
        inReplyTo: row.inReplyTo,
        threadId: row.threadId,
        requestKey: row.requestKey,
        taskId: row.taskId,
        parentRunId: row.parentRunId,
        createdAt: row.createdAt,
    };
}

/**
 * Map a thrown error onto the transport's typed vocabulary.
 *
 * Only a condition the CALLER can fix becomes a 4xx; anything else stays a server error with a
 * generic message, because echoing an internal string (a locked DB, a broken adapter) as a 400
 * tells the client its request was wrong when it was not.
 */
function toOrpcError(error: unknown, fallback: 'NOT_FOUND' | 'BAD_REQUEST'): Error {
    if (error instanceof MessageNotFoundError) return new ORPCError('NOT_FOUND', { message: error.message });
    if (error instanceof RequestKeyConflictError) return new ORPCError('CONFLICT', { message: error.message });
    const message = error instanceof Error ? error.message : String(error);
    // The service's own input validation is the one BAD_REQUEST class we can attribute.
    if (message.startsWith('inbox message requires') || message.includes('must be a non-empty')) {
        return new ORPCError('BAD_REQUEST', { message });
    }
    // A cursor the caller mangled is the caller's to fix, not a server fault.
    if (message.includes('malformed list cursor')) {
        return new ORPCError('BAD_REQUEST', { message: 'the list cursor is malformed' });
    }
    if (message.includes('already names a different message')) return new ORPCError('CONFLICT', { message });
    // Anything else is NOT the caller's fault — a locked database, a broken adapter. Reporting it
    // as a 4xx would tell a client its request was wrong and stop it retrying. Fixed text, no
    // internal detail.
    void fallback;
    return new ORPCError('INTERNAL_SERVER_ERROR', { message: 'the inbox request failed' });
}

/** 0844 R4: a client that recovered a stale port must not inject into another project. */
function assertServedProject(ctx: ServerContext, projectPath: string | undefined): void {
    if (projectPath === undefined || projectPath === '') return;
    const served = normalizeProjectPath(ctx.cwd);
    const claimed = normalizeProjectPath(projectPath);
    if (claimed !== served) {
        throw new ORPCError('CONFLICT', {
            message: `project mismatch: request targets ${claimed}, server serves ${served}`,
        });
    }
}

/** The fleet seams these handlers need, so a test can bind an orchestrator without a fleet file. */
type FleetSeams = Pick<FleetService, 'resolve' | 'resolveOrchestrator'>;

/**
 * The fleet seam the health module already uses (0799 R3's reloadable config). A context that
 * supplies its own `fleetService()` (tests, an embedding host) is used as given.
 */
function fleetOver(ctx: ServerContext): FleetSeams {
    const injected = (ctx as unknown as { fleetService?: () => FleetSeams }).fleetService;
    if (typeof injected === 'function') return injected.call(ctx);
    return new FleetService({
        fs: ctx.fs,
        reloadAgentConfig: () => ctx.reloadAgentConfig(),
        openDb: () => ctx.getDb(),
    });
}

/**
 * Every address this project can deliver to: the reserved identities, the addressable agent
 * specs (hand-authored plus the declared fleet), joined guests, and any address that already
 * owns inbox rows (a member between restarts must still receive its queued mail).
 *
 * R2 refuses an unknown recipient instead of storing a `queued` row no member can ever claim —
 * the silent drop the design rejects elsewhere.
 */
async function addressableRecipients(ctx: ServerContext): Promise<Set<string>> {
    const addresses = new Set<string>([OPERATOR_INBOX_ID, SPUR_INBOX_ID]);
    try {
        for (const spec of await ctx.coordination().listAgentSpecs()) addresses.add(spec.id);
    } catch {
        // A project with no readable specs still has its inbox addresses below.
    }
    try {
        for (const member of await new FleetGuestService({
            cwd: ctx.cwd,
            fs: ctx.fs,
            getDb: () => ctx.getDb(),
        }).list()) {
            addresses.add(member.id);
        }
    } catch {
        // No guest store: nothing joined.
    }
    try {
        for (const member of await ctx.inbox().members()) addresses.add(member.id);
    } catch {
        // An unreadable inbox leaves the spec-derived addresses.
    }
    return addresses;
}

/**
 * The bound orchestrator's member address, or '' when this project has none. A `missing` or
 * `unresolvable` binding is an empty answer, never a thrown error: the caller decides whether
 * that is a refusal (send) or an empty feed (requests).
 */
async function orchestratorAddress(ctx: ServerContext): Promise<string> {
    try {
        const { state, instanceId } = await fleetOver(ctx).resolveOrchestrator(normalizeProjectPath(ctx.cwd));
        if (state === 'missing' || state === 'unresolvable') return '';
        return typeof instanceId === 'string' ? instanceId : '';
    } catch {
        return '';
    }
}

/**
 * Inbox domain handlers (G11 R9, ADR-143 §13): the typed replacement for the raw
 * `/api/messages*` routes and the health module's `/api/project/requests` block.
 *
 * Reads are side-effect free (R3): `list`, `thread`, `requests` and `members` never sweep,
 * never reconcile and never expire a guest. Those writes live on the orchestrator's
 * non-readonly strategy tick.
 */
export function createInboxHandlers(ctx: ServerContext) {
    return {
        list: os.inbox.list.handler(async ({ input }) => {
            try {
                const page = await ctx.inbox().list(input.member, input.direction ?? 'in', {
                    ...(input.limit !== undefined ? { limit: input.limit } : {}),
                    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
                });
                return { messages: page.messages.map(toMessageDto), nextCursor: page.nextCursor };
            } catch (error) {
                throw toOrpcError(error, 'BAD_REQUEST');
            }
        }),

        thread: os.inbox.thread.handler(async ({ input }) => {
            const rows = await ctx.inbox().thread(input.id);
            if (rows.length === 0) throw new ORPCError('NOT_FOUND', { message: `no message ${input.id}` });
            return rows.map(toMessageDto);
        }),

        send: os.inbox.send.handler(async ({ input }) => {
            assertServedProject(ctx, input.projectPath);
            let to = input.to;
            if (to === undefined) {
                // Default recipient is the orchestrator; a project without one has no inbox to
                // deliver to, so the caller is told instead of believing the message went out.
                to = await orchestratorAddress(ctx);
                if (to === '') {
                    throw new ORPCError('BAD_REQUEST', {
                        message: 'no orchestrator member is bound for this project — pass `to` explicitly',
                    });
                }
            }
            if (!(await addressableRecipients(ctx)).has(to)) {
                throw new ORPCError('BAD_REQUEST', {
                    message: `unknown recipient "${to}" — no agent spec, fleet member, guest or inbox owns that address`,
                });
            }
            try {
                const result = await ctx.inbox().send({
                    from: input.from ?? OPERATOR_INBOX_ID,
                    to,
                    body: input.body,
                    ...(input.kind !== undefined ? { kind: input.kind } : {}),
                    ...(input.requestKey !== undefined ? { requestKey: input.requestKey } : {}),
                    ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
                    ...(input.parentRunId !== undefined ? { parentRunId: input.parentRunId } : {}),
                });
                return { message: toMessageDto(result.message), replayed: result.replayed };
            } catch (error) {
                if (error instanceof ORPCError) throw error;
                throw toOrpcError(error, 'BAD_REQUEST');
            }
        }),

        reply: os.inbox.reply.handler(async ({ input }) => {
            try {
                // The row can vanish between the read and the write; the service is the authority
                // on whether it still exists, so its answer is mapped rather than pre-judged.
                return toMessageDto(await ctx.inbox().reply(input.id, input.from, input.body));
            } catch (error) {
                throw toOrpcError(error, 'NOT_FOUND');
            }
        }),

        read: os.inbox.read.handler(async ({ input }) => {
            try {
                const receipt = await ctx.inbox().markRead(input.id, input.reader);
                return { readAt: receipt.readAt, transitioned: receipt.transitioned };
            } catch (error) {
                if (!(error instanceof MessageNotFoundError)) throw toOrpcError(error, 'NOT_FOUND');
                // Unknown id and non-recipient are the same answer, so ids cannot be probed
                // across addresses (the service's own contract). The message is fixed text: the
                // service's own wording names the id, which would confirm the id exists.
                throw new ORPCError('NOT_FOUND', { message: 'message not found for this reader' });
            }
        }),

        requests: os.inbox.requests.handler(async ({ input }) => {
            // Degraded states are named values, never an error: no bound orchestrator means this
            // project has no request feed to show, not that the read failed.
            const orchestratorId = await orchestratorAddress(ctx);
            if (orchestratorId === '' && input.messageId === undefined) return [];

            const limit = input.limit ?? 50;
            const rows = await ctx
                .inbox()
                .requests(input.messageId === undefined ? orchestratorId : undefined, input.messageId);
            const reconciler = new DeliveryReconciler({ getDb: () => ctx.getDb() });
            const classified = await reconciler.classify(
                input.messageId === undefined ? orchestratorId : undefined,
                input.messageId === undefined ? undefined : rows.filter((row) => row.kind === 'request'),
            );
            const reasonByMessage = new Map(classified.map((item) => [item.messageId, item.reason]));

            // Strategy holds name why a dispatch is stuck; a failure to read them leaves `hold`
            // null rather than failing the feed.
            const holdByTask = new Map<string, string>();
            try {
                const runtime = new StrategyRuntime({
                    openDb: () => ctx.getDb(),
                    tasks: ctx.taskService(),
                    fleet: fleetOver(ctx),
                    dependencyBlocked: async () => null,
                });
                const selected = await runtime.selectNext(normalizeProjectPath(ctx.cwd), { readOnly: true });
                for (const hold of selected.holds) holdByTask.set(hold.wbs, hold.reason);
            } catch {
                // holds stay empty
            }

            return rows.slice(0, limit).map((row) => ({
                messageId: row.id,
                requestKey: row.requestKey,
                status: row.status,
                attempts: row.attempts,
                error: row.error,
                runId: row.runId ?? null,
                runStatus: row.runStatus ?? null,
                taskId: row.runTaskId ?? row.taskId,
                outcome: row.runOutcome ?? null,
                reason: reasonByMessage.get(row.id) ?? null,
                hold: holdByTask.get(row.runTaskId ?? row.taskId ?? '') ?? null,
            }));
        }),

        members: os.inbox.members.handler(async () => ctx.inbox().members()),
    };
}
