/**
 * Task 1386 — the closed loop, end to end over a real in-memory ledger and bus.
 *
 * Local emit → tap persists (id registered first) → relay reads the ledger → the row is OWN, so it
 * is skipped, never echoed. Foreign write → relayed once → the tap/catch-all skip the marked
 * payload, so the ledger still holds exactly one row. Plus one real child CLI process writing to
 * the same DB, which is the case the task exists for.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSystemEventCatchAllSink, installSystemEventCatchAll, registerSystemEventTap } from '@gobing-ai/spur-app';
import { createMigratedDb, SystemEventDao } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { eventsModule, isRelayedPayload } from '../../../src/modules/events';

const quiet = { warn: () => {}, debug: () => {} };

async function harness() {
    const db = await createMigratedDb({ url: ':memory:' });
    const dao = new SystemEventDao(db);
    const ownIds = new Set<string>();
    // Same wrapper `serve.ts` installs: register the id, then insert.
    const insert = dao.insert.bind(dao);
    dao.insert = async (input) => {
        ownIds.add(input.id);
        return insert(input);
    };
    // A raw DAO for writes this process must NOT know about (another process's rows).
    const foreignDao = new SystemEventDao(db);
    const bus = new EventBus<Record<string, (event: unknown) => void>>();
    const heard: Array<{ name: string; payload: unknown }> = [];
    // A passive recorder beside the tap: what the Board stream would see.
    const ctx = {
        cwd: process.cwd(),
        getDb: async () => db,
        systemEventDao: async () => dao,
        systemEventProjectContext: () => ({ name: 'acme', root: '/workspace/acme' }),
        systemEventSecretValues: () => [],
        ownLedgerIds: () => ownIds,
        eventBus: () => bus,
    } as unknown as ServerContext;

    const tap = registerSystemEventTap(bus, dao, quiet, { skip: isRelayedPayload });
    void tap;
    installSystemEventCatchAll(
        bus,
        createSystemEventCatchAllSink({
            dao,
            logger: quiet,
            projectContext: { name: 'acme', root: process.cwd() },
            skip: isRelayedPayload,
        }),
    );
    const app = new Hono();
    eventsModule.mount(app, ctx);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Recorder subscribes after the tap so relayed payloads are already marked when it fires.
    for (const name of ['task.updated', 'workflow.run.started']) {
        bus.on(name, (payload) => heard.push({ name, payload }));
    }
    const rows = async (name: string) => (await dao.query({ name, limit: 10 })).length;
    void foreignDao;
    const waitFor = async (count: number) => {
        for (let i = 0; i < 80 && heard.length < count; i += 1) await new Promise((r) => setTimeout(r, 20));
    };
    return { db, bus, dao, foreignDao, heard, rows, waitFor };
}

describe('ledger relay loop (task 1386)', () => {
    test('an own emit is persisted once and never echoed back (R1, R3)', async () => {
        const { db, bus, heard, rows, waitFor } = await harness();
        try {
            await bus.emit('task.updated', { field: 'status' });
            await waitFor(1);
            // The tap persisted it…
            expect(await rows('task.updated')).toBe(1);
            // …and the local subscriber heard it exactly once (no relay echo of our own row).
            await new Promise((resolve) => setTimeout(resolve, 200));
            expect(heard.filter((event) => event.name === 'task.updated')).toHaveLength(1);
            expect(await rows('task.updated')).toBe(1);
        } finally {
            db.close();
        }
    });

    test('a relayed foreign row is emitted once and not persisted a second time (R2, R3)', async () => {
        const { db, foreignDao, heard, rows, waitFor } = await harness();
        try {
            // A child process writes straight to the ledger — bypassing this process's wrapper.
            await foreignDao.insert({
                id: 'sev_child_1',
                event_name: 'workflow.run.started',
                occurred_at: new Date().toISOString(),
                actor: null,
                payload_json: JSON.stringify({ runId: 'run-9' }),
            });
            await waitFor(1);
            expect(heard.filter((event) => event.name === 'workflow.run.started')).toHaveLength(1);
            // The tap and catch-all both skip a marked payload: still exactly one row.
            await new Promise((resolve) => setTimeout(resolve, 250));
            expect(await rows('workflow.run.started')).toBe(1);
        } finally {
            db.close();
        }
    });

    test('a real child CLI process writing the shared ledger is relayed (R2, AC1)', async () => {
        // The case the task exists for: a child `spur workflow run` writes `workflow.*` rows to the
        // project DB through its OWN bus; this process never sees that emit. The relay is the only
        // channel that recovers it, so both processes are pointed at one real file-backed ledger.
        const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const dir = mkdtempSync(join(tmpdir(), 'spur-relay-1386-'));
        const fileDb = join(dir, '.spur', 'spur.db');
        mkdirSync(join(dir, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: fileDb });
        const dao = new SystemEventDao(db);
        const ownIds = new Set<string>();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const heard: string[] = [];
        const ctx = {
            cwd: dir,
            getDb: async () => db,
            systemEventDao: async () => dao,
            systemEventProjectContext: () => ({ name: 'relay-child', root: dir }),
            systemEventSecretValues: () => [],
            ownLedgerIds: () => ownIds,
            eventBus: () => bus,
        } as unknown as ServerContext;
        eventsModule.mount(new Hono(), ctx);
        // The relay takes its snapshot at boot; the child's rows are therefore live events.
        await new Promise((resolve) => setTimeout(resolve, 300));
        bus.on('workflow.run.started', () => heard.push('run.started'));

        writeFileSync(join(dir, '.spur', 'config.yaml'), ['version: "1.2"', 'name: relay-child', ''].join('\n'));
        const workflow = join(dir, 'relay.yaml');
        writeFileSync(
            workflow,
            [
                'name: relay-fix',
                'kind: state-machine',
                'initialState: start',
                'terminalStates: [done]',
                'states:',
                '  - id: start',
                '    onEnter: []',
                '  - id: done',
                '    onEnter: []',
                'transitions:',
                '  - from: start',
                '    to: done',
                '    guard: { kind: always }',
                '',
            ].join('\n'),
        );
        const repo = join(import.meta.dir, '..', '..', '..', '..', '..');
        const proc = Bun.spawn(
            [process.execPath, join(repo, 'apps/cli/src/index.ts'), 'workflow', 'run', workflow, '--json'],
            { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
        );
        const code = await proc.exited;
        const stderr = await new Response(proc.stderr).text();
        expect(code, stderr).toBe(0);

        for (let i = 0; i < 100 && heard.length === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
        // The child wrote the family; the relay surfaced it here without any IPC.
        expect(heard.length).toBeGreaterThanOrEqual(1);
        const childRows = await dao.query({ name: 'workflow.run.started', limit: 20 });
        expect(childRows.length).toBeGreaterThanOrEqual(1);

        db.close();
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('trackOwnInserts (task 1386 R1)', () => {
    test('registers the id before the insert runs, so the relay can never race it', async () => {
        const { trackOwnInserts } = await import('../../../src/serve');
        const seenAtInsert: string[][] = [];
        const inner = {
            insert: async (input: { id: string }) => {
                // Whatever the set holds when the insert actually runs is what the relay could see.
                seenAtInsert.push([...ownIds]);
                void input;
            },
        } as unknown as SystemEventDao;
        const ownIds = new Set<string>();
        const tracked = trackOwnInserts(inner, ownIds);

        await tracked.insert({ id: 'sev_own_42' } as never);

        expect(seenAtInsert[0]).toEqual(['sev_own_42']);
        expect([...ownIds]).toEqual(['sev_own_42']);
    });
});
