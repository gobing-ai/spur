import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type ArtifactSelector,
    createMigratedDb,
    type DbAdapter,
    emptyAttributionSummary,
    type HistoryArtifact,
    historyBoardHistoryVersion,
    historyBoardRollupsFresh,
    RunSessionDao,
} from '@gobing-ai/spur-domain';
import {
    assertPiImporterSafe,
    HistoryService,
    type HistoryServiceContext,
    MIN_SAFE_PI_BASH_IMPORTER_VERSION,
    parseImporterVersion,
    UnsafeHistoryImporterError,
    writeArtifact,
} from '../../src/services/history-service';

/** An empty directory so incremental scans find no real on-disk history (hermetic). */
function emptyRoot(): string {
    return mkdtempSync(join(tmpdir(), 'spur-hist-empty-'));
}

function makeCtx() {
    let db: DbAdapter | undefined;
    return {
        getDb: async () => {
            if (db === undefined) db = await createMigratedDb({ url: ':memory:' });
            return db;
        },
    };
}

const ALL: ArtifactSelector = {
    since: null,
    until: null,
    sources: null,
    sessionId: null,
    runId: null,
    taskWbs: null,
};

interface Msg {
    record_hash: string;
    session_id: string;
    seq: number;
    ts: string;
    model: string | null;
    role?: string;
    input?: number | null;
    output?: number | null;
    cost?: number | null;
    disposition?: string;
    record_type?: string;
    provenance?: string;
    duration_ms?: number | null;
}

async function insertMessage(db: DbAdapter, m: Msg): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
             provenance, duration_ms, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.record_hash,
        'claude',
        'test.jsonl',
        1,
        m.session_id,
        m.seq,
        m.role ?? 'assistant',
        m.record_type ?? 'message',
        m.disposition ?? 'conversation',
        m.ts,
        m.model,
        m.input ?? null,
        m.output ?? null,
        m.cost ?? null,
        m.provenance ?? 'agent',
        m.duration_ms ?? null,
        '2026-06-01T00:00:00Z',
    );
}

interface ToolCall {
    record_hash: string;
    message_hash: string;
    session_id: string;
    seq: number;
    tool_name: string;
    args_digest: string | null;
    status: string;
    duration_ms: number | null;
}

async function insertToolCall(db: DbAdapter, t: ToolCall): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, args_digest, status, duration_ms, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.record_hash,
        t.message_hash,
        'claude',
        'test.jsonl',
        1,
        t.session_id,
        t.seq,
        t.tool_name,
        t.args_digest,
        t.status,
        t.duration_ms,
        '2026-06-01T00:00:00Z',
    );
}

/** Seed one session with two messages, one unknown record, and three tool calls. */
async function seed(ctx: HistoryServiceContext): Promise<void> {
    const db = await ctx.getDb();
    await insertMessage(db, {
        record_hash: 'm1',
        session_id: 'sess-1',
        seq: 1,
        ts: '2026-05-30T10:00:00Z',
        model: 'claude-opus-5',
        input: 1000,
        output: 500,
        cost: 0.05,
        duration_ms: 4000,
    });
    await insertMessage(db, {
        record_hash: 'm2',
        session_id: 'sess-1',
        seq: 2,
        ts: '2026-05-30T11:00:00Z',
        model: 'claude-opus-5',
        input: 500,
        output: 200,
        cost: 0.02,
        duration_ms: 6000,
    });
    await insertMessage(db, {
        record_hash: 'm3',
        session_id: 'sess-1',
        seq: 3,
        ts: '2026-05-31T10:00:00Z',
        model: null,
        disposition: 'unknown',
        record_type: 'id+ts+content',
        duration_ms: null,
    });
    await insertToolCall(db, {
        record_hash: 'tc1',
        message_hash: 'm1',
        session_id: 'sess-1',
        seq: 1,
        tool_name: 'Read',
        args_digest: 'abc',
        status: 'success',
        duration_ms: 100,
    });
    await insertToolCall(db, {
        record_hash: 'tc2',
        message_hash: 'm1',
        session_id: 'sess-1',
        seq: 2,
        tool_name: 'Read',
        args_digest: 'abc',
        status: 'success',
        duration_ms: 150,
    });
    await insertToolCall(db, {
        record_hash: 'tc3',
        message_hash: 'm2',
        session_id: 'sess-1',
        seq: 3,
        tool_name: 'Bash',
        args_digest: null,
        status: 'success',
        duration_ms: 300,
    });
}

