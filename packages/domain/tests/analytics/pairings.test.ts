import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { type PairingStat, pairingSummary } from '../../src/analytics/pairings';
import { applyCliMigrations, RunSessionDao, type RunSessionExactness, SystemEventDao } from '../../src/index';

// ---------------------------------------------------------------------------
// Helpers — rows shaped exactly as the J5 tap persists them (0546 test parity):
// routing rides `data.routing.{role,executor}` on `agent.invoke.start`, the exit
// row rides `data.outcome` / `data.durationMs` on `executionId`, escalations ride
// `data.fromExecutor` / `data.trigger` on the indexed `run_id`, and history rows
// carry the typed `cost_usd` column.
// ---------------------------------------------------------------------------

function envelope(data: Record<string, unknown>): string {
    return JSON.stringify({ schemaVersion: 2, data, context: {}, presentation: {} });
}

/** A migrated in-memory DB with the ledger + history plane + mapping tables. */
async function setupDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

/** Insert one agent.invoke.start dispatch row. */
async function insertStart(
    db: DbAdapter,
    id: string,
    at: string,
    opts: { role: string; executor: string; agent?: string; model?: string; runId: string; executionId: string },
): Promise<void> {
    const routing: Record<string, unknown> = {
        role: opts.role,
        tier: 'standard',
        executor: opts.executor,
        source: 'role',
    };
    await new SystemEventDao(db).insert({
        id,
        event_name: 'agent.invoke.start',
        occurred_at: at,
        payload_json: envelope({
            agent: opts.agent ?? 'pi',
            ...(opts.model !== undefined ? { model: opts.model } : {}),
            routing,
            runId: opts.runId,
            executionId: opts.executionId,
        }),
        run_id: opts.runId,
    });
}

/** Insert one agent.invoke.exit row for a dispatch's final outcome. */
async function insertExit(
    db: DbAdapter,
    id: string,
    at: string,
    opts: { executionId: string; outcome: 'done' | 'failed' | 'cancelled'; durationMs?: number },
): Promise<void> {
    await new SystemEventDao(db).insert({
        id,
        event_name: 'agent.invoke.exit',
        occurred_at: at,
        payload_json: envelope({
            runId: `run-${opts.executionId}`,
            executionId: opts.executionId,
            outcome: opts.outcome,
            ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
        }),
        run_id: `run-${opts.executionId}`,
    });
}

/** Insert one agent.invoke.escalated row. */
async function insertEscalation(
    db: DbAdapter,
    id: string,
    at: string,
    opts: { runId: string; fromExecutor: string; trigger: string },
): Promise<void> {
    await new SystemEventDao(db).insert({
        id,
        event_name: 'agent.invoke.escalated',
        occurred_at: at,
        payload_json: envelope({
            runId: opts.runId,
            fromExecutor: opts.fromExecutor,
            fromTier: 'standard',
            toExecutor: 'capable-exec',
            toTier: 'capable-1',
            trigger: opts.trigger,
        }),
        run_id: opts.runId,
    });
}

/** Insert one history_message row carrying the typed cost_usd column. */
async function insertMessage(
    db: DbAdapter,
    m: { record_hash: string; source?: string; session_id: string; seq: number; ts: string; cost?: number },
): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
             provenance, duration_ms, imported_at)
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
        null,
        null,
        m.cost ?? null,
        'ambient',
        null,
        '2026-08-13T10:10:00.000Z',
    );
}

async function insertMapping(
    db: DbAdapter,
    input: { runId: string; source: string; sessionId: string; exactness: RunSessionExactness },
): Promise<void> {
    await new RunSessionDao(db).insert({
        runId: input.runId,
        source: input.source,
        sessionId: input.sessionId,
        exactness: input.exactness,
        mechanism: input.exactness === 'estimated' ? 'inferred' : 'observed',
        resolvedAt: '2026-08-13T10:06:00.000Z',
    });
}

const WINDOW = { since: '2026-08-13T00:00:00.000Z', until: '2026-08-13T23:59:59.000Z' };

function byPairing(pairings: PairingStat[], executor: string, role: string): PairingStat {
    const found = pairings.find((p) => p.executor === executor && p.role === role);
    if (!found) throw new Error(`missing pairing ${executor}/${role}`);
    return found;
}

// ---------------------------------------------------------------------------
// R1 — per-(executor, role) dispatch, success, duration, and cost stats
// ---------------------------------------------------------------------------

