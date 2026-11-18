import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { surfaceUsageSummary } from '../../src/analytics/surface-usage';
import { applyCliMigrations } from '../../src/index';

/**
 * Task 1399 — surface usage (feature H85): per-item calls from `history_skill_call` and the
 * zero-use set, with the 30-day comparability floor.
 */

async function setupDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

/** One `history_skill_call` row; only the columns this query reads carry meaning. */
async function insertCall(db: DbAdapter, hash: string, skillName: string, startedAt: string, status = 'ok') {
    await db.run(
        `INSERT INTO history_skill_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, skill_name, invocation_kind, status, started_at, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        hash,
        `m-${hash}`,
        'claude',
        'test.jsonl',
        1,
        's1',
        1,
        skillName,
        'user',
        status,
        startedAt,
        startedAt,
    );
}

const INVENTORY = [
    { kind: 'command', name: 'sp:dev-run' },
    { kind: 'command', name: 'sp:dev-wrap' },
    { kind: 'skill', name: 'sp:brainstorm' },
] as const;

const SINCE = '2026-10-01T00:00:00.000Z';
const UNTIL = '2026-11-15T00:00:00.000Z'; // 45 days — comparable
const SHORT_UNTIL = '2026-10-20T00:00:00.000Z'; // 19 days — not comparable

describe('surfaceUsageSummary (1399 R1/R4)', () => {
    test('counts used items and reports the rest as zero-use over a comparable window', async () => {
        const db = await setupDb();
        try {
            await insertCall(db, 'h1', 'sp:dev-run', '2026-10-02T00:00:00.000Z');
            await insertCall(db, 'h2', 'sp:dev-run', '2026-10-03T00:00:00.000Z', 'error');
            await insertCall(db, 'h3', 'sp:brainstorm', '2026-10-04T00:00:00.000Z');
            // Outside the window: must not count.
            await insertCall(db, 'h4', 'sp:dev-wrap', '2026-09-01T00:00:00.000Z');

            const usage = await surfaceUsageSummary(db, { since: SINCE, until: UNTIL, inventory: [...INVENTORY] });

            expect(usage.comparable).toBe(true);
            expect(usage.windowDays).toBeCloseTo(45, 5);
            // Any status counts: an errored invocation is still evidence the surface was invoked.
            expect(usage.items).toEqual([
                { kind: 'command', name: 'sp:dev-run', calls: 2 },
                { kind: 'command', name: 'sp:dev-wrap', calls: 0 },
                { kind: 'skill', name: 'sp:brainstorm', calls: 1 },
            ]);
            expect(usage.zeroUse).toEqual([{ kind: 'command', name: 'sp:dev-wrap' }]);
        } finally {
            await db.close();
        }
    });

    test('a window under 30 days is not comparable and yields no zero-use claim', async () => {
        const db = await setupDb();
        try {
            await insertCall(db, 'h1', 'sp:dev-run', '2026-10-02T00:00:00.000Z');
            const usage = await surfaceUsageSummary(db, {
                since: SINCE,
                until: SHORT_UNTIL,
                inventory: [...INVENTORY],
            });

            expect(usage.comparable).toBe(false);
            expect(usage.zeroUse).toEqual([]);
            // The counts are still reported — only the zero-use CLAIM is withheld.
            expect(usage.items.find((item) => item.name === 'sp:dev-run')?.calls).toBe(1);
        } finally {
            await db.close();
        }
    });

    test('an unbounded window is not comparable, and an empty inventory is an empty block', async () => {
        const db = await setupDb();
        try {
            const unbounded = await surfaceUsageSummary(db, { inventory: [...INVENTORY] });
            expect(unbounded.windowDays).toBeNull();
            expect(unbounded.comparable).toBe(false);
            expect(unbounded.zeroUse).toEqual([]);

            const empty = await surfaceUsageSummary(db, { since: SINCE, until: UNTIL, inventory: [] });
            expect(empty).toEqual({ items: [], zeroUse: [], windowDays: 45, comparable: true });
        } finally {
            await db.close();
        }
    });

    test('an unreadable plane reads as an empty block instead of throwing', async () => {
        const broken = {
            queryAll: async () => {
                throw new Error('no such table: history_skill_call');
            },
        } as unknown as DbAdapter;
        const usage = await surfaceUsageSummary(broken, { since: SINCE, until: UNTIL, inventory: [...INVENTORY] });
        expect(usage).toEqual({ items: [], zeroUse: [], windowDays: 45, comparable: true });
    });
});
