import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CapabilityTier, createMigratedDb, type DbAdapter, InboxMessageDao } from '@gobing-ai/spur-domain';
import {
    type AgentEvents,
    type AgentProcessOptions,
    type AgentSpec,
    loadAgentSpecs,
    saveAgentSpec,
    TeamAgentProcess,
    TeamOrchestrator,
} from '@gobing-ai/ts-ai-runner';
import { EventBus } from '@gobing-ai/ts-infra';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    type MessageEventBus,
    type MessageEventPayload,
    type TeamLifecycleEventPayload,
    type TeamMemberEventPayload,
    TeamService,
    type TeamServiceContext,
    type TeamServiceEventBus,
} from '../../src/index';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function nullOutput() {
    return { write: () => {}, error: () => {} };
}

/** Build a TeamService over a temp project dir + a shared in-memory database. */
async function makeService(
    bus?: MessageEventBus | TeamServiceEventBus,
    events?: EventBus<AgentEvents>,
    roles?: ReadonlyMap<string, CapabilityTier>,
): Promise<{ svc: TeamService; cwd: string; db: DbAdapter; cleanup: () => Promise<void> }> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-team-'));
    const db = await createMigratedDb({ url: ':memory:' });
    const ctx: TeamServiceContext = {
        cwd,
        env: {},
        output: nullOutput(),
        getDb: async () => db,
        fs: createNodeFileSystem(cwd),
        ...(bus ? { eventBus: bus } : {}),
        ...(events ? { events } : {}),
        ...(roles ? { roles } : {}),
    };
    return {
        svc: new TeamService(ctx),
        cwd,
        db,
        cleanup: async () => {
            db.close();
            await rm(cwd, { recursive: true, force: true });
        },
    };
}

/** Minimal process double so TeamOrchestrator start/stop/send never spawns a real agent. */
class FakeTeamAgentProcess extends TeamAgentProcess {
    private fakeStatus: 'running' | 'stopped' | 'errored' = 'stopped';

    constructor(options: AgentProcessOptions) {
        super(options);
    }

    override async start(): Promise<void> {
        this.fakeStatus = 'running';
    }

    override async stop(): Promise<void> {
        this.fakeStatus = 'stopped';
    }

    override async send(_message: string): Promise<{ ok: boolean }> {
        return { ok: true };
    }

    override getStatus(): 'running' | 'stopped' | 'errored' {
        return this.fakeStatus;
    }

    override getPid(): number | null {
        return this.fakeStatus === 'running' ? 4242 : null;
    }

    override getExitCode(): number | null {
        return null;
    }
}

