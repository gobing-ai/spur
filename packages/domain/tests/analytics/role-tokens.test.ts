import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { type RoleTokenAttribution, roleTokenSummary } from '../../src/analytics/role-tokens';
import type { RoutingSummaryWindow } from '../../src/dao/system-event-dao';
import { applyCliMigrations, RunSessionDao, type RunSessionExactness, SystemEventDao } from '../../src/index';

// ---------------------------------------------------------------------------
// Helpers — rows shaped exactly as the J5 tap persists them (0546 test parity):
// routing rides `data.routing.{role,executor}` on `agent.invoke.start`, `run_id`
// is the indexed join column, and history rows carry typed token columns.
// ---------------------------------------------------------------------------

function envelope(data: Record<string, unknown>): string {
    return JSON.stringify({ schemaVersion: 2, data, context: {}, presentation: {} });
}

function startPayload(role: string | undefined, executor: string, source: string): string {
    const routing: Record<string, unknown> = { tier: 'standard', executor, source };
    if (role !== undefined) routing.role = role;
    return envelope({ agent: 'pi', operation: 'prompt', routing });
}

/** A migrated in-memory DB with the ledger + history plane + mapping tables. */
async function setupDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

async function insertInvoke(db: DbAdapter, id: string, at: string, payload: string, runId: string): Promise<void> {
    await new SystemEventDao(db).insert({
        id,
        event_name: 'agent.invoke.start',
        occurred_at: at,
        payload_json: payload,
        run_id: runId,
    });
}

async function insertMessage(
    db: DbAdapter,
    m: {
        record_hash: string;
        source?: string;
        session_id: string;
        seq: number;
        ts: string;
        input?: number | null;
        output?: number | null;
        cache_read?: number | null;
        cache_write?: number | null;
    },
): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, output_tokens,
             cache_read_tokens, cache_write_tokens, provenance, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.record_hash,
        m.source ?? 'pi',
        'test.jsonl',
        1,
        m.session_id,
        m.seq,
        'assistant',
        'message',
        'conversation',
        m.ts,
        'pi-1',
        m.input ?? null,
        m.output ?? null,
        m.cache_read ?? null,
        m.cache_write ?? null,
        'ambient',
        '2026-08-13T10:10:00.000Z',
    );
}

async function insertMapping(
    db: DbAdapter,
    input: {
        runId: string;
        source: string;
        sessionId: string;
        exactness: RunSessionExactness;
        mechanism?: 'observed' | 'supplied' | 'inferred';
    },
): Promise<void> {
    await new RunSessionDao(db).insert({
        runId: input.runId,
        source: input.source,
        sessionId: input.sessionId,
        exactness: input.exactness,
        mechanism: input.mechanism ?? (input.exactness === 'estimated' ? 'inferred' : 'observed'),
        resolvedAt: '2026-08-13T10:06:00.000Z',
    });
}

const WINDOW: RoutingSummaryWindow = {
    since: '2026-08-13T00:00:00.000Z',
    until: '2026-08-13T23:59:59.000Z',
};

/** Find one role's attribution in the result (role may be null — use find, not index). */
function byRole(roles: RoleTokenAttribution[], role: string | null): RoleTokenAttribution {
    const found = roles.find((r) => r.role === role);
    if (!found) throw new Error(`missing role ${String(role)}`);
    return found;
}

// ---------------------------------------------------------------------------
// R1 — per-role four-token totals over a bounded window, via run_id join
// ---------------------------------------------------------------------------

