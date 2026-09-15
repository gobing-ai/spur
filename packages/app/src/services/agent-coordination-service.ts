import { join } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import {
    atomicWriteAsync,
    type DbAdapter,
    InboxMessageDao,
    InboxRecentDao,
    MarkdownDocument,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import {
    type AgentEvents,
    type AgentSpec,
    buildIdentityPreamble,
    loadAgentSpecs,
    saveAgentSpec,
    TeamOrchestrator,
    validateAgentId,
} from '@gobing-ai/ts-ai-runner';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { resolvePlanningFolders } from '../config/planning-folders';
import type { AgentRoleDefinition } from './agent-service';
import { FleetService } from './fleet-service';
import { TaskLocator } from './task-locator';

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
     * TeamOrchestrator runs without publishing — the server injects its bus
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
 * Metadata-only payload for `message.sent|replied` events. The body is NEVER
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
    Record<'message.sent' | 'message.replied', (event: MessageEventPayload) => void>
>;

/** Bus shape consumed by AgentCoordinationService — message + assignment event names. */
export type CoordinationEventBus = EventBus<{
    'message.sent': (event: MessageEventPayload) => void;
    'message.replied': (event: MessageEventPayload) => void;
    'task.assigned': (event: TaskAssignedEventPayload) => void;
}>;

/** Result of enqueuing or threading a message. */
export interface SendResult {
    msgId: string;
    toId: string;
    status: 'queued' | 'injected';
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
}

/** Result of listing an agent's inbox. */
export interface InboxResult {
    messages: InboxEntry[];
    count: number;
}

/**
 * Resolved identity for a message endpoint (from/to). `agentId` is the raw
 * composed agent id; the remaining fields are best-effort joins
 * from the team roster. All identity fields are optional — when unresolved
 * (untethered agent, operator-originated, or stale row) the UI falls back to
 * the raw id (R8/R11).
 */
export interface MessageEndpointIdentity {
    agentId: string;
    memberLabel?: string;
    agentType?: string;
}

/**
 * A recent-message row with recipient + identity + reply signals for the
 * board's global message feed (R8/R11). Parents come from the `limit` window;
 * `replyCount` counts **all** children of those parents in `inbox_messages`
 * (not only children that also fall inside the window).
 */
export interface RecentMessageRow extends InboxEntry {
    toId: string;
    from?: MessageEndpointIdentity;
    to: MessageEndpointIdentity;
    hasReply: boolean;
    replyCount: number;
}

/** Result of listing recent messages across all agents. */
export interface RecentMessagesResult {
    messages: RecentMessageRow[];
    count: number;
}

/** A single agent's status for team listing. */
export interface TeamStatusEntry {
    id: string;
    name: string;
    type: string;
    /**
     * Declared Layer-1 role read off the materialized spec (`config.role`,
     * 0544 R1). Undefined = unset — never inferred from the executor's tier.
     */
    role?: string;
    /** Executor name the spec is bound to (0537 R1; resolved for role-only members, 0543 R1). */
    executor?: string;
    workspace?: string;
    purpose?: string;
    status: 'running' | 'stopped' | 'errored' | 'unknown';
    pid?: number;
}

/** Result of listing all team agents with status. */
export interface TeamStatusResult {
    agents: TeamStatusEntry[];
}

// ---------------------------------------------------------------------------
// AgentCoordinationService
// ---------------------------------------------------------------------------

/** Input shape for creating an agent spec. */
export interface AgentSpecInput {
    id: string;
    name?: string;
    type: string;
    workspace?: string;
    purpose?: string;
    tags?: string[];
    config?: Record<string, unknown>;
    autoStart?: boolean;
}

/**
 * Application-layer coordination for `spur message`, `spur task update --assignee`, and
 * fleet-aware `spur agent` commands. Wraps `TeamOrchestrator` from `@gobing-ai/ts-ai-runner`
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
    private orchestratorPromise?: Promise<TeamOrchestrator>;

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
    ): Promise<SendResult> {
        validateAgentId(toId);
        if (fromId !== null) validateAgentId(fromId);
        if (requestKey !== undefined && requestKey.trim() === '') {
            throw new Error('requestKey must be a non-empty string');
        }
        const dao = await this.inboxDao();
        // Keyed send (0832): routes through `enqueueIdempotent` — same key + same payload
        // replays the original row (no second row, no second delivery). Keyless path unchanged.
        const keyed =
            requestKey !== undefined ? await dao.enqueueIdempotent(fromId, toId, body, requestKey, replyTo) : null;
        const msgId = keyed?.id ?? (await dao.enqueue(fromId, toId, body, replyTo));
        // Emit a single lifecycle event: `message.replied` when this send is a reply
        // (thread context), otherwise `message.sent`. Metadata only — never the body.
        await this.emitMessageEvent(replyTo !== undefined ? 'message.replied' : 'message.sent', {
            msgId,
            fromId,
            toId,
            threadId: replyTo ?? null,
            createdAt: new Date().toISOString(),
        });
        return keyed === null
            ? { msgId, toId, status: 'queued', injected: false }
            : { msgId, toId, status: 'queued', injected: false, replayed: keyed.replayed, requestKey };
    }

    /** List the pending + delivered messages addressed to an agent. */
    async getInbox(agentId: string, limit?: number, offset?: number): Promise<InboxResult> {
        validateAgentId(agentId);
        const dao = await this.inboxDao();
        const rows = await dao.inbox(agentId, limit, offset);
        return {
            messages: rows.map((row) => ({
                id: row.id,
                fromId: row.fromId,
                body: row.body,
                status: row.status,
                createdAt: new Date(row.createdAt).toISOString(),
                inReplyTo: row.inReplyTo,
                injectAttempts: row.injectAttempts,
                injectError: row.injectError,
            })),
            count: rows.length,
        };
    }

    /**
     * Atomically drain pending (queued→injected) messages for an agent (R5, 0253 fix).
     * Unlike {@link getInbox} (non-consuming read), this transitions messages to
     * `injected` so a second call returns nothing — idempotent loop-safe (AC3).
     */
    async drainPending(agentId: string): Promise<InboxResult> {
        validateAgentId(agentId);
        const dao = await this.inboxDao();
        const rows = await dao.drainPending(agentId);
        return {
            messages: rows.map((row) => ({
                id: row.id,
                fromId: row.fromId,
                body: row.body,
                status: row.status,
                createdAt: new Date(row.createdAt).toISOString(),
                inReplyTo: row.inReplyTo,
            })),
            count: rows.length,
        };
    }

    /**
     * Release claimed (injected) messages back to queued for redelivery (0831 R1).
     * Only rows currently at `injected` match the guard, so settling a message
     * twice is a no-op; `injectAttempts` is left untouched — the claim counter
     * IS the bounded attempt budget (0831 R3). Returns the released count.
     */
    async releasePending(msgIds: string[]): Promise<number> {
        if (msgIds.length === 0) return 0;
        const dao = await this.inboxDao();
        return dao.release(msgIds);
    }

    /**
     * Settle claimed messages as delivered — the invocation was ACCEPTED (0831 R2).
     * Delivery state stays separate from run outcome: an accepted invocation
     * settles `delivered` regardless of the exit code (0831 Q&A).
     */
    async settleDelivered(msgIds: string[]): Promise<void> {
        if (msgIds.length === 0) return;
        const dao = await this.inboxDao();
        for (const msgId of msgIds) await dao.markDelivered(msgId);
    }

    /**
     * Settle claimed messages as failed — delivery cannot be completed (0831 R3).
     * Reserved for budget exhaustion and unrecoverable delivery; a failing RUN
     * is never a message failure (0831 R2, task 0833 owns run receipts).
     */
    async settleFailed(msgIds: string[], error: string): Promise<void> {
        if (msgIds.length === 0) return;
        const dao = await this.inboxDao();
        for (const msgId of msgIds) await dao.markFailed(msgId, error);
    }

    /** Count pending (queued) messages for an agent — used by the drain loop to idle (0253). */
    async countPending(agentId: string): Promise<number> {
        validateAgentId(agentId);
        const dao = await this.inboxDao();
        return dao.countPending(agentId);
    }

    /**
     * List recent messages across ALL agents (newest first), for the board's
     * global message feed. Differs from {@link getInbox} (one agent's queue) by
     * spanning every recipient. Delegates to {@link InboxRecentDao} (domain) so
     * this package stays raw-SQL-free (project rule `raw-sql-only-in-domain`).
     * Returns an empty list when the table is absent.
     *
     * Identity join (R11): `fromId`/`toId` are composed ids. We resolve them
     * against the agent specs on disk — `team:<id>` tag (when tethered), spec
     * name as the member label, spec type as the agent type. Unresolved ids
     * (operator-originated, stale) leave the identity optional fields unset —
     * the UI falls back to the raw id. (0857: the team roster config block is gone,
     * so the team *display name* is no longer resolved; the tag id stands.)
     *
     * Reply signals (R11): parent rows are the newest `limit` messages;
     * `countReplies` then counts **all** children of those parent ids in the
     * table (global for those parents, not limited to children in the window).
     */
    async listRecent(limit = 50): Promise<RecentMessagesResult> {
        const dao = await this.inboxRecentDao();
        const rows = await dao.listRecent(limit);
        if (rows.length === 0) {
            return { messages: [], count: 0 };
        }

        // Build the identity index once: agentId → { memberLabel, agentType }.
        const specs = await this.listAgentSpecs();
        const identityById = new Map<string, MessageEndpointIdentity>();
        for (const spec of specs) {
            identityById.set(spec.id, {
                agentId: spec.id,
                memberLabel: spec.name,
                agentType: spec.type,
            });
        }

        // Reply counts: global child count for each parent id in the current window.
        const replyCounts = await dao.countReplies(rows.map((r) => r.id));

        const resolveEndpoint = (agentId: string): MessageEndpointIdentity => identityById.get(agentId) ?? { agentId };

        return {
            messages: rows.map((row) => {
                const replyCount = replyCounts.get(row.id) ?? 0;
                return {
                    id: row.id,
                    fromId: row.from_id,
                    toId: row.to_id,
                    body: row.body,
                    status: row.status,
                    createdAt: new Date(row.created_at).toISOString(),
                    inReplyTo: row.in_reply_to,
                    ...(row.from_id !== null ? { from: resolveEndpoint(row.from_id) } : {}),
                    to: resolveEndpoint(row.to_id),
                    hasReply: replyCount > 0,
                    replyCount,
                };
            }),
            count: rows.length,
        };
    }

    /**
     * Thread a reply to an existing message: look up the original, address the
     * reply back to its sender, and link it via `in_reply_to`. Operator-originated
     * messages (`from_id` null) cannot be replied to — there is no addressable peer.
     */
    async replyToMessage(msgId: string, body: string): Promise<SendResult> {
        const dao = await this.inboxDao();
        const original = await dao.getById(msgId);
        if (original === undefined) {
            throw new Error(`No message found with id "${msgId}"`);
        }
        if (original.fromId === null) {
            throw new Error(`Message "${msgId}" has no sender to reply to (operator-originated)`);
        }
        return this.sendMessage(original.toId, original.fromId, body, msgId);
    }

    // -------------------------------------------------------------------------
    // Team status & assignment
    // -------------------------------------------------------------------------

    /**
     * List every agent spec under `.spur/agents/` with its current process state.
     * In Phase 1-3 (no daemon) every agent reports `stopped`; once the orchestrator
     * holds live processes, real status is returned.
     */
    async getStatus(): Promise<TeamStatusResult> {
        const orchestrator = await this.orchestrator();
        const specs = await orchestrator.loadSpecs();
        const running = orchestrator.getRunningAgents();
        const agents = await Promise.all(
            specs.map(async (spec) => {
                const status = await orchestrator.getAgentStatus(spec.id);
                const pid = running.get(spec.id)?.getPid() ?? null;
                return {
                    id: spec.id,
                    name: spec.name,
                    type: spec.type,
                    workspace: spec.workspace,
                    purpose: spec.purpose,
                    status,
                    // 0544 R1: role + resolved executor surface wherever the
                    // roster shows (unset = field absent, never inferred).
                    ...(typeof spec.config?.role === 'string' && spec.config.role.length > 0
                        ? { role: spec.config.role }
                        : {}),
                    ...(spec.executor !== undefined ? { executor: spec.executor } : {}),
                    ...(pid !== null ? { pid } : {}),
                };
            }),
        );
        return { agents };
    }

    /**
     * Assign a task to an agent by setting `assignee:` in the task file's YAML
     * frontmatter. The task id is matched against `<folder>/<id>_*.md` across all
     * registered task folders (phase folders).
     */
    async assignTask(taskId: string, agentId: string): Promise<void> {
        validateAgentId(agentId);
        const path = await this.resolveTaskFile(taskId);
        if (path === null) {
            throw new Error(`No task file found for id "${taskId}" in any registered task folder`);
        }
        const fs = this.ctx.fs;
        const source = await fs.readFile(path);
        const doc = MarkdownDocument.parse(source, 'task');
        doc.setFrontmatterField('assignee', agentId);
        // Atomic temp+rename: a raw writeFile can leave a torn SSOT task file on crash.
        await atomicWriteAsync(path, doc.serialize(), taskId, fs);

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

    /** List the agent specs currently defined under `.spur/agents/`. */
    async listAgentSpecs(): Promise<AgentSpec[]> {
        return loadAgentSpecs(this.configDir);
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

    private async inboxDao(): Promise<InboxMessageDao> {
        const db = await this.ctx.getDb();
        return new InboxMessageDao(db);
    }

    /**
     * Publish through the attached bus, or persist the wake directly for CLI
     * senders. The inbox row is already durable; an event failure cannot undo it.
     */
    private async emitMessageEvent(
        name: 'message.sent' | 'message.replied',
        payload: MessageEventPayload,
    ): Promise<void> {
        const bus = this.ctx.eventBus;
        try {
            if (bus) {
                bus.emit(name, { ...payload, severity: 'info' });
            } else {
                await new SystemEventDao(await this.ctx.getDb()).insert({
                    id: crypto.randomUUID(),
                    event_name: name,
                    occurred_at: payload.createdAt,
                    actor: payload.fromId ?? 'operator',
                    payload_json: JSON.stringify(payload),
                });
            }
        } catch (error) {
            this.ctx.output?.error(
                `Message stored, but wake event failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
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

    private async inboxRecentDao(): Promise<InboxRecentDao> {
        const db = await this.ctx.getDb();
        return new InboxRecentDao(db);
    }

    private orchestrator(): Promise<TeamOrchestrator> {
        this.orchestratorPromise ??= this.inboxDao().then((dao) => {
            const orch = new TeamOrchestrator(this.configDir, dao, { events: this.ctx.events });
            // 0860 R2: the retired member-scoped lifecycle bridge is gone — the
            // orchestrator's own `agent.started|stopped` events are the cataloged
            // lifecycle fact, and SupervisorService emits them on the serve path.
            // Nothing re-publishes agent lifecycle under a second name.
            return orch;
        });
        return this.orchestratorPromise;
    }

    private async resolveTaskFile(taskId: string): Promise<string | null> {
        const fs = this.ctx.fs;
        // Scan every registered task folder (phase folders), not a hardcoded one —
        // the corpus may span docs/tasks + docs/tasks2 + … (rd3:tasks heritage).
        // Folders resolve against the invocation `cwd` here (as the rest of this
        // service does), not the fs project root — hence `forDirs` rather than
        // handing the raw config to TaskLocator.
        const { foldersConfig } = await resolvePlanningFolders(fs);
        const dirs = [...new Set([foldersConfig.active_folder, ...Object.keys(foldersConfig.folders)])].map((dir) =>
            join(this.ctx.cwd, dir),
        );
        return await TaskLocator.forDirs(fs, dirs).findPathByWbs(taskId);
    }
}