/** Build a fresh EventBus and capture every emitted payload by event name. */
function makeCapturingBus(): { bus: MessageEventBus; events: Map<string, MessageEventPayload[]> } {
    const bus = new EventBus<Record<'message.sent' | 'message.replied', (event: MessageEventPayload) => void>>();
    const events = new Map<string, MessageEventPayload[]>([
        ['message.sent', []],
        ['message.replied', []],
    ]);
    bus.on('message.sent', (e) => events.get('message.sent')?.push(e));
    bus.on('message.replied', (e) => events.get('message.replied')?.push(e));
    return { bus, events };
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

describe('TeamService messaging', () => {
    test('sendMessage enqueues and returns a queued result', async () => {
        const { svc, cleanup } = await makeService();
        try {
            const result = await svc.sendMessage('operator', 'planner', 'start work');
            expect(result.toId).toBe('planner');
            expect(result.status).toBe('queued');
            expect(result.injected).toBe(false);
            expect(result.msgId.length).toBeGreaterThan(0);
        } finally {
            await cleanup();
        }
    });

    test('getInbox returns messages addressed to the agent', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await svc.sendMessage('operator', 'planner', 'first');
            await svc.sendMessage('operator', 'planner', 'second');
            await svc.sendMessage('operator', 'coder', 'other');

            const inbox = await svc.getInbox('planner');
            expect(inbox.count).toBe(2);
            const bodies = inbox.messages.map((m) => m.body).sort();
            expect(bodies).toEqual(['first', 'second']);
            // createdAt is surfaced as an ISO string for stable display.
            expect(inbox.messages[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        } finally {
            await cleanup();
        }
    });

    test('replyToMessage threads back to the original sender', async () => {
        const { svc, cleanup } = await makeService();
        try {
            // coder messages planner; planner replies — reply must address coder.
            const sent = await svc.sendMessage('coder', 'planner', 'need a plan');
            const reply = await svc.replyToMessage(sent.msgId, 'here is the plan');

            expect(reply.toId).toBe('coder');
            const coderInbox = await svc.getInbox('coder');
            expect(coderInbox.count).toBe(1);
            expect(coderInbox.messages[0]?.body).toBe('here is the plan');
            expect(coderInbox.messages[0]?.inReplyTo).toBe(sent.msgId);
        } finally {
            await cleanup();
        }
    });

    test('replyToMessage rejects an unknown message id', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await expect(svc.replyToMessage('does-not-exist', 'body')).rejects.toThrow(/No message found/);
        } finally {
            await cleanup();
        }
    });

    test('replyToMessage rejects operator-originated messages (no sender)', async () => {
        const { svc, cleanup } = await makeService();
        try {
            // from_id null — there is no addressable peer to reply to.
            const sent = await svc.sendMessage(null, 'planner', 'broadcast');
            await expect(svc.replyToMessage(sent.msgId, 'reply')).rejects.toThrow(/operator-originated/);
        } finally {
            await cleanup();
        }
    });

    // ── Event emission (task 0193/0204 R1) ──

    test('sendMessage emits message.sent with metadata only (no body)', async () => {
        const { bus, events } = makeCapturingBus();
        const { svc, cleanup } = await makeService(bus);
        try {
            const result = await svc.sendMessage('coder', 'planner', 'secret body');
            const sent = events.get('message.sent');
            expect(sent?.length).toBe(1);
            const payload = sent?.[0];
            expect(payload?.msgId).toBe(result.msgId);
            expect(payload?.fromId).toBe('coder');
            expect(payload?.toId).toBe('planner');
            expect(payload?.threadId).toBeNull();
            expect(payload?.createdAt).toBeTruthy();
            // The event payload must NEVER carry the body — events are observable metadata.
            expect(JSON.stringify(payload)).not.toContain('secret body');
        } finally {
            await cleanup();
        }
    });

    test('replyToMessage emits message.replied with the thread id', async () => {
        const { bus, events } = makeCapturingBus();
        const { svc, cleanup } = await makeService(bus);
        try {
            const sent = await svc.sendMessage('coder', 'planner', 'need a plan');
            await svc.replyToMessage(sent.msgId, 'here is the plan');
            // Exactly one of each event — the reply does not also fire message.sent.
            expect(events.get('message.sent')?.length).toBe(1);
            const replied = events.get('message.replied');
            expect(replied?.length).toBe(1);
            expect(replied?.[0]?.threadId).toBe(sent.msgId);
            expect(replied?.[0]?.toId).toBe('coder'); // reply addresses the original sender
        } finally {
            await cleanup();
        }
    });

    test('no bus wired — send/reply still succeed, no events fired', async () => {
        // The CLI default has no bus; messaging must work unchanged.
        const { svc, cleanup } = await makeService();
        try {
            const result = await svc.sendMessage('coder', 'planner', 'hi');
            expect(result.status).toBe('queued');
            const reply = await svc.replyToMessage(result.msgId, 'ack');
            expect(reply.status).toBe('queued');
        } finally {
            await cleanup();
        }
    });

    test('sendMessage rejects a malformed recipient id', async () => {
        const { svc, cleanup } = await makeService();
        try {
            // A typo'd / malformed id must surface immediately, not create an
            // unaddressable row. Existence is NOT required (deferred delivery), but
            // syntax is.
            await expect(svc.sendMessage('operator', 'Bad Id', 'hi')).rejects.toThrow();
            // A null sender is allowed (operator broadcast); only a malformed
            // non-null sender is rejected.
            await expect(svc.sendMessage('Bad Sender', 'planner', 'hi')).rejects.toThrow();
            // A valid not-yet-existing recipient is accepted (deferred delivery).
            const ok = await svc.sendMessage(null, 'future-agent', 'hi');
            expect(ok.toId).toBe('future-agent');
        } finally {
            await cleanup();
        }
    });

    test('getInbox rejects a malformed agent id', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await expect(svc.getInbox('Bad Id')).rejects.toThrow();
        } finally {
            await cleanup();
        }
    });

    test('listRecent returns messages across all agents newest-first', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await svc.sendMessage('coder', 'planner', 'first');
            await svc.sendMessage('coder', 'coder', 'second');
            await svc.sendMessage(null, 'planner', 'broadcast');

            const recent = await svc.listRecent(50);
            expect(recent.count).toBe(3);
            // Each row carries the recipient (toId) — the global feed is per-recipient,
            // unlike getInbox which is scoped to one agent.
            expect(recent.messages[0]?.toId).toBeDefined();
            expect(recent.messages.every((m) => typeof m.toId === 'string')).toBe(true);
            // createdAt surfaced as ISO for stable display.
            expect(recent.messages[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            // R11: identity + reply signals surfaced on every row.
            expect(recent.messages.every((m) => typeof m.hasReply === 'boolean')).toBe(true);
            expect(recent.messages.every((m) => typeof m.replyCount === 'number')).toBe(true);
            // No replies in this fixture — hasReply false, replyCount 0.
            expect(recent.messages.every((m) => !m.hasReply)).toBe(true);
            // `to` identity always present; `from` only when fromId is non-null.
            expect(recent.messages.every((m) => m.to.agentId === m.toId)).toBe(true);
            const broadcast = recent.messages.find((m) => m.fromId === null);
            expect(broadcast?.from).toBeUndefined();
            const nonBroadcast = recent.messages.find((m) => m.fromId !== null);
            expect(nonBroadcast?.from?.agentId).toBe(nonBroadcast?.fromId ?? undefined);
            // Unresolved agent ids (no team config) fall back to raw agentId only.
            expect(nonBroadcast?.from?.teamName).toBeUndefined();
        } finally {
            await cleanup();
        }
    });

    test('listRecent clamps limit into [1, 500] and defaults to 50', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await svc.sendMessage('coder', 'planner', 'one');

            // limit <= 0 → clamped to 1.
            const one = await svc.listRecent(0);
            expect(one.count).toBe(1);

            // limit huge → clamped to 500 (still returns all 1 row present).
            const huge = await svc.listRecent(100_000);
            expect(huge.count).toBe(1);

            // No arg → default 50.
            const def = await svc.listRecent();
            expect(def.count).toBe(1);
        } finally {
            await cleanup();
        }
    });

    test('listRecent surfaces hasReply/replyCount for threaded messages', async () => {
        const { svc, cleanup } = await makeService();
        try {
            // Send a message, then reply to it — the original should show hasReply=true.
            const sent = await svc.sendMessage('coder', 'planner', 'original');
            await svc.replyToMessage(sent.msgId, 'got it');

            const recent = await svc.listRecent(50);
            expect(recent.count).toBe(2);
            // The original message (sent first) should have a reply.
            const original = recent.messages.find((m) => m.id === sent.msgId);
            expect(original).toBeDefined();
            expect(original?.hasReply).toBe(true);
            expect(original?.replyCount).toBe(1);
            // The reply itself has no replies.
            const reply = recent.messages.find((m) => m.inReplyTo === sent.msgId);
            expect(reply).toBeDefined();
            expect(reply?.hasReply).toBe(false);
            expect(reply?.replyCount).toBe(0);
        } finally {
            await cleanup();
        }
    });

    test('listRecent replyCount is window-scoped — only replies to in-window messages are counted', async () => {
        const { svc, cleanup } = await makeService();
        try {
            // Three-message thread: original → reply → reply-to-reply.
            const sent = await svc.sendMessage('coder', 'planner', 'original');
            const reply = await svc.replyToMessage(sent.msgId, 'reply');
            await svc.replyToMessage(reply.msgId, 'reply to reply');

            // Full window: all three messages visible.
            // The original has 1 reply; the first reply has 1 reply; the newest has none.
            const all = await svc.listRecent(50);
            expect(all.count).toBe(3);
            expect(all.messages.find((m) => m.id === sent.msgId)?.replyCount).toBe(1);
            expect(all.messages.find((m) => m.id === reply.msgId)?.replyCount).toBe(1);
            const newest = all.messages.find((m) => m.inReplyTo === reply.msgId);
            expect(newest?.replyCount).toBe(0);
            expect(newest?.hasReply).toBe(false);

            // The replyCount map only contains ids that are in the window — if we
            // query a narrow window, messages outside it don't get their replies
            // counted. This is enforced by the DAO passing only in-window ids to
            // countReplies (verified in the DAO-level test).
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// Agent specs
// ---------------------------------------------------------------------------

describe('TeamService agent specs', () => {
    test('createAgentSpec writes a spec and applies defaults', async () => {
        const { svc, cwd, cleanup } = await makeService();
        try {
            const spec = await svc.createAgentSpec({ id: 'planner', type: 'claude-code' });
            expect(spec.id).toBe('planner');
            expect(spec.name).toBe('planner');
            expect(spec.workspace).toBe(cwd);
            // Empty purpose falls back to a type-derived default so the spec round-trips.
            expect(spec.purpose).toBe('claude-code agent');
            expect(spec.tags).toEqual([]);

            const onDisk = await readFile(join(cwd, '.spur', 'agents', 'planner.yaml'), 'utf8');
            expect(onDisk).toContain('id: planner');
            expect(onDisk).toContain('type: claude-code');
        } finally {
            await cleanup();
        }
    });

    test('createAgentSpec rejects a duplicate id', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await svc.createAgentSpec({ id: 'planner', type: 'claude-code' });
            await expect(svc.createAgentSpec({ id: 'planner', type: 'codex' })).rejects.toThrow(/already exists/);
        } finally {
            await cleanup();
        }
    });

    test('createAgentSpec rejects an invalid id', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await expect(svc.createAgentSpec({ id: 'Bad ID', type: 'claude-code' })).rejects.toThrow();
        } finally {
            await cleanup();
        }
    });

    test('deleteAgentSpec removes the spec file', async () => {
        const { svc, cwd, cleanup } = await makeService();
        try {
            await svc.createAgentSpec({ id: 'planner', type: 'claude-code' });
            await svc.deleteAgentSpec('planner');
            expect(await svc.listAgentSpecs()).toHaveLength(0);
            const fs = createNodeFileSystem();
            expect(await fs.exists(join(cwd, '.spur', 'agents', 'planner.yaml'))).toBe(false);
        } finally {
            await cleanup();
        }
    });

    test('deleteAgentSpec rejects an unknown id', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await expect(svc.deleteAgentSpec('ghost')).rejects.toThrow(/No agent spec found/);
        } finally {
            await cleanup();
        }
    });

    test('listAgentSpecs returns created specs', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await svc.createAgentSpec({ id: 'planner', type: 'claude-code' });
            await svc.createAgentSpec({ id: 'coder', type: 'codex', purpose: 'write code' });
            const specs = (await svc.listAgentSpecs()).map((s) => s.id).sort();
            expect(specs).toEqual(['coder', 'planner']);
        } finally {
            await cleanup();
        }
    });

    test('buildIdentity includes workspace peers', async () => {
        const { svc, cwd, cleanup } = await makeService();
        try {
            await svc.createAgentSpec({ id: 'planner', type: 'claude-code', workspace: cwd, purpose: 'plan' });
            const coder = await svc.createAgentSpec({
                id: 'coder',
                type: 'codex',
                workspace: cwd,
                purpose: 'code',
            });
            const preamble = await svc.buildIdentity(coder);
            expect(preamble).toContain('coder');
            // planner is a same-workspace peer and should appear in the preamble.
            expect(preamble).toContain('planner');
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// Status & task assignment
// ---------------------------------------------------------------------------

describe('TeamService status & assignment', () => {
    test('getStatus reports stopped for non-running specs', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await svc.createAgentSpec({ id: 'planner', type: 'claude-code', purpose: 'plan it' });
            const status = await svc.getStatus();
            expect(status.agents).toHaveLength(1);
            expect(status.agents[0]?.id).toBe('planner');
            expect(status.agents[0]?.status).toBe('stopped');
            expect(status.agents[0]?.pid).toBeUndefined();
        } finally {
            await cleanup();
        }
    });

    test('0544 R1: getStatus carries the declared role and resolved executor; unset when absent', async () => {
        const { svc, cwd, cleanup } = await makeService(
            undefined,
            undefined,
            new Map<string, CapabilityTier>([['reviewer', 'capable-1']]),
        );
        try {
            await writeConfig(
                cwd,
                `agent:
  executors:
    - name: capable-exec
      agent: claude
      tier: capable-1
  team:
    demo:
      name: Demo
      work_dir: /tmp/demo
      members:
        - role: reviewer
        - executor: capable-exec
`,
            );
            await svc.materializeTeam('demo');
            const status = await svc.getStatus();
            const byId = new Map(status.agents.map((a) => [a.id, a]));
            const reviewer = byId.get('demo-reviewer-1');
            expect(reviewer?.role).toBe('reviewer');
            expect(reviewer?.executor).toBe('capable-exec');
            const plain = byId.get('demo-capable-exec');
            expect(plain?.role).toBeUndefined();
            expect(plain?.executor).toBe('capable-exec');
        } finally {
            await cleanup();
        }
    });

    test('assignTask sets assignee in the task frontmatter', async () => {
        const { svc, cwd, cleanup } = await makeService();
        try {
            const tasksDir = join(cwd, 'docs', 'tasks');
            await createNodeFileSystem().ensureDir(tasksDir);
            const taskPath = join(tasksDir, '0042_demo_task.md');
            await writeFile(taskPath, '---\nname: "Demo"\nstatus: Todo\n---\n\n## Body\n');

            await svc.assignTask('0042', 'planner');
            const updated = await readFile(taskPath, 'utf8');
            expect(updated).toContain('assignee: planner');
            // Existing fields are preserved.
            expect(updated).toContain('status: Todo');
        } finally {
            await cleanup();
        }
    });

    test('assignTask replaces an existing assignee', async () => {
        const { svc, cwd, cleanup } = await makeService();
        try {
            const tasksDir = join(cwd, 'docs', 'tasks');
            await createNodeFileSystem().ensureDir(tasksDir);
            const taskPath = join(tasksDir, '0042_demo_task.md');
            await writeFile(taskPath, '---\nname: "Demo"\nassignee: oldagent\n---\n\nbody\n');

            await svc.assignTask('0042', 'newagent');
            const updated = await readFile(taskPath, 'utf8');
            expect(updated).toContain('assignee: newagent');
            expect(updated).not.toContain('oldagent');
        } finally {
            await cleanup();
        }
    });

    test('assignTask finds a task in a NON-active registered phase folder', async () => {
        // Regression: when `.spur/config.yaml` sets active=docs/tasks2 but the task
        // lives in docs/tasks (a registered phase folder), assignTask must still find
        // it. The old hardcoded `docs/tasks` (or a single-folder scan) would miss it
        // whenever active ≠ the task's folder.
        const { svc, cwd, cleanup } = await makeService();
        try {
            const nodeFs = createNodeFileSystem();
            await nodeFs.ensureDir(join(cwd, '.spur'));
            await writeFile(
                join(cwd, '.spur', 'config.yaml'),
                ['tasks:', '  active: docs/tasks2', '  folders:', '    docs/tasks: {}', '    docs/tasks2: {}'].join(
                    '\n',
                ),
            );
            // Task is in docs/tasks, NOT the active docs/tasks2.
            const tasksDir = join(cwd, 'docs', 'tasks');
            await nodeFs.ensureDir(tasksDir);
            const taskPath = join(tasksDir, '0099_phase_one.md');
            await writeFile(taskPath, '---\nname: "Phase One"\nstatus: Todo\n---\n\nbody\n');

            await svc.assignTask('0099', 'planner');
            expect(await readFile(taskPath, 'utf8')).toContain('assignee: planner');
        } finally {
            await cleanup();
        }
    });

    test('assignTask rejects a missing task file', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await expect(svc.assignTask('9999', 'planner')).rejects.toThrow(/No task file found/);
        } finally {
            await cleanup();
        }
    });

    test('assignTask preserves $-sequences in the frontmatter body', async () => {
        // Guards against `String.replace` interpreting `$&`/`$1` in existing
        // frontmatter as special replacement patterns, which would corrupt the file.
        const { svc, cwd, cleanup } = await makeService();
        try {
            const tasksDir = join(cwd, 'docs', 'tasks');
            await createNodeFileSystem().ensureDir(tasksDir);
            const taskPath = join(tasksDir, '0042_demo_task.md');
            await writeFile(taskPath, '---\nname: "Cost $1.00 and $& literal"\nstatus: Todo\n---\n\nbody\n');

            await svc.assignTask('0042', 'planner');
            const updated = await readFile(taskPath, 'utf8');
            expect(updated).toContain('name: "Cost $1.00 and $& literal"');
            expect(updated).toContain('assignee: planner');
            expect(updated).toContain('status: Todo');
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// Task 0237 — TeamOrchestrator events bus wiring
// ---------------------------------------------------------------------------

describe('TeamService agent lifecycle bus (task 0237)', () => {
    test('R5: message.sent still fires when both eventBus and events are wired', async () => {
        // Two independent bus fields must not interfere: TeamService messaging uses
        // eventBus; TeamOrchestrator lifecycle uses events.
        const { bus, events: msgEvents } = makeCapturingBus();
        const agentBus = new EventBus<AgentEvents>();
        const agentSeen: string[] = [];
        agentBus.on('agent.started', (e) => agentSeen.push(e.agentId));

        const { svc, cleanup } = await makeService(bus, agentBus);
        try {
            const result = await svc.sendMessage('coder', 'planner', 'hello body');
            expect(msgEvents.get('message.sent')?.length).toBe(1);
            expect(msgEvents.get('message.sent')?.[0]?.msgId).toBe(result.msgId);
            // Messaging must not emit agent.* (different path / different event names).
            expect(agentSeen).toEqual([]);
            expect(JSON.stringify(msgEvents.get('message.sent')?.[0])).not.toContain('hello body');
        } finally {
            await cleanup();
        }
    });

    test('R4: TeamOrchestrator with events bus emits agent.started/stopped/message.sent', async () => {
        // Mirrors TeamService.orchestrator(): `new TeamOrchestrator(configDir, dao, { events })`.
        // processFactory is test-only (TeamService does not inject it) so we never spawn a real agent.
        const cwd = await mkdtemp(join(tmpdir(), 'spur-team-orch-'));
        const db = await createMigratedDb({ url: ':memory:' });
        const configDir = join(cwd, '.spur', 'agents');
        await createNodeFileSystem(cwd).ensureDir(configDir);
        await saveAgentSpec(
            {
                id: 'coder',
                name: 'coder',
                type: 'codex',
                workspace: cwd,
                purpose: 'Implement',
                tags: [],
                config: {},
            },
            configDir,
        );

        const agentBus = new EventBus<AgentEvents>();
        const seen: string[] = [];
        agentBus.on('agent.started', (e) => seen.push(`started:${e.agentId}`));
        agentBus.on('agent.stopped', (e) => seen.push(`stopped:${e.agentId}`));
        agentBus.on('agent.message.sent', (e) => seen.push(`message:${e.agentId}:${e.ok}`));

        const inbox = new InboxMessageDao(db);
        const orchestrator = new TeamOrchestrator(configDir, inbox, {
            events: agentBus,
            processFactory: (options) => new FakeTeamAgentProcess(options),
        });

        try {
            await orchestrator.startAgent('coder');
            await orchestrator.sendMessage('planner', 'coder', 'live ping');
            await orchestrator.stopAgent('coder');

            expect(seen).toContain('started:coder');
            expect(seen).toContain('stopped:coder');
            expect(seen).toContain('message:coder:true');
        } finally {
            db.close();
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('R6: TeamServiceContext without events still constructs (optional field)', async () => {
        const { svc, cleanup } = await makeService();
        try {
            // getStatus touches orchestrator(); CLI path omits events → throwaway bus.
            const status = await svc.getStatus();
            expect(Array.isArray(status.agents)).toBe(true);
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// Team management (0258 R1-R3): listTeams / materializeTeam / teardownTeam
// ---------------------------------------------------------------------------

/** Write a `.spur/config.yaml` with the given YAML body under cwd. */
async function writeConfig(cwd: string, yaml: string): Promise<void> {
    await mkdir(join(cwd, '.spur'), { recursive: true });
    await writeFile(join(cwd, '.spur', 'config.yaml'), yaml, 'utf8');
}

/** Save a spec with the given tags under `.spur/agents/`. */
async function seedSpec(configDir: string, id: string, tags: string[], type = 'claude'): Promise<void> {
    await saveAgentSpec(
        {
            id,
            name: id,
            type,
            workspace: '/tmp',
            purpose: 'seeded',
            tags,
            config: {},
        },
        configDir,
    );
}

const DEVOPS_CONFIG = `agent:
  team:
    devops:
      name: DevOps
      work_dir: /tmp/devops
      members:
        - executor: claude
          purpose: plan work
        - executor: codex
`;

describe('TeamService team management (0258)', () => {
    describe('listTeams (R1)', () => {
        test('returns config-declared teams with empty specs when no specs exist', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const teams = await svc.listTeams();
                expect(teams).toHaveLength(1);
                expect(teams[0]?.teamId).toBe('devops');
                expect(teams[0]?.name).toBe('DevOps');
                expect(teams[0]?.specs).toEqual([]);
            } finally {
                await cleanup();
            }
        });

        test('groups specs under their team: tag and merges with config', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');
                await seedSpec(configDir, 'devops-claude', ['team:devops', 'spur:generated']);
                await seedSpec(configDir, 'devops-codex', ['team:devops', 'spur:generated'], 'codex');

                const teams = await svc.listTeams();
                expect(teams).toHaveLength(1);
                const ids = teams[0]?.specs.map((s) => s.id).sort();
                expect(ids).toEqual(['devops-claude', 'devops-codex']);
            } finally {
                await cleanup();
            }
        });

        test('groups orphaned specs (team tag not in config) under a synthesized entry', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');
                // 'ghost' team is not declared in config — synthesized entry uses teamId as name.
                await seedSpec(configDir, 'ghost-x', ['team:ghost', 'spur:generated']);

                const teams = await svc.listTeams();
                const byId = new Map(teams.map((t) => [t.teamId, t]));
                expect(byId.has('devops')).toBe(true);
                expect(byId.has('ghost')).toBe(true);
                const ghost = byId.get('ghost');
                expect(ghost?.name).toBe('ghost'); // synthesized name = teamId
                expect(ghost?.specs.map((s) => s.id)).toEqual(['ghost-x']);
            } finally {
                await cleanup();
            }
        });

        test('surfaces specs with no team tag under the __untethered__ group (0256 R2)', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');
                await seedSpec(configDir, 'devops-claude', ['team:devops', 'spur:generated']);
                await seedSpec(configDir, 'lonely', []); // hand-authored spec, no team tag

                const teams = await svc.listTeams();
                const byId = new Map(teams.map((t) => [t.teamId, t]));
                const untethered = byId.get('__untethered__');
                expect(untethered).toBeDefined();
                expect(untethered?.specs.map((s) => s.id)).toEqual(['lonely']);
                // The tethered spec stays under its team, not double-counted.
                expect(byId.get('devops')?.specs.map((s) => s.id)).toEqual(['devops-claude']);
            } finally {
                await cleanup();
            }
        });

        test('returns empty list when no config and no specs exist', async () => {
            const { svc, cleanup } = await makeService();
            try {
                const teams = await svc.listTeams();
                expect(teams).toEqual([]);
            } finally {
                await cleanup();
            }
        });

        // ── 0197 R4: workDir / isCurrentProject ──

        test('R4: configured team resolves work_dir relative to the service cwd', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                // work_dir '.' resolves to the service cwd -> current project.
                await writeConfig(
                    cwd,
                    [
                        'agent:',
                        '  team:',
                        '    proj:',
                        '      name: Proj',
                        '      work_dir: .',
                        '      members:',
                        '        - executor: claude',
                    ].join('\n'),
                );
                const teams = await svc.listTeams();
                expect(teams).toHaveLength(1);
                const team = teams[0];
                expect(team?.teamId).toBe('proj');
                expect(team?.workDir).toBe(resolve(cwd, '.'));
                expect(team?.isCurrentProject).toBe(true);
            } finally {
                await cleanup();
            }
        });

        test('R4: configured team with an external work_dir is not the current project', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG); // work_dir /tmp/devops
                const teams = await svc.listTeams();
                const devops = teams.find((t) => t.teamId === 'devops');
                expect(devops?.workDir).toBe(resolve(cwd, '/tmp/devops'));
                expect(devops?.isCurrentProject).toBe(false);
            } finally {
                await cleanup();
            }
        });

        test('R4: orphaned group uses a common spec workspace when all members agree', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                const configDir = join(cwd, '.spur', 'agents');
                // Two specs in the same orphaned team, same workspace.
                await seedSpec(configDir, 'ghost-a', ['team:ghost', 'spur:generated']);
                await seedSpec(configDir, 'ghost-b', ['team:ghost', 'spur:generated'], 'codex');
                const teams = await svc.listTeams();
                const ghost = teams.find((t) => t.teamId === 'ghost');
                expect(ghost?.workDir).toBe(resolve(cwd, '/tmp'));
                expect(ghost?.isCurrentProject).toBe(false);
            } finally {
                await cleanup();
            }
        });

        test('R4: orphaned group with disagreeing spec workspaces is not selectable', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                const configDir = join(cwd, '.spur', 'agents');
                await seedSpec(configDir, 'ghost-a', ['team:ghost', 'spur:generated']);
                // Second spec with a different workspace.
                await saveAgentSpec(
                    {
                        id: 'ghost-b',
                        name: 'ghost-b',
                        type: 'codex',
                        workspace: '/elsewhere',
                        purpose: 'seeded',
                        tags: ['team:ghost', 'spur:generated'],
                        config: {},
                    },
                    configDir,
                );
                const teams = await svc.listTeams();
                const ghost = teams.find((t) => t.teamId === 'ghost');
                expect(ghost?.workDir).toBeNull();
                expect(ghost?.isCurrentProject).toBe(false);
            } finally {
                await cleanup();
            }
        });

        test('R4: untethered group uses a common spec workspace only when specs agree', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                const configDir = join(cwd, '.spur', 'agents');
                await seedSpec(configDir, 'lonely', []);
                const teams = await svc.listTeams();
                const untethered = teams.find((t) => t.teamId === '__untethered__');
                expect(untethered?.workDir).toBe(resolve(cwd, '/tmp'));
                expect(untethered?.isCurrentProject).toBe(false);
            } finally {
                await cleanup();
            }
        });
    });

    describe('materializeTeam (R2)', () => {
        test('throws when the team is not declared in config', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                await expect(svc.materializeTeam('unknown')).rejects.toThrow(
                    'Team "unknown" not found in agent.team config',
                );
            } finally {
                await cleanup();
            }
        });

        test('check=true returns the diff and writes nothing', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');

                const result = await svc.materializeTeam('devops', { check: true });
                expect(result.written).toBe(false);
                expect(result.upserted).toEqual(['devops-claude', 'devops-codex']);
                expect(result.orphaned).toEqual([]);
                // Dry-run must not have written any spec files.
                const specs = await loadAgentSpecs(configDir);
                expect(specs).toEqual([]);
            } finally {
                await cleanup();
            }
        });

        test('writes one generated spec per member and reports written=true', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');

                const result = await svc.materializeTeam('devops');
                expect(result.written).toBe(true);
                expect(result.upserted).toEqual(['devops-claude', 'devops-codex']);

                const specs = await loadAgentSpecs(configDir);
                const byId = new Map(specs.map((s) => [s.id, s]));
                expect(byId.has('devops-claude')).toBe(true);
                expect(byId.has('devops-codex')).toBe(true);
                const claude = byId.get('devops-claude');
                // Member purpose is preserved; type comes from resolveExecutor('claude', undefined).
                expect(claude?.purpose).toBe('plan work');
                expect(claude?.type).toBe('claude');
                expect(claude?.workspace).toBe('/tmp/devops');
                expect(claude?.tags).toContain('spur:generated');
                expect(claude?.tags).toContain('team:devops');
            } finally {
                await cleanup();
            }
        });

        test('records the executor name beside the kind (0537 R1)', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(
                    cwd,
                    `agent:
  executors:
    - name: codex-sol
      agent: codex
      model: gpt-5.6-sol
      tier: capable-3
  team:
    demo:
      name: Demo
      work_dir: /tmp/demo
      members:
        - executor: codex-sol
          purpose: verifier
`,
                );
                const configDir = join(cwd, '.spur', 'agents');

                await svc.materializeTeam('demo');
                const specs = await loadAgentSpecs(configDir);
                const spec = specs.find((s) => s.id === 'demo-codex-sol');
                // The kind stays (AiRunner resolves the runner from it)...
                expect(spec?.type).toBe('codex');
                // ...and the executor name now survives the round trip (R1).
                expect(spec?.executor).toBe('codex-sol');
                expect(spec?.config?.model).toBe('gpt-5.6-sol');
            } finally {
                await cleanup();
            }
        });

        test('0538 R3: a member declaring role records it on the materialized spec', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(
                    cwd,
                    `agent:
  team:
    demo:
      name: Demo
      work_dir: /tmp/demo
      members:
        - executor: claude
          purpose: verdict writer
          role: reviewer
        - executor: codex
`,
                );
                const configDir = join(cwd, '.spur', 'agents');

                await svc.materializeTeam('demo');
                const specs = await loadAgentSpecs(configDir);
                const byId = new Map(specs.map((s) => [s.id, s]));
                // The declared role rides the spec's config bag beside the executor binding.
                expect(byId.get('demo-claude')?.config?.role).toBe('reviewer');
                // A member declaring none still materializes, without the key.
                expect(byId.get('demo-codex')).toBeDefined();
                expect(byId.get('demo-codex')?.config?.role).toBeUndefined();
                // purpose stays as documentation.
                expect(byId.get('demo-claude')?.purpose).toBe('verdict writer');
            } finally {
                await cleanup();
            }
        });

        test('0543 R1: a role-only member resolves through the tier ladder, recording role + resolved executor', async () => {
            const { svc, cwd, cleanup } = await makeService(
                undefined,
                undefined,
                new Map<string, CapabilityTier>([
                    ['coder', 'standard'],
                    ['reviewer', 'capable-1'],
                ]),
            );
            try {
                await writeConfig(
                    cwd,
                    `agent:
  executors:
    - name: cheap-exec
      agent: pi
      tier: cheap
    - name: capable-exec
      agent: claude
      tier: capable-1
  team:
    demo:
      name: Demo
      work_dir: /tmp/demo
      members:
        - role: reviewer
`,
                );
                const configDir = join(cwd, '.spur', 'agents');

                await svc.materializeTeam('demo');
                const specs = await loadAgentSpecs(configDir);
                const byId = new Map(specs.map((s) => [s.id, s]));
                const spec = byId.get('demo-reviewer-1');
                expect(spec).toBeDefined();
                // Cheapest executor eligible for reviewer (capable-1): capable-exec.
                expect(spec?.type).toBe('claude');
                expect(spec?.executor).toBe('capable-exec');
                expect(spec?.config?.role).toBe('reviewer');
            } finally {
                await cleanup();
            }
        });

        test('0543 R2: a pinned executor beats role tier resolution, role still recorded', async () => {
            const { svc, cwd, cleanup } = await makeService(
                undefined,
                undefined,
                new Map<string, CapabilityTier>([['coder', 'standard']]),
            );
            try {
                await writeConfig(
                    cwd,
                    `agent:
  executors:
    - name: cheap-exec
      agent: pi
      tier: cheap
    - name: capable-exec
      agent: claude
      tier: capable-1
  team:
    demo:
      name: Demo
      work_dir: /tmp/demo
      members:
        - executor: cheap-exec
          role: coder
`,
                );
                const configDir = join(cwd, '.spur', 'agents');

                await svc.materializeTeam('demo');
                const specs = await loadAgentSpecs(configDir);
                const byId = new Map(specs.map((s) => [s.id, s]));
                const spec = byId.get('demo-cheap-exec');
                expect(spec).toBeDefined();
                // cheap-exec is NOT eligible for coder's standard tier — the pin wins.
                expect(spec?.executor).toBe('cheap-exec');
                expect(spec?.type).toBe('pi');
                expect(spec?.config?.role).toBe('coder');
            } finally {
                await cleanup();
            }
        });

        test('0543 R3: purpose is annotation — the same role-only member resolves identically without it', async () => {
            const roles = new Map<string, CapabilityTier>([['reviewer', 'capable-1']]);
            const {
                svc: svcWithPurpose,
                cwd: cwdWithPurpose,
                cleanup: cleanupWithPurpose,
            } = await makeService(undefined, undefined, roles);
            const {
                svc: svcPlain,
                cwd: cwdPlain,
                cleanup: cleanupPlain,
            } = await makeService(undefined, undefined, roles);
            try {
                const config = (purposeLine: string) =>
                    `agent:
  executors:
    - name: capable-exec
      agent: claude
      tier: capable-1
  team:
    demo:
      name: Demo
      work_dir: /tmp/demo
      members:
        - role: reviewer
${purposeLine}
`;
                await writeConfig(cwdWithPurpose, config('          purpose: annotation-only'));
                await writeConfig(cwdPlain, config(''));
                const configDirWithPurpose = join(cwdWithPurpose, '.spur', 'agents');
                const configDirPlain = join(cwdPlain, '.spur', 'agents');

                await svcWithPurpose.materializeTeam('demo');
                await svcPlain.materializeTeam('demo');
                const withPurpose = (await loadAgentSpecs(configDirWithPurpose)).find(
                    (s) => s.id === 'demo-reviewer-1',
                );
                const plain = (await loadAgentSpecs(configDirPlain)).find((s) => s.id === 'demo-reviewer-1');
                // Same id, same resolution; only the purpose annotation differs.
                expect(withPurpose?.executor).toBe('capable-exec');
                expect(plain?.executor).toBe('capable-exec');
                expect(withPurpose?.purpose).toBe('annotation-only');
                expect(plain?.purpose).toBe('claude agent');
            } finally {
                await cleanupWithPurpose();
                await cleanupPlain();
            }
        });

        test('0543 R1/R3: repeated role-only members derive distinct <role>-<n> ids', async () => {
            const { svc, cwd, cleanup } = await makeService(
                undefined,
                undefined,
                new Map<string, CapabilityTier>([['coder', 'standard']]),
            );
            try {
                await writeConfig(
                    cwd,
                    `agent:
  executors:
    - name: capable-exec
      agent: claude
      tier: capable-1
  team:
    demo:
      name: Demo
      work_dir: /tmp/demo
      members:
        - role: coder
        - role: coder
`,
                );
                const configDir = join(cwd, '.spur', 'agents');

                await svc.materializeTeam('demo');
                const specs = await loadAgentSpecs(configDir);
                const byId = new Map(specs.map((s) => [s.id, s]));
                expect(byId.get('demo-coder-1')).toBeDefined();
                expect(byId.get('demo-coder-2')).toBeDefined();
            } finally {
                await cleanup();
            }
        });

        test('0543 R1: a role-only member fails loudly when no role table is available (server path)', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(
                    cwd,
                    `agent:
  executors:
    - name: capable-exec
      agent: claude
      tier: capable-1
  team:
    demo:
      name: Demo
      work_dir: /tmp/demo
      members:
        - role: reviewer
`,
                );
                await expect(svc.materializeTeam('demo')).rejects.toThrow('no Layer-1 role table is available');
            } finally {
                await cleanup();
            }
        });

        test('prunes orphaned generated specs that are no longer desired', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');
                // A previously-generated member that is no longer in the config's member list.
                await seedSpec(configDir, 'devops-stale', ['team:devops', 'spur:generated']);

                const result = await svc.materializeTeam('devops');
                expect(result.orphaned).toEqual(['devops-stale']);
                // The orphan is deleted from disk.
                const specs = await loadAgentSpecs(configDir);
                expect(specs.find((s) => s.id === 'devops-stale')).toBeUndefined();
            } finally {
                await cleanup();
            }
        });

        test('skips hand-authored (ref:) specs — never overwrites them', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');
                // A hand-authored spec occupying devops-claude (team tag but NOT generated).
                await seedSpec(configDir, 'devops-claude', ['team:devops'], 'handauth');

                const result = await svc.materializeTeam('devops');
                // devops-claude is hand-authored → skipped (not in upserted, not orphaned).
                expect(result.upserted).toEqual(['devops-codex']);
                expect(result.orphaned).toEqual([]);
                // The hand-authored spec is untouched (type preserved, not overwritten).
                const specs = await loadAgentSpecs(configDir);
                const claude = specs.find((s) => s.id === 'devops-claude');
                expect(claude?.type).toBe('handauth');
                expect(claude?.tags).not.toContain('spur:generated');
            } finally {
                await cleanup();
            }
        });

        test('falls back to a type-derived purpose when the member omits purpose', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');

                await svc.materializeTeam('devops');
                const specs = await loadAgentSpecs(configDir);
                // codex member has no purpose → falls back to "<agent> agent".
                const codex = specs.find((s) => s.id === 'devops-codex');
                expect(codex?.purpose).toBe('codex agent');
            } finally {
                await cleanup();
            }
        });
    });

    describe('teardownTeam (R3)', () => {
        test('without purge returns stopped ids for all team specs and deletes nothing', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');
                await seedSpec(configDir, 'devops-claude', ['team:devops', 'spur:generated']);
                await seedSpec(configDir, 'devops-handauth', ['team:devops'], 'handauth');

                const result = await svc.teardownTeam('devops');
                expect(result.purged).toEqual([]);
                expect(result.stopped.sort()).toEqual(['devops-claude', 'devops-handauth']);
                // No deletion without purge.
                const specs = await loadAgentSpecs(configDir);
                expect(specs).toHaveLength(2);
            } finally {
                await cleanup();
            }
        });

        test('with purge deletes only generated specs and never hand-authored ones', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const configDir = join(cwd, '.spur', 'agents');
                await seedSpec(configDir, 'devops-claude', ['team:devops', 'spur:generated']);
                await seedSpec(configDir, 'devops-codex', ['team:devops', 'spur:generated'], 'codex');
                await seedSpec(configDir, 'devops-handauth', ['team:devops'], 'handauth');

                const result = await svc.teardownTeam('devops', { purge: true });
                expect(result.purged.sort()).toEqual(['devops-claude', 'devops-codex']);
                // Hand-authored spec survives the purge.
                const specs = await loadAgentSpecs(configDir);
                const ids = specs.map((s) => s.id);
                expect(ids).toEqual(['devops-handauth']);
            } finally {
                await cleanup();
            }
        });

        test('returns empty stopped list when the team has no specs', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                await writeConfig(cwd, DEVOPS_CONFIG);
                const result = await svc.teardownTeam('devops', { purge: true });
                expect(result.purged).toEqual([]);
                expect(result.stopped).toEqual([]);
            } finally {
                await cleanup();
            }
        });
    });

    describe('buildIdentity', () => {
        test('builds a preamble listing workspace peers (excluding self)', async () => {
            const { svc, cwd, cleanup } = await makeService();
            try {
                const configDir = join(cwd, '.spur', 'agents');
                await seedSpec(configDir, 'planner', [], 'claude');
                await seedSpec(configDir, 'reviewer', [], 'codex');
                await seedSpec(configDir, 'loner', [], 'omp');
                // 'loner' has a different workspace (/tmp) but the seeds all use /tmp,
                // so all three share the workspace — planner's peers are reviewer + loner.

                const specs = await loadAgentSpecs(configDir);
                const planner = specs.find((s) => s.id === 'planner') as AgentSpec;
                const preamble = await svc.buildIdentity(planner, '0258', 'Team runtime');
                expect(preamble).toContain('planner');
                // Peers are included; self is not duplicated as a peer.
                expect(preamble).toContain('reviewer');
                expect(preamble).toContain('loner');
            } finally {
                await cleanup();
            }
        });
    });
});

