import { join } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import {
    type DbAdapter,
    type MemberLifecycleState,
    type RecordLifecycleResult,
    recordLifecycle,
} from '@gobing-ai/spur-domain';
import {
    type AgentEvents,
    type AgentSpec,
    buildIdentityPreamble,
    loadAgentSpecs,
    saveAgentSpec,
    validateAgentId,
} from '@gobing-ai/ts-ai-runner';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { AgentRoleDefinition } from './agent-service';
import { FleetService, mergeAgentSpecs, type ResolvedFleetMember } from './fleet-service';
import {
    type InboxMessage,
    type InboxMessageKind,
    type InboxMessageStatus,
    InboxService,
    isReservedInboxId,
    OPERATOR_INBOX_ID,
} from './inbox-service';
import type { TaskService } from './task-service';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Output sink injected into AgentCoordinationService. */
export interface AgentCoordinationServiceOutput {
    write(message: string): void;
    error(message: string): void;
}

/** Context injected into AgentCoordinationService. */
export interface AgentCoordinationServiceContext {
    cwd: string;
    env: Record<string, string | undefined>;
    /**
     * Merged global+project config threaded from the composition root (A5 /
     * ADR-082). `null` = load failed/absent; consumers degrade to today's
     * defaults.
     */
    spurConfig?: SpurConfig | null;
    /** 0799 R3: launch boundaries reload merged config so quota-driven executor disables apply without a server restart. */
    reloadAgentConfig?: () => Promise<SpurConfig | null>;
    /** Optional output sink; the service does not read it (kept for CLI stdout coupling). */
    output?: AgentCoordinationServiceOutput;
    /**
     * Task-corpus writer for `assignTask` (1078 R2). Injected rather than constructed because a
     * TaskService needs the section matrix and template bodies the composition root owns; when it
     * is absent `assignTask` refuses instead of falling back to a second write path.
     */
    tasks?: Pick<TaskService, 'assign'>;
    getDb(): Promise<DbAdapter>;
    /** Filesystem port for reading/writing task files. */
    fs: FileSystem;
    /**
     * Optional EventBus for message lifecycle events (`message.sent|replied`)
     * and task assignment events (`task.assigned`). When absent (CLI default
     * without a ledger attach), those operations still succeed — they just
     * don't publish. The server injects its bus so the tap persists and SSE
     * streams the events.
     */
    eventBus?: CoordinationEventBus;
    /**
     * Optional EventBus for agent lifecycle events (`agent.started`,
     * `agent.stopped`, `agent.invoke.*`, `agent.message.sent`). When absent,
     * The coordination service runs without publishing — the server injects its bus
     * so the system_events tap persists and SSE streams agent lifecycle.
     */
    events?: EventBus<AgentEvents>;
    /**
     * Layer-1 role → tier map resolved at the CLI boundary (0543 R1) from the
     * `DEFAULT_AGENT_ROLES` SSOT (0572 / ADR-061) — the same map AgentService
     * receives, so a role-only member resolves through the SAME ladder as
     * `--agent <role>`. Absent → a role-only member fails materialization loudly
     * (the CLI threads it from `agentRoles`; the server path does not resolve roles).
     */
    roles?: ReadonlyMap<string, AgentRoleDefinition>;
}

/**
 * Metadata-only payload for `message.sent|replied|read` events. For `message.read`,
 * `toId` is the reader and `createdAt` the read time. The body is NEVER
 * included — events are observable metadata; bodies stay in the store.
 */
export interface MessageEventPayload {
    msgId: string;
    fromId: string | null;
    toId: string;
    /** Thread root id (`in_reply_to`) when this message is a reply, else null. */
    threadId: string | null;
    createdAt: string;
    /** Producer-owned observability severity. */
    severity?: 'info' | 'warning' | 'error';
}

/**
 * Metadata-only payload for the `task.assigned` event. Unresolved roster fields
 * stay null rather than dropping the event (task 0371 R5 / J3 R17).
 */
export interface TaskAssignedEventPayload {
    memberId: string | null;
    agentType: string | null;
    /** Operation outcome label (`ok`, `assigned`, `started`, `stopped`, …). */
    outcome: string;
    /** Optional task id for assignment events. */
    taskId?: string | null;
    /** Producer-owned observability severity. */
    severity?: 'info' | 'warning' | 'error';
}

/** Bus shape for message lifecycle events (legacy alias of {@link CoordinationEventBus}). */
export type MessageEventBus = EventBus<
    Record<'message.sent' | 'message.replied' | 'message.read', (event: MessageEventPayload) => void>