describe('roleTokenSummary (task 0547)', () => {
    test('R1: a known dataset yields the expected four token totals per role (exact join)', async () => {
        const db = await setupDb();
        await insertInvoke(db, 's1', '2026-08-13T01:00:00.000Z', startPayload('scribe', 'cheap-exec', 'role'), 'run-1');
        await insertInvoke(db, 's2', '2026-08-13T02:00:00.000Z', startPayload('planner', 'std-exec', 'role'), 'run-2');
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMapping(db, { runId: 'run-2', source: 'pi', sessionId: 'sess-2', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-08-13T01:02:00.000Z',
            input: 1000,
            output: 500,
            cache_read: 200,
            cache_write: 50,
        });
        await insertMessage(db, {
            record_hash: 'm2',
            session_id: 'sess-2',
            seq: 1,
            ts: '2026-08-13T02:02:00.000Z',
            input: 300,
            output: 30,
            cache_read: 0,
            cache_write: 0,
        });

        const result = await roleTokenSummary(db, WINDOW);
        expect(result.window).toEqual(WINDOW);

        const scribe = byRole(result.roles, 'scribe');
        expect(scribe.totalRuns).toBe(1);
        expect(scribe.matchedRuns).toBe(1);
        // Billed input total = fresh + cache read + cache write.
        expect(scribe.exact?.inputTokens).toBe(1250);
        expect(scribe.exact?.outputTokens).toBe(500);
        expect(scribe.exact?.cacheReadTokens).toBe(200);
        expect(scribe.exact?.cacheCreationTokens).toBe(50);
        expect(scribe.estimated).toBeNull();
        expect(scribe.unmeasured).toBe(false);

        const planner = byRole(result.roles, 'planner');
        expect(planner.exact?.inputTokens).toBe(300);
        expect(planner.exact?.outputTokens).toBe(30);
        expect(planner.exact?.cacheReadTokens).toBe(0);
        expect(planner.exact?.cacheCreationTokens).toBe(0);
    });

    test('R1: the bounded window excludes runs outside it', async () => {
        const db = await setupDb();
        await insertInvoke(db, 's1', '2026-08-13T01:00:00.000Z', startPayload('scribe', 'cheap-exec', 'role'), 'run-1');
        // Outside the window — must not appear.
        await insertInvoke(db, 's2', '2026-07-01T00:00:00.000Z', startPayload('old', 'cheap-exec', 'role'), 'run-2');
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-08-13T01:02:00.000Z',
            input: 10,
            output: 1,
        });

        const result = await roleTokenSummary(db, WINDOW);
        const roles = result.roles.map((r) => r.role);
        expect(roles).toContain('scribe');
        expect(roles).not.toContain('old');
    });

    // -----------------------------------------------------------------------
    // R2 — no currency field anywhere in the output
    // -----------------------------------------------------------------------

    test('R2: the output contains no currency field, even with large token figures', async () => {
        const db = await setupDb();
        await insertInvoke(db, 's1', '2026-08-13T01:00:00.000Z', startPayload('scribe', 'cheap-exec', 'role'), 'run-1');
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-08-13T01:02:00.000Z',
            input: 1_000_000,
            output: 1_000_000,
            cache_read: 100_000,
            cache_write: 50_000,
        });

        const result = await roleTokenSummary(db, WINDOW);
        const serialized = JSON.stringify(result);
        // No dollar figure is computed, stored, or displayed (R2).
        expect(serialized).not.toMatch(/costUsd|cost_usd|price|\$|usd/i);
        const scribe = byRole(result.roles, 'scribe');
        expect(scribe.exact).not.toBeNull();
        // The four token fields are the whole bucket — no currency sibling.
        expect(Object.keys(scribe.exact ?? {})).toEqual(
            expect.arrayContaining(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens']),
        );
        expect(Object.keys(scribe.exact ?? {})).not.toContain('costUsd');
    });

    // -----------------------------------------------------------------------
    // R3 — never-fabricate: unmeasured is not zero
    // -----------------------------------------------------------------------

    test('R3: a role with no matched rows reads as unmeasured with matched-run count, not zero', async () => {
        const db = await setupDb();
        await insertInvoke(db, 's1', '2026-08-13T01:00:00.000Z', startPayload('scribe', 'cheap-exec', 'role'), 'run-1');
        await insertInvoke(db, 's2', '2026-08-13T02:00:00.000Z', startPayload('ghost', 'std-exec', 'role'), 'run-2');
        // ghost has attribution but no mapping and no history rows.
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-08-13T01:02:00.000Z',
            input: 100,
            output: 10,
        });

        const result = await roleTokenSummary(db, WINDOW);
        const ghost = byRole(result.roles, 'ghost');
        expect(ghost.totalRuns).toBe(1);
        expect(ghost.matchedRuns).toBe(0);
        expect(ghost.exact).toBeNull();
        expect(ghost.estimated).toBeNull();
        expect(ghost.unmeasured).toBe(true);
    });

    test('R3: a role whose rows carry no usage reports unmeasured, distinct from observed zero', async () => {
        const db = await setupDb();
        // "ghost" rows matched but carry no token data (NULL token columns).
        await insertInvoke(db, 's1', '2026-08-13T01:00:00.000Z', startPayload('ghost', 'std-exec', 'role'), 'run-1');
        // "zero" genuinely consumed nothing: rows exist, usage present, tokens are 0.
        await insertInvoke(db, 's2', '2026-08-13T02:00:00.000Z', startPayload('zero', 'std-exec', 'role'), 'run-2');
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMapping(db, { runId: 'run-2', source: 'pi', sessionId: 'sess-2', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'g1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-08-13T01:02:00.000Z',
            input: null,
            output: null,
            cache_read: null,
            cache_write: null,
        });
        await insertMessage(db, {
            record_hash: 'z1',
            session_id: 'sess-2',
            seq: 1,
            ts: '2026-08-13T02:02:00.000Z',
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
        });

        const result = await roleTokenSummary(db, WINDOW);
        const ghost = byRole(result.roles, 'ghost');
        // Rows matched but carried no usage → unmeasured, not zero-as-fact.
        expect(ghost.matchedRuns).toBe(1);
        expect(ghost.exact).toBeNull();
        expect(ghost.unmeasured).toBe(true);

        const zero = byRole(result.roles, 'zero');
        // Observed zero is measured — present bucket with zero tokens.
        expect(zero.exact).not.toBeNull();
        expect(zero.exact?.inputTokens).toBe(0);
        expect(zero.exact?.outputTokens).toBe(0);
        expect(zero.unmeasured).toBe(false);
    });

    // -----------------------------------------------------------------------
    // R4 — exact and estimated are never summed into one number
    // -----------------------------------------------------------------------

    test('R4: a mixed dataset reports exact and estimated totals separately', async () => {
        const db = await setupDb();
        await insertInvoke(db, 's1', '2026-08-13T01:00:00.000Z', startPayload('scribe', 'cheap-exec', 'role'), 'run-1');
        // run-2 has BOTH an exact mapping and an estimated mapping (two sessions).
        await insertInvoke(db, 's2', '2026-08-13T02:00:00.000Z', startPayload('scribe', 'cheap-exec', 'role'), 'run-2');
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-exact', exactness: 'exact' });
        await insertMapping(db, {
            runId: 'run-2',
            source: 'pi',
            sessionId: 'sess-est',
            exactness: 'estimated',
            mechanism: 'inferred',
        });
        await insertMessage(db, {
            record_hash: 'e1',
            session_id: 'sess-exact',
            seq: 1,
            ts: '2026-08-13T01:02:00.000Z',
            input: 1000,
            output: 100,
        });
        await insertMessage(db, {
            record_hash: 's1',
            session_id: 'sess-est',
            seq: 1,
            ts: '2026-08-13T02:02:00.000Z',
            input: 300,
            output: 30,
        });

        const result = await roleTokenSummary(db, WINDOW);
        const scribe = byRole(result.roles, 'scribe');
        expect(scribe.exact?.inputTokens).toBe(1000);
        expect(scribe.estimated?.inputTokens).toBe(300);
        // The two classes are separate buckets — no figure mixes them.
        expect(scribe.exact?.records).toBe(1);
        expect(scribe.estimated?.records).toBe(1);
        expect(scribe.unmeasured).toBe(false);
    });

    // -----------------------------------------------------------------------
    // R5 — coverage: matched runs of total attributed runs
    // -----------------------------------------------------------------------

    test('R5: partial coverage reports matched and total run counts', async () => {
        const db = await setupDb();
        // scribe: 3 attributed runs, 2 matched → coverage 2/3 visible.
        for (let i = 1; i <= 3; i++) {
            await insertInvoke(
                db,
                `s${i}`,
                `2026-08-13T0${i}:00:00.000Z`,
                startPayload('scribe', 'cheap-exec', 'role'),
                `run-${i}`,
            );
        }
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMapping(db, { runId: 'run-2', source: 'pi', sessionId: 'sess-2', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-08-13T01:02:00.000Z',
            input: 10,
            output: 1,
        });
        await insertMessage(db, {
            record_hash: 'm2',
            session_id: 'sess-2',
            seq: 1,
            ts: '2026-08-13T02:02:00.000Z',
            input: 20,
            output: 2,
        });

        const result = await roleTokenSummary(db, WINDOW);
        const scribe = byRole(result.roles, 'scribe');
        expect(scribe.totalRuns).toBe(3);
        expect(scribe.matchedRuns).toBe(2);
        expect(scribe.exact?.inputTokens).toBe(30);
        expect(scribe.unmeasured).toBe(false);
    });

    test('R5: a run mapped in both exactness classes counts once in coverage', async () => {
        const db = await setupDb();
        // run-1 carries BOTH an exact and an estimated mapping (two sessions).
        await insertInvoke(db, 's1', '2026-08-13T01:00:00.000Z', startPayload('scribe', 'cheap-exec', 'role'), 'run-1');
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-exact', exactness: 'exact' });
        await insertMapping(db, {
            runId: 'run-1',
            source: 'pi',
            sessionId: 'sess-est',
            exactness: 'estimated',
            mechanism: 'inferred',
        });
        await insertMessage(db, {
            record_hash: 'e1',
            session_id: 'sess-exact',
            seq: 1,
            ts: '2026-08-13T01:02:00.000Z',
            input: 100,
            output: 10,
        });
        await insertMessage(db, {
            record_hash: 's1',
            session_id: 'sess-est',
            seq: 1,
            ts: '2026-08-13T01:03:00.000Z',
            input: 200,
            output: 20,
        });

        const result = await roleTokenSummary(db, WINDOW);
        const scribe = byRole(result.roles, 'scribe');
        expect(scribe.totalRuns).toBe(1);
        // One run matched, even though it resolved through both classes.
        expect(scribe.matchedRuns).toBe(1);
        expect(scribe.exact?.inputTokens).toBe(100);
        expect(scribe.estimated?.inputTokens).toBe(200);
    });

    // -----------------------------------------------------------------------
    // Safety — missing tables read as empty, never throw
    // -----------------------------------------------------------------------

    test('an unmigrated DB (no ledger) returns an empty result', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const result = await roleTokenSummary(db, WINDOW);
        expect(result.roles).toEqual([]);
    });

    test('a ledger without the history plane (E1 condition) returns unmeasured roles, never throws', async () => {
        const db = await setupDb();
        await insertInvoke(db, 's1', '2026-08-13T01:00:00.000Z', startPayload('scribe', 'cheap-exec', 'role'), 'run-1');
        // Simulate a DB where history tables were never created / are empty:
        // drop the mapping and message tables the join would read.
        await db.run('DROP TABLE history_run_session');
        await db.run('DROP TABLE history_message');

        const result = await roleTokenSummary(db, WINDOW);
        const scribe = byRole(result.roles, 'scribe');
        expect(scribe.totalRuns).toBe(1);
        expect(scribe.matchedRuns).toBe(0);
        expect(scribe.exact).toBeNull();
        expect(scribe.estimated).toBeNull();
        expect(scribe.unmeasured).toBe(true);
    });

    test('attribution with no matching history rows produces only unmeasured roles', async () => {
        const db = await setupDb();
        await insertInvoke(db, 's1', '2026-08-13T01:00:00.000Z', startPayload('scribe', 'cheap-exec', 'role'), 'run-1');
        const result = await roleTokenSummary(db, WINDOW);
        const scribe = byRole(result.roles, 'scribe');
        expect(scribe.totalRuns).toBe(1);
        expect(scribe.matchedRuns).toBe(0);
        expect(scribe.unmeasured).toBe(true);
    });
});