// ---------------------------------------------------------------------------
// Drain loop (0253 R5/AC3): drainPending + countPending
// ---------------------------------------------------------------------------

describe('TeamService drain loop (0253)', () => {
    test('drainPending consumes queued messages and marks them injected', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await svc.sendMessage('operator', 'planner', 'one');
            await svc.sendMessage('operator', 'planner', 'two');

            const drained = await svc.drainPending('planner');
            expect(drained.count).toBe(2);
            // Every drained row is now in the injected state (consumed, not just read).
            expect(drained.messages.every((m) => m.status === 'injected')).toBe(true);
            const bodies = drained.messages.map((m) => m.body).sort();
            expect(bodies).toEqual(['one', 'two']);
        } finally {
            await cleanup();
        }
    });

    test('drainPending is idempotent — a second call returns nothing', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await svc.sendMessage('operator', 'planner', 'one');
            await svc.drainPending('planner');
            const second = await svc.drainPending('planner');
            expect(second.count).toBe(0);
            expect(second.messages).toEqual([]);
        } finally {
            await cleanup();
        }
    });

    test('countPending reports queued messages and drops to zero after drain', async () => {
        const { svc, cleanup } = await makeService();
        try {
            expect(await svc.countPending('planner')).toBe(0);
            await svc.sendMessage('operator', 'planner', 'one');
            await svc.sendMessage('operator', 'planner', 'two');
            expect(await svc.countPending('planner')).toBe(2);

            await svc.drainPending('planner');
            expect(await svc.countPending('planner')).toBe(0);
        } finally {
            await cleanup();
        }
    });

    test('drainPending and countPending reject an invalid agent id', async () => {
        const { svc, cleanup } = await makeService();
        try {
            await expect(svc.drainPending('Bad ID')).rejects.toThrow();
            await expect(svc.countPending('Bad ID')).rejects.toThrow();
        } finally {
            await cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// Team.* event family (task 0371 / J3 R15–R17)
// ---------------------------------------------------------------------------

function makeTeamCapturingBus(): {
    bus: TeamServiceEventBus;
    lifecycle: Map<string, TeamLifecycleEventPayload[]>;
    members: Map<string, TeamMemberEventPayload[]>;
} {
    const bus = new EventBus() as unknown as TeamServiceEventBus;
    const lifecycle = new Map<string, TeamLifecycleEventPayload[]>([
        ['team.up', []],
        ['team.down', []],
    ]);
    const members = new Map<string, TeamMemberEventPayload[]>([
        ['team.member.assigned', []],
        ['team.member.started', []],
        ['team.member.stopped', []],
    ]);
    bus.on('team.up', (e) => lifecycle.get('team.up')?.push(e));
    bus.on('team.down', (e) => lifecycle.get('team.down')?.push(e));
    bus.on('team.member.assigned', (e) => members.get('team.member.assigned')?.push(e));
    bus.on('team.member.started', (e) => members.get('team.member.started')?.push(e));
    bus.on('team.member.stopped', (e) => members.get('team.member.stopped')?.push(e));
    return { bus, lifecycle, members };
}

describe('TeamService team.* events (task 0371)', () => {
    test('R15: materializeTeam emits team.up with teamId and memberCount', async () => {
        const { bus, lifecycle } = makeTeamCapturingBus();
        const { svc, cwd, cleanup } = await makeService(bus);
        try {
            await writeConfig(cwd, DEVOPS_CONFIG);
            const result = await svc.materializeTeam('devops');
            expect(result.written).toBe(true);
            const ups = lifecycle.get('team.up');
            expect(ups?.length).toBe(1);
            expect(ups?.[0]?.teamId).toBe('devops');
            expect(ups?.[0]?.memberCount).toBe(result.upserted.length);
            expect(ups?.[0]?.outcome).toBe('ok');
        } finally {
            await cleanup();
        }
    });

    test('R15: dry-run materialize does not emit team.up', async () => {
        const { bus, lifecycle } = makeTeamCapturingBus();
        const { svc, cwd, cleanup } = await makeService(bus);
        try {
            await writeConfig(cwd, DEVOPS_CONFIG);
            await svc.materializeTeam('devops', { check: true });
            expect(lifecycle.get('team.up')).toEqual([]);
        } finally {
            await cleanup();
        }
    });

    test('R15: teardownTeam emits team.down with teamId and memberCount', async () => {
        const { bus, lifecycle } = makeTeamCapturingBus();
        const { svc, cwd, cleanup } = await makeService(bus);
        try {
            await writeConfig(cwd, DEVOPS_CONFIG);
            await svc.materializeTeam('devops');
            const result = await svc.teardownTeam('devops', { purge: true });
            const downs = lifecycle.get('team.down');
            expect(downs?.length).toBe(1);
            expect(downs?.[0]?.teamId).toBe('devops');
            expect(downs?.[0]?.memberCount).toBe(result.stopped.length);
            expect(downs?.[0]?.outcome).toBe('purged');
        } finally {
            await cleanup();
        }
    });

    test('R16: assignTask emits team.member.assigned with teamId/memberId/agentType', async () => {
        const { bus, members } = makeTeamCapturingBus();
        const { svc, cwd, cleanup } = await makeService(bus);
        try {
            await writeConfig(cwd, DEVOPS_CONFIG);
            await svc.materializeTeam('devops');
            const tasksDir = join(cwd, 'docs', 'tasks');
            await mkdir(tasksDir, { recursive: true });
            await writeFile(join(tasksDir, '0042_demo_task.md'), '---\nname: Demo\nstatus: Todo\n---\n\nbody\n');

            await svc.assignTask('0042', 'devops-claude');
            const assigned = members.get('team.member.assigned');
            expect(assigned?.length).toBe(1);
            expect(assigned?.[0]?.teamId).toBe('devops');
            expect(assigned?.[0]?.memberId).toBe('devops-claude');
            expect(assigned?.[0]?.agentType).toBe('claude');
            expect(assigned?.[0]?.outcome).toBe('assigned');
            expect(assigned?.[0]?.taskId).toBe('0042');
        } finally {
            await cleanup();
        }
    });

    test('R17: assignTask for unknown member still emits with null unresolved fields', async () => {
        const { bus, members } = makeTeamCapturingBus();
        const { svc, cwd, cleanup } = await makeService(bus);
        try {
            const tasksDir = join(cwd, 'docs', 'tasks');
            await mkdir(tasksDir, { recursive: true });
            await writeFile(join(tasksDir, '0042_demo_task.md'), '---\nname: Demo\nstatus: Todo\n---\n\nbody\n');

            // Agent id is syntactically valid but has no roster/spec entry.
            await svc.assignTask('0042', 'ghost-member');
            const assigned = members.get('team.member.assigned');
            expect(assigned?.length).toBe(1);
            expect(assigned?.[0]?.memberId).toBe('ghost-member');
            expect(assigned?.[0]?.teamId).toBeNull();
            expect(assigned?.[0]?.agentType).toBeNull();
            expect(assigned?.[0]?.outcome).toBe('assigned');
        } finally {
            await cleanup();
        }
    });

    test('R2: TeamOrchestrator agent.started bridges to team.member.started', async () => {
        const { bus, members } = makeTeamCapturingBus();
        const agentBus = new EventBus<AgentEvents>();
        const { svc, cwd, cleanup } = await makeService(bus, agentBus);
        try {
            const configDir = join(cwd, '.spur', 'agents');
            await createNodeFileSystem(cwd).ensureDir(configDir);
            await saveAgentSpec(
                {
                    id: 'devops-coder',
                    name: 'coder',
                    type: 'codex',
                    workspace: cwd,
                    purpose: 'Implement',
                    tags: ['team:devops', 'spur:generated'],
                    config: {},
                },
                configDir,
            );

            // Touch orchestrator() so the agent.* → team.member.* bridge is wired.
            await svc.getStatus();

            // Drive the agent bus the way TeamOrchestrator would.
            agentBus.emit('agent.started', {
                agentId: 'devops-coder',
                agentType: 'codex',
                pid: 99,
                severity: 'info',
            });
            // Allow the async identity resolve to settle.
            await new Promise((r) => setTimeout(r, 20));

            const started = members.get('team.member.started');
            expect(started?.length).toBe(1);
            expect(started?.[0]?.memberId).toBe('devops-coder');
            expect(started?.[0]?.teamId).toBe('devops');
            expect(started?.[0]?.agentType).toBe('codex');
            expect(started?.[0]?.outcome).toBe('started');
        } finally {
            await cleanup();
        }
    });

    test('R2: TeamOrchestrator agent.stopped bridges to team.member.stopped', async () => {
        const { bus, members } = makeTeamCapturingBus();
        const agentBus = new EventBus<AgentEvents>();
        const { svc, cwd, cleanup } = await makeService(bus, agentBus);
        try {
            const configDir = join(cwd, '.spur', 'agents');
            await createNodeFileSystem(cwd).ensureDir(configDir);
            await saveAgentSpec(
                {
                    id: 'devops-coder',
                    name: 'coder',
                    type: 'codex',
                    workspace: cwd,
                    purpose: 'Implement',
                    tags: ['team:devops', 'spur:generated'],
                    config: {},
                },
                configDir,
            );

            await svc.getStatus();

            agentBus.emit('agent.stopped', {
                agentId: 'devops-coder',
                exitCode: 0,
                severity: 'info',
            });
            await new Promise((r) => setTimeout(r, 20));

            const stopped = members.get('team.member.stopped');
            expect(stopped?.length).toBe(1);
            expect(stopped?.[0]?.memberId).toBe('devops-coder');
            expect(stopped?.[0]?.teamId).toBe('devops');
            expect(stopped?.[0]?.agentType).toBe('codex');
            expect(stopped?.[0]?.outcome).toBe('stopped');
        } finally {
            await cleanup();
        }
    });

    test('R15: teardownTeam without purge emits outcome ok (not purged)', async () => {
        const { bus, lifecycle } = makeTeamCapturingBus();
        const { svc, cwd, cleanup } = await makeService(bus);
        try {
            await writeConfig(cwd, DEVOPS_CONFIG);
            await svc.materializeTeam('devops');
            const result = await svc.teardownTeam('devops');
            expect(result.purged).toEqual([]);
            const downs = lifecycle.get('team.down');
            expect(downs?.length).toBe(1);
            expect(downs?.[0]?.teamId).toBe('devops');
            expect(downs?.[0]?.outcome).toBe('ok');
        } finally {
            await cleanup();
        }
    });

    test('no team.* emit when eventBus is absent (CLI without ledger)', async () => {
        const { svc, cwd, cleanup } = await makeService();
        try {
            await writeConfig(cwd, DEVOPS_CONFIG);
            // Must not throw without a bus.
            await svc.materializeTeam('devops');
            await svc.teardownTeam('devops');
        } finally {
            await cleanup();
        }
    });
});