>;

/** Bus shape consumed by AgentCoordinationService — message + assignment event names. */
export type CoordinationEventBus = EventBus<{
    'message.sent': (event: MessageEventPayload) => void;
    'message.replied': (event: MessageEventPayload) => void;
    'message.read': (event: MessageEventPayload) => void;
    'task.assigned': (event: TaskAssignedEventPayload) => void;
}>;

/** No message with that id is addressed to the reader (unknown id and wrong reader look alike). */
export class MessageNotFoundError extends Error {}

/** Result of enqueuing or threading a message. */
export interface SendResult {
    msgId: string;
    toId: string;
    /** The message's post-send status: `queued` on a fresh send, or the stored row's status on a replay. */
    status: InboxMessageStatus;
    injected: boolean;
    /** Present only on a keyed send (0832): true when the request key replayed an earlier submission. */
    replayed?: boolean;
    requestKey?: string;
}

/** A single inbox row in display form. */
export interface InboxEntry {
    id: string;
    fromId: string | null;
    body: string;
    status: string;
    createdAt: string;
    inReplyTo: string | null;
    /** Delivery attempt count (0834 R6); populated by {@link AgentCoordinationService.getInbox}. */
    injectAttempts?: number;
    /** Last delivery error, when the drain recorded one (0834 R6). */
    injectError?: string | null;
    /**
     * Keyed-submission identity from the ts-db row (G71 R1). A `fleet:task:<wbs>:<n>`
     * value lets the drain name the dispatched task on the run receipt; null/absent
     * for a keyless send.
     */
    requestKey?: string | null;
}

/** Inbox row as read for dispatch-receipt work — the fields {@link FleetDispatcher} needs. */
export interface InboxMessageView {
    id: string;
    toId: string;
    status: string;
    requestKey: string | null;
}

/** Project one inbox message onto the display shape the CLI, server and Board already read. */
function toInboxEntry(row: InboxMessage): InboxEntry {
    return {
        id: row.id,
        fromId: row.fromId,
        body: row.body,
        status: row.status,
        createdAt: new Date(row.createdAt).toISOString(),
        inReplyTo: row.inReplyTo,
        injectAttempts: row.attempts,
        injectError: row.error,
        requestKey: row.requestKey,
    };
}

/** Result of listing an agent's inbox. */
export interface InboxResult {
    messages: InboxEntry[];
    count: number;
}

// ---------------------------------------------------------------------------
// AgentCoordinationService
// ---------------------------------------------------------------------------

/** Input shape for creating an agent spec. */
export interface AgentSpecInput {
    id: string;
    name?: string;
    type: string;
    /** Executor binding drain routes through (an agent.executors name or a canonical agent). */
    executor?: string;
    workspace?: string;
    purpose?: string;
    tags?: string[];
    config?: Record<string, unknown>;
    autoStart?: boolean;
}

/**
 * Application-layer coordination for `spur message`, `spur task update --assignee`, and
 * fleet-aware `spur agent` commands. Reads specs and delivers inbox messages
 * over the CLI's SQLite adapter. Agent specs are read from and written to
 * `.spur/agents/` via the package's spec helpers.
 *
 * The constructor is synchronous and cheap; the DB-backed dependencies are built
 * lazily on first use so that purely spec-oriented operations (`createAgentSpec`)
 * never open a database.
 */
export class AgentCoordinationService {
    private readonly ctx: AgentCoordinationServiceContext;
    private readonly configDir: string;

    constructor(ctx: AgentCoordinationServiceContext) {
        this.ctx = ctx;
        this.configDir = join(ctx.cwd, '.spur', 'agents');
    }

    // -------------------------------------------------------------------------
    // Messaging
    // -------------------------------------------------------------------------

