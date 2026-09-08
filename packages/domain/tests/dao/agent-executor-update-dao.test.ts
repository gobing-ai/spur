import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { AgentExecutorUpdateDao } from '../../src/dao/agent-executor-update-dao';
import { applyCliMigrations } from '../../src/migrations';

/** Canonical exhaustion observation for `(p1, codex)`; later variants derive from it. */
function disableInput(overrides: Partial<Parameters<AgentExecutorUpdateDao['recordObservation']>[0]> = {}) {
    return {
        project_id: '/repo/p1',
        executor_name: 'codex',
        observation_id: 'obs-a',
        observed_at: '2026-02-01T10:00:00.000Z',
        agent: 'claude',
        model: 'claude-opus-4-6',
        disabled: true,
        ...overrides,
    };
}

describe('AgentExecutorUpdateDao', () => {
    async function setup() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        return { adapter, dao: new AgentExecutorUpdateDao(adapter) };
    }

    test('records the first observation as pending', async () => {
        const { adapter, dao } = await setup();
        expect(await dao.recordObservation(disableInput())).toBe('recorded');
        const row = await dao.getUpdate('/repo/p1', 'codex');
        expect(row).toBeDefined();
        expect(row?.observation_id).toBe('obs-a');
        expect(row?.disabled).toBe(1);
        expect(row?.applied_observation_id).toBeNull();
        expect(row?.attempts).toBe(0);
        adapter.close();
    });

    test('same observation id is an idempotent duplicate (crash replay)', async () => {
        const { adapter, dao } = await setup();
        expect(await dao.recordObservation(disableInput())).toBe('recorded');
        expect(await dao.recordObservation(disableInput())).toBe('duplicate');
        const row = await dao.getUpdate('/repo/p1', 'codex');
        expect(row?.attempts).toBe(0);
        expect(await dao.pendingUpdates()).toHaveLength(1);
        adapter.close();
    });

    test('strictly newer observation supersedes and resets retry state', async () => {
        const { adapter, dao } = await setup();
        await dao.recordObservation(disableInput());
        await dao.recordFailure('/repo/p1', 'codex', 'obs-a', 'boom', '2026-02-01T10:01:00.000Z');
        expect(
            await dao.recordObservation(
                disableInput({ observation_id: 'obs-b', observed_at: '2026-02-01T11:00:00.000Z', disabled: false }),
            ),
        ).toBe('recorded');
        const row = await dao.getUpdate('/repo/p1', 'codex');
        expect(row?.observation_id).toBe('obs-b');
        expect(row?.disabled).toBe(0);
        expect(row?.attempts).toBe(0);
        expect(row?.last_error).toBeNull();
        adapter.close();
    });

    test('older observation from a different id never replaces a newer row', async () => {
        const { adapter, dao } = await setup();
        await dao.recordObservation(disableInput({ observation_id: 'obs-b', observed_at: '2026-02-01T11:00:00.000Z' }));
        expect(await dao.recordObservation(disableInput({ observation_id: 'obs-a' }))).toBe('superseded');
        const row = await dao.getUpdate('/repo/p1', 'codex');
        expect(row?.observation_id).toBe('obs-b');
        adapter.close();
    });

    test('same timestamp breaks the tie by lexical observation id', async () => {
        const { adapter, dao } = await setup();
        await dao.recordObservation(disableInput({ observation_id: 'obs-m' }));
        expect(await dao.recordObservation(disableInput({ observation_id: 'obs-z' }))).toBe('recorded');
        expect(await dao.recordObservation(disableInput({ observation_id: 'obs-a' }))).toBe('superseded');
        expect((await dao.getUpdate('/repo/p1', 'codex'))?.observation_id).toBe('obs-z');
        adapter.close();
    });

    test('a superseding write that raced a newer arrival does not regress the row', async () => {
        const { adapter, dao } = await setup();
        await dao.recordObservation(disableInput({ observation_id: 'obs-z', observed_at: '2026-02-01T12:00:00.000Z' }));
        // Simulate the racing read: a decision made while obs-a was newest, but
        // the guarded write lands after obs-z was retained.
        expect(await dao.recordObservation(disableInput({ observation_id: 'obs-a' }))).toBe('superseded');
        expect((await dao.getUpdate('/repo/p1', 'codex'))?.observation_id).toBe('obs-z');
        adapter.close();
    });

    test('ackApplied acknowledges only its exact observation version', async () => {
        const { adapter, dao } = await setup();
        await dao.recordObservation(disableInput({ observation_id: 'obs-a' }));
        await dao.recordObservation(disableInput({ observation_id: 'obs-b', observed_at: '2026-02-01T11:00:00.000Z' }));
        expect(await dao.ackApplied('/repo/p1', 'codex', 'obs-a', '2026-02-01T11:05:00.000Z')).toBe(false);
        expect((await dao.getUpdate('/repo/p1', 'codex'))?.applied_observation_id).toBeNull();
        expect(await dao.ackApplied('/repo/p1', 'codex', 'obs-b', '2026-02-01T11:05:00.000Z')).toBe(true);
        const row = await dao.getUpdate('/repo/p1', 'codex');
        expect(row?.applied_observation_id).toBe('obs-b');
        expect(row?.attempts).toBe(0);
        adapter.close();
    });

    test('recordFailure keeps the exact version pending and visible', async () => {
        const { adapter, dao } = await setup();
        await dao.recordObservation(disableInput());
        await dao.recordFailure('/repo/p1', 'codex', 'obs-a', 'CONFIG_CONFLICT', '2026-02-01T10:01:00.000Z');
        const row = await dao.getUpdate('/repo/p1', 'codex');
        expect(row?.attempts).toBe(1);
        expect(row?.last_error).toBe('CONFIG_CONFLICT');
        expect(row?.retry_after).toBe('2026-02-01T10:01:00.000Z');
        expect(await dao.pendingUpdates()).toHaveLength(1);
        adapter.close();
    });

    test('pendingUpdates excludes applied rows and orders oldest first', async () => {
        const { adapter, dao } = await setup();
        await dao.recordObservation(disableInput({ observation_id: 'obs-a', observed_at: '2026-02-01T09:00:00.000Z' }));
        await dao.recordObservation(
            disableInput({ executor_name: 'gemini', observation_id: 'obs-b', observed_at: '2026-02-01T08:00:00.000Z' }),
        );
        const pending = await dao.pendingUpdates();
        expect(pending.map((r) => r.executor_name)).toEqual(['gemini', 'codex']);
        await dao.ackApplied('/repo/p1', 'codex', 'obs-a', '2026-02-01T09:05:00.000Z');
        const after = await dao.pendingUpdates();
        expect(after.map((r) => r.executor_name)).toEqual(['gemini']);
        adapter.close();
    });

    test('a superseded pending observation after an ack stays pending (newest wins)', async () => {
        const { adapter, dao } = await setup();
        await dao.recordObservation(disableInput({ observation_id: 'obs-a' }));
        await dao.ackApplied('/repo/p1', 'codex', 'obs-a', '2026-02-01T10:05:00.000Z');
        expect(await dao.pendingUpdates()).toHaveLength(0);
        // Recovery then a later re-exhaustion: only the newest observation is retained
        // per executor (obs-b superseded in-place by obs-c) and stays pending.
        await dao.recordObservation(
            disableInput({ observation_id: 'obs-b', observed_at: '2026-02-01T11:00:00.000Z', disabled: false }),
        );
        await dao.recordObservation(disableInput({ observation_id: 'obs-c', observed_at: '2026-02-01T12:00:00.000Z' }));
        const pending = await dao.pendingUpdates();
        expect(pending.map((r) => r.observation_id)).toEqual(['obs-c']);
        adapter.close();
    });
});
