import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ArtifactSelector, createMigratedDb, type DbAdapter, type HistoryArtifact } from '@gobing-ai/spur-domain';
import { HistoryService, type HistoryServiceContext, writeArtifact } from '../../src/services/history-service';

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
    input?: number | null;
    output?: number | null;
    cost?: number | null;
    disposition?: string;
    record_type?: string;
    provenance?: string;
}

async function insertMessage(db: DbAdapter, m: Msg): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
             provenance, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.record_hash,
        'claude',
        'test.jsonl',
        1,
        m.session_id,
        m.seq,
        'assistant',
        m.record_type ?? 'message',
        m.disposition ?? 'conversation',
        m.ts,
        m.model,
        m.input ?? null,
        m.output ?? null,
        m.cost ?? null,
        m.provenance ?? 'agent',
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
    });
    await insertMessage(db, {
        record_hash: 'm3',
        session_id: 'sess-1',
        seq: 3,
        ts: '2026-05-31T10:00:00Z',
        model: null,
        disposition: 'unknown',
        record_type: 'id+ts+content',
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
            // loops: Read/abc repeated 2 — below the >=3 threshold, so none
            expect(artifact.loops).toEqual([]);
            // drift warning
            expect(artifact.warnings.some((w) => w.code === 'unknown-drift')).toBe(true);
            // coverage
            expect(artifact.coverage[0]?.source).toBe('claude');
            expect(artifact.coverage[0]?.messages).toBe(3);
            expect(artifact.coverage[0]?.toolCalls).toBe(3);
            expect(artifact.coverage[0]?.unknownRecords).toBe(1);
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
            const svc = new HistoryService(ctx);
            const artifact = await svc.analyze(ALL);
            expect(artifact.totals.toolCalls).toBe(1);
            expect(artifact.totals.durationUnmeasured).toBe(1);
            expect(artifact.totals.durationMs).toBe(0);
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
    });
});
