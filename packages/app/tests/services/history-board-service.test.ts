import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, CLI_SCHEMA_SQL } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { LiveHistoryBoardService } from '../../src/services/history-board-service';

async function setupTestDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of CLI_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await adapter.exec(statement);
    }
    await applyCliMigrations(adapter);
    return adapter;
}

async function seedCorpus(
    db: DbAdapter,
    sessionCount = 50,
    messagesPerSession = 10,
): Promise<{ messages: number; toolCalls: number }> {
    const sources = ['claude', 'codex', 'antigravity', 'omp', 'openclaw', 'hermes', 'grok', 'opencode', 'pi'];
    const models = ['claude-opus-4.6', 'claude-sonnet-4.6', 'gpt-5.6-sol', 'gemini-3.0-flash'];
    const tools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

    let messageTotal = 0;
    let toolCallTotal = 0;

    for (let s = 1; s <= sessionCount; s++) {
        const sessionId = `sess-${s}`;
        const source = sources[s % sources.length] ?? 'claude';
        const model = models[s % models.length] ?? 'claude-opus-4.6';

        for (let m = 1; m <= messagesPerSession; m++) {
            const recordHash = `msg-${s}-${m}`;
            const role = m % 2 === 1 ? 'user' : 'assistant';
            const ts = new Date(
                Date.now() - (sessionCount - s) * 3600 * 1000 - (messagesPerSession - m) * 60 * 1000,
            ).toISOString();

            await db.run(
                `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                     role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
                     cache_read_tokens, provenance, duration_ms, imported_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                recordHash,
                source,
                'test.jsonl',
                m,
                sessionId,
                m,
                role,
                'message',
                'ok',
                ts,
                model,
                role === 'assistant' ? 120 : 50,
                role === 'assistant' ? 80 : 0,
                0.001,
                role === 'assistant' ? 300 : 0,
                'agent',
                role === 'assistant' ? 450 : null,
                '2026-06-01T00:00:00Z',
            );
            messageTotal += 1;

            if (role === 'assistant') {
                const toolName = tools[(s + m) % tools.length] ?? 'Read';
                const toolHash = `tc-${s}-${m}`;
                await db.run(
                    `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                         session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, imported_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    toolHash,
                    recordHash,
                    source,
                    'test.jsonl',
                    1,
                    sessionId,
                    1,
                    toolName,
                    'hash-abc',
                    `{"action": "${toolName}"}`,
                    'success',
                    150,
                    '2026-06-01T00:00:00Z',
                );
                toolCallTotal += 1;
            }
        }
    }

    return { messages: messageTotal, toolCalls: toolCallTotal };
}

describe('LiveHistoryBoardService', () => {
    test('getSummary returns aggregated KPIs and time series', async () => {
        const db = await setupTestDb();
        await seedCorpus(db, 10, 6);
        const svc = new LiveHistoryBoardService({ db });

        const summary = await svc.getSummary({ range: '30d', bucket: '1d' });
        expect(summary.kpis.sessionsCount).toBe(10);
        expect(summary.kpis.totalBilledTokens).toBeGreaterThan(0);
        expect(summary.kpis.cacheSavedTokens).toBeGreaterThan(0);
        expect(summary.topModels.length).toBeGreaterThan(0);
        expect(summary.topSources.length).toBeGreaterThan(0);
        expect(summary.topTools.length).toBeGreaterThan(0);
        expect(summary.cacheEfficiency.hitRatio).toBeGreaterThan(0);
    });

    test('getTimeline returns session metadata and blocks', async () => {
        const db = await setupTestDb();
        await seedCorpus(db, 5, 6);
        const svc = new LiveHistoryBoardService({ db });

        const timeline = await svc.getTimeline('sess-1');
        expect(timeline.session.id).toBe('sess-1');
        expect(timeline.session.messageCount).toBe(6);
        expect(timeline.blocks.length).toBe(1);
        expect(timeline.blocks[0]?.events.length).toBe(6);
    });

    test('getSessions returns sorted paginated session items', async () => {
        const db = await setupTestDb();
        await seedCorpus(db, 25, 4);
        const svc = new LiveHistoryBoardService({ db });

        const sessions = await svc.getSessions({ page: 1, pageSize: 10, sortBy: 'billedTokens', sortDir: 'desc' });
        expect(sessions.total).toBe(25);
        expect(sessions.items.length).toBe(10);
        expect(sessions.page).toBe(1);
        expect(sessions.pageSize).toBe(10);
    });

    test('getInsights returns loops, heavy sessions, slow steps, and model comparison', async () => {
        const db = await setupTestDb();
        await seedCorpus(db, 10, 6);
        const svc = new LiveHistoryBoardService({ db });

        const insights = await svc.getInsights();
        expect(insights.heavySessions.length).toBeGreaterThan(0);
        expect(insights.modelComparison.length).toBeGreaterThan(0);
    });

    test('getSources returns overview and 9 agent heatmaps', async () => {
        const db = await setupTestDb();
        await seedCorpus(db, 18, 4);
        const svc = new LiveHistoryBoardService({ db });

        const sources = await svc.getSources();
        expect(sources.agents.length).toBe(9);
        expect(sources.roots.length).toBe(9);
        expect(sources.overview.totalSessions).toBeGreaterThan(0);
    });

    test('triggerImport returns pending job status', async () => {
        const svc = new LiveHistoryBoardService();
        const res = await svc.triggerImport('incremental');
        expect(res.status).toBe('started');
    });

    test('Performance benchmark: all 6 endpoints respond in <50ms on seeded corpus (50 sessions, 500 messages, 250 tool calls)', async () => {
        const db = await setupTestDb();
        const stats = await seedCorpus(db, 50, 10);
        expect(stats.messages).toBe(500);
        expect(stats.toolCalls).toBe(250);

        const svc = new LiveHistoryBoardService({ db });

        const startSummary = performance.now();
        await svc.getSummary({ range: '30d' });
        const summaryDuration = performance.now() - startSummary;

        const startTimeline = performance.now();
        await svc.getTimeline('sess-1');
        const timelineDuration = performance.now() - startTimeline;

        const startSessions = performance.now();
        await svc.getSessions({ page: 1, pageSize: 20 });
        const sessionsDuration = performance.now() - startSessions;

        const startInsights = performance.now();
        await svc.getInsights();
        const insightsDuration = performance.now() - startInsights;

        const startSources = performance.now();
        await svc.getSources();
        const sourcesDuration = performance.now() - startSources;

        const startTrigger = performance.now();
        await svc.triggerImport('incremental');
        const triggerDuration = performance.now() - startTrigger;

        expect(summaryDuration).toBeLessThan(50);
        expect(timelineDuration).toBeLessThan(50);
        expect(sessionsDuration).toBeLessThan(50);
        expect(insightsDuration).toBeLessThan(50);
        expect(sourcesDuration).toBeLessThan(50);
        expect(triggerDuration).toBeLessThan(50);
    });
});
