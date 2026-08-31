import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, CLI_SCHEMA_SQL } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { refreshHistoryRollups } from '../../src/services/history-analysis-service';
import { LiveHistoryBoardService, toolCategory } from '../../src/services/history-board-service';

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
    const sources = ['claude', 'codex', 'agy', 'omp', 'openclaw', 'hermes', 'grok', 'opencode', 'pi'];
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
                `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, turn_index,
                     role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
                     cache_read_tokens, provenance, duration_ms, imported_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                recordHash,
                source,
                'test.jsonl',
                m,
                sessionId,
                m,
                Math.ceil(m / 2),
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
        expect(summary.previousKpis).not.toBeNull();
    });

    test('fresh unfiltered Summary across all four dimensions reads only rollup tables (no raw scans)', async () => {
        const db = await setupTestDb();
        await seedCorpus(db, 12, 6);
        // Add a mixed message: one non-skill and one skill tool call on the same message.
        const mixedTs = new Date(Date.now() - 3600_000).toISOString();
        await db.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, turn_index,
                 role, record_type, disposition, ts, model, input_tokens, output_tokens, cache_read_tokens,
                 provenance, duration_ms, imported_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            'msg-skill-mixed',
            'claude',
            'test.jsonl',
            1,
            'sess-1',
            99,
            50,
            'assistant',
            'message',
            'ok',
            mixedTs,
            'claude-opus-4.6',
            300,
            90,
            100,
            'agent',
            100,
            '2026-06-01T00:00:00Z',
        );
        await db.run(
            `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                 session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, imported_at)
             VALUES ('tc-mixed-1', 'msg-skill-mixed', 'claude', 'test.jsonl', 1, 'sess-1', 1, 'Read', 'h1',
                     '{"file": "a.ts"}', 'success', 10, '2026-06-01T00:00:00Z')`,
        );
        await db.run(
            `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                 session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, imported_at)
             VALUES ('tc-mixed-2', 'msg-skill-mixed', 'claude', 'test.jsonl', 1, 'sess-1', 2, 'skill', 'h2',
                     '{"skill": "sp-code-testing"}', 'success', 20, '2026-06-01T00:00:00Z')`,
        );
        const refreshed = await refreshHistoryRollups(db);
        expect(refreshed.status).toBe('refreshed');

        const queries: string[] = [];
        const recording: DbAdapter = new Proxy(db, {
            get(target, prop) {
                const value = Reflect.get(target, prop, target);
                if (typeof prop === 'string' && ['queryAll', 'queryFirst', 'run', 'exec'].includes(prop)) {
                    return (sql: string, ...params: unknown[]) => {
                        queries.push(sql);
                        return (value as (...args: unknown[]) => unknown).call(target, sql, ...params);
                    };
                }
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });

        const svc = new LiveHistoryBoardService({ db: recording });
        for (const dimension of ['model', 'source', 'tool', 'skill'] as const) {
            const summary = await svc.getSummary({ range: '24h', bucket: '10m', dimension });
            expect(summary.kpis.totalBilledTokens).toBeGreaterThan(0);
            expect(summary.skillTimeSeries).toBeDefined();
            expect(summary.previousKpis).not.toBeNull();
            expect(summary.kpiTrend.length).toBe(30);
        }
        // Skill extras appear for non-skill dimensions too, from the rollup.
        const modelSummary = await svc.getSummary({ range: '24h', bucket: '10m', dimension: 'model' });
        const allSeries = modelSummary.skillTimeSeries.flatMap((p) => Object.keys(p.series));
        expect(allSeries).toContain('sp-code-testing');

        // The only tolerated raw-table reference is the freshness version probe: a
        // single-row `ORDER BY rowid DESC LIMIT 1` read, never a scan or aggregate.
        const rawReads = queries.filter(
            (sql) => /history_message|history_tool_call/.test(sql) && !sql.includes('ORDER BY rowid DESC LIMIT 1'),
        );
        expect(rawReads).toEqual([]);
    });

    test('getTimeline returns session metadata and blocks', async () => {
        const db = await setupTestDb();
        await seedCorpus(db, 5, 6);
        const svc = new LiveHistoryBoardService({ db });

        const timeline = await svc.getTimeline({ mode: 'session', source: 'codex', sessionId: 'sess-1' });
        expect(timeline.scope.sessionId).toBe('sess-1');
        expect(timeline.scope.messageCount).toBe(6);
        expect(timeline.scope.toolCallCount).toBe(3);
        expect(timeline.blocks.length).toBe(3);
        expect(timeline.blocks[0]?.events.length).toBe(3);
        expect(timeline.blocks[0]?.events.map(({ eventType, kind }) => ({ eventType, kind }))).toEqual([
            { eventType: 'message', kind: 'user' },
            { eventType: 'message', kind: 'assistant' },
            { eventType: 'tool', kind: 'bash' },
        ]);
        // Check prompt token telemetry on user event
        expect(timeline.blocks[0]?.events[0]?.promptTokens).toBeDefined();
        expect(timeline.blocks[0]?.events[0]?.promptTokens?.billedTokens).toBeGreaterThan(0);
    });

    test('consolidated timeline keeps same-id sessions and prompt attribution source-safe', async () => {
        const db = await setupTestDb();
        await db.exec(`INSERT INTO history_message (
            record_hash, source, source_file, source_line, session_id, seq, turn_index, role,
            record_type, disposition, ts, model, input_tokens, output_tokens, cache_read_tokens,
            content_text, provenance, imported_at
        ) VALUES
            ('agy-user', 'agy', 'agy.jsonl', 1, 'shared-id', 1, 1, 'user', 'message', 'ok',
             '2026-08-23T10:00:00Z', NULL, NULL, NULL, NULL, 'agy prompt', 'ambient', '2026-08-23T12:00:00Z'),
            ('agy-assistant', 'agy', 'agy.jsonl', 2, 'shared-id', 2, 1, 'assistant', 'message', 'ok',
             '2026-08-23T10:00:01Z', 'gemini-3-pro', 10, 2, 5, 'agy reply', 'ambient', '2026-08-23T12:00:00Z'),
            ('codex-user', 'codex', 'codex.jsonl', 1, 'shared-id', 1, 1, 'user', 'message', 'ok',
             '2026-08-23T10:00:02Z', NULL, NULL, NULL, NULL, 'codex prompt', 'ambient', '2026-08-23T12:00:00Z'),
            ('codex-assistant', 'codex', 'codex.jsonl', 2, 'shared-id', 2, 1, 'assistant', 'message', 'ok',
             '2026-08-23T10:00:03Z', 'gpt-5.6-sol', 100, 20, 50, 'codex reply', 'ambient', '2026-08-23T12:00:00Z')`);

        const timeline = await new LiveHistoryBoardService({ db }).getTimeline({ mode: 'consolidated' });
        expect(timeline.scope.sessionCount).toBe(2);
        expect(timeline.scope.tokens).toMatchObject({ billedTokens: 132, cacheReadTokens: 55 });
        expect(timeline.blocks.map((block) => block.key)).toEqual(['agy:::shared-id:::1', 'codex:::shared-id:::1']);
        const agyPrompt = timeline.blocks[0]?.events.find((event) => event.kind === 'user');
        const codexPrompt = timeline.blocks[1]?.events.find((event) => event.kind === 'user');
        expect(agyPrompt?.promptTokens).toMatchObject({ freshInputTokens: 10, cacheReadTokens: 5, outputTokens: 2 });
        expect(codexPrompt?.promptTokens).toMatchObject({
            freshInputTokens: 100,
            cacheReadTokens: 50,
            outputTokens: 20,
        });
    });

    test('sentinel session ids stay out of navigable session projections', async () => {
        const db = await setupTestDb();
        await seedCorpus(db, 2, 2);
        await db.run(
            `INSERT INTO history_message (
                 record_hash, source, source_file, source_line, session_id, seq, role,
                 record_type, disposition, ts, provenance, imported_at
             ) VALUES ('unknown-message', 'agy', 'legacy.jsonl', 1, 'unknown', 1, 'assistant',
                       'message', 'ok', '2026-08-21T00:00:00Z', 'agent', '2026-08-21T00:00:00Z')`,
        );
        await db.run(
            `INSERT INTO history_message (
                 record_hash, source, source_file, source_line, session_id, seq, role,
                 record_type, disposition, ts, provenance, imported_at
             ) VALUES ('generic-session-message', 'agy', 'legacy.jsonl', 2, 'session', 2, 'assistant',
                       'message', 'ok', '2026-08-21T00:00:01Z', 'agent', '2026-08-21T00:00:01Z')`,
        );
        const svc = new LiveHistoryBoardService({ db });

        const sessions = await svc.getSessions({ page: 1, pageSize: 20 });
        expect(sessions.total).toBe(2);
        expect(sessions.items.some((session) => session.id === 'unknown')).toBe(false);
        await expect(svc.getTimeline({ mode: 'session', source: 'agy', sessionId: 'unknown' })).rejects.toThrow(
            'History session not found',
        );
        await expect(svc.getTimeline({ mode: 'session', source: 'agy', sessionId: 'session' })).rejects.toThrow(
            'History session not found',
        );
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
        expect(sources.agents.find((agent) => agent.id === 'agy')?.sessionCount).toBeGreaterThan(0);
    });

    test('triggerImport returns pending job status', async () => {
        const svc = new LiveHistoryBoardService({
            triggerImport: async (mode) => ({
                runId: 'history-refresh-test',
                status: 'queued',
                message: `${mode} import queued`,
            }),
        });
        const res = await svc.triggerImport('incremental');
        expect(res.status).toBe('queued');
    });

    test('fresh-rollup latency regression: median of 5 serial reads <50ms per tab (50 sessions, 500 messages, 252 tool calls incl. 2 skill)', async () => {
        const db = await setupTestDb();
        const stats = await seedCorpus(db, 50, 10);
        expect(stats.messages).toBe(500);
        expect(stats.toolCalls).toBe(250);
        await seedSkillCalls(db);
        await refreshHistoryRollups(db);

        const svc = new LiveHistoryBoardService({
            db,
            triggerImport: async () => ({ runId: 'history-refresh-benchmark', status: 'queued', message: 'queued' }),
        });

        const reads: [string, () => Promise<unknown>][] = [
            ['summary:model', () => svc.getSummary({ range: '30d', bucket: '1d', dimension: 'model' })],
            ['summary:source', () => svc.getSummary({ range: '30d', bucket: '1d', dimension: 'source' })],
            ['summary:tool', () => svc.getSummary({ range: '30d', bucket: '1d', dimension: 'tool' })],
            ['summary:skill', () => svc.getSummary({ range: '30d', bucket: '1d', dimension: 'skill' })],
            ['timeline', () => svc.getTimeline({ mode: 'session', source: 'codex', sessionId: 'sess-1' })],
            ['sessions', () => svc.getSessions({ page: 1, pageSize: 20 })],
            ['insights', () => svc.getInsights()],
            ['sources', () => svc.getSources()],
        ];
        // triggerImport is excluded from the latency matrix: it is a job enqueue, not a read path.

        for (const [name, read] of reads) {
            await read(); // warm cache/prepared statements once, then sample serially
            const samples: number[] = [];
            for (let i = 0; i < 5; i++) {
                const t0 = performance.now();
                await read();
                samples.push(performance.now() - t0);
            }
            const mid = median(samples);
            expect(
                mid,
                `${name} median ${mid.toFixed(1)}ms of [${samples.map((s) => s.toFixed(1)).join(', ')}]`,
            ).toBeLessThan(50);
        }
    });

    test('deterministic access paths: fresh Sessions/Insights/Sources hit only rollups; no tab leaks currency fields', async () => {
        const db = await setupTestDb();
        await seedCorpus(db, 12, 6); // raw rows carry cost_usd = 0.001
        await seedSkillCalls(db);
        await refreshHistoryRollups(db);

        const queries: string[] = [];
        let tag = '';
        const recording: DbAdapter = new Proxy(db, {
            get(target, prop) {
                const value = Reflect.get(target, prop, target);
                if (typeof prop === 'string' && ['queryAll', 'queryFirst', 'run', 'exec'].includes(prop)) {
                    return (sql: string, ...params: unknown[]) => {
                        queries.push(`${tag}::${sql}`);
                        return (value as (...args: unknown[]) => unknown).call(target, sql, ...params);
                    };
                }
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });

        const svc = new LiveHistoryBoardService({ db: recording });
        const responses: Record<string, unknown> = {};
        const read = async (name: string, fn: () => Promise<unknown>) => {
            tag = name;
            try {
                responses[name] = await fn();
            } finally {
                tag = '';
            }
        };
        await read('summary', () => svc.getSummary({ range: '24h', bucket: '10m' }));
        await read('sessions', () => svc.getSessions({ page: 1, pageSize: 20 }));
        await read('insights', () => svc.getInsights());
        await read('sources', () => svc.getSources());
        await read('timeline', () => svc.getTimeline({ mode: 'session', source: 'codex', sessionId: 'sess-1' }));

        // Timeline is the documented indexed raw-read exception; the other four must not
        // touch history_message/history_tool_call beyond the single-row freshness probe.
        const rawReads = queries.filter(
            (entry) =>
                !entry.startsWith('timeline::') &&
                /history_message|history_tool_call/.test(entry) &&
                !entry.includes('ORDER BY rowid DESC LIMIT 1'),
        );
        expect(rawReads).toEqual([]);

        // Recursively: no Board response key matches cost/currency naming despite cost_usd in raw rows.
        for (const [tab, response] of Object.entries(responses)) {
            expect(forbiddenCurrencyKeys(response), `${tab} leaked currency keys`).toEqual([]);
        }
    });

    test('toolCategory matches precedence table correctly', () => {
        expect(toolCategory('mcp__context__read_file')).toBe('mcp');
        expect(toolCategory('mcp_search')).toBe('mcp');
        expect(toolCategory('run_agent')).toBe('mcp');
        expect(toolCategory('invoke_subagent')).toBe('mcp');
        expect(toolCategory('sp_skill_run')).toBe('mcp');
        expect(toolCategory('grep_search')).toBe('search');
        expect(toolCategory('Glob')).toBe('search');
        expect(toolCategory('WebSearch')).toBe('search');
        expect(toolCategory('write_to_file')).toBe('write');
        expect(toolCategory('edit_file')).toBe('write');
        expect(toolCategory('apply_patch')).toBe('write');
        expect(toolCategory('view_file')).toBe('read');
        expect(toolCategory('read_url_content')).toBe('read');
        expect(toolCategory('run_command')).toBe('bash');
        expect(toolCategory('bash_exec')).toBe('bash');
        expect(toolCategory('unknown_custom_tool')).toBe('other');
    });

    test('getToolSequence returns sequence and splits tokens evenly across linked tools', async () => {
        const db = await setupTestDb();
        const service = new LiveHistoryBoardService({ db });

        // Seed single message with 2 linked tool calls
        await db.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, turn_index,
                 role, record_type, disposition, ts, model, input_tokens, output_tokens, cache_read_tokens,
                 provenance, duration_ms, imported_at)
             VALUES ('msg-seq-1', 'claude', 'test.jsonl', 1, 'sess-seq-1', 1, 1,
                     'assistant', 'message', 'ok', '2026-08-31T01:00:00Z', 'claude-opus-4.6',
                     400, 100, 600, 'agent', 500, '2026-06-01T00:00:00Z')`,
        );

        await db.run(
            `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                 session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, imported_at)
             VALUES ('tc-seq-1', 'msg-seq-1', 'claude', 'test.jsonl', 1, 'sess-seq-1', 1,
                     'view_file', 'src/a.ts', '{"path":"src/a.ts"}', 'ok', 120, '2026-06-01T00:00:00Z')`,
        );

        await db.run(
            `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                 session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, error_text, imported_at)
             VALUES ('tc-seq-2', 'msg-seq-1', 'claude', 'test.jsonl', 2, 'sess-seq-1', 2,
                     'run_command', 'bun test', '{"cmd":"bun test"}', 'error', null, 'Failed test', '2026-06-01T00:00:00Z')`,
        );

        const res = await service.getToolSequence({
            mode: 'session',
            source: 'claude',
            sessionId: 'sess-seq-1',
        });

        expect(res.mode).toBe('session');
        expect(res.truncated).toBe(false);
        expect(res.items.length).toBe(2);

        // Check tool 1
        const item1 = res.items[0];
        expect(item1).toBeDefined();
        expect(item1?.toolName).toBe('view_file');
        expect(item1?.category).toBe('read');
        expect(item1?.status).toBe('ok');
        expect(item1?.durationMs).toBe(120);
        expect(item1?.durationSource).toBe('measured');
        // Tokens: 400 / 2 = 200 fresh, 600 / 2 = 300 cache, 100 / 2 = 50 out => billed = 250
        expect(item1?.tokens.freshInputTokens).toBe(200);
        expect(item1?.tokens.cacheReadTokens).toBe(300);
        expect(item1?.tokens.outputTokens).toBe(50);
        expect(item1?.tokens.billedTokens).toBe(250);

        // Check tool 2
        const item2 = res.items[1];
        expect(item2).toBeDefined();
        expect(item2?.toolName).toBe('run_command');
        expect(item2?.category).toBe('bash');
        expect(item2?.status).toBe('error');
        expect(item2?.durationMs).toBeNull();
        expect(item2?.durationSource).toBe('unmeasured');
        expect(item2?.errorText).toBe('Failed test');

        // Check scope metrics
        expect(res.scope.totalCalls).toBe(2);
        expect(res.scope.uniqueTools).toBe(2);
        expect(res.scope.errorCount).toBe(1);
        expect(res.scope.errorRate).toBe(0.5);
        expect(res.scope.totalDurationMs).toBe(120);
        expect(res.scope.meanDurationMs).toBe(120);
        expect(res.scope.durationUnmeasured).toBe(1);
        expect(res.scope.tokens.billedTokens).toBe(500); // Sum of shares equals original message total!
        expect(res.scope.tokens.cacheReadTokens).toBe(600);
    });

    test('getToolSequence token shares sum to message totals when not evenly divisible', async () => {
        const db = await setupTestDb();
        const service = new LiveHistoryBoardService({ db });

        // 401 / 3 and 101 / 3 do not divide evenly — rounding each share independently
        // would over- or under-attribute the message totals in the scope aggregate.
        await db.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, turn_index,
                 role, record_type, disposition, ts, model, input_tokens, output_tokens, cache_read_tokens,
                 provenance, duration_ms, imported_at)
             VALUES ('msg-odd-1', 'claude', 'odd.jsonl', 1, 'sess-odd-1', 1, 1,
                     'assistant', 'message', 'ok', '2026-08-31T02:00:00Z', 'claude-opus-4.6',
                     401, 101, 205, 'agent', 500, '2026-06-01T00:00:00Z')`,
        );
        for (const [i, hash] of ['tc-odd-1', 'tc-odd-2', 'tc-odd-3'].entries()) {
            await db.run(
                `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                     session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, imported_at)
                 VALUES (?, 'msg-odd-1', 'claude', 'odd.jsonl', ?, 'sess-odd-1', ?,
                         'view_file', 'src/a.ts', '{"path":"src/a.ts"}', 'ok', 10, '2026-06-01T00:00:00Z')`,
                hash,
                i + 1,
                i + 1,
            );
        }

        const res = await service.getToolSequence({ mode: 'session', source: 'claude', sessionId: 'sess-odd-1' });

        expect(res.items.length).toBe(3);
        const sum = (pick: (t: (typeof res.items)[number]['tokens']) => number) =>
            res.items.reduce((acc, item) => acc + pick(item.tokens), 0);
        expect(sum((t) => t.freshInputTokens)).toBeCloseTo(401, 6);
        expect(sum((t) => t.outputTokens)).toBeCloseTo(101, 6);
        expect(sum((t) => t.cacheReadTokens)).toBeCloseTo(205, 6);
        expect(res.scope.tokens.freshInputTokens).toBeCloseTo(401, 6);
        expect(res.scope.tokens.outputTokens).toBeCloseTo(101, 6);
        expect(res.scope.tokens.cacheReadTokens).toBeCloseTo(205, 6);
        expect(res.scope.tokens.billedTokens).toBeCloseTo(502, 6);
    });

    test('getToolSequence handles empty db cleanly', async () => {
        const service = new LiveHistoryBoardService({});
        const res = await service.getToolSequence({ mode: 'consolidated' });
        expect(res.items).toEqual([]);
        expect(res.scope.totalCalls).toBe(0);
    });
});

/** Mixed skill/non-skill tool calls on one shared message (0632 fixture shape, reused for 0633). */
async function seedSkillCalls(db: DbAdapter): Promise<void> {
    const ts = new Date(Date.now() - 3600_000).toISOString();
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, turn_index,
             role, record_type, disposition, ts, model, input_tokens, output_tokens, cache_read_tokens,
             provenance, duration_ms, imported_at)
         VALUES ('msg-skill-mixed', 'claude', 'test.jsonl', 1, 'sess-1', 99, 50,
                 'assistant', 'message', 'ok', ?, 'claude-opus-4.6', 300, 90, 100, 'agent', 100, '2026-06-01T00:00:00Z')`,
        ts,
    );
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, imported_at)
         VALUES ('tc-benchmark-skill', 'msg-skill-mixed', 'claude', 'test.jsonl', 1, 'sess-1', 3, 'skill', 'hs',
                 '{"skill": "sp-code-testing"}', 'success', 20, '2026-06-01T00:00:00Z')`,
    );
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, imported_at)
         VALUES ('tc-benchmark-plain', 'msg-skill-mixed', 'claude', 'test.jsonl', 1, 'sess-1', 4, 'Read', 'hp',
                 '{"file": "a.ts"}', 'success', 10, '2026-06-01T00:00:00Z')`,
    );
}

function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
}

function forbiddenCurrencyKeys(value: unknown, path = '$'): string[] {
    if (Array.isArray(value)) return value.flatMap((v) => forbiddenCurrencyKeys(v, path));
    if (value !== null && typeof value === 'object') {
        return Object.entries(value).flatMap(([k, v]) =>
            /cost|usd|dollar|currency/i.test(k) ? [`${path}.${k}`] : forbiddenCurrencyKeys(v, `${path}.${k}`),
        );
    }
    return [];
}