describe('pairingSummary (feature J8 / task 0573)', () => {
    test('R1: a known two-role dataset yields dispatch counts, success rates, durations, and folded cost', async () => {
        const db = await setupDb();
        // cheap-exec/scribe: 2 dispatches, 1 done + 1 failed.
        await insertStart(db, 's1', '2026-08-13T01:00:00.000Z', {
            role: 'scribe',
            executor: 'cheap-exec',
            agent: 'pi',
            model: 'pi-1',
            runId: 'run-1',
            executionId: 'exec-1',
        });
        await insertExit(db, 'x1', '2026-08-13T01:01:00.000Z', {
            executionId: 'exec-1',
            outcome: 'done',
            durationMs: 1000,
        });
        await insertStart(db, 's2', '2026-08-13T02:00:00.000Z', {
            role: 'scribe',
            executor: 'cheap-exec',
            agent: 'pi',
            model: 'pi-1',
            runId: 'run-2',
            executionId: 'exec-2',
        });
        await insertExit(db, 'x2', '2026-08-13T02:01:00.000Z', {
            executionId: 'exec-2',
            outcome: 'failed',
            durationMs: 3000,
        });
        // std-exec/planner: 1 dispatch, done.
        await insertStart(db, 's3', '2026-08-13T03:00:00.000Z', {
            role: 'planner',
            executor: 'std-exec',
            agent: 'claude',
            model: 'claude-opus',
            runId: 'run-3',
            executionId: 'exec-3',
        });
        await insertExit(db, 'x3', '2026-08-13T03:01:00.000Z', {
            executionId: 'exec-3',
            outcome: 'done',
            durationMs: 2000,
        });

        // Cost folds: run-1 → sess-1 (0.04), run-3 → sess-2 (0.01).
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMapping(db, { runId: 'run-3', source: 'pi', sessionId: 'sess-2', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-08-13T01:02:00.000Z',
            cost: 0.04,
        });
        await insertMessage(db, {
            record_hash: 'm2',
            session_id: 'sess-2',
            seq: 1,
            ts: '2026-08-13T03:02:00.000Z',
            cost: 0.01,
        });

        const pairings = await pairingSummary(db, WINDOW);

        const scribe = byPairing(pairings, 'cheap-exec', 'scribe');
        expect(scribe.agent).toBe('pi');
        expect(scribe.model).toBe('pi-1');
        expect(scribe.dispatches).toBe(2);
        expect(scribe.successRate).toBeCloseTo(0.5);
        expect(scribe.meanDurationMs).toBe(2000); // (1000 + 3000) / 2
        expect(scribe.totalCostUsd).toBeCloseTo(0.04);
        expect(scribe.escalations).toEqual({});

        const planner = byPairing(pairings, 'std-exec', 'planner');
        expect(planner.agent).toBe('claude');
        expect(planner.model).toBe('claude-opus');
        expect(planner.dispatches).toBe(1);
        expect(planner.successRate).toBe(1);
        expect(planner.meanDurationMs).toBe(2000);
        expect(planner.totalCostUsd).toBeCloseTo(0.01);
    });

    // -----------------------------------------------------------------------
    // P1 regression — one (executor, role) spanning multiple model values
    // -----------------------------------------------------------------------

    test('P1 regression: a pairing across multiple model values accumulates, not overwrites', async () => {
        const db = await setupDb();
        // codex/coder dispatches across two model pins within the same window:
        // model codex-a: 2 dispatches (1 done + 1 failed)
        // model codex-b: 1 dispatch  (1 done)
        // The dispatch SQL groups by (executor, role, agent, model), so this
        // pairing arrives as 2 rows sharing one (codex, coder) key. The merge
        // must accumulate them into 3 dispatches / 2 successes — NOT keep only
        // the last group (which would report dispatches:1 and a wrong rate).
        await insertStart(db, 's1', '2026-08-13T01:00:00.000Z', {
            role: 'coder',
            executor: 'codex',
            agent: 'codex',
            model: 'codex-a',
            runId: 'run-1',
            executionId: 'exec-1',
        });
        await insertExit(db, 'x1', '2026-08-13T01:01:00.000Z', {
            executionId: 'exec-1',
            outcome: 'done',
            durationMs: 1000,
        });
        await insertStart(db, 's2', '2026-08-13T02:00:00.000Z', {
            role: 'coder',
            executor: 'codex',
            agent: 'codex',
            model: 'codex-a',
            runId: 'run-2',
            executionId: 'exec-2',
        });
        await insertExit(db, 'x2', '2026-08-13T02:01:00.000Z', {
            executionId: 'exec-2',
            outcome: 'failed',
            durationMs: 2000,
        });
        await insertStart(db, 's3', '2026-08-13T03:00:00.000Z', {
            role: 'coder',
            executor: 'codex',
            agent: 'codex',
            model: 'codex-b',
            runId: 'run-3',
            executionId: 'exec-3',
        });
        await insertExit(db, 'x3', '2026-08-13T03:01:00.000Z', {
            executionId: 'exec-3',
            outcome: 'done',
            durationMs: 3000,
        });

        const pairings = await pairingSummary(db, WINDOW);
        const coder = byPairing(pairings, 'codex', 'coder');
        expect(coder.dispatches).toBe(3); // across both models, NOT just the last group
        expect(coder.successRate).toBeCloseTo(2 / 3);
        expect(coder.meanDurationMs).toBe(2000); // (1000 + 2000 + 3000) / 3
        // agent/model stay the first-seen values (denormalized-attribute contract).
        expect(coder.agent).toBe('codex');
        expect(coder.model === 'codex-a' || coder.model === 'codex-b').toBe(true);
    });

    test('R1: a dispatch with no exit row contributes a dispatch but no duration', async () => {
        const db = await setupDb();
        await insertStart(db, 's1', '2026-08-13T01:00:00.000Z', {
            role: 'scribe',
            executor: 'cheap-exec',
            runId: 'run-1',
            executionId: 'exec-1',
        });
        // No exit row — outcome unknown, duration unmeasured.
        const pairings = await pairingSummary(db, WINDOW);
        const scribe = byPairing(pairings, 'cheap-exec', 'scribe');
        expect(scribe.dispatches).toBe(1);
        expect(scribe.successRate).toBe(0);
        expect(scribe.meanDurationMs).toBe(0);
    });

    test('R1: the bounded window excludes dispatches outside it', async () => {
        const db = await setupDb();
        await insertStart(db, 's1', '2026-08-13T01:00:00.000Z', {
            role: 'scribe',
            executor: 'cheap-exec',
            runId: 'run-1',
            executionId: 'exec-1',
        });
        await insertStart(db, 's2', '2026-07-01T00:00:00.000Z', {
            role: 'old',
            executor: 'cheap-exec',
            runId: 'run-2',
            executionId: 'exec-2',
        });
        const pairings = await pairingSummary(db, WINDOW);
        expect(pairings.some((p) => p.role === 'scribe')).toBe(true);
        expect(pairings.some((p) => p.role === 'old')).toBe(false);
    });

    // -----------------------------------------------------------------------
    // R1 — absence-not-zero: zero-attribution pairings are absent
    // -----------------------------------------------------------------------

    test('R1: a pairing with zero attributed dispatches is absent, never zero-valued', async () => {
        const db = await setupDb();
        // Only one attributed pairing; "ghost" executor has no start rows.
        await insertStart(db, 's1', '2026-08-13T01:00:00.000Z', {
            role: 'scribe',
            executor: 'cheap-exec',
            runId: 'run-1',
            executionId: 'exec-1',
        });
        await insertExit(db, 'x1', '2026-08-13T01:01:00.000Z', { executionId: 'exec-1', outcome: 'done' });

        const pairings = await pairingSummary(db, WINDOW);
        expect(pairings).toHaveLength(1);
        expect(byPairing(pairings, 'cheap-exec', 'scribe').dispatches).toBe(1);
        expect(pairings.some((p) => p.executor === 'ghost')).toBe(false);
    });

    // -----------------------------------------------------------------------
    // R1 — escalation counts split by trigger
    // -----------------------------------------------------------------------

    test('R1: escalations are counted per trigger for the originating pairing', async () => {
        const db = await setupDb();
        // cheap-exec/scribe dispatches run-1, escalates twice (two triggers), then std-exec/scribe finishes it.
        await insertStart(db, 's1', '2026-08-13T01:00:00.000Z', {
            role: 'scribe',
            executor: 'cheap-exec',
            runId: 'run-1',
            executionId: 'exec-1',
        });
        await insertExit(db, 'x1', '2026-08-13T01:01:00.000Z', { executionId: 'exec-1', outcome: 'failed' });
        await insertEscalation(db, 'e1', '2026-08-13T01:01:00.000Z', {
            runId: 'run-1',
            fromExecutor: 'cheap-exec',
            trigger: 'gate-fail',
        });
        await insertEscalation(db, 'e2', '2026-08-13T01:01:00.000Z', {
            runId: 'run-1',
            fromExecutor: 'cheap-exec',
            trigger: 'exit-code',
        });
        await insertStart(db, 's2', '2026-08-13T01:05:00.000Z', {
            role: 'scribe',
            executor: 'std-exec',
            runId: 'run-1',
            executionId: 'exec-2',
        });
        await insertExit(db, 'x2', '2026-08-13T01:06:00.000Z', { executionId: 'exec-2', outcome: 'done' });

        const pairings = await pairingSummary(db, WINDOW);
        const cheap = byPairing(pairings, 'cheap-exec', 'scribe');
        // The escalated-then-succeeded run counts success for the FINAL executor.
        expect(cheap.dispatches).toBe(1);
        expect(cheap.successRate).toBe(0);
        expect(cheap.escalations).toEqual({ 'gate-fail': 1, 'exit-code': 1 });

        const std = byPairing(pairings, 'std-exec', 'scribe');
        expect(std.successRate).toBe(1);
        expect(std.escalations).toEqual({});
    });

    test('R1: escalation rows without fromExecutor are excluded (absence is the signal)', async () => {
        const db = await setupDb();
        await insertStart(db, 's1', '2026-08-13T01:00:00.000Z', {
            role: 'scribe',
            executor: 'cheap-exec',
            runId: 'run-1',
            executionId: 'exec-1',
        });
        // A malformed escalation with no fromExecutor — must not count anywhere.
        await new SystemEventDao(db).insert({
            id: 'e-bad',
            event_name: 'agent.invoke.escalated',
            occurred_at: '2026-08-13T01:01:00.000Z',
            payload_json: envelope({ runId: 'run-1', trigger: 'gate-fail' }),
            run_id: 'run-1',
        });

        const pairings = await pairingSummary(db, WINDOW);
        expect(byPairing(pairings, 'cheap-exec', 'scribe').escalations).toEqual({});
    });

    // -----------------------------------------------------------------------
    // R6 — additive artifact fields (type-level check via pairings export)
    // -----------------------------------------------------------------------

    test('R1: unbounded summary covers the full history when no window is given', async () => {
        const db = await setupDb();
        await insertStart(db, 's1', '2026-08-13T01:00:00.000Z', {
            role: 'scribe',
            executor: 'cheap-exec',
            runId: 'run-1',
            executionId: 'exec-1',
        });
        await insertExit(db, 'x1', '2026-08-13T01:01:00.000Z', { executionId: 'exec-1', outcome: 'done' });
        // Old row outside any default window — must still appear when unbounded.
        await insertStart(db, 's2', '2026-01-01T01:00:00.000Z', {
            role: 'old',
            executor: 'std-exec',
            runId: 'run-2',
            executionId: 'exec-2',
        });
        const pairings = await pairingSummary(db);
        expect(pairings.some((p) => p.role === 'old')).toBe(true);
    });

    // -----------------------------------------------------------------------
    // R1 — window clamps, NUL-key separation, missing-table best-effort
    // -----------------------------------------------------------------------

    test('R1: explicit since/until bounds clamp both edges of the window', async () => {
        const db = await setupDb();
        // One dispatch inside the window, one before `since`, one after `until`.
        await insertStart(db, 's-before', '2026-08-12T23:59:00.000Z', {
            role: 'early',
            executor: 'cheap-exec',
            runId: 'run-early',
            executionId: 'exec-early',
        });
        await insertStart(db, 's-in', '2026-08-13T12:00:00.000Z', {
            role: 'scribe',
            executor: 'cheap-exec',
            runId: 'run-in',
            executionId: 'exec-in',
        });
        await insertStart(db, 's-after', '2026-08-14T00:00:00.000Z', {
            role: 'late',
            executor: 'cheap-exec',
            runId: 'run-late',
            executionId: 'exec-late',
        });

        const pairings = await pairingSummary(db, WINDOW);
        expect(pairings.some((p) => p.role === 'scribe')).toBe(true);
        expect(pairings.some((p) => p.role === 'early')).toBe(false);
        expect(pairings.some((p) => p.role === 'late')).toBe(false);
    });

    test('R1: pairings keyed by NUL do not collide when an executor name prefixes another', async () => {
        const db = await setupDb();
        // 'ab' is a prefix of 'abc': a plain string-concat key would map both
        // ('ab', 'c') and ('abc', '') to 'abc' and collapse them. The NUL
        // separator keeps the two pairings distinct.
        await insertStart(db, 's1', '2026-08-13T01:00:00.000Z', {
            role: 'c',
            executor: 'ab',
            runId: 'run-1',
            executionId: 'exec-1',
        });
        await insertStart(db, 's2', '2026-08-13T02:00:00.000Z', {
            role: '',
            executor: 'abc',
            runId: 'run-2',
            executionId: 'exec-2',
        });

        const pairings = await pairingSummary(db, WINDOW);
        expect(pairings).toHaveLength(2);
        expect(byPairing(pairings, 'ab', 'c').dispatches).toBe(1);
        expect(byPairing(pairings, 'abc', '').dispatches).toBe(1);
    });

    test('R1: a missing system_events plane reads as empty, never throws (best-effort)', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        // No migrations — no system_events / history tables. All three loaders
        // hit their no-such-table catch and return [].
        const pairings = await pairingSummary(db, WINDOW);
        expect(pairings).toEqual([]);
    });
});
