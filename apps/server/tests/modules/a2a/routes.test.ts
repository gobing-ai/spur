/**
 * G9 task 1336 — `spur serve` speaks A2A (HTTP+JSON binding, v1.0).
 *
 * The failure modes come first (task Plan step 1): a mounted route with the endpoint off, a
 * write that sneaks past authentication, a duplicate message id that double-enqueues, an
 * unknown task id, a receipt read that invents a state, a cancel that does not stop the run,
 * state held in memory that dies with the process, and a token that leaks into a response.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { a2aModule } from '../../../src/modules/a2a';

const TOKEN = 'test-token-value-1234';
const MEMBER = 'proj-coder';

interface Harness {
    app: Hono;
    db: Awaited<ReturnType<typeof createMigratedDb>>;
    inbox: Awaited<ReturnType<typeof makeInbox>>;
    stops: string[];
    close(): Promise<void>;
}

async function createMigratedDb(args: { url: string }) {
    const { createMigratedDb: factory } = await import('@gobing-ai/spur-domain');
    return factory(args);
}

async function makeInbox(getDb: () => Promise<unknown>) {
    const { InboxService } = await import('@gobing-ai/spur-app');
    return new InboxService({ getDb: getDb as never });
}

let tempDir: string;
let harness: Harness;

/**
 * A context slice the module needs: the DB, the inbox, the fleet roster (declared members),
 * the supervisor stop path, and the boot config carrying the a2a switch + token.
 */
async function makeHarness(
    options: { enabled?: boolean; members?: string[]; tokenVarUnset?: boolean } = {},
): Promise<Harness> {
    const db = await createMigratedDb({ url: ':memory:' });
    const inbox = await makeInbox(async () => db);
    const stops: string[] = [];
    const memberIds = options.members ?? [MEMBER];
    const enabled = options.enabled ?? true;
    const fs = createNodeFileSystem();
    const ctx = {
        cwd: tempDir,
        fs,
        runDir: join(tempDir, '.spur', 'run'),
        getDb: async () => db,
        inbox: () => inbox,
        supervisor: () => ({
            stop: async (agentId: string) => {
                stops.push(agentId);
            },
        }),
        coordination: () => ({ listAgentSpecs: async () => memberIds.map((id) => ({ id, name: id })) }),
        fleetService: () => ({
            memberAddresses: async () =>
                memberIds.map((instanceId) => ({ instanceId, executor: 'claude', enabled: true })),
        }),
        env: options.tokenVarUnset === true ? {} : { SPUR_A2A_TOKEN: TOKEN },
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        bootConfig: () => ({
            a2a: { enabled, authEnv: enabled ? 'SPUR_A2A_TOKEN' : null },
        }),
    } as unknown as ServerContext;
    const app = new Hono();
    a2aModule.mount(app, ctx);
    return {
        app,
        db,
        inbox,
        stops,
        close: async () => {
            await db.close();
        },
    };
}

function cardUrl(member = MEMBER): string {
    return `http://localhost/a2a/members/${member}/.well-known/agent-card.json`;
}

function memberUrl(path: string, member = MEMBER): string {
    return `http://localhost/a2a/members/${member}/${path}`;
}

