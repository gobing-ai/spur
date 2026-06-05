import { join } from 'node:path';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    type AgentSpec,
    buildIdentityPreamble,
    deleteAgentSpec as deleteAgentSpecFile,
    loadAgentSpecs,
    saveAgentSpec,
    TeamOrchestrator,
    validateAgentId,
} from '@gobing-ai/ts-ai-runner';
import { InboxMessageDao } from '@gobing-ai/ts-db';
import { getFs } from '@gobing-ai/ts-runtime';

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
    output: TeamServiceOutput;
    getDb(): Promise<DbAdapter>;
}

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

/** A single agent's status for team listing. */
export interface TeamStatusEntry {
    id: string;
    name: string;
    type: string;
    workspace: string;
    purpose: string;
    status: 'running' | 'stopped' | 'errored' | 'unknown';
    pid?: number;
}

/** Result of listing all team agents with status. */
export interface TeamStatusResult {
    agents: TeamStatusEntry[];
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
        const specs = orchestrator.loadSpecs();
        const running = orchestrator.getRunningAgents();
        const agents = specs.map((spec) => {
            const status = orchestrator.getAgentStatus(spec.id);
            const pid = running.get(spec.id)?.getPid() ?? null;
            return {
                id: spec.id,
                name: spec.name,
                type: spec.type,
                workspace: spec.workspace,
                purpose: spec.purpose,
                status,
                ...(pid !== null ? { pid } : {}),
            };
        });
        return { agents };
    }

    /**
     * Assign a task to an agent by setting `assignee:` in the task file's YAML
     * frontmatter. The task id is matched against `docs/tasks/<id>_*.md`.
     */
    async assignTask(taskId: string, agentId: string): Promise<void> {
        validateAgentId(agentId);
        const path = await this.resolveTaskFile(taskId);
        if (path === null) {
            throw new Error(`No task file found for id "${taskId}" under docs/tasks/`);
        }
        const fs = getFs();
        const source = await fs.readFile(path);
        await fs.writeFile(path, setFrontmatterField(source, 'assignee', agentId));
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
        const existing = loadAgentSpecs(this.configDir).find((spec) => spec.id === input.id);
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
        const existing = loadAgentSpecs(this.configDir).find((spec) => spec.id === id);
        if (existing === undefined) {
            throw new Error(`No agent spec found: ${id}`);
        }
        await deleteAgentSpecFile(id, this.configDir);
    }

    /** List the agent specs currently defined under `.spur/agents/`. */
    listAgentSpecs(): AgentSpec[] {
        return loadAgentSpecs(this.configDir);
    }

    /** Build the identity preamble for an agent + its workspace peers. */
    buildIdentity(spec: AgentSpec, taskId?: string, taskTitle?: string): string {
        const peers = loadAgentSpecs(this.configDir)
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
    // Lazy dependency construction
    // -------------------------------------------------------------------------

    private async inboxDao(): Promise<InboxMessageDao> {
        const db = await this.ctx.getDb();
        return new InboxMessageDao(db);
    }

    private orchestrator(): Promise<TeamOrchestrator> {
        this.orchestratorPromise ??= this.inboxDao().then((dao) => new TeamOrchestrator(this.configDir, dao));
        return this.orchestratorPromise;
    }

    private async resolveTaskFile(taskId: string): Promise<string | null> {
        const fs = getFs();
        const tasksDir = join(this.ctx.cwd, 'docs', 'tasks');
        let entries: string[];
        try {
            entries = await fs.readDir(tasksDir);
        } catch {
            return null;
        }
        const prefix = `${taskId}_`;
        const match = entries.find((entry) => entry.startsWith(prefix) && entry.endsWith('.md'));
        return match === undefined ? null : join(tasksDir, match);
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Set or replace a scalar field in a markdown file's leading YAML frontmatter.
 * If the field exists it is replaced in place; otherwise it is appended to the
 * end of the frontmatter block. Files without frontmatter get one prepended.
 */
function setFrontmatterField(source: string, key: string, value: string): string {
    const line = `${key}: ${value}`;
    const fence = /^---\n([\s\S]*?)\n---/;
    const matched = fence.exec(source);
    if (matched === null) {
        return `---\n${line}\n---\n\n${source}`;
    }
    const body = matched[1] ?? '';
    const keyLine = new RegExp(`^${key}:.*$`, 'm');
    // Use function replacers so `$`-sequences in the frontmatter body (e.g. a cost
    // figure like `$1.00` or a literal `$&`) are written verbatim, not interpreted
    // as `String.prototype.replace` special replacement patterns.
    const nextBody = keyLine.test(body) ? body.replace(keyLine, () => line) : `${body}\n${line}`;
    return source.replace(fence, () => `---\n${nextBody}\n---`);
}
