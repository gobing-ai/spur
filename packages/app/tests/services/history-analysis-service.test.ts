import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, CLI_SCHEMA_SQL, historyBoardRollupsFresh } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { refreshHistoryRollups } from '../../src/services/history-analysis-service';
import { LiveHistoryBoardService } from '../../src/services/history-board-service';

// The AC5 `skillBreakdown.fresh` flag is genuine rollup-state metadata that differs between the
// pre-refresh (stale) and post-refresh (fresh) read paths. The numeric-equality intent of the
// refreshHistoryRollups tests compares the DATA, not the freshness signal, so strip `fresh`.
function withoutFresh<T extends { skillBreakdown?: { fresh?: boolean } }>(summary: T): T {
    if (summary.skillBreakdown === undefined) return summary;
    const { fresh: _fresh, ...rest } = summary.skillBreakdown;
    return { ...summary, skillBreakdown: rest };
}

async function setup(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of CLI_SCHEMA_SQL.split(';')
        .map((value) => value.trim())
        .filter(Boolean)) {
        await db.exec(statement);
    }
    await applyCliMigrations(db);
    return db;
}

async function insertMessage(
    db: DbAdapter,
    input: {
        hash: string;
        source: string;
        session: string;
        seq: number;
        turn: number;
        role: string;
        ts: string;
        model: string;
        fresh: number;
        cache: number;
        output: number;
        duration?: number;
        importedAt?: string;
    },
): Promise<void> {
    await db.run(
        `INSERT INTO history_message (
             record_hash, source, source_file, source_line, session_id, seq, turn_index,
             role, record_type, disposition, ts, model, input_tokens, output_tokens,
             cache_read_tokens, provenance, duration_ms, content_text, imported_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'message', 'ok', ?, ?, ?, ?, ?, 'agent', ?, ?, ?)`,
        input.hash,
        input.source,
        `${input.source}.jsonl`,
        input.seq,
        input.session,
        input.seq,
        input.turn,
        input.role,
        input.ts,
        input.model,
        input.fresh,
        input.output,
        input.cache,
        input.duration ?? null,
        `${input.role} payload`,
        input.importedAt ?? '2026-08-21T12:00:00Z',
    );
}