describe('HistoryService', () => {
    describe('analyze', () => {
        test('returns a versioned artifact with zeroed totals for an empty corpus', async () => {
            const svc = new HistoryService(makeCtx());
            const artifact = await svc.analyze(ALL);
            expect(artifact.schemaVersion).toBe(1);
            expect(artifact.totals.messages).toBe(0);
            expect(artifact.totals.toolCalls).toBe(0);
            expect(artifact.totals.costUsd).toBe(0);
            expect(artifact.coverage).toEqual([]);
            expect(artifact.loops).toEqual([]);
            expect(artifact.warnings).toEqual([]);
        });

        test('analyze materializes all 11 rollup tables once and stamps the matching history version', async () => {
            const ctx = makeCtx();
            await seed(ctx);
            const db = await ctx.getDb();
            const svc = new HistoryService(ctx);
            await svc.analyze(ALL);

            // Single refresh choke point: analyze leaves rollups fresh and version-stamped.
            expect(await historyBoardRollupsFresh(db)).toBe(true);
            const version = await historyBoardHistoryVersion(db);
            const meta = await db.queryFirst<{ history_version: string }>(
                'SELECT history_version FROM history_board_rollup_meta',
            );
            expect(meta?.history_version).toBe(version);

            // Message rollup: every deduped message lands with its tokens.
            const msg = await db.queryFirst<{ messages: number; input_tokens: number; output_tokens: number }>(
                'SELECT SUM(messages) AS messages, SUM(fresh_input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM history_board_message_5m',
            );
            expect(msg?.messages).toBe(3);
            expect(msg?.input_tokens).toBe(1500);
            expect(msg?.output_tokens).toBe(700);
            // Tool rollup: all three calls, duration preserved.
            const tool = await db.queryFirst<{ calls: number; duration_ms: number }>(
                'SELECT SUM(calls) AS calls, SUM(duration_ms) AS duration_ms FROM history_board_tool_5m',
            );
            expect(tool?.calls).toBe(3);
            expect(tool?.duration_ms).toBe(550);
            // Session/model/source aggregates.
            expect(
                await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_session_stats'),
            ).toMatchObject({ n: 1 });
            expect(
                await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_model_stats'),
            ).toMatchObject({ n: 1 });
            expect(
                await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_tool_stats'),
            ).toMatchObject({ n: 2 }); // Read + Bash
            expect(
                await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_source_stats'),
            ).toMatchObject({ n: 1 });
            expect(
                await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_source_daily'),
            ).toMatchObject({ n: 2 });
            expect(
                await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_ranked_steps'),
            ).toMatchObject({ n: 4 }); // 2 by-tokens + 2 by-duration
            expect(await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_daily_stats')).toMatchObject({
                n: 2,
            });
            // Legitimate zero count: this fixture has no loops, so loop findings stays empty
            // while every other table carries its aggregate.
            expect(
                await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_loop_findings'),
            ).toMatchObject({ n: 0 });

            // Re-analyzing the unchanged corpus performs no duplicate refresh work.
            const { refreshHistoryRollups } = await import('../../src/services/history-analysis-service');
            expect((await refreshHistoryRollups(db)).status).toBe('unchanged');
        });

        test('assembles the artifact from SQL aggregation', async () => {
            const ctx = makeCtx();
            await seed(ctx);
            const svc = new HistoryService(ctx);
            const artifact = await svc.analyze(ALL);

            expect(artifact.schemaVersion).toBe(1);
            expect(artifact.selector.sources).toBeNull();
            // totals
            expect(artifact.totals.messages).toBe(3);
            expect(artifact.totals.toolCalls).toBe(3);
            expect(artifact.totals.inputTokens).toBe(1500);
            expect(artifact.totals.outputTokens).toBe(700);
            expect(artifact.totals.costUsd).toBeCloseTo(0.07);
            expect(artifact.totals.recordsWithUsage).toBe(2); // m1 + m2
            // Assistant duration: role-filtered sum + unmeasured count (0507 R2).
            expect(artifact.totals.assistantDurationMs).toBe(10000); // m1 4000 + m2 6000
            expect(artifact.totals.assistantDurationUnmeasured).toBe(1); // m3
            expect(artifact.totals.durationMs).toBe(550); // tool calls only — unchanged semantics
            // bySource / byModel / daily
            expect(artifact.bySource.claude?.messages).toBe(3);
            expect(artifact.byModel['claude-opus-5']?.messages).toBe(2);
            expect(artifact.byModel.unknown?.messages).toBe(1);
            expect(artifact.daily.map((d) => d.date).sort()).toEqual(['2026-05-30', '2026-05-31']);
            // byTool ranked by duration
            expect(artifact.byTool[0]?.toolName).toBe('Bash');
            expect(artifact.byTool.find((t) => t.toolName === 'Read')?.calls).toBe(2);
            // bySession
            expect(artifact.bySession[0]?.sessionId).toBe('sess-1');
            expect(artifact.bySession[0]?.topTool).toBe('Read');
            expect(artifact.bySession[0]?.assistantDurationMs).toBe(10000);
            expect(artifact.bySession[0]?.assistantDurationUnmeasured).toBe(1);
            expect(artifact.bySession[0]?.sessionState).toBe('complete');
            // loops: Read/abc repeated 2 — below the >=3 threshold, so none
            expect(artifact.loops).toEqual([]);
            // HA-S1: true population recorded, not the bounded array lengths.
            expect(artifact.population).toMatchObject({ sessions: 1, tools: 2, loops: 0, appliedTop: 20 });
            // drift warning
            expect(artifact.warnings.some((w) => w.code === 'unknown-drift')).toBe(true);
            // coverage
            expect(artifact.coverage[0]?.source).toBe('claude');
            expect(artifact.coverage[0]?.messages).toBe(3);
            expect(artifact.coverage[0]?.toolCalls).toBe(3);
            expect(artifact.coverage[0]?.unknownRecords).toBe(1);
        });

        test('HA-S1: analyze --top 2 records the true population, not the bounded depth', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            // Three sessions, two distinct tools — population must be 3/2 even at top=2.
            for (const s of ['sess-a', 'sess-b', 'sess-c']) {
                await insertMessage(db, {
                    record_hash: `m-${s}`,
                    session_id: s,
                    seq: 1,
                    ts: '2026-05-30T10:00:00Z',
                    model: 'claude-opus-5',
                    input: 100,
                    output: 50,
                    cost: 0.01,
                    duration_ms: 1000,
                });
            }
            for (const tool of ['Read', 'Bash']) {
                await insertToolCall(db, {
                    record_hash: `tc-${tool}`,
                    message_hash: 'm-sess-a',
                    session_id: 'sess-a',
                    seq: 1,
                    tool_name: tool,
                    args_digest: null,
                    status: 'success',
                    duration_ms: 100,
                });
            }
            const svc = new HistoryService(ctx);
            const artifact = await svc.analyze(ALL, { top: 2 });
            // True population exceeds the bounded leaderboard depth (2).
            expect(artifact.population?.sessions).toBe(3);
            expect(artifact.population?.tools).toBe(2);
            expect(artifact.population?.appliedTop).toBe(2);
            // Bounded leaderboards stay at depth.
            expect(artifact.bySession).toHaveLength(2);
        });

        test('marks a still-appending session in-progress and excludes the trailing turn', async () => {
            const ctx = makeCtx();
            await seed(ctx);
            const db = await ctx.getDb();
            await insertMessage(db, {
                record_hash: 'm-live',
                session_id: 'sess-1',
                seq: 4,
                ts: '2026-05-31T10:01:00Z',
                model: null,
                role: 'user',
                input: 777,
                output: 0,
                cost: 9,
            });
            const svc = new HistoryService(ctx);
            const first = await svc.analyze(ALL);
            expect(first.bySession[0]?.sessionState).toBe('in-progress');
            expect(first.totals.messages).toBe(3);
            expect(first.bySource.claude?.messages).toBe(3);
            const second = await svc.analyze(ALL);
            expect(second.bySession).toHaveLength(1);
            expect(second.bySession[0]?.sessionState).toBe('in-progress');
        });

        test('reports loop findings when a digest repeats >= 3 times', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await seed(ctx);
            await insertToolCall(db, {
                record_hash: 'tc4',
                message_hash: 'm1',
                session_id: 'sess-1',
                seq: 4,
                tool_name: 'Read',
                args_digest: 'abc',
                status: 'success',
                duration_ms: 90,
            });
            const svc = new HistoryService(ctx);
            const artifact = await svc.analyze(ALL);
            expect(artifact.loops).toHaveLength(1);
            expect(artifact.loops[0]?.toolName).toBe('Read');
            expect(artifact.loops[0]?.repeats).toBe(3);
        });

        test('R5 — a corpus with no duration data yields durationUnmeasured, not a fabricated zero total', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await insertMessage(db, {
                record_hash: 'm1',
                session_id: 'sess-1',
                seq: 1,
                ts: '2026-05-30T10:00:00Z',
                model: 'claude-opus-5',
                input: 100,
                output: 50,
            });
            await insertToolCall(db, {
                record_hash: 'tc1',
                message_hash: 'm1',
                session_id: 'sess-1',
                seq: 1,
                tool_name: 'Read',
                args_digest: null,
                status: 'success',
                duration_ms: null,
            });
            // Task 0550: the watermark treats an assistant message with an open tool call as
            // a mid-turn message — a session ending on one is `in-progress` and its data is
            // excluded. Add a closing assistant response so this fixture stays a complete
            // session and the test keeps asserting the durationUnmeasured semantics it was
            // written for (R5: never a fabricated zero total).
            await insertMessage(db, {
                record_hash: 'm2',
                session_id: 'sess-1',
                seq: 2,
                ts: '2026-05-30T10:01:00Z',
                model: 'claude-opus-5',
                input: 50,
                output: 20,
            });
            const svc = new HistoryService(ctx);
            const artifact = await svc.analyze(ALL);
            expect(artifact.totals.toolCalls).toBe(1);
            expect(artifact.totals.durationUnmeasured).toBe(1);
            expect(artifact.totals.durationMs).toBe(0);
        });

        // Task 0550 R1/R2: watermark — an in-progress session (trailing partial turn) is
        // marked `in-progress` and its partial turn is excluded from every derived total.
        test('0550 R1/R2 — an in-progress session is marked and its partial turn excluded from totals', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            // Complete turn 1: user + assistant (no tool call) → closes the turn.
            await insertMessage(db, {
                record_hash: 'w1',
                session_id: 'sess-w',
                seq: 1,
                ts: '2026-06-01T00:00:00Z',
                model: 'claude-opus-5',
                role: 'user',
                input: 100,
                output: 0,
            });
            await insertMessage(db, {
                record_hash: 'w2',
                session_id: 'sess-w',
                seq: 2,
                ts: '2026-06-01T00:01:00Z',
                model: 'claude-opus-5',
                input: 200,
                output: 100,
            });
            // Partial turn 2: user message only — no assistant response yet (still appending).
            await insertMessage(db, {
                record_hash: 'w3',
                session_id: 'sess-w',
                seq: 3,
                ts: '2026-06-01T00:02:00Z',
                model: 'claude-opus-5',
                role: 'user',
                input: 500,
                output: 0,
            });
            const svc = new HistoryService(ctx);
            const artifact = await svc.analyze(ALL);
            expect(artifact.bySession[0]?.sessionState).toBe('in-progress');
            // Totals exclude the trailing partial turn: 2 messages, 300 input (not 800).
            expect(artifact.totals.messages).toBe(2);
            expect(artifact.totals.inputTokens).toBe(300);
        });

        // Task 0550 R2: a complete session is marked complete and its data counted in full.
        test('0550 R2 — a complete session is marked complete and its data counted in full', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await insertMessage(db, {
                record_hash: 'c1',
                session_id: 'sess-c',
                seq: 1,
                ts: '2026-06-01T00:00:00Z',
                model: 'claude-opus-5',
                role: 'user',
                input: 100,
                output: 0,
            });
            await insertMessage(db, {
                record_hash: 'c2',
                session_id: 'sess-c',
                seq: 2,
                ts: '2026-06-01T00:01:00Z',
                model: 'claude-opus-5',
                input: 200,
                output: 100,
            });
            const svc = new HistoryService(ctx);
            const artifact = await svc.analyze(ALL);
            expect(artifact.bySession[0]?.sessionState).toBe('complete');
            expect(artifact.totals.messages).toBe(2);
            expect(artifact.totals.inputTokens).toBe(300);
        });

        // Task 0550 R5: supersede, do not accumulate. Re-analyzing a growing session leaves
        // exactly ONE bySession record per analyze — the watermark excludes the partial turn
        // while it is live, and the completed re-analysis supersedes the in-progress result
        // instead of stacking a second record. Three analyses while running + one after =
        // one final record, never four.
        test('0550 R5 — re-analyzing a growing session supersedes the in-progress result, never duplicates it', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            // Turn 1 complete: user + assistant (no tool call).
            await insertMessage(db, {
                record_hash: 's1',
                session_id: 'sess-s',
                seq: 1,
                ts: '2026-06-01T00:00:00Z',
                model: 'claude-opus-5',
                role: 'user',
                input: 100,
                output: 0,
            });
            await insertMessage(db, {
                record_hash: 's2',
                session_id: 'sess-s',
                seq: 2,
                ts: '2026-06-01T00:01:00Z',
                model: 'claude-opus-5',
                input: 200,
                output: 100,
            });
            // Partial turn 2: user message only — the agent is still writing.
            await insertMessage(db, {
                record_hash: 's3',
                session_id: 'sess-s',
                seq: 3,
                ts: '2026-06-01T00:02:00Z',
                model: 'claude-opus-5',
                role: 'user',
                input: 500,
                output: 0,
            });
            const svc = new HistoryService(ctx);

            // First refresh while running: one in-progress record, partial turn excluded.
            const first = await svc.analyze(ALL);
            expect(first.bySession).toHaveLength(1);
            expect(first.bySession[0]?.sessionState).toBe('in-progress');
            expect(first.bySession[0]?.messages).toBe(2);

            // Second refresh while still running: still exactly one record, still in-progress.
            const second = await svc.analyze(ALL);
            expect(second.bySession).toHaveLength(1);
            expect(second.bySession[0]?.sessionState).toBe('in-progress');

            // The session completes: assistant response closes turn 2.
            await insertMessage(db, {
                record_hash: 's4',
                session_id: 'sess-s',
                seq: 4,
                ts: '2026-06-01T00:03:00Z',
                model: 'claude-opus-5',
                input: 50,
                output: 20,
            });

            // Final refresh after completion: ONE complete record supersedes the partials.
            const final = await svc.analyze(ALL);
            expect(final.bySession).toHaveLength(1);
            expect(final.bySession[0]?.sessionState).toBe('complete');
            // Full final data, not four partial records — 4 messages, 850 input tokens.
            expect(final.bySession[0]?.messages).toBe(4);
            expect(final.totals.messages).toBe(4);
            expect(final.totals.inputTokens).toBe(850);
        });

        test('R4 — the same selector twice resolves to the same artifact path', async () => {
            const cwd = mkdtempSync(join(tmpdir(), 'spur-artifact-'));
            const ctx = makeCtx();
            const svc = new HistoryService(ctx);
            const first = await svc.analyze(ALL, { cwd });
            const second = await svc.analyze(ALL, { cwd });
            const firstPath = readlinkSync(join(cwd, '.spur', 'reports', 'history', 'latest.json'));
            const secondPath = readlinkSync(join(cwd, '.spur', 'reports', 'history', 'latest.json'));
            expect(firstPath).toBe(secondPath);
            expect(existsSync(firstPath)).toBe(true);
            const written = JSON.parse(readFileSync(firstPath, 'utf8')) as HistoryArtifact;
            expect(written.schemaVersion).toBe(1);
            expect(written.totals).toEqual(first.totals);
            expect(second.totals).toEqual(first.totals);
            rmSync(cwd, { recursive: true, force: true });
        });

        test('respects --out for ad-hoc artifact paths', async () => {
            const cwd = mkdtempSync(join(tmpdir(), 'spur-artifact-out-'));
            const ctx = makeCtx();
            await seed(ctx);
            const svc = new HistoryService(ctx);
            const out = join(cwd, 'custom.json');
            await svc.analyze(ALL, { out });
            expect(existsSync(out)).toBe(true);
            expect(existsSync(`${out.replace(/\.json$/, '')}.errors.jsonl`)).toBe(false); // no errors → no sidecar
            rmSync(cwd, { recursive: true, force: true });
        });
    });

    describe('writeArtifact (R6 bounding)', () => {
        function makeArtifact(validationErrorSamples: string[]): HistoryArtifact {
            return {
                schemaVersion: 1,
                generatedAt: '2026-08-07T00:00:00Z',
                spurVersion: '0.0.0-test',
                selector: ALL,
                coverage: [
                    {
                        source: 'claude',
                        status: 'ok',
                        files: 1,
                        messages: 10,
                        toolCalls: 5,
                        unknownRecords: 0,
                        lastImportedAt: '2026-08-07T00:00:00Z',
                        parseErrors: 0,
                        validationErrors: validationErrorSamples.length,
                        parseErrorSamples: [],
                        validationErrorSamples,
                    },
                ],
                totals: {
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    costUsd: 0,
                    records: 0,
                    recordsWithUsage: 0,
                    messages: 10,
                    toolCalls: 5,
                    durationMs: 0,
                    durationUnmeasured: 0,
                    assistantDurationMs: 0,
                    assistantDurationUnmeasured: 0,
                },
                bySource: {},
                byModel: {},
                daily: [],
                byTool: [],
                bySession: [],
                loops: [],
                warnings: [],
            };
        }

        test('caps error samples at 20 per source and streams the remainder to the sidecar', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'spur-bounding-'));
            const out = join(cwd, 'analyze-abc.json');
            const samples = Array.from({ length: 25 }, (_, i) => `err-${i}`);
            const { sidecarPath } = writeArtifact(makeArtifact(samples), { out, cwd });

            const written = JSON.parse(readFileSync(out, 'utf8')) as HistoryArtifact;
            expect(written.coverage[0]?.validationErrorSamples).toHaveLength(20);
            expect(written.coverage[0]?.validationErrors).toBe(25); // true count preserved

            const sidecar = readFileSync(sidecarPath, 'utf8').trim().split('\n');
            expect(sidecar).toHaveLength(5); // 25 - 20 overflow
            for (const line of sidecar) {
                const parsed = JSON.parse(line) as { source: string; kind: string; sample: string };
                expect(parsed.source).toBe('claude');
                expect(parsed.kind).toBe('validation');
            }
            expect(sidecar.map((l) => JSON.parse(l).sample)).toEqual([
                'err-20',
                'err-21',
                'err-22',
                'err-23',
                'err-24',
            ]);
            rmSync(cwd, { recursive: true, force: true });
        });

        test('writes no sidecar when samples are within bounds', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'spur-bounding-ok-'));
            const out = join(cwd, 'analyze.json');
            const { sidecarPath } = writeArtifact(makeArtifact(['only-one']), { out, cwd });
            expect(existsSync(sidecarPath)).toBe(false);
            rmSync(cwd, { recursive: true, force: true });
        });
    });

    describe('pi importer provenance guard (0726 R1)', () => {
        /** makeCtx with an open counter so tests can prove the DB was never touched. */
        function makeGuardCtx(importerVersion: string) {
            const ctx = makeCtx();
            let dbOpens = 0;
            const svc = new HistoryService({
                getDb: async () => {
                    dbOpens++;
                    return ctx.getDb();
                },
                importerVersion,
            });
            return { svc, dbOpens: () => dbOpens };
        }

        async function importError(promise: Promise<unknown>): Promise<UnsafeHistoryImporterError> {
            let caught: unknown;
            try {
                await promise;
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeInstanceOf(UnsafeHistoryImporterError);
            return caught as UnsafeHistoryImporterError;
        }

        test('parseImporterVersion accepts exact triples and rejects unknown/malformed/prerelease', () => {
            expect(parseImporterVersion('0.4.48')).toEqual([0, 4, 48]);
            expect(parseImporterVersion('1.0.0')).toEqual([1, 0, 0]);
            expect(parseImporterVersion('unknown')).toBeNull();
            expect(parseImporterVersion('')).toBeNull();
            expect(parseImporterVersion(undefined)).toBeNull();
            expect(parseImporterVersion('1.2')).toBeNull();
            expect(parseImporterVersion('0.4.49-beta.1')).toBeNull();
            expect(parseImporterVersion(' 0.4.49 ')).toEqual([0, 4, 49]);
        });

        test('assertPiImporterSafe gates only non-dry-run full imports containing pi', () => {
            const base = { importerVersion: '0.4.48', mode: 'full', dryRun: false };
            // pi + full + real run on the destructive version → throws.
            expect(() => assertPiImporterSafe({ ...base, sources: ['pi'] })).toThrow(UnsafeHistoryImporterError);
            // Dry-run is always safe (no persistence).
            expect(() => assertPiImporterSafe({ ...base, dryRun: true, sources: ['pi'] })).not.toThrow();
            // Incremental/force-file modes are append-scoped, not reconciliation.
            expect(() => assertPiImporterSafe({ ...base, mode: 'incremental', sources: ['pi'] })).not.toThrow();
            expect(() => assertPiImporterSafe({ ...base, mode: 'force-file', sources: ['pi'] })).not.toThrow();
            // Non-pi sources are out of the guard's scope.
            expect(() => assertPiImporterSafe({ ...base, sources: ['claude'] })).not.toThrow();
            expect(() => assertPiImporterSafe({ ...base, sources: ['pi', 'claude'] })).toThrow(
                UnsafeHistoryImporterError,
            );
            // Boundary: exactly the minimum is safe, one patch below is not.
            expect(() =>
                assertPiImporterSafe({ ...base, importerVersion: MIN_SAFE_PI_BASH_IMPORTER_VERSION, sources: ['pi'] }),
            ).not.toThrow();
            expect(() => assertPiImporterSafe({ ...base, importerVersion: '0.4.49-beta.1', sources: ['pi'] })).toThrow(
                UnsafeHistoryImporterError,
            );
        });

        test('import rejects a full pi import on 0.4.48 before any database access', async () => {
            const { svc, dbOpens } = makeGuardCtx('0.4.48');
            const err = await importError(svc.import('pi', { mode: 'full', root: emptyRoot() }));
            expect(err.code).toBe('unsafe-history-importer');
            expect(err.installedVersion).toBe('0.4.48');
            expect(err.minSafeVersion).toBe('0.4.49');
            expect(err.message).toContain('96762d5');
            expect(err.message).toContain('--dry-run');
            expect(dbOpens()).toBe(0);
        });

        test('import rejects unknown, malformed, and prerelease versions (fail closed)', async () => {
            for (const version of ['unknown', '1.2', '0.4.49-rc.1', '']) {
                const { svc, dbOpens } = makeGuardCtx(version);
                await importError(svc.import('pi', { mode: 'full', root: emptyRoot() }));
                expect(dbOpens()).toBe(0);
            }
        });

        test('import lets a safe importer run a full pi scan (hermetic empty root)', async () => {
            const { svc, dbOpens } = makeGuardCtx('0.4.49');
            const result = await svc.import('pi', { mode: 'full', root: emptyRoot() });
            expect(result.source).toBe('pi');
            expect(result.mode).toBe('full');
            expect(dbOpens()).toBeGreaterThan(0);
        });

        test('importAll rejects before any source fan-out when pi is included and version is unsafe', async () => {
            const { svc, dbOpens } = makeGuardCtx('0.4.48');
            // Default source list includes pi; a full non-dry-run fan-out must not start.
            const err = await importError(svc.importAll({ mode: 'full' }));
            expect(err.code).toBe('unsafe-history-importer');
            expect(dbOpens()).toBe(0);
        });

        test('importAll dry-run and non-full modes skip the guard entirely', async () => {
            const dryRun = makeGuardCtx('0.4.48');
            const result = await dryRun.svc.importAll({ mode: 'full', dryRun: true, root: emptyRoot() });
            expect(result.entries.length).toBeGreaterThan(0);

            const incremental = makeGuardCtx('0.4.48');
            const incrementalResult = await incremental.svc.importAll({ mode: 'incremental', root: emptyRoot() });
            expect(incrementalResult.entries.length).toBeGreaterThan(0);
        });
    });

    describe('import', () => {
        test('throws for invalid source name', async () => {
            const svc = new HistoryService(makeCtx());
            await expect(svc.import('not-a-source')).rejects.toThrow('Invalid history source');
        });

        test('throws for invalid mode', async () => {
            const svc = new HistoryService(makeCtx());
            await expect(svc.import('claude', { mode: 'bad-mode' })).rejects.toThrow('Invalid history import mode');
        });

        test('runs incremental import for a known source with no files', async () => {
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('claude', { mode: 'incremental', root: emptyRoot() });
            expect(result.source).toBe('claude');
            expect(result.mode).toBe('incremental');
            expect(result.scannedFiles).toBe(0);
        });

        test('defaults mode to incremental when no file is provided', async () => {
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('pi', { root: emptyRoot() });
            expect(result.mode).toBe('incremental');
        });

        test('accepts explicit full import mode for a known source', async () => {
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('codex', { mode: 'full', root: emptyRoot() });
            expect(result.source).toBe('codex');
            expect(result.mode).toBe('full');
        });

        test('uses force-file mode when a file path is provided, rejecting a missing file', async () => {
            const svc = new HistoryService(makeCtx());
            await expect(svc.import('claude', { file: '/tmp/spur-nonexistent.jsonl' })).rejects.toThrow();
        });

        test('passes dryRun true through to the importer without error', async () => {
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('claude', { mode: 'incremental', root: emptyRoot(), dryRun: true });
            expect(result.source).toBe('claude');
            expect(result.mode).toBe('incremental');
            expect(result.scannedFiles).toBe(0);
        });

        test('routes opencode source to the SQLite importer (dry-run)', async () => {
            const svc = new HistoryService({
                ...makeCtx(),
                openCodeSourceDatabase: join(emptyRoot(), 'opencode.db'),
            });
            const result = await svc.import('opencode', { mode: 'full', dryRun: true });
            expect(result.source).toBe('opencode');
            expect(result.mode).toBe('full');
        });

        test('treats empty string file as absent, defaulting to force-file mode without a files list', async () => {
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('claude', { file: '', root: emptyRoot() });
            expect(result.mode).toBe('force-file');
            expect(result.scannedFiles).toBe(0);
        });

        test('treats empty string root as absent, scanning the provided file instead', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-hist-file-'));
            const file = join(dir, 'empty.jsonl');
            writeFileSync(file, '');
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('claude', { root: '', file });
            expect(result.mode).toBe('force-file');
            expect(result.scannedFiles).toBe(1);
            expect(result.processedLines).toBe(0);
        });

        // R5 (task 0559): provenance is launch provenance, derived from the run→session
        // mapping — a cwd under a /spur path is not evidence of a spur launch.
        describe('provenance correction (R5)', () => {
            function writeClaudeSession(cwd: string, sessionId: string): string {
                const dir = mkdtempSync(join(tmpdir(), 'spur-hist-prov-'));
                const file = join(dir, 'session.jsonl');
                writeFileSync(
                    file,
                    `${JSON.stringify({
                        sessionId,
                        type: 'user',
                        timestamp: '2026-05-30T00:00:00.000Z',
                        content: 'hello',
                        cwd,
                    })}\n`,
                );
                return file;
            }

            async function provenanceOf(db: DbAdapter): Promise<string[]> {
                const rows = await db.queryAll<{ provenance: string }>(
                    'SELECT provenance FROM history_message ORDER BY record_hash',
                );
                return rows.map((r) => r.provenance);
            }

            test('a session merely run inside a /spur directory imports as ambient when unmapped', async () => {
                const ctx = makeCtx();
                const db = await ctx.getDb();
                const svc = new HistoryService(ctx);
                await svc.import('claude', {
                    file: writeClaudeSession('/home/user/projects/spur-work', 'sess-ambient'),
                });

                expect(await provenanceOf(db)).toEqual(['ambient']);
            });

            test('a session present in history_run_session imports as spur-run (mapped)', async () => {
                const ctx = makeCtx();
                const db = await ctx.getDb();
                await new RunSessionDao(db).insert({
                    runId: 'run-prov',
                    source: 'claude',
                    sessionId: 'sess-mapped',
                    exactness: 'exact',
                    mechanism: 'observed',
                    resolvedAt: '2026-05-30T01:00:00.000Z',
                });
                const svc = new HistoryService(ctx);
                await svc.import('claude', {
                    file: writeClaudeSession('/home/user/projects/spur-work', 'sess-mapped'),
                });

                expect(await provenanceOf(db)).toEqual(['spur-run']);
            });

            test('a mapped ambient-cwd session is promoted to spur-run even when the cwd is not under /spur', async () => {
                const ctx = makeCtx();
                const db = await ctx.getDb();
                await new RunSessionDao(db).insert({
                    runId: 'run-prov2',
                    source: 'claude',
                    sessionId: 'sess-mapped2',
                    exactness: 'estimated',
                    mechanism: 'inferred',
                    resolvedAt: '2026-05-30T01:00:00.000Z',
                });
                const svc = new HistoryService(ctx);
                await svc.import('claude', {
                    file: writeClaudeSession('/home/user/projects/elsewhere', 'sess-mapped2'),
                });

                expect(await provenanceOf(db)).toEqual(['spur-run']);
            });

            test('dry-run never corrects provenance (no rows written)', async () => {
                const ctx = makeCtx();
                const db = await ctx.getDb();
                const svc = new HistoryService(ctx);
                await svc.import('claude', {
                    file: writeClaudeSession('/home/user/projects/spur-work', 'sess-dry'),
                    dryRun: true,
                });

                expect(await provenanceOf(db)).toEqual([]);
            });
        });

        describe('run-session discovery augmentation (0624 R5)', () => {
            test('a role-named run dir resolves its source mapping and persists the exact imported session', async () => {
                const home = emptyRoot();
                const cwd = emptyRoot();
                const runId = 'run-r5';
                const stem = '2026-08-20T10-00-00-000Z_0123456789abcdef';
                const sessionDir = join(cwd, '.spur', 'run', runId, 'agent-sessions', 'coder');
                mkdirSync(sessionDir, { recursive: true });
                writeFileSync(
                    join(sessionDir, `${stem}.jsonl`),
                    `${JSON.stringify({
                        type: 'session',
                        version: 3,
                        id: 'evt-1',
                        timestamp: '2026-08-20T10:00:00.000Z',
                        cwd,
                    })}\n`,
                );
                const ctx = { ...makeCtx(), historyHome: home, cwd };
                const db = await ctx.getDb();
                await new RunSessionDao(db).insert({
                    runId,
                    source: 'omp',
                    sessionId: null,
                    exactness: 'unresolved',
                    mechanism: 'observed',
                    resolvedAt: '2026-08-20T10:01:00.000Z',
                });
                const svc = new HistoryService(ctx);

                const result = await svc.import('omp');

                expect(result.scannedFiles).toBe(1);
                const rows = await db.queryAll<{ session_id: string; provenance: string }>(
                    'SELECT session_id, provenance FROM history_message',
                );
                expect(rows.length).toBeGreaterThanOrEqual(1);
                expect(rows.every((r) => r.session_id === stem && r.provenance === 'spur-run')).toBe(true);
                const mappings = await new RunSessionDao(db).getByRunId(runId);
                expect(mappings.some((m) => m.session_id === stem && m.exactness === 'exact')).toBe(true);
            });

            test('an explicit root bypasses run-dir augmentation (caller-directed scan)', async () => {
                const home = emptyRoot();
                const cwd = emptyRoot();
                const runId = 'run-r5b';
                const sessionDir = join(cwd, '.spur', 'run', runId, 'agent-sessions', 'omp');
                mkdirSync(sessionDir, { recursive: true });
                writeFileSync(
                    join(sessionDir, 's.jsonl'),
                    `${JSON.stringify({ type: 'session', version: 3, id: 'evt-2', timestamp: '2026-08-20T11:00:00.000Z', cwd })}\n`,
                );
                const ctx = { ...makeCtx(), historyHome: home, cwd };
                const svc = new HistoryService(ctx);

                const result = await svc.import('omp', { root: emptyRoot() });

                expect(result.scannedFiles).toBe(0);
                const rows = await (await ctx.getDb()).queryAll('SELECT 1 FROM history_message');
                expect(rows.length).toBe(0);
            });
        });
    });

    describe('importAll degraded classification (0504 R2)', () => {
        test('a source with parse/validation errors is degraded — never clean ok — and forces a non-zero exit', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-hist-degraded-'));
            const file = join(dir, 'history.jsonl');
            writeFileSync(
                file,
                `${[
                    JSON.stringify({ id: 'ok-1', timestamp: '2026-05-30T00:00:00.000Z', content: 'hello' }),
                    '{',
                    JSON.stringify({ id: 'bad-1', timestamp: '2026-05-30T00:00:00.000Z' }),
                ].join('\n')}\n`,
            );
            const svc = new HistoryService(makeCtx());
            try {
                const result = await svc.importAll({ sources: ['antigravity'], file, mode: 'full' });
                const entry = result.entries.find((e) => e.source === 'antigravity');
                expect(entry?.status).toBe('degraded');
                expect(entry?.parseErrors).toBe(1);
                expect(entry?.validationErrors).toBe(1);
                expect(result.exitCode).toBe(2);
                expect(result.warnings.some((w) => w.code === 'source-degraded')).toBe(true);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        test('a fully clean source stays ok with exit code 0', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-hist-ok-'));
            const file = join(dir, 'history.jsonl');
            writeFileSync(
                file,
                `${JSON.stringify({ id: 'ok-1', timestamp: '2026-05-30T00:00:00.000Z', content: 'hello' })}\n`,
            );
            const svc = new HistoryService(makeCtx());
            try {
                const result = await svc.importAll({ sources: ['antigravity'], file, mode: 'full' });
                const entry = result.entries.find((e) => e.source === 'antigravity');
                expect(entry?.status).toBe('ok');
                expect(result.exitCode).toBe(0);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('importAll deferred classification (0624 R4)', () => {
        test('a deferred-set source scanning 0 files is deferred, not empty, and emits no source-empty warning', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-hist-deferred-'));
            const svc = new HistoryService(makeCtx());
            try {
                // emptyRoot scans 0 files: antigravity is in DEFERRED_SOURCES → deferred
                const result = await svc.importAll({ sources: ['antigravity'], root: dir, mode: 'incremental' });
                const entry = result.entries.find((e) => e.source === 'antigravity');
                expect(entry?.status).toBe('deferred');
                expect(result.warnings.some((w) => w.code === 'source-empty' && w.source === 'antigravity')).toBe(
                    false,
                );
                // deferred is not a failure: exit code stays 0
                expect(result.exitCode).toBe(0);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        test('a non-deferred source scanning 0 files stays empty; analyze warns source-empty while deferred does not', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-hist-empty-'));
            const svc = new HistoryService(makeCtx());
            try {
                const result = await svc.importAll({ sources: ['pi'], root: dir, mode: 'incremental' });
                const entry = result.entries.find((e) => e.source === 'pi');
                expect(entry?.status).toBe('empty');

                // buildWarnings runs in analyze: importCoverage entries drive source-empty.
                const deferredDir = mkdtempSync(join(tmpdir(), 'spur-hist-empty2-'));
                try {
                    const deferredResult = await svc.importAll({
                        sources: ['antigravity'],
                        root: deferredDir,
                        mode: 'incremental',
                    });
                    const analyzed = await svc.analyze(ALL, {
                        importCoverage: [...result.entries, ...deferredResult.entries],
                    });
                    expect(analyzed.warnings.some((w) => w.code === 'source-empty' && w.source === 'pi')).toBe(true);
                    expect(analyzed.warnings.some((w) => w.code === 'source-empty' && w.source === 'antigravity')).toBe(
                        false,
                    );
                } finally {
                    rmSync(deferredDir, { recursive: true, force: true });
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        test('a deferred-set source that imports records keeps its import-derived status (label, not gate)', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-hist-deferred-ok-'));
            const file = join(dir, 'history.jsonl');
            writeFileSync(
                file,
                `${JSON.stringify({ id: 'ok-1', timestamp: '2026-05-30T00:00:00.000Z', content: 'hello' })}\n`,
            );
            const svc = new HistoryService(makeCtx());
            try {
                // gemini is in DEFERRED_SOURCES but scans a file with valid records → ok
                const result = await svc.importAll({ sources: ['gemini'], file, mode: 'full' });
                const entry = result.entries.find((e) => e.source === 'gemini');
                expect(entry?.status).toBe('ok');
                expect(result.exitCode).toBe(0);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('importAll reconciliation pass-through (0505 R1)', () => {
        test('full-mode entries carry the importer reconciliation summary; stale rows surface after source shrink', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-hist-recon-'));
            const file = join(dir, 'history.jsonl');
            const record = (id: string) => JSON.stringify({ id, timestamp: '2026-05-30T00:00:00.000Z', content: id });
            writeFileSync(file, `${record('keep')}\n${record('stale')}\n`);
            const svc = new HistoryService(makeCtx());
            try {
                const first = await svc.importAll({ sources: ['antigravity'], file, mode: 'full' });
                const firstEntry = first.entries.find((e) => e.source === 'antigravity');
                expect(firstEntry?.reconciliation).toEqual({
                    staleTargetRows: 0,
                    staleLedgerRows: 0,
                    staleCheckpointRows: 0,
                });

                // The `stale` record is no longer produced by the source.
                writeFileSync(file, `${record('keep')}\n`);
                const second = await svc.importAll({ sources: ['antigravity'], file, mode: 'full' });
                const secondEntry = second.entries.find((e) => e.source === 'antigravity');
                expect(secondEntry?.reconciliation).toEqual({
                    staleTargetRows: 1,
                    staleLedgerRows: 1,
                    staleCheckpointRows: 0,
                });

                // Incremental runs never carry the field.
                const incremental = await svc.importAll({ sources: ['antigravity'], file, mode: 'incremental' });
                expect(incremental.entries.find((e) => e.source === 'antigravity')?.reconciliation).toBeUndefined();
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    // Task 0550 R3/R4: honest coverage — a refresh reports which sources it refreshed,
    // which it skipped as unsupported, and the window covered. Never bare success.
    describe('daily coverage (0550 R3/R4)', () => {
        test('reports refreshed + skipped sources by name and the covered window', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            // Seed messages so the covered window is non-null. The daily analyze reads
            // whatever is in the DB; the import fan-out over the empty root adds nothing.
            await insertMessage(db, {
                record_hash: 'd1',
                session_id: 'sess-d',
                seq: 1,
                ts: '2026-06-01T00:00:00Z',
                model: 'claude-opus-5',
                role: 'user',
                input: 100,
                output: 0,
            });
            await insertMessage(db, {
                record_hash: 'd2',
                session_id: 'sess-d',
                seq: 2,
                ts: '2026-06-01T00:01:00Z',
                model: 'claude-opus-5',
                input: 200,
                output: 100,
            });
            const cwd = mkdtempSync(join(tmpdir(), 'spur-daily-cov-'));
            const svc = new HistoryService(ctx);
            try {
                const result = await svc.daily({ cwd, root: emptyRoot(), sourceTimeout: 500 });
                // Refreshed = the six full-fidelity sources that did not fail. Under an empty
                // root every source is `empty` (not failed), so all six qualify.
                expect(result.coverage.refreshed.sort()).toEqual(['agy', 'claude', 'codex', 'grok', 'omp', 'pi']);
                // Skipped = the five unsupported sources (operator ruling 2026-08-06).
                expect(result.coverage.skipped.sort()).toEqual([
                    'antigravity',
                    'gemini',
                    'hermes',
                    'openclaw',
                    'opencode',
                ]);
                // Window = MIN/MAX message ts the analyze covered (recency without the DB).
                expect(result.coverage.window).toEqual({
                    since: '2026-06-01T00:00:00Z',
                    until: '2026-06-01T00:01:00Z',
                });
                // The coverage is carried on the daily result — never bare success.
                expect(result.coverage).toBeDefined();
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        });

        test('a failed full-fidelity source is excluded from refreshed (still named in the fan-out)', async () => {
            const ctx = makeCtx();
            const cwd = mkdtempSync(join(tmpdir(), 'spur-daily-cov-fail-'));
            // Mock the import fan-out so `claude` fails while every other source is ok.
            // daily → buildRefreshCoverage then filters FULL_FIDELITY_SOURCES against the
            // entries, so a failed full-fidelity source drops out of `refreshed`.
            const entry = (source: string, status: 'ok' | 'failed' | 'empty') => ({
                source,
                status,
                files: 0,
                messages: 0,
                toolCalls: 0,
                unknownRecords: 0,
                lastImportedAt: null,
                parseErrors: 0,
                validationErrors: 0,
                parseErrorSamples: [],
                validationErrorSamples: [],
            });
            const spy = spyOn(HistoryService.prototype, 'importAll').mockResolvedValueOnce({
                entries: [
                    entry('claude', 'failed'),
                    entry('codex', 'ok'),
                    entry('pi', 'ok'),
                    entry('omp', 'ok'),
                    entry('agy', 'ok'),
                    entry('grok', 'ok'),
                    entry('gemini', 'empty'),
                ],
                exitCode: 2,
                warnings: [{ code: 'source-failed', source: 'claude', detail: 'forced' }],
                attribution: emptyAttributionSummary(),
            });
            const svc = new HistoryService(ctx);
            try {
                const result = await svc.daily({ cwd, root: emptyRoot(), sourceTimeout: 500 });
                // claude failed → dropped; the other five full-fidelity sources refreshed.
                expect(result.coverage.refreshed.sort()).toEqual(['agy', 'codex', 'grok', 'omp', 'pi']);
                // Skipped is a static ruling — still the five unsupported sources.
                expect(result.coverage.skipped.sort()).toEqual([
                    'antigravity',
                    'gemini',
                    'hermes',
                    'openclaw',
                    'opencode',
                ]);
                // Nothing was analyzed, so the window is empty.
                expect(result.coverage.window).toEqual({ since: null, until: null });
            } finally {
                spy.mockRestore();
                rmSync(cwd, { recursive: true, force: true });
            }
        });
    });
});