function authed(init: RequestInit = {}): RequestInit {
    return { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${TOKEN}` } };
}

async function sendMessage(messageId: string, text = 'deploy the docs site') {
    return harness.app.request(
        memberUrl('message:send'),
        authed({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: { messageId, role: 'ROLE_USER', parts: [{ text }] } }),
        }),
    );
}

/** Seed a coordination run row for a message id, with the given terminal or live status. */
async function seedRun(messageId: string, status: 'running' | 'exited' | 'errored'): Promise<string> {
    const { CoordinationRunDao } = await import('@gobing-ai/spur-domain');
    const runs = new CoordinationRunDao(harness.db as never);
    const runId = `run-${messageId}`;
    await runs.insertStart({
        specId: MEMBER,
        agentKind: 'claude',
        processId: null,
        runId,
        generation: 1,
        startedAt: new Date().toISOString(),
        messageIds: [messageId],
    });
    if (status !== 'running')
        await runs.updateExit(runId, status, new Date().toISOString(), '[]', {
            messageIds: [messageId],
            outcome: status === 'exited' ? 'run-exit-only' : 'errored',
        });
    return runId;
}

beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'spur-a2a-'));
    harness = await makeHarness();
});

afterEach(async () => {
    await harness.close();
    rmSync(tempDir, { recursive: true, force: true });
});

describe('a2a module — off by default (R1/R5)', () => {
    test('no A2A route exists when the endpoint is disabled', async () => {
        harness = await makeHarness({ enabled: false });
        for (const [url, init] of [
            [cardUrl(), {}],
            [memberUrl('message:send'), { method: 'POST', body: '{}' }],
            [memberUrl('tasks/msg_1'), {}],
            [memberUrl('tasks/msg_1:cancel'), { method: 'POST', body: '{}' }],
        ] as [string, RequestInit][]) {
            const res = await harness.app.request(url, init);
            expect(res.status).toBe(404);
        }
    });

    test('a disabled endpoint enqueues nothing', async () => {
        harness = await makeHarness({ enabled: false });
        await harness.app.request(
            memberUrl('message:send'),
            authed({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: { messageId: 'm-off', role: 'ROLE_USER', parts: [{ text: 'hi' }] } }),
            }),
        );
        const { messages } = await harness.inbox.list(MEMBER, 'in');
        expect(messages).toHaveLength(0);
    });
});

describe('a2a module — authentication (R5/R6)', () => {
    test('a missing bearer token is rejected and enqueues nothing', async () => {
        const res = await harness.app.request(memberUrl('message:send'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: { messageId: 'm-noauth', role: 'ROLE_USER', parts: [{ text: 'hi' }] } }),
        });
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toContain('Bearer');
        const { messages } = await harness.inbox.list(MEMBER, 'in');
        expect(messages).toHaveLength(0);
    });

    test('a wrong bearer token is rejected on every route', async () => {
        for (const [url, init] of [
            [cardUrl(), {}],
            [memberUrl('tasks/msg_1'), {}],
        ] as [string, RequestInit][]) {
            const res = await harness.app.request(url, { ...init, headers: { Authorization: 'Bearer wrong' } });
            expect(res.status).toBe(401);
        }
    });

    test('enabled with an unreadable token variable refuses loudly instead of faking a 404', async () => {
        harness = await makeHarness({ tokenVarUnset: true });
        const res = await harness.app.request(cardUrl(), { headers: { Authorization: 'Bearer anything' } });
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: { message: string } };
        expect(body.error.message).toContain('server.a2a.authEnv');
    });

    test('no response body echoes the configured token', async () => {
        const res = await sendMessage('m-leak');
        const body = await res.text();
        expect(body).not.toContain(TOKEN);
    });
});

describe('a2a module — agent card (R2)', () => {
    test('the card reports protocol 1.0, HTTP+JSON and the member name', async () => {
        const res = await harness.app.request(cardUrl(), authed());
        expect(res.status).toBe(200);
        const card = (await res.json()) as Record<string, unknown>;
        expect(card.name).toBe(MEMBER);
        const interfaces = card.supportedInterfaces as {
            protocolBinding: string;
            protocolVersion: string;
            url: string;
        }[];
        expect(interfaces).toHaveLength(1);
        expect(interfaces[0]?.protocolBinding).toBe('HTTP+JSON');
        expect(interfaces[0]?.protocolVersion).toBe('1.0');
        expect(interfaces[0]?.url).toBe('http://localhost/a2a/members/proj-coder');
        const capabilities = card.capabilities as { streaming: boolean; pushNotifications: boolean };
        expect(capabilities.streaming).toBe(false);
        expect(capabilities.pushNotifications).toBe(false);
    });

    test('an unknown member has no card', async () => {
        const res = await harness.app.request(cardUrl('nobody'), authed());
        expect(res.status).toBe(404);
    });
});

describe('a2a module — SendMessage is one keyed inbox request (R3)', () => {
    test('a message becomes one request row and the task id is its message id', async () => {
        const res = await sendMessage('m-1');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { task: { id: string; status: { state: string } } };
        const { messages } = await harness.inbox.list(MEMBER, 'in');
        expect(messages).toHaveLength(1);
        expect(body.task.id).toBe(messages[0]?.id ?? '');
        expect(messages[0]?.kind).toBe('request');
        expect(messages[0]?.requestKey ?? '').toBe(`a2a:${MEMBER}:m-1`);
        expect(messages[0]?.body).toBe('deploy the docs site');
    });

    test('the same message id twice yields one row and the same task id', async () => {
        const first = (await (await sendMessage('m-dup')).json()) as { task: { id: string } };
        const second = (await (await sendMessage('m-dup')).json()) as { task: { id: string } };
        expect(second.task.id).toBe(first.task.id);
        const { messages } = await harness.inbox.list(MEMBER, 'in');
        expect(messages).toHaveLength(1);
    });

    test('a reused message id with different work is a conflict, not a silent drop', async () => {
        await sendMessage('m-dup2', 'first work');
        const res = await sendMessage('m-dup2', 'different work');
        expect(res.status).toBe(409);
        const { messages } = await harness.inbox.list(MEMBER, 'in');
        expect(messages).toHaveLength(1);
    });

    test('a message without a message id is rejected', async () => {
        const res = await harness.app.request(
            memberUrl('message:send'),
            authed({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: { role: 'ROLE_USER', parts: [{ text: 'hi' }] } }),
            }),
        );
        expect(res.status).toBe(400);
        const { messages } = await harness.inbox.list(MEMBER, 'in');
        expect(messages).toHaveLength(0);
    });

    test('an unknown member refuses the message instead of queueing it', async () => {
        const res = await harness.app.request(
            memberUrl('message:send', 'nobody'),
            authed({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: { messageId: 'm-x', role: 'ROLE_USER', parts: [{ text: 'hi' }] } }),
            }),
        );
        expect(res.status).toBe(404);
    });
});

describe('a2a module — GetTask reads the receipt (R4)', () => {
    test('an unknown task id is TaskNotFound', async () => {
        const res = await harness.app.request(memberUrl('tasks/msg_missing'), authed());
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: { status: string; message: string } };
        expect(body.error.status).toBe('NOT_FOUND');
        expect(body.error.message).toContain('msg_missing');
    });

    test('a queued request with no run row is submitted', async () => {
        const sent = (await (await sendMessage('m-q')).json()) as { task: { id: string } };
        const res = await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed());
        const task = (await res.json()) as { status: { state: string } };
        expect(task.status.state).toBe('TASK_STATE_SUBMITTED');
    });

    test('a running receipt is working', async () => {
        const sent = (await (await sendMessage('m-r')).json()) as { task: { id: string } };
        await seedRun(sent.task.id, 'running');
        const task = (await (await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
            status: { state: string };
        };
        expect(task.status.state).toBe('TASK_STATE_WORKING');
    });

    test('an exited receipt is completed and carries the answer as a text artifact', async () => {
        const sent = (await (await sendMessage('m-c')).json()) as { task: { id: string } };
        await seedRun(sent.task.id, 'exited');
        await harness.inbox.reply(sent.task.id, MEMBER, 'docs site deployed');
        const task = (await (await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
            status: { state: string };
            artifacts?: { parts: { text?: string }[] }[];
        };
        expect(task.status.state).toBe('TASK_STATE_COMPLETED');
        expect(task.artifacts?.[0]?.parts[0]?.text).toBe('docs site deployed');
    });

    test('a completed task carries the remote working branch in metadata (1337 R4)', async () => {
        const init = Bun.spawnSync({ cmd: ['git', 'init', '-b', 'sp/remote-e2e'], cwd: tempDir });
        expect(init.exitCode).toBe(0);
        const sent = (await (await sendMessage('m-branch')).json()) as { task: { id: string } };
        await seedRun(sent.task.id, 'exited');
        await harness.inbox.reply(sent.task.id, MEMBER, 'mutating work completed');
        const task = (await (await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
            status: { state: string };
            metadata?: { remoteBranch?: string };
        };
        expect(task.status.state).toBe('TASK_STATE_COMPLETED');
        expect(task.metadata?.remoteBranch).toBe('sp/remote-e2e');
    });

    test('an errored receipt is failed with the reason', async () => {
        const sent = (await (await sendMessage('m-f')).json()) as { task: { id: string } };
        await seedRun(sent.task.id, 'errored');
        const task = (await (await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
            status: { state: string; message?: { parts: { text?: string }[] } };
        };
        expect(task.status.state).toBe('TASK_STATE_FAILED');
        expect(task.status.message?.parts[0]?.text).toContain('failed');
    });

    test('state survives a restart because it is read from the store, not memory', async () => {
        const sent = (await (await sendMessage('m-restart')).json()) as { task: { id: string } };
        await seedRun(sent.task.id, 'exited');
        // A second app over the SAME database stands in for a restarted `spur serve`.
        const app2 = new Hono();
        const ctx = {
            cwd: tempDir,
            fs: createNodeFileSystem(),
            runDir: join(tempDir, '.spur', 'run'),
            getDb: async () => harness.db,
            inbox: () => harness.inbox,
            supervisor: () => ({ stop: async () => {} }),
            logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
            coordination: () => ({ listAgentSpecs: async () => [] }),
            fleetService: () => ({
                memberAddresses: async () => [{ instanceId: MEMBER, executor: 'claude', enabled: true }],
            }),
            env: { SPUR_A2A_TOKEN: TOKEN },
            bootConfig: () => ({ a2a: { enabled: true, authEnv: 'SPUR_A2A_TOKEN' } }),
        } as unknown as ServerContext;
        a2aModule.mount(app2, ctx);
        const task = (await (await app2.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
            status: { state: string };
        };
        expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    });
});

describe('a2a module — CancelTask stops the run (R5)', () => {
    test('canceling a working task stops the run and reports canceled', async () => {
        const sent = (await (await sendMessage('m-cancel')).json()) as { task: { id: string } };
        await seedRun(sent.task.id, 'running');
        const res = await harness.app.request(
            memberUrl(`tasks/${sent.task.id}:cancel`),
            authed({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        );
        expect(res.status).toBe(200);
        expect(harness.stops).toEqual([MEMBER]);
        const task = (await (await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
            status: { state: string };
        };
        expect(task.status.state).toBe('TASK_STATE_CANCELED');
    });

    test('canceling a task with no run in progress is refused, never faked', async () => {
        const sent = (await (await sendMessage('m-queued')).json()) as { task: { id: string } };
        const res = await harness.app.request(
            memberUrl(`tasks/${sent.task.id}:cancel`),
            authed({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        );
        expect(res.status).toBe(400);
        expect(harness.stops).toHaveLength(0);
        const task = (await (await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
            status: { state: string };
        };
        expect(task.status.state).toBe('TASK_STATE_SUBMITTED');
    });

    test('canceling a finished task is refused and leaves the state alone', async () => {
        const sent = (await (await sendMessage('m-done')).json()) as { task: { id: string } };
        await seedRun(sent.task.id, 'exited');
        const res = await harness.app.request(
            memberUrl(`tasks/${sent.task.id}:cancel`),
            authed({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: { status: string } };
        expect(body.error.status).toBe('FAILED_PRECONDITION');
        expect(harness.stops).toHaveLength(0);
        const task = (await (await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
            status: { state: string };
        };
        expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    });
});
