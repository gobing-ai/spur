import { describe, expect, test } from 'bun:test';
import type { SystemEventRow } from '@gobing-ai/spur-domain';
import { enrichTerminalJobsFromEvents } from '../../../src/modules/jobs';

function eventRow(
    overrides: Partial<SystemEventRow> & Pick<SystemEventRow, 'event_name' | 'payload_json'>,
): SystemEventRow {
    return {
        id: `evt-${Math.random().toString(36).slice(2)}`,
        occurred_at: '2026-01-01T00:05:00.000Z',
        level: 'info',
        category: 'queue',
        actor: null,
        run_id: null,
        entity_kind: 'queue_job',
        entity_id: null,
        context_json: '{}',
        retention_tier: 'standard',
        sequence: null,
        ...overrides,
    } as SystemEventRow;
}

function daoReturning(rows: SystemEventRow[]) {
    return { query: async () => rows } as unknown as Parameters<typeof enrichTerminalJobsFromEvents>[0];
}

describe('enrichTerminalJobsFromEvents (task 0806 R4)', () => {
    const terminalPayload = (jobId: string, durationMs: number) =>
        JSON.stringify({ schemaVersion: 1, data: { jobId, durationMs } });

    test('fills durationMs from the terminal event and startedAt from the started anchor', async () => {
        const dao = daoReturning([
            eventRow({
                event_name: 'queue.job.started',
                payload_json: '{}',
                entity_id: 'job-1',
                occurred_at: '2026-01-01T00:01:00.000Z',
            }),
            eventRow({ event_name: 'queue.job.completed', payload_json: terminalPayload('job-1', 42_000) }),
        ]);
        const job = {
            id: 'job-1',
            status: 'completed',
            startedAt: null as string | null,
            durationMs: null as number | null,
        };
        await enrichTerminalJobsFromEvents(dao, [job]);
        expect(job.durationMs).toBe(42_000);
        expect(job.startedAt).toBe('2026-01-01T00:01:00.000Z');
    });

    test('falls back to entity_id when the payload omits jobId; unparsable payloads are skipped', async () => {
        const dao = daoReturning([
            eventRow({ event_name: 'queue.job.failed', payload_json: 'not-json', entity_id: 'job-2' }),
            eventRow({
                event_name: 'queue.job.failed',
                payload_json: JSON.stringify({ data: { durationMs: 900 } }),
                entity_id: 'job-2',
            }),
        ]);
        const job = {
            id: 'job-2',
            status: 'failed',
            startedAt: null as string | null,
            durationMs: null as number | null,
        };
        await enrichTerminalJobsFromEvents(dao, [job]);
        expect(job.durationMs).toBe(900);
        expect(job.startedAt).toBeNull(); // unknown start stays unknown — never inferred from queuedAt
    });

    test('non-terminal rows and rows with their own duration are untouched; dao failure is swallowed', async () => {
        const job = { id: 'job-3', status: 'completed', startedAt: '2026-01-01T00:00:00.000Z', durationMs: 5 };
        await enrichTerminalJobsFromEvents(
            daoReturning([eventRow({ event_name: 'queue.job.started', payload_json: '{}' })]),
            [job, { id: 'job-4', status: 'queued', startedAt: null, durationMs: null }],
        );
        expect(job.durationMs).toBe(5);
        const failing = {
            query: async () => {
                throw new Error('db locked');
            },
        } as unknown as Parameters<typeof enrichTerminalJobsFromEvents>[0];
        const untouched = { id: 'job-5', status: 'completed', startedAt: null, durationMs: null };
        await expect(enrichTerminalJobsFromEvents(failing, [untouched])).resolves.toBeUndefined();
        expect(untouched.durationMs).toBeNull();
    });
});