    /**
     * Enqueue a message. The recipient (`toId`) and a non-null sender (`fromId`)
     * are syntactically validated so a typo'd id surfaces immediately instead of
     * silently creating an unaddressable row; recipient existence is intentionally
     * NOT required (team mode addresses agents before their spec exists, for
     * deferred `--drain` delivery). In Phase 1-3 there is no live daemon, so the
     * message stays queued.
     */
    async sendMessage(
        fromId: string | null,
        toId: string,
        body: string,
        replyTo?: string,
        requestKey?: string,
        extra?: { kind?: InboxMessageKind; taskId?: string; parentRunId?: string },
    ): Promise<SendResult> {
        validateAgentId(toId);
        if (fromId !== null) validateAgentId(fromId);
        if (requestKey !== undefined && requestKey.trim() === '') {
            throw new Error('requestKey must be a non-empty string');
        }
        // G11 R5: `from_id` is never null. A caller with no identity is the human operator —
        // the same attribution the retired CLI-path event fallback used.
        const sender = fromId ?? OPERATOR_INBOX_ID;
        const service = await this.inboxService();
        if (replyTo !== undefined) {
            // A reply is addressed to the original sender and inherits the thread root; the
            // service writes it with its `message.replied` event in one transaction.
            const reply = await service.reply(replyTo, sender, body);
            return { msgId: reply.id, toId: reply.toId, status: reply.status, injected: false };
        }
        const { message, replayed } = await service.send({
            from: sender,
            to: toId,
            body,
            kind: extra?.kind ?? 'chat',
            ...(requestKey !== undefined ? { requestKey } : {}),
            ...(extra?.taskId !== undefined ? { taskId: extra.taskId } : {}),
            ...(extra?.parentRunId !== undefined ? { parentRunId: extra.parentRunId } : {}),
        });
        return requestKey === undefined
            ? { msgId: message.id, toId: message.toId, status: message.status, injected: false }
            : {
                  msgId: message.id,
                  toId: message.toId,
                  status: message.status,
                  injected: false,
                  replayed,
                  requestKey,
              };
    }

    /**
     * Mark a message read by its recipient (0204 P2). Idempotent: only the first mark
     * emits `message.read`; repeats return the original stamp. A non-recipient or unknown
     * id is "not found" — the same answer, so ids cannot be probed across recipients.
     */
    async markMessageRead(msgId: string, readerId: string): Promise<{ readAt: string; transitioned: boolean }> {
        validateAgentId(readerId);
        const receipt = await (await this.inboxService()).markRead(msgId, readerId).catch(() => null);
        if (receipt === null) throw new MessageNotFoundError(`message ${msgId} not found for ${readerId}`);
        // The `message.read` ledger row is written by the service inside the mark's transaction.
        return { readAt: new Date(receipt.readAt).toISOString(), transitioned: receipt.transitioned };
    }

    /** List the pending + delivered messages addressed to an agent. */
    async getInbox(agentId: string, limit?: number, offset?: number): Promise<InboxResult> {
        validateAgentId(agentId);
        const { messages: rows } = await (await this.inboxService()).list(agentId, 'in', {
            ...(limit !== undefined ? { limit } : {}),
        });
        // `offset` is accepted for the existing callers but the plane pages by cursor now (G11 R1);
        // a plain page of `limit` is what every current caller wants.
        void offset;
        return { messages: rows.map(toInboxEntry), count: rows.length };
    }

    /**
     * One inbox row by id, or null when absent (G71 R1). The fleet dispatcher reads
     * THIS row's status to distinguish a `not-started` dispatch (settled `failed` with
     * no run receipt) from one still pending/claimed/running.
     */
    async getMessage(msgId: string): Promise<InboxMessageView | null> {
        const row = await (await this.inboxService()).get(msgId);
        if (row === null) return null;
        return { id: row.id, toId: row.toId, status: row.status, requestKey: row.requestKey };
    }

    /**
     * Drain pending (queued→claimed) messages for an agent (R5, 0253 fix), charging the
     * delivery budget. Unlike {@link getInbox} (non-consuming read), a second call returns
     * nothing — idempotent loop-safe (AC3).
     */
    async drainPending(agentId: string, options?: { limit?: number }): Promise<InboxResult> {
        validateAgentId(agentId);
        const rows = await (await this.inboxService()).claim(agentId, options?.limit ?? 100);
        return { messages: rows.map(toInboxEntry), count: rows.length };
    }

    /**
     * Release claimed messages back to queued for redelivery (0831 R1).
     * Only rows currently claimed match the guard, so settling a message
     * twice is a no-op; `attempts` is left untouched — the claim counter
     * IS the bounded attempt budget (0831 R3). Returns the released count.
     */
    async releasePending(msgIds: string[]): Promise<number> {
        if (msgIds.length === 0) return 0;
        return (await (await this.inboxService()).release(msgIds)).length;
    }

    /**
     * Settle claimed messages as delivered — the invocation was ACCEPTED (0831 R2).
     * Delivery state stays separate from run outcome: an accepted invocation
     * settles `delivered` regardless of the exit code (0831 Q&A).
     */
    async settleDelivered(msgIds: string[]): Promise<void> {
        if (msgIds.length === 0) return;
        await (await this.inboxService()).settle(msgIds, 'accepted');
    }

