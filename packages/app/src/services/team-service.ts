import { join, resolve } from 'node:path';
import {
    memberLocalId,
    type NormalizedTeamMember,
    normalizeMember,
    type ResolvedExecutor,
    resolveExecutor,
    type SpurConfig,
} from '@gobing-ai/spur-config';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import {
    atomicWriteAsync,
    type DbAdapter,
    InboxMessageDao,
    InboxRecentDao,
    MarkdownDocument,
} from '@gobing-ai/spur-domain';
import {
    type AgentEvents,
    type AgentSpec,
    buildIdentityPreamble,
    deleteAgentSpec as deleteAgentSpecFile,
    loadAgentSpecs,
    saveAgentSpec,
    TeamOrchestrator,
    validateAgentId,
} from '@gobing-ai/ts-ai-runner';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { resolvePlanningFolders } from '../config/planning-folders';
import { type AgentRoleDefinition, cheapestEligibleExecutors } from './agent-service';
import { TaskLocator } from './task-locator';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Output sink injected into TeamService. */
export interface TeamServiceOutput {
    write(message: string): void;
    error(message: string): void;
}

/** Context injected into TeamService. */
export interface TeamServiceContext {
    cwd: string;
    env: Record<string, string | undefined>;
    /** Optional output sink; TeamService does not read it (kept for CLI stdout coupling). */
    output?: TeamServiceOutput;
    getDb(): Promise<DbAdapter>;
    /** Filesystem port for reading/writing task files. */
    fs: FileSystem;
    /**
     * Optional EventBus for message lifecycle events (`message.sent|replied`)
     * and team lifecycle events (`team.up|down`, `team.member.*`). When absent
     * (CLI default without a ledger attach), those operations still succeed —
     * they just don't publish. The server injects its bus so the tap persists
     * and SSE streams the events; CLI `team up|down|assign` attaches a local
     * bus + ledger (task 0371 R6).
     */
    eventBus?: TeamServiceEventBus;
    /**
     * Optional EventBus for agent lifecycle events (`agent.started`,
     * `agent.stopped`, `agent.invoke.*`, `agent.message.sent`). When absent,
     * TeamOrchestrator runs without publishing — the server injects its bus
     * so the system_events tap persists and SSE streams agent lifecycle.
     * TeamService also bridges `agent.started|stopped` → `team.member.*` on
     * {@link eventBus} when both are present (task 0371 R2).
     */
    events?: EventBus<AgentEvents>;
    /**
     * Layer-1 role → tier map resolved at the CLI boundary (0543 R1) from the
     * `DEFAULT_AGENT_ROLES` SSOT (0572 / ADR-061) — the same map AgentService
     * receives, so a role-only team member resolves through the SAME ladder as
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
 * Metadata-only payload for team lifecycle events (`team.up` / `team.down`).
 * Carries the team id and resulting member set size (J3 R15); never command
 * lines or message bodies (task 0371 R3).
 */
export interface TeamLifecycleEventPayload {
    teamId: string;
    /** Count of members after the operation (upserted for up; stopped for down). */
    memberCount: number;
    /** Operation outcome label (`ok`, `check`, `purged`, …). */
    outcome: string;
    /** Producer-owned observability severity. */
    severity?: 'info' | 'warning' | 'error';
}

/**
 * Metadata-only payload for member-scoped team events
 * (`team.member.assigned|started|stopped`). Unresolved roster fields stay
 * null rather than dropping the event (task 0371 R5 / J3 R17).
 */
export interface TeamMemberEventPayload {
    teamId: string | null;
    memberId: string | null;
    agentType: string | null;
    /** Operation outcome label (`ok`, `assigned`, `started`, `stopped`, …). */
    outcome: string;
    /** Optional task id for assignment events. */
    taskId?: string | null;
    /** Producer-owned observability severity. */
    severity?: 'info' | 'warning' | 'error';
}

/** Bus shape for message lifecycle events (legacy alias of {@link TeamServiceEventBus}). */
export type MessageEventBus = EventBus<
    Record<'message.sent' | 'message.replied', (event: MessageEventPayload) => void>
>;

/** Bus shape consumed by TeamService — message + team lifecycle event names. */
export type TeamServiceEventBus = EventBus<{
    'message.sent': (event: MessageEventPayload) => void;
    'message.replied': (event: MessageEventPayload) => void;
    'team.up': (event: TeamLifecycleEventPayload) => void;
    'team.down': (event: TeamLifecycleEventPayload) => void;
    'team.member.assigned': (event: TeamMemberEventPayload) => void;
    'team.member.started': (event: TeamMemberEventPayload) => void;
    'team.member.stopped': (event: TeamMemberEventPayload) => void;
}>;

/** Result of enqueuing or threading a message. */
export interface SendResult {
    msgId: string;
    toId: string;
    status: 'queued' | 'injected';
    injected: boolean;
}

/** A single inbox row in display form. */
export interface InboxEntry {
    id: string;
    fromId: string | null;
    body: string;
    status: string;
    createdAt: string;
    inReplyTo: string | null;
}

/** Result of listing an agent's inbox. */
export interface InboxResult {
    messages: InboxEntry[];
    count: number;
}

/**
 * Resolved identity for a message endpoint (from/to). `agentId` is the raw
 * `teamId-memberId` composed id; the remaining fields are best-effort joins
 * from the team roster. All identity fields are optional — when unresolved
 * (untethered agent, operator-originated, or stale row) the UI falls back to
 * the raw id (R8/R11).
 */
export interface MessageEndpointIdentity {
    agentId: string;
    teamId?: string;
    teamName?: string;
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

/** A team listing entry (R1). */
export interface TeamListing {
    teamId: string;
    name: string;
    members: NormalizedTeamMember[];
    specs: AgentSpec[];
    /**
     * Resolved absolute path of the team's configured `work_dir` (R4).
     *
     * Configured teams use `agent.team.<id>.work_dir` (resolved relative to the
     * service cwd). Orphaned/untethered groups use a common spec workspace only
     * when all member specs agree, otherwise this is `null`.
     */
    workDir: string | null;
    /** True when {@link workDir} equals the service cwd — the current project (R4). */
    isCurrentProject: boolean;
}

/** Result of materializing a team (R2). */
export interface MaterializeResult {
    teamId: string;
    upserted: string[];
    orphaned: string[];
    written: boolean;
}

/** Result of tearing down a team (R3). */
export interface TeardownResult {
    teamId: string;
    purged: string[];
    stopped: string[];
}

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

// ---------------------------------------------------------------------------
// TeamService
// ---------------------------------------------------------------------------

/**
 * Application-layer orchestration for `spur message`, `spur team`, and team-aware
 * `spur agent` commands. Wraps `TeamOrchestrator` from `@gobing-ai/ts-ai-runner`
 * over the CLI's SQLite adapter. Agent specs are read from and written to
 * `.spur/agents/` via the package's spec helpers.
 *
 * The constructor is synchronous and cheap; the DB-backed dependencies are built
 * lazily on first use so that purely spec-oriented operations (`createAgentSpec`,
 * `deleteAgentSpec`) never open a database.
 */
export class TeamService {
    private readonly ctx: TeamServiceContext;
    private readonly configDir: string;
    private orchestratorPromise?: Promise<TeamOrchestrator>;

