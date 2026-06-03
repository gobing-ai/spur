import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import { NodeFileSystem, setFileSystem } from '@gobing-ai/ts-runtime';
import { TeamService, type TeamServiceContext } from '../../src/index';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

setFileSystem(new NodeFileSystem());

function nullOutput() {
    return { write: () => {}, error: () => {} };
}

/** Build a TeamService over a temp project dir + a shared in-memory database. */
async function makeService(): Promise<{ svc: TeamService; cwd: string; db: DbAdapter; cleanup: () => Promise<void> }> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-team-'));
    const db = await createMigratedDb({ url: ':memory:' });
    const ctx: TeamServiceContext = {
        cwd,
        env: {},
        output: nullOutput(),
        getDb: async () => db,
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
            expect(svc.listAgentSpecs()).toHaveLength(0);
            const fs = new NodeFileSystem();
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
            const specs = svc
                .listAgentSpecs()
                .map((s) => s.id)
                .sort();
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
            const preamble = svc.buildIdentity(coder);
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

    test('assignTask sets assignee in the task frontmatter', async () => {
        const { svc, cwd, cleanup } = await makeService();
        try {
            const tasksDir = join(cwd, 'docs', 'tasks');
            await new NodeFileSystem().mkdir(tasksDir);
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
            await new NodeFileSystem().mkdir(tasksDir);
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
            await new NodeFileSystem().mkdir(tasksDir);
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