    /**
     * Settle claimed messages as failed — delivery cannot be completed (0831 R3).
     * Reserved for budget exhaustion and unrecoverable delivery; a failing RUN
     * is never a message failure (0831 R2, task 0833 owns run receipts).
     */
    async settleFailed(msgIds: string[], error: string): Promise<void> {
        if (msgIds.length === 0) return;
        await (await this.inboxService()).settle(msgIds, 'not-started', error);
    }

    /** Count pending (queued) messages for an agent — used by the drain loop to idle (0253). */
    async countPending(agentId: string): Promise<number> {
        validateAgentId(agentId);
        return (await this.inboxService()).countQueued(agentId);
    }

    /**
     * Thread a reply to an existing message: the reply is addressed to its original sender
     * and inherits the thread root (G11 R5). Every address is replyable, including
     * `operator` and `spur`.
     */
    async replyToMessage(msgId: string, body: string): Promise<SendResult> {
        const service = await this.inboxService();
        const original = await service.get(msgId);
        if (original === null) throw new Error(`No message found with id "${msgId}"`);

        // Reply as the original recipient: that is the peer the sender is talking to.
        const reply = await service.reply(msgId, original.toId, body);
        return { msgId: reply.id, toId: reply.toId, status: reply.status, injected: false };
    }

    // -------------------------------------------------------------------------
    // Team status & assignment
    // -------------------------------------------------------------------------

    /**
     * Assign a task to an agent by setting `assignee:` in the task file's YAML
     * frontmatter. The task id is matched against `<folder>/<id>_*.md` across all
     * registered task folders (phase folders).
     */
    async assignTask(taskId: string, agentId: string): Promise<void> {
        validateAgentId(agentId);
        // 1078 R2: the corpus write goes through TaskService, so the task file has exactly one
        // writer. This service keeps the validated caller, the spec lookup and the event.
        const tasks = this.ctx.tasks;
        if (tasks === undefined) {
            throw new Error(
                'assignTask requires the TaskService seam (1078 R2) — wire `tasks` on the coordination context',
            );
        }
        await tasks.assign(taskId, agentId);

        // Task assignment event (task 0371 R1/R2; renamed by 0860 R2 — the subject
        // is the task). Spec lookup is best-effort: an unknown member still emits
        // with a null agentType (R5 / R17).
        const agentType = await this.resolveAgentType(agentId);
        this.emitTaskAssignedEvent({
            memberId: agentId,
            agentType,
            outcome: 'assigned',
            taskId,
        });
    }

    // -------------------------------------------------------------------------
    // Agent spec management
    // -------------------------------------------------------------------------

    /**
     * Create and persist an agent spec at `.spur/agents/<id>.yaml`. Rejects ids
     * that already have a spec to avoid silent overwrites.
     */
    async createAgentSpec(input: AgentSpecInput): Promise<AgentSpec> {
        validateAgentId(input.id);
        const fleet = new FleetService({
            fs: this.ctx.fs,
            ...(this.ctx.reloadAgentConfig !== undefined ? { reloadAgentConfig: this.ctx.reloadAgentConfig } : {}),
            ...(this.ctx.spurConfig !== undefined ? { spurConfig: this.ctx.spurConfig } : {}),
            openDb: this.ctx.getDb,
        });
        if ((await fleet.load(this.ctx.cwd)) !== null || input.tags?.some((tag) => tag.startsWith('fleet:'))) {
            await fleet.assertLaunchGroundTruth(input.workspace ?? this.ctx.cwd);
        }
        const existing = (await loadAgentSpecs(this.configDir)).find((spec) => spec.id === input.id);
        if (existing !== undefined) {
            throw new Error(`Agent spec already exists: ${input.id}`);
        }
        const spec: AgentSpec = {
            id: input.id,
            name: input.name ?? input.id,
            type: input.type,
            ...(input.executor !== undefined ? { executor: input.executor } : {}),
            workspace: input.workspace ?? this.ctx.cwd,
            // ts-ai-runner requires a non-empty purpose to round-trip a spec, so
            // fall back to a type-derived default rather than writing an unloadable file.
            purpose: input.purpose && input.purpose.length > 0 ? input.purpose : `${input.type} agent`,
            tags: input.tags ?? [],
            config: input.config ?? {},
            ...(input.autoStart !== undefined ? { autoStart: input.autoStart } : {}),
        };
        await saveAgentSpec(spec, this.configDir);
        return spec;
    }

