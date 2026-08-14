import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, RunSessionDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { type RetroCorrelationWindow, RetroCorrelator } from '../../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Db = Awaited<ReturnType<typeof createDbAdapter>>;

async function makeDb(): Promise<Db> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

/** Seed one imported history row (run_id NULL — the pre-correlation state). */
async function seedMessage(
    db: Db,
    input: { hash: string; source: string; sessionId: string; cwd: string; ts: string },
): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, cwd, provenance, run_id, imported_at)
         VALUES (?, ?, 'test.jsonl', 1, ?, 1, 'user', 'message', 'conversation', ?, ?, 'spur-run', NULL, ?)`,
        input.hash,
        input.source,
        input.sessionId,
        input.ts,
        input.cwd,
        input.ts,
    );
}

/** Seed one agent.invoke event with a run_id and agent payload. */
async function seedInvoke(
    db: Db,
    input: { id: string; runId: string; event: 'agent.invoke.start' | 'agent.invoke.exit'; at: string; agent: string },
): Promise<void> {
    await db.run(
        `INSERT INTO system_events (id, event_name, occurred_at, payload_json, run_id)
         VALUES (?, ?, ?, ?, ?)`,
        input.id,
        input.event,
        input.at,
        JSON.stringify({ agent: input.agent, operation: 'run', severity: 'info' }),
        input.runId,
    );
}

const WINDOW: RetroCorrelationWindow = {
    start: '2026-08-14T00:00:00.000Z',
    end: '2026-08-14T03:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetroCorrelator (feature E6 / task 0558)', () => {
    test('R1 — history rows inside a known run window map to the run, marked estimated', async () => {
        const db = await makeDb();
        await seedInvoke(db, {
            id: 'e1',
            runId: 'run-r',
            event: 'agent.invoke.start',
            at: '2026-08-14T01:00:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e2',
            runId: 'run-r',
            event: 'agent.invoke.exit',
            at: '2026-08-14T01:30:00.000Z',
            agent: 'pi',
        });
        await seedMessage(db, {
            hash: 'm1',
            source: 'pi',
            sessionId: 'session-s',
            cwd: '/repo',
            ts: '2026-08-14T01:10:00.000Z',
        });
        await seedMessage(db, {
            hash: 'm2',
            source: 'pi',
            sessionId: 'session-s',
            cwd: '/repo',
            ts: '2026-08-14T01:20:00.000Z',
        });

        const report = await new RetroCorrelator(db).correlate(WINDOW);
        expect(report).toMatchObject({
            window: WINDOW,
            correlated: 2,
            ambiguous: 0,
            noCandidate: 0,
            rowsScanned: 2,
            runsConsidered: 1,
            mappingsWritten: 1,
        });

        const rows = await new RunSessionDao(db).getByRunId('run-r');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            run_id: 'run-r',
            source: 'pi',
            session_id: 'session-s',
            exactness: 'estimated',
            mechanism: 'inferred',
        });
    });

    test('R2 — a range covered by an exact mapping is left unchanged, no estimated row added', async () => {
        const db = await makeDb();
        const dao = new RunSessionDao(db);
        await dao.insert({
            runId: 'run-e',
            source: 'pi',
            sessionId: 'session-exact',
            exactness: 'exact',
            mechanism: 'observed',
            resolvedAt: '2026-08-14T00:30:00.000Z',
        });
        await seedInvoke(db, {
            id: 'e1',
            runId: 'run-e',
            event: 'agent.invoke.start',
            at: '2026-08-14T01:00:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e2',
            runId: 'run-e',
            event: 'agent.invoke.exit',
            at: '2026-08-14T01:30:00.000Z',
            agent: 'pi',
        });
        await seedMessage(db, {
            hash: 'm1',
            source: 'pi',
            sessionId: 'session-other',
            cwd: '/repo',
            ts: '2026-08-14T01:10:00.000Z',
        });

        const report = await new RetroCorrelator(db).correlate(WINDOW);
        expect(report.mappingsWritten).toBe(0);

        const rows = await dao.getByRunId('run-e');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ session_id: 'session-exact', exactness: 'exact' });
    });

    test('R3 — a session overlapping two run windows yields no mapping and an ambiguity count', async () => {
        const db = await makeDb();
        await seedInvoke(db, {
            id: 'e1',
            runId: 'run-1',
            event: 'agent.invoke.start',
            at: '2026-08-14T01:00:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e2',
            runId: 'run-1',
            event: 'agent.invoke.exit',
            at: '2026-08-14T02:00:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e3',
            runId: 'run-2',
            event: 'agent.invoke.start',
            at: '2026-08-14T01:30:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e4',
            runId: 'run-2',
            event: 'agent.invoke.exit',
            at: '2026-08-14T02:30:00.000Z',
            agent: 'pi',
        });
        await seedMessage(db, {
            hash: 'm1',
            source: 'pi',
            sessionId: 'session-x',
            cwd: '/repo',
            ts: '2026-08-14T01:40:00.000Z',
        });
        await seedMessage(db, {
            hash: 'm2',
            source: 'pi',
            sessionId: 'session-x',
            cwd: '/repo',
            ts: '2026-08-14T01:50:00.000Z',
        });

        const report = await new RetroCorrelator(db).correlate(WINDOW);
        expect(report).toMatchObject({ correlated: 0, ambiguous: 2, noCandidate: 0, mappingsWritten: 0 });

        const dao = new RunSessionDao(db);
        expect(await dao.getByRunId('run-1')).toHaveLength(0);
        expect(await dao.getByRunId('run-2')).toHaveLength(0);
    });

    test('R3 — a session with no candidate run is counted, not guessed', async () => {
        const db = await makeDb();
        // No invoke events at all — the session cannot be attributed.
        await seedMessage(db, {
            hash: 'm1',
            source: 'pi',
            sessionId: 'session-z',
            cwd: '/repo',
            ts: '2026-08-14T01:10:00.000Z',
        });

        const report = await new RetroCorrelator(db).correlate(WINDOW);
        expect(report).toMatchObject({ correlated: 0, ambiguous: 0, noCandidate: 1, mappingsWritten: 0 });
    });

    test('R4 — re-running the same window writes no duplicate rows and scans only the window', async () => {
        const db = await makeDb();
        await seedInvoke(db, {
            id: 'e1',
            runId: 'run-r',
            event: 'agent.invoke.start',
            at: '2026-08-14T01:00:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e2',
            runId: 'run-r',
            event: 'agent.invoke.exit',
            at: '2026-08-14T01:30:00.000Z',
            agent: 'pi',
        });
        await seedMessage(db, {
            hash: 'm1',
            source: 'pi',
            sessionId: 'session-s',
            cwd: '/repo',
            ts: '2026-08-14T01:10:00.000Z',
        });
        // Outside the correlation window — must not be scanned or mapped.
        await seedMessage(db, {
            hash: 'm2',
            source: 'pi',
            sessionId: 'session-out',
            cwd: '/repo',
            ts: '2026-08-14T05:00:00.000Z',
        });

        const correlator = new RetroCorrelator(db);
        const first = await correlator.correlate(WINDOW);
        const second = await correlator.correlate(WINDOW);

        expect(first).toMatchObject({ correlated: 1, rowsScanned: 1, mappingsWritten: 1 });
        expect(second).toMatchObject({ correlated: 1, rowsScanned: 1, mappingsWritten: 0 });
        expect(await new RunSessionDao(db).getByRunId('run-r')).toHaveLength(1);
    });

    test('R5 — mixed window reports all three counts plus the window (one per bucket)', async () => {
        const db = await makeDb();
        await seedInvoke(db, {
            id: 'e1',
            runId: 'run-a',
            event: 'agent.invoke.start',
            at: '2026-08-14T01:00:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e2',
            runId: 'run-a',
            event: 'agent.invoke.exit',
            at: '2026-08-14T01:30:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e3',
            runId: 'run-b',
            event: 'agent.invoke.start',
            at: '2026-08-14T01:40:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e4',
            runId: 'run-b',
            event: 'agent.invoke.exit',
            at: '2026-08-14T02:20:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e5',
            runId: 'run-c',
            event: 'agent.invoke.start',
            at: '2026-08-14T02:00:00.000Z',
            agent: 'pi',
        });
        await seedInvoke(db, {
            id: 'e6',
            runId: 'run-c',
            event: 'agent.invoke.exit',
            at: '2026-08-14T02:40:00.000Z',
            agent: 'pi',
        });
        // mapped: only run-a contains it
        await seedMessage(db, {
            hash: 'm1',
            source: 'pi',
            sessionId: 's-a',
            cwd: '/a',
            ts: '2026-08-14T01:10:00.000Z',
        });
        // ambiguous: inside run-b and run-c
        await seedMessage(db, {
            hash: 'm2',
            source: 'pi',
            sessionId: 's-bc',
            cwd: '/bc',
            ts: '2026-08-14T02:10:00.000Z',
        });
        // no candidate: no run contains it
        await seedMessage(db, {
            hash: 'm3',
            source: 'pi',
            sessionId: 's-none',
            cwd: '/none',
            ts: '2026-08-14T00:10:00.000Z',
        });

        const report = await new RetroCorrelator(db).correlate(WINDOW);
        expect(report).toMatchObject({
            window: WINDOW,
            correlated: 1,
            ambiguous: 1,
            noCandidate: 1,
            rowsScanned: 3,
            runsConsidered: 3,
            mappingsWritten: 1,
        });
    });

    test('tolerates unmigrated tables (empty report, no throw)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const report = await new RetroCorrelator(adapter).correlate(WINDOW);
        expect(report).toMatchObject({
            correlated: 0,
            ambiguous: 0,
            noCandidate: 0,
            rowsScanned: 0,
            runsConsidered: 0,
            mappingsWritten: 0,
        });
    });

    test('events without a run_id and exit-only runs are skipped; source falls back to the actor column', async () => {
        const db = await makeDb();
        // run_id NULL — no key, cannot write a mapping.
        await db.run(
            `INSERT INTO system_events (id, event_name, occurred_at, payload_json, run_id)
             VALUES ('e0', 'agent.invoke.start', '2026-08-14T01:00:00.000Z', '{"agent":"pi"}', NULL)`,
        );
        // exit-only — no start bound, cannot correlate.
        await seedInvoke(db, {
            id: 'e1',
            runId: 'run-x',
            event: 'agent.invoke.exit',
            at: '2026-08-14T01:00:00.000Z',
            agent: 'pi',
        });
        // start + exit whose payload carries no `agent` — actor column supplies the source.
        await db.run(
            `INSERT INTO system_events (id, event_name, occurred_at, actor, payload_json, run_id)
             VALUES ('e2', 'agent.invoke.start', '2026-08-14T01:00:00.000Z', 'pi', '{"operation":"run"}', 'run-a'),
                    ('e3', 'agent.invoke.exit', '2026-08-14T01:30:00.000Z', 'pi', '{"operation":"run"}', 'run-a')`,
        );
        await seedMessage(db, {
            hash: 'm1',
            source: 'pi',
            sessionId: 's-a',
            cwd: '/a',
            ts: '2026-08-14T01:10:00.000Z',
        });

        const report = await new RetroCorrelator(db).correlate(WINDOW);
        expect(report).toMatchObject({ correlated: 1, runsConsidered: 1, mappingsWritten: 1 });
        const rows = await new RunSessionDao(db).getByRunId('run-a');
        expect(rows).toHaveLength(1);
        expect(rows[0]?.session_id).toBe('s-a');
    });

    test('a run whose source cannot be resolved never matches a session (noCandidate, no guess)', async () => {
        const db = await makeDb();
        // Unparseable payload and no actor — source resolves to 'unknown', which matches nothing.
        await db.run(
            `INSERT INTO system_events (id, event_name, occurred_at, payload_json, run_id)
             VALUES ('e1', 'agent.invoke.start', '2026-08-14T01:00:00.000Z', '{not json', 'run-u'),
                    ('e2', 'agent.invoke.exit', '2026-08-14T01:30:00.000Z', '{not json', 'run-u')`,
        );
        await seedMessage(db, {
            hash: 'm1',
            source: 'pi',
            sessionId: 's-u',
            cwd: '/u',
            ts: '2026-08-14T01:10:00.000Z',
        });

        const report = await new RetroCorrelator(db).correlate(WINDOW);
        expect(report).toMatchObject({ correlated: 0, noCandidate: 1, runsConsidered: 1, mappingsWritten: 0 });
        expect(await new RunSessionDao(db).getByRunId('run-u')).toHaveLength(0);
    });

    test('an open window (missing exit) is bounded by the correlation window end', async () => {
        const db = await makeDb();
        await seedInvoke(db, {
            id: 'e1',
            runId: 'run-o',
            event: 'agent.invoke.start',
            at: '2026-08-14T01:00:00.000Z',
            agent: 'pi',
        });
        // no exit event — crash/kill
        await seedMessage(db, {
            hash: 'm1',
            source: 'pi',
            sessionId: 's-o',
            cwd: '/o',
            ts: '2026-08-14T01:10:00.000Z',
        });
        // after the correlation window end — outside the bounded open window
        await seedMessage(db, {
            hash: 'm2',
            source: 'pi',
            sessionId: 's-late',
            cwd: '/late',
            ts: '2026-08-14T04:00:00.000Z',
        });

        const report = await new RetroCorrelator(db).correlate(WINDOW);
        expect(report).toMatchObject({ correlated: 1, noCandidate: 0, rowsScanned: 1, mappingsWritten: 1 });
        const rows = await new RunSessionDao(db).getByRunId('run-o');
        expect(rows).toHaveLength(1);
        expect(rows[0]?.session_id).toBe('s-o');
    });
});
