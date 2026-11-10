import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { readExecutorLatency } from '../../src/analytics/executor-latency';
import { applyCliMigrations } from '../../src/migrations';

// D3 (task 1323): the raw `history_board_model_stats` latency read lives in
// domain (ADR-011) — these tests pin its shape at the new home: mean over
// samples, the tool-error success proxy, zero-sample skips and the
// empty-map-on-failure degradation the app policy relies on.

async function setup(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

interface SeedRow {
    model: string;
    durationMs: number;
    samples: number;
    toolCalls?: number;
    errors?: number;
}

async function seed(db: DbAdapter, rows: SeedRow[]): Promise<void> {
    for (const row of rows) {
        await db.run(
            `INSERT INTO history_board_model_stats
             (model, assistant_duration_ms, assistant_duration_samples, fresh_input_tokens, cache_read_tokens, output_tokens, tool_calls, errors)
             VALUES (?, ?, ?, 0, 0, 0, ?, ?)`,
            row.model,
            row.durationMs,
            row.samples,
            row.toolCalls ?? 0,
            row.errors ?? 0,
        );
    }
}

describe('readExecutorLatency (1323)', () => {
    test('reads mean latency and the tool-error success proxy per model', async () => {
        const db = await setup();
        await seed(db, [
            { model: 'pi-flash', durationMs: 120_000, samples: 3, toolCalls: 10, errors: 3 },
            { model: 'codex-main', durationMs: 90_000, samples: 2, toolCalls: 4, errors: 0 },
        ]);
        const stats = await readExecutorLatency(db, ['pi-flash', 'codex-main']);
        expect(stats.get('pi-flash')).toEqual({ meanMs: 40_000, samples: 3, successRate: 0.7 });
        expect(stats.get('codex-main')).toEqual({ meanMs: 45_000, samples: 2, successRate: 1 });
    });

    test('models with zero samples are not evidence and stay absent', async () => {
        const db = await setup();
        await seed(db, [{ model: 'pi-flash', durationMs: 50_000, samples: 0 }]);
        const stats = await readExecutorLatency(db, ['pi-flash']);
        expect(stats.has('pi-flash')).toBe(false);
    });

    test('unknown keys resolve to nothing and duplicate keys are queried once', async () => {
        const db = await setup();
        await seed(db, [{ model: 'pi-flash', durationMs: 30_000, samples: 1, toolCalls: 2, errors: 2 }]);
        const stats = await readExecutorLatency(db, ['pi-flash', 'pi-flash', 'nope', '']);
        expect(stats.size).toBe(1);
        expect(stats.get('pi-flash')).toEqual({ meanMs: 30_000, samples: 1, successRate: 0 });
        expect(stats.has('nope')).toBe(false);
    });

    test('no tool evidence counts as success', async () => {
        const db = await setup();
        await seed(db, [{ model: 'pi-flash', durationMs: 10_000, samples: 2, toolCalls: 0, errors: 0 }]);
        const stats = await readExecutorLatency(db, ['pi-flash']);
        expect(stats.get('pi-flash')?.successRate).toBe(1);
    });

    test('a missing table (or any read failure) degrades to an empty map, never throws', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const stats = await readExecutorLatency(adapter, ['pi-flash']);
        expect(stats.size).toBe(0);
    });

    test('empty key input short-circuits to an empty map', async () => {
        const db = await setup();
        const stats = await readExecutorLatency(db, []);
        expect(stats.size).toBe(0);
    });
});