    /**
     * List the project's addressable agent specs: hand-authored specs under
     * `.spur/agents/` plus the declared `agent.fleet` members (G72 R2). A stale
     * fleet-generated file left on disk is ignored and the declaration wins an id
     * clash, so generated state can never shadow the config.
     */
    async listAgentSpecs(): Promise<AgentSpec[]> {
        const disk = await loadAgentSpecs(this.configDir);
        const { specs, shadowed } = mergeAgentSpecs(disk, await this.fleetService().specs(this.ctx.cwd));
        for (const id of shadowed) {
            this.ctx.output?.error(`agent spec "${id}" under .spur/agents/ is shadowed by the agent.fleet declaration`);
        }
        // G11 R5: `operator` and `spur` are reserved identities. A spec claiming one would
        // shadow a real inbox, so it is reported and dropped from the addressable set.
        const addressable = specs.filter((spec) => {
            if (!isReservedInboxId(spec.id)) return true;
            this.ctx.output?.error(`agent spec "${spec.id}" uses a reserved inbox identity and is ignored`);
            return false;
        });
        return addressable;
    }

    /**
     * The project's declared fleet members (G72 R1) — the roster role/executor
     * addressing resolves over, so a stale spec file is never addressable.
     */
    async listFleetMembers(): Promise<ResolvedFleetMember[]> {
        return (await this.fleetService().resolve(this.ctx.cwd)).members;
    }

    /**
     * Record a fleet member's reported lifecycle state (G73 R1/R2, task 1080).
     *
     * Thin by design: the monotonic guard and the ledger write both live in the
     * domain (`recordLifecycle`), so the CLI verb, the host hooks and any future
     * caller share one definition of "stale". An accepted report writes the
     * cataloged `agent.lifecycle.changed` row — that row IS the emitted event
     * (ADR-066 presenter renders it) and the state the strategy reads back, so
     * there is no second state store and no duplicate bus write.
     */
    async reportLifecycle(specId: string, state: MemberLifecycleState, seq: number): Promise<RecordLifecycleResult> {
        return recordLifecycle(await this.ctx.getDb(), specId, { state, seq });
    }

    /** Build the identity preamble for an agent + its workspace peers. */
    async buildIdentity(spec: AgentSpec, taskId?: string, taskTitle?: string): Promise<string> {
        const peers = (await loadAgentSpecs(this.configDir))
            .filter((peer) => peer.workspace === spec.workspace && peer.id !== spec.id)
            .map((peer) => ({ id: peer.id, type: peer.type, purpose: peer.purpose }));
        return buildIdentityPreamble({
            agentId: spec.id,
            agentType: spec.type,
            workspace: spec.workspace,
            purpose: spec.purpose,
            ...(taskId !== undefined ? { taskId } : {}),
            ...(taskTitle !== undefined ? { taskTitle } : {}),
            peers,
        });
    }

    /** FleetService over this service's context slice (G72 R1/R2). */
    private fleetService(): FleetService {
        return new FleetService({
            fs: this.ctx.fs,
            ...(this.ctx.spurConfig !== undefined ? { spurConfig: this.ctx.spurConfig } : {}),
            ...(this.ctx.reloadAgentConfig !== undefined ? { reloadAgentConfig: this.ctx.reloadAgentConfig } : {}),
            ...(this.ctx.roles !== undefined ? { roles: this.ctx.roles } : {}),
            openDb: () => this.ctx.getDb(),
        });
    }

    private async inboxService(): Promise<InboxService> {
        return new InboxService({ getDb: () => this.ctx.getDb() });
    }

    /**
     * Publish the `task.assigned` event when a bus is wired. Payload fields may be
     * null (unknown spec) — the event is never dropped (R5).
     */
    private emitTaskAssignedEvent(payload: TaskAssignedEventPayload): void {
        const bus = this.ctx.eventBus;
        if (!bus) return;
        try {
            bus.emit('task.assigned', { ...payload, severity: 'info' });
        } catch {
            // Swallow — event is observable metadata only.
        }
    }

    /**
     * Best-effort spec join for an agent id — the agent type off the spec.
     * A missing spec yields null — never throws (R5 / R17).
     */
    private async resolveAgentType(agentId: string): Promise<string | null> {
        try {
            const specs = await loadAgentSpecs(this.configDir);
            const spec = specs.find((s) => s.id === agentId);
            if (!spec) return null;
            return typeof spec.type === 'string' && spec.type.length > 0 ? spec.type : null;
        } catch {
            return null;
        }
    }
}