    constructor(ctx: TeamServiceContext) {
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
    async sendMessage(fromId: string | null, toId: string, body: string, replyTo?: string): Promise<SendResult> {
        validateAgentId(toId);
        if (fromId !== null) validateAgentId(fromId);
        const dao = await this.inboxDao();
        const msgId = await dao.enqueue(fromId, toId, body, replyTo);
        // Emit a single lifecycle event: `message.replied` when this send is a reply
        // (thread context), otherwise `message.sent`. Metadata only — never the body.
        this.emitMessageEvent(replyTo !== undefined ? 'message.replied' : 'message.sent', {
            msgId,
            fromId,
            toId,
            threadId: replyTo ?? null,
            createdAt: new Date().toISOString(),
        });
        return { msgId, toId, status: 'queued', injected: false };
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
     * Identity join (R11): `fromId`/`toId` are `teamId-memberId` composed ids.
     * We resolve them against `listTeams()` + `listAgentSpecs()` for team name,
     * member label (spec.name), and agent type (spec.type). Unresolved ids
     * (untethered, operator-originated, stale) leave the identity optional
     * fields unset — the UI falls back to the raw id.
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

        // Build the identity index once: agentId → { teamId, teamName, memberLabel, agentType }.
        const [teams, specs] = await Promise.all([this.listTeams(), this.listAgentSpecs()]);
        const identityById = new Map<string, MessageEndpointIdentity>();
        for (const team of teams) {
            for (const spec of team.specs) {
                identityById.set(spec.id, {
                    agentId: spec.id,
                    teamId: team.teamId,
                    teamName: team.name,
                    memberLabel: spec.name,
                    agentType: spec.type,
                });
            }
        }
        // Untethered specs (no team tag) — still resolvable to agentType/memberLabel.
        for (const spec of specs) {
            if (!identityById.has(spec.id)) {
                identityById.set(spec.id, {
                    agentId: spec.id,
                    memberLabel: spec.name,
                    agentType: spec.type,
                });
            }
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

        // Member assignment event (task 0371 R1/R2). Roster lookup is best-effort:
        // an unknown member still emits with null unresolved fields (R5 / R17).
        const identity = await this.resolveMemberIdentity(agentId);
        this.emitTeamMemberEvent('team.member.assigned', {
            teamId: identity.teamId,
            memberId: agentId,
            agentType: identity.agentType,
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

    /** Remove an agent spec file. */
    async deleteAgentSpec(id: string): Promise<void> {
        validateAgentId(id);
        const existing = (await loadAgentSpecs(this.configDir)).find((spec) => spec.id === id);
        if (existing === undefined) {
            throw new Error(`No agent spec found: ${id}`);
        }
        await deleteAgentSpecFile(id, this.configDir);
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

    // -------------------------------------------------------------------------
    // Team management (0258)
    // -------------------------------------------------------------------------

    /**
     * List all teams: groups agent specs by their `team:<id>` tag, cross-referenced
     * with the `agent.team` config block. Untethered specs (no team tag) are grouped
     * separately (R1).
     */
    async listTeams(): Promise<TeamListing[]> {
        const specs = await loadAgentSpecs(this.configDir);
        const config = await this.loadTeamConfig();
        const teams = new Map<string, TeamListing>();
        const configTeamIds = new Set<string>();

        // Initialize from config — configured teams carry their resolved work_dir.
        if (config?.agent?.team) {
            for (const [teamId, teamConfig] of Object.entries(config.agent.team)) {
                configTeamIds.add(teamId);
                const workDir = this.resolveWorkspaceDir(teamConfig.work_dir);
                teams.set(teamId, {
                    teamId,
                    name: teamConfig.name,
                    members: [],
                    specs: [],
                    workDir,
                    isCurrentProject: this.isCurrentProject(workDir),
                });
            }
        }

        // Group specs by team tag; collect specs with no team tag for the untethered group.
        const untethered: AgentSpec[] = [];
        for (const spec of specs) {
            const teamTag = spec.tags?.find((t) => t.startsWith('team:'));
            if (teamTag) {
                const teamId = teamTag.slice('team:'.length);
                const entry = teams.get(teamId);
                if (entry) {
                    entry.specs.push(spec);
                } else {
                    // Team exists in specs but not in config (orphaned generated spec)
                    teams.set(teamId, {
                        teamId,
                        name: teamId,
                        members: [],
                        specs: [spec],
                        workDir: null,
                        isCurrentProject: false,
                    });
                }
            } else {
                untethered.push(spec);
            }
        }

        // Surface specs with no `team:<id>` tag under a synthetic `__untethered__` group (0256 R2).
        if (untethered.length > 0) {
            teams.set('__untethered__', {
                teamId: '__untethered__',
                name: 'Untethered',
                members: [],
                specs: untethered,
                workDir: null,
                isCurrentProject: false,
            });
        }

        // Orphaned/untethered groups (not config-declared): use a common spec
        // workspace only when every member spec agrees; otherwise stay unselectable
        // (workDir null, isCurrentProject false) — R4.
        for (const team of Array.from(teams.values())) {
            if (configTeamIds.has(team.teamId)) continue;
            const common = this.commonWorkspace(team.specs);
            team.workDir = common.workDir;
            team.isCurrentProject = common.isCurrentProject;
        }

        return Array.from(teams.values());
    }

    /**
     * Materialize a team: upsert one `spur:generated`-tagged spec per member,
     * prune orphaned generated specs, skip `ref:` aliases (R2). When `check` is
     * true, returns the diff and writes nothing (dry-run).
     */
    async materializeTeam(teamId: string, opts?: { check?: boolean }): Promise<MaterializeResult> {
        const config = await this.loadTeamConfig();
        const teamConfig = config?.agent?.team?.[teamId];
        if (!teamConfig) {
            throw new Error(`Team "${teamId}" not found in agent.team config`);
        }

        const agentConfig = config?.agent;
        const specs = await loadAgentSpecs(this.configDir);
        const existingTeamSpecs = specs.filter(
            (s) => s.tags?.includes(`team:${teamId}`) && s.tags?.includes('spur:generated'),
        );

        const desiredMembers = teamConfig.members.map((m) => normalizeMember(m));
        const desiredIds = new Set<string>();
        const toUpsert: AgentSpec[] = [];

        for (const [index, member] of desiredMembers.entries()) {
            // 0543 R3: a role-only member derives `<role>-<n>` (frozen index) so
            // the id matches the config-load derivation (memberLocalId).
            const localId = memberLocalId(member, desiredMembers, index);
            const composedId = `${teamId}-${localId}`;
            desiredIds.add(composedId);

            // Skip ref: aliases — they are hand-authored, not generated (R2)
            const existing = specs.find((s) => s.id === composedId);
            if (existing && !existing.tags?.includes('spur:generated')) continue;

            // 0543 R1/R2: an executor pin is authoritative (R2); a role-only
            // member resolves through the shared tier ladder — the SAME funnel
            // `--agent <role>` uses (cheapest eligible executor), never a second
            // selector. The resolved executor name is recorded on the spec so
            // the resolution is inspectable, not implicit (R1).
            let resolved: ResolvedExecutor;
            let executorName: string;
            if (member.executor !== undefined) {
                resolved = resolveExecutor(member.executor, agentConfig);
                executorName = member.executor;
            } else {
                const role = member.role;
                // R4 validation rejects neither-role-nor-executor at config load;
                // this is a defensive loud error for unvalidated callers.
                if (role === undefined) {
                    throw new Error(
                        `Team "${teamId}" member at index ${index} declares neither role nor executor — at least one is required`,
                    );
                }
                const roleTier = this.ctx.roles?.get(role)?.tier;
                if (roleTier === undefined) {
                    throw new Error(
                        `Team "${teamId}" member at index ${index} declares role "${role}" but no Layer-1 role table is available — run spur team up from the CLI (the role table is threaded only at the CLI boundary)`,
                    );
                }
                const eligible = cheapestEligibleExecutors(agentConfig?.executors ?? [], roleTier);
                const winner = eligible[0];
                if (winner === undefined) {
                    throw new Error(
                        `Team "${teamId}" member at index ${index}: no executor configured to serve role "${role}" (tier ${roleTier}) — define executors under agent.executors`,
                    );
                }
                resolved = { agent: winner.agent, model: winner.model };
                executorName = winner.name;
            }
            const spec: AgentSpec = {
                id: composedId,
                name: member.purpose ?? composedId,
                type: resolved.agent,
                // Executor binding (0537 R1): carry the configured executor name
                // beside the coding-agent kind so drain can resolve back through
                // `resolveExecutor`'s executor-first lookup — restoring the
                // operator's model + tier instead of a bare binary on the default
                // model. For a role-only member this is the RESOLVED executor
                // entry (0543 R1). `type` stays: AiRunner resolves the runner
                // from it, and pre-existing specs carry only `type` (drain
                // falls back to it).
                executor: executorName,
                workspace: member.workspace ?? teamConfig.work_dir,
                purpose: member.purpose && member.purpose.length > 0 ? member.purpose : `${resolved.agent} agent`,
                tags: [`team:${teamId}`, 'spur:generated'],
                config: {
                    ...(resolved.model !== undefined ? { model: resolved.model } : {}),
                    // Layer-1 role (0538 R3): carried beside the executor binding so
                    // routing reads it off the spec (0543 R1 — the role and the
                    // resolved executor name are BOTH recorded).
                    ...(member.role !== undefined ? { role: member.role } : {}),
                    ...(member.systemPrompt !== undefined ? { systemPrompt: member.systemPrompt } : {}),
                    ...(member.command !== undefined ? { command: member.command } : {}),
                    ...(member.autonomy !== undefined ? { autonomy: member.autonomy } : {}),
                },
                ...(member.autostart !== undefined ? { autoStart: member.autostart } : {}),
            };
            toUpsert.push(spec);
        }

        // Prune orphaned generated specs (in the team but not in desired set)
        const orphaned = existingTeamSpecs.filter((s) => !desiredIds.has(s.id));

        if (opts?.check) {
            // Dry-run does not transition team state — no lifecycle event (R15).
            return {
                teamId,
                upserted: toUpsert.map((s) => s.id),
                orphaned: orphaned.map((s) => s.id),
                written: false,
            };
        }

        // Write upserts
        for (const spec of toUpsert) {
            await saveAgentSpec(spec, this.configDir);
        }
        // Delete orphans
        for (const spec of orphaned) {
            await deleteAgentSpecFile(spec.id, this.configDir);
        }

        const result: MaterializeResult = {
            teamId,
            upserted: toUpsert.map((s) => s.id),
            orphaned: orphaned.map((s) => s.id),
            written: true,
        };
        // Team up lifecycle (task 0371 R1/R2 / J3 R15): cataloged event with
        // team id + resulting member set size. Metadata only.
        this.emitTeamLifecycleEvent('team.up', {
            teamId,
            memberCount: result.upserted.length,
            outcome: 'ok',
        });
        return result;
    }

    /**
     * Teardown a team: stop members (if supervisor is wired) and optionally purge
     * generated specs (R3). Only `spur:generated` specs are deleted — hand-authored
     * specs are never touched.
     */
    async teardownTeam(teamId: string, opts?: { purge?: boolean }): Promise<TeardownResult> {
        const specs = await loadAgentSpecs(this.configDir);
        const teamSpecs = specs.filter((s) => s.tags?.includes(`team:${teamId}`));
        const generated = teamSpecs.filter((s) => s.tags?.includes('spur:generated'));

        if (opts?.purge) {
            for (const spec of generated) {
                await deleteAgentSpecFile(spec.id, this.configDir);
            }
        }

        const result: TeardownResult = {
            teamId,
            purged: opts?.purge ? generated.map((s) => s.id) : [],
            stopped: teamSpecs.map((s) => s.id),
        };
        // Team down lifecycle (task 0371 R1/R2 / J3 R15).
        this.emitTeamLifecycleEvent('team.down', {
            teamId,
            memberCount: result.stopped.length,
            outcome: opts?.purge ? 'purged' : 'ok',
        });
        return result;
    }

    // -------------------------------------------------------------------------
    // Lazy dependency construction
    // -------------------------------------------------------------------------

    /** Resolve a configured/derived workspace path relative to the service cwd. */
    private resolveWorkspaceDir(p: string): string {
        return resolve(this.ctx.cwd, p);
    }

    /** True when a resolved workspace path equals the service cwd (the current project). */
    private isCurrentProject(workDir: string): boolean {
        return resolve(this.ctx.cwd, workDir) === resolve(this.ctx.cwd, this.ctx.cwd);
    }

    /**
     * Derive the workspace facts for a spec-derived group (orphaned/untethered).
     * Returns a common workspace only when all member specs agree on the same
     * `workspace`; otherwise `workDir = null` and `isCurrentProject = false` (R4).
     */
    private commonWorkspace(specs: AgentSpec[]): { workDir: string | null; isCurrentProject: boolean } {
        if (specs.length === 0) return { workDir: null, isCurrentProject: false };
        const first = specs[0]?.workspace;
        if (typeof first !== 'string' || first.length === 0) return { workDir: null, isCurrentProject: false };
        if (!specs.every((s) => s.workspace === first)) return { workDir: null, isCurrentProject: false };
        const workDir = this.resolveWorkspaceDir(first);
        return { workDir, isCurrentProject: this.isCurrentProject(workDir) };
    }

    private async loadTeamConfig(): Promise<SpurConfig | null> {
        try {
            return await loadSpurConfig(this.ctx.cwd);
        } catch {
            return null;
        }
    }

    private async inboxDao(): Promise<InboxMessageDao> {
        const db = await this.ctx.getDb();
        return new InboxMessageDao(db);
    }

    /**
     * Publish a message lifecycle event when a bus is wired. No-op without one
     * (CLI default). Isolated try/catch so a bus failure never breaks the send —
     * the row is already durable; the event is observable metadata.
     */
    private emitMessageEvent(name: 'message.sent' | 'message.replied', payload: MessageEventPayload): void {
        const bus = this.ctx.eventBus;
        if (!bus) return;
        try {
            bus.emit(name, { ...payload, severity: 'info' });
        } catch {
            // Swallow — see method doc.
        }
    }

    /**
     * Publish a team lifecycle event (`team.up` / `team.down`) when a bus is
     * wired. Same failure isolation as {@link emitMessageEvent} (task 0371).
     */
    private emitTeamLifecycleEvent(name: 'team.up' | 'team.down', payload: TeamLifecycleEventPayload): void {
        const bus = this.ctx.eventBus;
        if (!bus) return;
        try {
            bus.emit(name, { ...payload, severity: 'info' });
        } catch {
            // Swallow — event is observable metadata only.
        }
    }

    /**
     * Publish a member-scoped team event when a bus is wired. Payload fields
     * may be null (unknown roster) — the event is never dropped (R5).
     */
    private emitTeamMemberEvent(
        name: 'team.member.assigned' | 'team.member.started' | 'team.member.stopped',
        payload: TeamMemberEventPayload,
    ): void {
        const bus = this.ctx.eventBus;
        if (!bus) return;
        try {
            bus.emit(name, { ...payload, severity: 'info' });
        } catch {
            // Swallow — event is observable metadata only.
        }
    }

    /**
     * Best-effort roster join for a composed agent id (`teamId-memberId`).
     * Missing roster rows yield null fields — never throws (R5 / R17).
     */
    private async resolveMemberIdentity(agentId: string): Promise<{ teamId: string | null; agentType: string | null }> {
        try {
            const specs = await loadAgentSpecs(this.configDir);
            const spec = specs.find((s) => s.id === agentId);
            if (!spec) return { teamId: null, agentType: null };
            const teamTag = spec.tags?.find((t) => t.startsWith('team:'));
            return {
                teamId: teamTag ? teamTag.slice('team:'.length) : null,
                agentType: typeof spec.type === 'string' && spec.type.length > 0 ? spec.type : null,
            };
        } catch {
            return { teamId: null, agentType: null };
        }
    }

    private async inboxRecentDao(): Promise<InboxRecentDao> {
        const db = await this.ctx.getDb();
        return new InboxRecentDao(db);
    }

    private orchestrator(): Promise<TeamOrchestrator> {
        this.orchestratorPromise ??= this.inboxDao().then((dao) => {
            const orch = new TeamOrchestrator(this.configDir, dao, { events: this.ctx.events });
            // Bridge TeamOrchestrator agent lifecycle → team.member.* so the
            // team family reaches the ledger from the orchestrator path
            // (task 0371 R2). SupervisorService emits the same names on the
            // serve/process path; both are cataloged and idempotent as rows.
            orch.on('agent.started', (event) => {
                void this.resolveMemberIdentity(event.agentId).then((identity) => {
                    this.emitTeamMemberEvent('team.member.started', {
                        teamId: identity.teamId,
                        memberId: event.agentId,
                        agentType: event.agentType ?? identity.agentType,
                        outcome: 'started',
                    });
                });
            });
            orch.on('agent.stopped', (event) => {
                void this.resolveMemberIdentity(event.agentId).then((identity) => {
                    this.emitTeamMemberEvent('team.member.stopped', {
                        teamId: identity.teamId,
                        memberId: event.agentId,
                        agentType: identity.agentType,
                        outcome: 'stopped',
                    });
                });
            });
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

// ---------------------------------------------------------------------------
// Autostart resolution (0258 R8)
// ---------------------------------------------------------------------------

/**
 * Resolve the set of agent ids with effective autostart = true across all
 * `agent.team.*` entries. Effective autostart = `member.autostart ?? team.autostart ?? false`.
 * A `SPUR_TEAM_AUTOSTART` env entry (comma-separated ids) unions into the set
 * (0253 R2, closes the 0252 handoff).
 */
export function resolveAutostartSet(config: SpurConfig | null, envAutostart?: string): string[] {
    const ids = new Set<string>();
    const teams = config?.agent?.team;
    if (teams) {
        for (const [teamId, teamConfig] of Object.entries(teams)) {
            const members = teamConfig.members.map(normalizeMember);
            for (const [index, ref] of members.entries()) {
                const localId = memberLocalId(ref, members, index);
                const composedId = `${teamId}-${localId}`;
                const effective = ref.autostart ?? teamConfig.autostart ?? false;
                if (effective) ids.add(composedId);
            }
        }
    }
    // Env unions in
    if (envAutostart) {
        for (const id of envAutostart
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)) {
            ids.add(id);
        }
    }
    return Array.from(ids).sort();
}
