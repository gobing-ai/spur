/**
 * G9 task 1336 — `spur self serve` speaks A2A (HTTP+JSON binding, v1.0).
 *
 * The failure modes come first (task Plan step 1): a mounted route with the endpoint off, a
 * write that sneaks past authentication, a duplicate message id that double-enqueues, an
 * unknown task id, a receipt read that invents a state, a cancel that does not stop the run,
 * state held in memory that dies with the process, and a token that leaks into a response.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lanePath, ProjectRegistry, registerSystemEventTap, resolveLaneRoot } from '@gobing-ai/spur-app';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { SystemEventDao } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
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
    /** 1376: what the module emitted on `ctx.eventBus()`. */
    events: Array<{ name: string; payload: Record<string, unknown> }>;
    /** 1377: the persisted ledger rows for one name (tap flushed first), payload = envelope `data`. */
    rows(name: string): Promise<Array<{ data: Record<string, unknown>; raw: string }>>;
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
    options: {
        enabled?: boolean;
        members?: string[];
        tokenVarUnset?: boolean;
        /** 1421 R4: the member's declared role and purpose, which the card projects as a skill. */
        role?: string;
        purpose?: string;
        /** 1421 R5: lane mode is on, which is what `agent.fleet.maxWriters` presence means. */
        laneMode?: boolean;
    } = {},
): Promise<Harness> {
    const db = await createMigratedDb({ url: ':memory:' });
    const inbox = await makeInbox(async () => db);
    const stops: string[] = [];
    const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
    // The canonical bus + catalog tap over the harness DB: the same path `serve` wires, so a
    // route's emit is proven to reach the ledger, not just an array (1377 Plan Step 1).
    const bus = new EventBus<Record<string, (event: unknown) => void>>();
    const dao = new SystemEventDao(db as never);
    const tap = registerSystemEventTap(bus, dao, { warn: () => {}, debug: () => {} }, { diagnosticEnabled: false });
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
                memberIds.map((instanceId) => ({
                    instanceId,
                    localId: 'coder',
                    executor: 'claude',
                    enabled: true,
                    ...(options.role === undefined ? {} : { role: options.role }),
                    ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
                })),
            ...(options.laneMode === true ? { load: async () => ({ maxWriters: 2 }) } : {}),
        }),
        env: options.tokenVarUnset === true ? {} : { SPUR_A2A_TOKEN: TOKEN },
        // 1376 R4 / 1377 R1-R3: the module emits onto the canonical bus; the recording handler
        // keeps the raw payload for the direct assertions while the tap persists the ledger rows.
        eventBus: () => ({
            emit: (name: string, payload: Record<string, unknown>) => {
                events.push({ name, payload });
                return bus.emit(name, payload);
            },
        }),
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
        events,
        rows: async (name: string) => {
            await tap.flush();
            const rows = await dao.query({ name, limit: 20 });
            return rows.map((row) => {
                const raw = row.payload_json ?? '';
                const parsed = JSON.parse(raw === '' ? '{}' : raw) as { data?: Record<string, unknown> };
                return { data: parsed.data ?? {}, raw };
            });
        },
        close: async () => {
            tap.unsubscribe();
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

    test('a refused request emits auth.denied for surface a2a without token material (1376 R4, R5)', async () => {
        await harness.app.request(memberUrl('message:send'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: { messageId: 'm-denied', role: 'ROLE_USER', parts: [{ text: 'hi' }] } }),
        });
        const denied = harness.events.find((event) => event.name === 'auth.denied');
        if (denied === undefined) throw new Error('expected an auth.denied emit');
        expect(denied.payload.surface).toBe('a2a');
        expect(denied.payload.reason).toBe('missing');
        expect(String(denied.payload.path)).toContain(`/a2a/members/${MEMBER}/`);
        expect(JSON.stringify(denied.payload)).not.toContain(TOKEN);
    });

    test('a wrong bearer token is rejected on every bearer-only route', async () => {
        for (const [url, init] of [
            [memberUrl('tasks/msg_1'), {}],
            [memberUrl('message:send'), { method: 'POST', body: '{}' }],
        ] as [string, RequestInit][]) {
            const res = await harness.app.request(url, { ...init, headers: { Authorization: 'Bearer wrong' } });
            expect(res.status).toBe(401);
        }
    });

    test('the Agent Card needs no bearer token while every other route does (R3)', async () => {
        const card = await harness.app.request(cardUrl());
        expect(card.status).toBe(200);
        const body = (await card.json()) as { name: string };
        expect(body.name).toBe(MEMBER);
        // The same unauthenticated caller is refused on the write and the read routes, and the
        // refusal is observable (R3's second half).
        for (const [url, init] of [
            [memberUrl('message:send'), { method: 'POST', body: '{}' }],
            [memberUrl('tasks/msg_1'), {}],
        ] as [string, RequestInit][]) {
            const res = await harness.app.request(url, init);
            expect(res.status).toBe(401);
        }
        expect(harness.events.filter((event) => event.name === 'auth.denied')).toHaveLength(2);
    });

    test('enabled with an unreadable token variable refuses loudly instead of faking a 404', async () => {
        harness = await makeHarness({ tokenVarUnset: true });
        const res = await harness.app.request(memberUrl('tasks/msg_1'), {
            headers: { Authorization: 'Bearer anything' },
        });
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

    test('the card carries one skill derived from the member declaration (1421 R4)', async () => {
        harness = await makeHarness({ role: 'implementer', purpose: 'lands the feature tasks' });
        const res = await harness.app.request(cardUrl());
        expect(res.status).toBe(200);
        const card = (await res.json()) as {
            skills: Array<{ id: string; name: string; description: string; tags: string[] }>;
        };
        expect(card.skills).toEqual([
            { id: 'implementer', name: 'implementer', description: 'lands the feature tasks', tags: ['implementer'] },
        ]);
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

    test('a completed task in lane mode reports the member worktree branch (1421 R5)', async () => {
        await harness.close();
        harness = await makeHarness({ laneMode: true });
        const init = Bun.spawnSync({ cmd: ['git', 'init', '-b', 'main'], cwd: tempDir });
        expect(init.exitCode).toBe(0);
        const commit = Bun.spawnSync({
            cmd: [
                'git',
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.test',
                'commit',
                '--allow-empty',
                '-m',
                'fixture',
            ],
            cwd: tempDir,
        });
        expect(commit.exitCode).toBe(0);
        const laneRoot = resolveLaneRoot(tempDir, undefined);
        mkdirSync(laneRoot);
        try {
            const lane = lanePath(tempDir, undefined, 'coder', 1);
            const add = Bun.spawnSync({ cmd: ['git', 'worktree', 'add', '-b', 'lane/coder', lane], cwd: tempDir });
            expect(add.exitCode).toBe(0);
            const sent = (await (await sendMessage('m-lane')).json()) as { task: { id: string } };
            const runId = await seedRun(sent.task.id, 'exited');
            const branch = Bun.spawnSync({ cmd: ['git', 'branch', '--show-current'], cwd: lane });
            expect(branch.exitCode).toBe(0);
            // The agent loop records the actual lane branch beside this run's receipt.
            const receiptDir = join(tempDir, '.spur', 'run', runId);
            mkdirSync(receiptDir, { recursive: true });
            await Bun.write(join(receiptDir, 'a2a-branch'), branch.stdout);
            await harness.inbox.reply(sent.task.id, MEMBER, 'lane work completed');
            const task = (await (await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
                metadata?: { remoteBranch?: string };
            };
            expect(task.metadata?.remoteBranch).toBe('lane/coder');
        } finally {
            rmSync(laneRoot, { recursive: true, force: true });
        }
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
        // A second app over the SAME database stands in for a restarted `spur self serve`.
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
    /** Cancel one task the way the A2A CLI does (empty JSON body, bearer token). */
    async function cancel(taskId: string): Promise<Response> {
        return harness.app.request(
            memberUrl(`tasks/${taskId}:cancel`),
            authed({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        );
    }

    /** Close the coordination row a live run would leave behind when its child dies. */
    async function settleRun(messageId: string, status: 'exited' | 'errored'): Promise<void> {
        const { CoordinationRunDao } = await import('@gobing-ai/spur-domain');
        const runs = new CoordinationRunDao(harness.db as never);
        await runs.updateExit(`run-${messageId}`, status, new Date().toISOString(), '[]', {
            messageIds: [messageId],
            outcome: status === 'exited' ? 'run-exit-only' : 'errored',
        });
    }

    test('canceling a working task requests the cancel and reports canceled (1422 R2/R3)', async () => {
        const sent = (await (await sendMessage('m-cancel')).json()) as { task: { id: string } };
        const runId = await seedRun(sent.task.id, 'running');
        // The member loop is what settles the row once its child is aborted; stand in for it.
        const settle = setTimeout(() => void settleRun(sent.task.id, 'errored'), 300);
        const res = await cancel(sent.task.id);
        clearTimeout(settle);
        expect(res.status).toBe(200);
        // 1422 R3: the member loop is never stopped — only the run behind this task.
        expect(harness.stops).toEqual([]);
        // The request is a durable per-run marker the drain polls (never a fire-and-forget kill).
        expect(existsSync(join(tempDir, '.spur', 'run', runId, 'cancel-requested'))).toBe(true);
        const task = (await (await harness.app.request(memberUrl(`tasks/${sent.task.id}`), authed())).json()) as {
            status: { state: string };
        };
        expect(task.status.state).toBe('TASK_STATE_CANCELED');
    }, 20_000);

    test('a run that never clears reports runStopped false and still never stops the member (1422 R3)', async () => {
        const sent = (await (await sendMessage('m-cancel-timeout')).json()) as { task: { id: string } };
        const runId = await seedRun(sent.task.id, 'running');
        const res = await cancel(sent.task.id);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ metadata: { runStopped: false } });
        expect(harness.stops).toEqual([]);
        expect(existsSync(join(tempDir, '.spur', 'run', runId, 'cancel-requested'))).toBe(true);
        const row = await harness.rows('a2a.task.cancelled');
        const cancelled = row.find((entry) => entry.data.taskId === sent.task.id);
        if (cancelled === undefined) throw new Error('expected an a2a.task.cancelled row');
        expect(cancelled.data.runStopped).toBe(false);
        expect(cancelled.data.runId).toBe(runId);
    }, 30_000);

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

/**
 * 1377 — A2A intake and cancellation are observable: the module's emit reaches the real catalog
 * tap and the `system_events` ledger, and the message body never appears in a payload (R4).
 */
describe('a2a module — intake and cancellation events (1377)', () => {
    test('a first authenticated send emits a2a.message.received with outcome accepted (R2)', async () => {
        const res = await sendMessage('ev-1', 'deploy the docs site');
        expect(res.status).toBe(200);
        const rows = await harness.rows('a2a.message.received');
        const row = rows[0];
        if (row === undefined) throw new Error('expected an a2a.message.received row');
        expect(row.data.member).toBe(MEMBER);
        expect(row.data.messageId).toBe('ev-1');
        expect(row.data.requestKey).toBe(`a2a:${MEMBER}:ev-1`);
        expect(row.data.outcome).toBe('accepted');
        expect(typeof row.data.inboxMessageId).toBe('string');
        // R4: the body is the risk — it must not survive into the stored payload.
        expect(row.raw).not.toContain('deploy the docs site');
    });

    test('the same message id again emits outcome replayed (R2)', async () => {
        await sendMessage('ev-dup', 'first work');
        await sendMessage('ev-dup', 'first work');
        const outcomes = (await harness.rows('a2a.message.received')).map((row) => row.data.outcome);
        expect(outcomes).toContain('accepted');
        expect(outcomes).toContain('replayed');
    });

    test('a reused message id with different work emits outcome conflict (R2)', async () => {
        await sendMessage('ev-conflict', 'first work');
        const res = await sendMessage('ev-conflict', 'different work');
        expect(res.status).toBe(409);
        const row = (await harness.rows('a2a.message.received')).find(
            (entry) => entry.data.messageId === 'ev-conflict',
        );
        if (row === undefined) throw new Error('expected a row for the conflicting message id');
        // Newest-first is not guaranteed; the conflict row is the last one written for this id.
        const outcomes = (await harness.rows('a2a.message.received'))
            .filter((entry) => entry.data.messageId === 'ev-conflict')
            .map((entry) => entry.data.outcome);
        expect(outcomes).toContain('conflict');
        expect(row.raw).not.toContain('different work');
    });

    test('an accepted cancel emits a2a.task.cancelled with runStopped (R3)', async () => {
        const first = (await (await sendMessage('ev-cancel')).json()) as { task: { id: string } };
        await seedRun(first.task.id, 'running');
        // The drain settles its own row once its child is aborted (1422); stand in for it here.
        const settle = setTimeout(() => {
            void (async () => {
                const { CoordinationRunDao } = await import('@gobing-ai/spur-domain');
                await new CoordinationRunDao(harness.db as never).updateExit(
                    `run-${first.task.id}`,
                    'errored',
                    new Date().toISOString(),
                    '[]',
                    { messageIds: [first.task.id], outcome: 'errored' },
                );
            })();
        }, 300);
        const res = await harness.app.request(
            memberUrl(`tasks/${first.task.id}:cancel`),
            authed({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        );
        clearTimeout(settle);
        expect(res.status).toBe(200);
        const row = (await harness.rows('a2a.task.cancelled'))[0];
        if (row === undefined) throw new Error('expected an a2a.task.cancelled row');
        expect(row.data.member).toBe(MEMBER);
        expect(row.data.taskId).toBe(first.task.id);
        expect(row.data.runId).toEqual(expect.any(String));
        // The row cleared inside the wait bound, so the child was really stopped (1422 R3).
        expect(row.data.runStopped).toBe(true);
        expect(row.raw).not.toContain('deploy the docs site');
    });
});

/**
 * 1395 R3/R4 — the card behind the gateway.
 *
 * The failure this closes: the gateway rewrites `host` to the upstream loopback authority, so a card
 * built from `new URL(c.req.url).origin` advertises `http://127.0.0.1:<ephemeral serve port>/…`. Every
 * later send then bypasses the gateway and breaks when the serve restarts on a new port.
 */
describe('A2A card origin behind the gateway (1395 R4)', () => {
    async function cardWith(headers: Record<string, string>): Promise<string> {
        const res = await harness.app.request(cardUrl(), authed({ headers }));
        expect(res.status).toBe(200);
        const card = (await res.json()) as { supportedInterfaces: Array<{ url: string }> };
        return card.supportedInterfaces[0]?.url ?? '';
    }

    test('honors x-forwarded-host and x-forwarded-prefix together', async () => {
        expect(await cardWith({ 'x-forwarded-host': 'localhost:3000', 'x-forwarded-prefix': '/tslibs' })).toBe(
            `http://localhost:3000/tslibs/a2a/members/${MEMBER}`,
        );
    });

    test('preserves the HTTPS scheme of the forwarded gateway origin', async () => {
        expect(
            await cardWith({
                'x-forwarded-host': 'board.example.test',
                'x-forwarded-prefix': '/tslibs',
                'x-forwarded-proto': 'https',
            }),
        ).toBe(`https://board.example.test/tslibs/a2a/members/${MEMBER}`);
    });

    test('falls back to the request origin when a header is missing', async () => {
        const partials: Array<Record<string, string>> = [
            {},
            { 'x-forwarded-host': 'localhost:3000' },
            { 'x-forwarded-prefix': '/tslibs' },
        ];
        for (const headers of partials) {
            expect(await cardWith(headers)).toBe(`http://localhost/a2a/members/${MEMBER}`);
        }
    });

    test('uses the canonical local gateway origin for direct legacy requests', async () => {
        const projectsFile = join(tempDir, 'projects.json');
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        await new ProjectRegistry(projectsFile).upsert({ name: 'proj', path: tempDir, port: 3007 });
        try {
            expect(await cardWith({})).toBe(`http://localhost:3000/proj/a2a/members/${MEMBER}`);
        } finally {
            removeEnvVar('SPUR_PROJECTS_FILE');
        }
    });

    test('an empty forwarded prefix is not treated as a prefix', async () => {
        expect(await cardWith({ 'x-forwarded-host': 'localhost:3000', 'x-forwarded-prefix': '' })).toBe(
            `http://localhost/a2a/members/${MEMBER}`,
        );
    });
});

/**
 * 1395 R2/R3/R4 end to end: the real gateway handler in front of this module's real card route.
 * Nothing is mocked on the A2A path — the gateway proxies into the Hono app — so this pins the whole
 * chain: forwarded headers, card origin, and the URL `resolveProjectCardTarget` would fetch.
 */
describe('gateway → card round trip (1395 R2/R3/R4)', () => {
    test('a card fetched through the gateway advertises the stable gateway URL', async () => {
        const { createGatewayHandler } = await import('@gobing-ai/spur-app');
        const handler = createGatewayHandler({
            listProjects: async () => [{ name: 'ts-libs', path: tempDir, prefix: '/tslibs', port: 3007 }],
            ensureUpstream: async () => 3007,
            port: 3000,
            fetchUpstream: (async (input: unknown, init?: RequestInit) => {
                // Hand the upstream call to the real Hono app; only the authority is rewritten.
                const url = new URL(String(input));
                return harness.app.request(`http://localhost${url.pathname}${url.search}`, init);
            }) as unknown as typeof fetch,
        });
        const res = await handler(
            new Request(`http://localhost:3000/tslibs/a2a/members/${MEMBER}/.well-known/agent-card.json`, {
                headers: { authorization: `Bearer ${TOKEN}` },
            }),
        );
        expect(res.status).toBe(200);
        const card = (await res.json()) as { supportedInterfaces: Array<{ url: string }> };
        expect(card.supportedInterfaces[0]?.url).toBe(`http://localhost:3000/tslibs/a2a/members/${MEMBER}`);
    });
});