async function insertTool(
    db: DbAdapter,
    input: {
        hash: string;
        message: string;
        session: string;
        seq: number;
        tool: string;
        digest: string;
        status?: string;
    },
): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (
             record_hash, message_hash, source, source_file, source_line, session_id, seq,
             tool_name, args_digest, args_raw, status, duration_ms, imported_at
         ) VALUES (?, ?, 'claude', 'claude.jsonl', ?, ?, ?, ?, ?, ?, ?, 100, '2026-08-21T12:00:00Z')`,
        input.hash,
        input.message,
        input.seq,
        input.session,
        input.seq,
        input.tool,
        input.digest,
        input.tool === 'Skill' ? '{"skill":"sp-dev-verify"}' : '{"path":"src/index.ts"}',
        input.status ?? 'success',
    );
}

async function seed(db: DbAdapter): Promise<void> {
    await insertMessage(db, {
        hash: 'm1',
        source: 'claude',
        session: 's1',
        seq: 1,
        turn: 1,
        role: 'user',
        ts: '2026-08-21T10:00:00Z',
        model: 'claude-opus-4.6',
        fresh: 10,
        cache: 0,
        output: 0,
    });
    await insertMessage(db, {
        hash: 'm2',
        source: 'claude',
        session: 's1',
        seq: 2,
        turn: 1,
        role: 'assistant',
        ts: '2026-08-21T10:01:00Z',
        model: 'claude-opus-4.6',
        fresh: 120_000,
        cache: 2_000,
        output: 500,
        duration: 1_000,
    });
    await insertMessage(db, {
        hash: 'm3',
        source: 'claude',
        session: 's1',
        seq: 3,
        turn: 2,
        role: 'assistant',
        ts: '2026-08-21T10:02:00Z',
        model: 'claude-opus-4.6',
        fresh: 80,
        cache: 40,
        output: 20,
        duration: 0,
    });
    await insertMessage(db, {
        hash: 'm4',
        source: 'codex',
        session: 's2',
        seq: 1,
        turn: 1,
        role: 'assistant',
        ts: '2026-08-21T11:00:00Z',
        model: 'gpt-5.6-sol',
        fresh: 200,
        cache: 100,
        output: 50,
        duration: 700,
    });
    await insertTool(db, { hash: 't1', message: 'm2', session: 's1', seq: 1, tool: 'Read', digest: 'same' });
    await insertTool(db, { hash: 't2', message: 'm2', session: 's1', seq: 2, tool: 'Read', digest: 'same' });
    await insertTool(db, {
        hash: 't3',
        message: 'm2',
        session: 's1',
        seq: 3,
        tool: 'Read',
        digest: 'same',
        status: 'error',
    });
    await insertTool(db, { hash: 't4', message: 'm2', session: 's1', seq: 4, tool: 'Skill', digest: 'skill' });
    await insertMessage(db, {
        hash: 'unknown-message',
        source: 'claude',
        session: 'unknown',
        seq: 1,
        turn: 1,
        role: 'assistant',
        ts: '2026-08-21T09:00:00Z',
        model: 'claude-opus-4.6',
        fresh: 5,
        cache: 0,
        output: 1,
    });
    await insertTool(db, {
        hash: 'unknown-t1',
        message: 'unknown-message',
        session: 'unknown',
        seq: 1,
        tool: 'Read',
        digest: 'sentinel-loop',
    });
    await insertTool(db, {
        hash: 'unknown-t2',
        message: 'unknown-message',
        session: 'unknown',
        seq: 2,
        tool: 'Read',
        digest: 'sentinel-loop',
    });
    await insertTool(db, {
        hash: 'unknown-t3',
        message: 'unknown-message',
        session: 'unknown',
        seq: 3,
        tool: 'Read',
        digest: 'sentinel-loop',
    });
    await db.run(
        `INSERT INTO history_import_checkpoint (source, source_file, last_imported_line, updated_at)
         VALUES ('claude', 'claude.jsonl', 3, '2026-08-21T12:00:00Z'),
                ('codex', 'codex.jsonl', 1, '2026-08-21T12:00:00Z')`,
    );
}

function withoutPhysicalSize<T extends { overview: { corpusSizeBytes: number } }>(value: T): T {
    return { ...value, overview: { ...value.overview, corpusSizeBytes: 0 } };
}

describe('refreshHistoryRollups (task 0629)', () => {
    test('is checkpoint-keyed, idempotent, stale-safe, and numerically equal to live reads', async () => {
        const db = await setup();
        await seed(db);
        const service = new LiveHistoryBoardService({ db });

        expect(await historyBoardRollupsFresh(db)).toBe(false);
        const liveSummary = await service.getSummary({ range: 'all', bucket: '1d', dimension: 'model' });
        const liveSubdaySummary = await service.getSummary({ range: 'all', bucket: '5m', dimension: 'tool' });
        const liveSessions = await service.getSessions({
            filter: { range: 'all' },
            page: 1,
            pageSize: 20,
            sortBy: 'billedTokens',
            sortDir: 'desc',
        });
        const liveInsights = await service.getInsights({ range: 'all' });
        expect(liveInsights.loops.some((loop) => loop.sessionId === 'unknown')).toBe(false);
        const liveSources = await service.getSources();

        const first = await refreshHistoryRollups(db);
        expect(first.status).toBe('refreshed');
        expect(await historyBoardRollupsFresh(db)).toBe(true);
        expect(withoutFresh(await service.getSummary({ range: 'all', bucket: '1d', dimension: 'model' }))).toEqual(
            withoutFresh(liveSummary),
        );
        const toolSummary = await service.getSummary({
            range: 'all',
            bucket: '1d',
            dimension: 'model',
            tools: ['Read'],
        });
        expect(toolSummary.kpis.toolCallsCount).toBe(6);
        expect(toolSummary.topTools.map((t) => t.id)).toEqual(['Read']);
        expect(toolSummary.kpis.totalBilledTokens).toBe(90381);
        expect(withoutFresh(await service.getSummary({ range: 'all', bucket: '5m', dimension: 'tool' }))).toEqual(
            withoutFresh(liveSubdaySummary),
        );
        expect(
            await service.getSessions({
                filter: { range: 'all' },
                page: 1,
                pageSize: 20,
                sortBy: 'billedTokens',
                sortDir: 'desc',
            }),
        ).toEqual(liveSessions);
        expect(await service.getInsights({ range: 'all' })).toEqual(liveInsights);
        const toolSessions = await service.getSessions({
            filter: { range: 'all', tools: ['Read'] },
            page: 1,
            pageSize: 20,
            sortBy: 'billedTokens',
            sortDir: 'desc',
        });
        expect(toolSessions.total).toBe(1);
        expect(toolSessions.items[0]?.id).toBe('s1');
        expect(toolSessions.items[0]?.topTool).toBe('Read');

        const toolInsights = await service.getInsights({ range: 'all', tools: ['Read'] });
        expect(toolInsights.modelComparison.length).toBeGreaterThanOrEqual(1);
        expect(withoutPhysicalSize(await service.getSources())).toEqual(withoutPhysicalSize(liveSources));

        const beforeNoOp = await db.queryAll<Record<string, unknown>>(
            'SELECT * FROM history_board_rollup_meta UNION ALL SELECT 0, COUNT(*), MAX(rank) FROM history_board_ranked_steps',
        );
        const second = await refreshHistoryRollups(db);
        expect(second.status).toBe('unchanged');
        expect(
            await db.queryAll<Record<string, unknown>>(
                'SELECT * FROM history_board_rollup_meta UNION ALL SELECT 0, COUNT(*), MAX(rank) FROM history_board_ranked_steps',
            ),
        ).toEqual(beforeNoOp);

        await insertMessage(db, {
            hash: 'm5',
            source: 'codex',
            session: 's2',
            seq: 2,
            turn: 2,
            role: 'assistant',
            ts: '2026-08-21T11:01:00Z',
            model: 'gpt-5.6-sol',
            fresh: 300,
            cache: 150,
            output: 75,
            duration: 400,
            importedAt: '2026-08-21T12:01:00Z',
        });
        await db.run(
            `UPDATE history_import_checkpoint
             SET last_imported_line = 2, updated_at = '2026-08-21T12:01:00Z'
             WHERE source = 'codex'`,
        );
        expect(await historyBoardRollupsFresh(db)).toBe(false);

        const staleFallback = await service.getSummary({ range: 'all', bucket: '1d', dimension: 'model' });
        expect(staleFallback.kpis.totalBilledTokens).toBe(liveSummary.kpis.totalBilledTokens + 375);
        expect((await refreshHistoryRollups(db)).status).toBe('refreshed');
        expect(withoutFresh(await service.getSummary({ range: 'all', bucket: '1d', dimension: 'model' }))).toEqual(
            withoutFresh(staleFallback),
        );
        expect((await refreshHistoryRollups(db)).status).toBe('unchanged');
    });
});
