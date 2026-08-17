import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { AgentConfig } from '@gobing-ai/spur-config';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    type ArtifactSelector,
    type ArtifactWarning,
    assertArtifactVersion,
    buildWatermarkFilter,
    bySession,
    byTool,
    type CoverageEntry,
    computeDerived,
    countCheckpointsBySource,
    type DriftRow,
    dataWindow,
    derivedWarnings,
    drift,
    type ForensicTotals,
    HISTORY_ARTIFACT_SCHEMA_VERSION,
    type HistoryArtifact,
    type LadderEntry,
    loops,
    type MessageRollupRow,
    materializeWatermarkExclude,
    messageRollup,
    narrowArtifact,
    pairingSummary,
    RunSessionDao,
    renderMarkdown,
    resolveReportMode,
    type SessionState,
    type SourceSummaryRow,
    selectorDigest,
    sessionSpans,
    sessionToolDurations,
    sessionWatermarks,
    sourceSummary,
    type ToolRollupRow,
    todoToolCalls,
    toolRollup,
} from '@gobing-ai/spur-domain';
import {
    type ImportIssue,
    type ImportMode,
    type ImportResult,
    type LlmJsonlSource,
    runJsonlImport,
    runOpenCodeImport,
} from '@gobing-ai/ts-llm-jsonl-importer';
import { getExecutorTier } from './agent-service';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of a history import operation. */
export type HistoryImportResult = ImportResult;

/** Result of a history analyze operation — the versioned JSON artifact (0464 R2). */
export type HistoryAnalyzeResult = HistoryArtifact;

/** Per-source import error samples used to populate `coverage[]` (R6-bounded by the writer). */
export interface CoverageErrorsInput {
    [source: string]: { parseErrors: string[]; validationErrors: string[] };
}

/** Options for {@link HistoryService.analyze}. */
export interface AnalyzeOptions {
    /** Leaderboard depth for `byTool` / `bySession` (default 20). Not part of the selector digest. */
    top?: number;
    /** Spur CLI version stamped into the artifact. */
    spurVersion?: string;
    /** Custom artifact path (`--out`); sidecar derived beside it. */
    out?: string;
    /** Project root used for the default `.spur/reports/history/<date>/` path. */
    cwd?: string;
    /** Optional per-source import error samples merged into `coverage[]`. */
    coverageErrors?: CoverageErrorsInput;
    /**
     * Import-time per-source coverage entries (task 0470). When provided, these are the
     * authoritative base; SQL `sourceSummary` enriches only `'ok'` entries with accurate
     * message/tool/unknown counts and `lastImportedAt`. `'empty'` / `'failed'` entries
     * keep their import-time data untouched.
     */
    importCoverage?: readonly CoverageEntry[];
    /** Advisory warnings merged from the import layer (e.g. failed sources, was-non-empty). */
    extraWarnings?: HistoryArtifact['warnings'];
}

/** Result of {@link HistoryService.importAll} — the fan-out outcome (task 0470). */
export interface FanOutResult {
    /** One {@link CoverageEntry} per attempted source, in `SOURCES` order. */
    entries: CoverageEntry[];
    /** `0` all ok/empty, `1` all failed, `2` mixed. */
    exitCode: 0 | 1 | 2;
    /** Per-source warnings: failed sources carry `source-failed`; was-non-empty carry `source-was-nonempty`. */
    warnings: ArtifactWarning[];
}

/** Options for {@link HistoryService.importAll}. */
export interface ImportAllOptions {
    /** Sources to attempt; defaults to all ten. A single source is the n=1 case of the same contract. */
    sources?: readonly string[];
    /** Import mode (defaults to `incremental` for fan-out, `force-file` when `file` is given). */
    mode?: string;
    /** Import one JSONL file instead of scanning a root (single-source only). */
    file?: string;
    /** History root override (testing). */
    root?: string;
    /** Scan without persisting. */
    dryRun?: boolean;
    /** Per-source timeout in ms (default {@link DEFAULT_SOURCE_TIMEOUT_MS}). */
    sourceTimeout?: number;
}

/** Options for {@link HistoryService.daily}. */
export interface DailyOptions {
    /** Inclusive lower bound on message timestamp for the analyze step only (never the import). */
    since?: string;
    /** Inclusive upper bound on message timestamp for the analyze step only. */
    until?: string;
    /** Per-source import timeout in ms (default {@link DEFAULT_SOURCE_TIMEOUT_MS}). */
    sourceTimeout?: number;
    /** Spur CLI version stamped into the artifact. */
    spurVersion?: string;
    /** Project root. */
    cwd?: string;
    /** Emit the daily result as JSON. */
    json?: boolean;
    /** Sources filter (testing override; default: all). */
    sources?: readonly string[];
    /** History root override (testing). */
    root?: string;
    /**
     * Report mode pass-through (0555 R4): when set, a `.md` sidecar of the artifact rendered
     * in this mode is written next to it. Validated up front so an unknown mode fails before
     * the import fan-out runs. Absent → no sidecar; daily's composition is otherwise untouched.
     */
    mode?: string;
}

/**
 * Honest refresh coverage (task 0550, R3/R4): which sources were refreshed, which were
 * skipped as unsupported, and the data window covered. Carried on the refresh result so a
 * reader never mistakes a refresh for full capture of every source.
 */
export interface RefreshCoverage {
    /** Full-fidelity sources this refresh imported (non-failed fan-out entries). */
    refreshed: string[];
    /** Sources without full-fidelity support, skipped by operator ruling (feature E1 § Out of scope). */
    skipped: string[];
    /** MIN/MAX message `ts` the analyze covered (recency without touching the DB). */
    window: { since: string | null; until: string | null };
}

/** Result of {@link HistoryService.daily}. */
export interface DailyResult {
    /** The fan-out import outcome. */
    fanOut: FanOutResult;
    /** The written analyze artifact. */
    artifact: HistoryArtifact;
    /** Pruned report directory names (`YYYY-MM-DD`), oldest first. */
    pruned: string[];
    /**
     * Honest coverage report (task 0550, R3/R4): refreshed + skipped sources and the
     * covered window. Always present — a refresh reports its coverage, never bare success.
     */
    coverage: RefreshCoverage;
    /** Path of the mode-rendered `.md` sidecar (present only when `mode` was passed, 0555 R4). */
    reportPath?: string;
}

/** Context injected into HistoryService. */
export interface HistoryServiceContext {
    getDb(): Promise<DbAdapter>;
    /** Override OpenCode's SQLite path for hermetic composition/tests. */
    openCodeSourceDatabase?: string;
    /**
     * Validated `agent` config block from the project config (feature J8 R2).
     * When present, analyze embeds its executor ladder as `ladderSnapshot`;
     * absent (no `agent.executors`), the ladder is an empty array.
     */
    agentConfig?: AgentConfig;
}

// ---------------------------------------------------------------------------
// Private constants
// ---------------------------------------------------------------------------

const SOURCES: readonly LlmJsonlSource[] = [
    'pi',
    'claude',
    'codex',
    'gemini',
    'opencode',
    'antigravity',
    'openclaw',
    'omp',
    'grok',
    'agy',
];

/**
 * Sources with full-fidelity import support (feature E1 § In). The coverage report
 * (task 0550 R3) enumerates these as refreshed and the unsupported set as skipped.
 */
const FULL_FIDELITY_SOURCES: readonly string[] = ['claude', 'codex', 'pi', 'omp', 'agy', 'grok'];

/**
 * Sources without full-fidelity support — deferred by operator ruling 2026-08-06
 * (feature E1 § Out of scope). Named in the coverage report so a refresh never reads
 * as if it captured every source.
 */
const UNSUPPORTED_SOURCES: readonly string[] = ['gemini', 'opencode', 'antigravity-ide', 'openclaw', 'hermes'];

/**
 * Build the honest coverage report (task 0550 R3/R4) from the import fan-out and the
 * analyze selector. `refreshed` = full-fidelity sources whose fan-out entry did not
 * fail; `skipped` = the unsupported set; `window` = the MIN/MAX message `ts` the
 * analyze covered (recency without touching the DB).
 */
async function buildRefreshCoverage(
    db: DbAdapter,
    selector: ArtifactSelector,
    fanOut: FanOutResult,
): Promise<RefreshCoverage> {
    const statusBySource = new Map(fanOut.entries.map((e) => [e.source, e.status]));
    const refreshed = FULL_FIDELITY_SOURCES.filter((s) => statusBySource.has(s) && statusBySource.get(s) !== 'failed');
    const { since, until } = await dataWindow(db, selector);
    return { refreshed, skipped: [...UNSUPPORTED_SOURCES], window: { since, until } };
}
const MODES: readonly ImportMode[] = ['full', 'incremental', 'force-file'];
const MAX_ERROR_SAMPLES = 20;
/** Per-source import timeout default (10 minutes, task 0470 R5). */
const DEFAULT_SOURCE_TIMEOUT_MS = 600_000;
/** Report retention window for the daily prune (task 0470 R6). */
const REPORT_RETENTION_DAYS = 90;

// ---------------------------------------------------------------------------
// HistoryService
// ---------------------------------------------------------------------------

/** Application-layer orchestration for `spur history` commands. */
export class HistoryService {
    private readonly ctx: HistoryServiceContext;

    constructor(ctx: HistoryServiceContext) {
        this.ctx = ctx;
    }

    /** Import JSONL history from a source into the database. */
    async import(
        source: string,
        opts: { file?: string; root?: string; mode?: string; dryRun?: boolean } = {},
    ): Promise<HistoryImportResult> {
        const parsedSource = parseSource(source);
        const mode = parseMode(opts.mode ?? (opts.file !== undefined ? 'force-file' : 'incremental'));
        const dryRun = opts.dryRun ?? false;

        const result =
            parsedSource === 'opencode' && opts.file === undefined && opts.root === undefined
                ? await runOpenCodeImport({
                      db: await this.ctx.getDb(),
                      sourceDatabase: this.ctx.openCodeSourceDatabase,
                      mode,
                      dryRun,
                  })
                : await runJsonlImport(parsedSource, {
                      db: await this.ctx.getDb(),
                      mode,
                      ...(opts.file !== undefined && opts.file.length > 0 ? { files: [opts.file] } : {}),
                      ...(opts.root !== undefined && opts.root.length > 0 ? { roots: [opts.root] } : {}),
                      dryRun,
                  });

        // R5 (task 0559): provenance is launch provenance. The mapper cannot know
        // whether a session was spur-launched (the cwd substring heuristic was deleted
        // upstream), so the mapping table — populated by the run path (task 0557) and
        // retro-correlation (task 0558) — is the authority: a (source, session_id)
        // present in `history_run_session` is spur-run, anything else is ambient. The
        // two-way alignment also self-heals rows imported by the old heuristic.
        if (!dryRun) {
            await new RunSessionDao(await this.ctx.getDb()).alignMessageProvenance();
        }
        return result;
    }

    /**
     * Analyze forensic history with SQL aggregation (task 0474). Resolves the six
     * composable selectors, runs the Q1–Q10 query set over `history_message` /
     * `history_tool_call` (never materializing the corpus), assembles the versioned
     * artifact, and writes it (plus the bounded-errors sidecar) to disk. Returns the
     * artifact.
     */
    async analyze(selector: ArtifactSelector, opts: AnalyzeOptions = {}): Promise<HistoryAnalyzeResult> {
        const top = opts.top ?? 20;
        const db = await this.ctx.getDb();

        // Task 0550 watermark (R1/R2): compute each session's last-complete-turn boundary,
        // then exclude the trailing partial turn of in-progress sessions from every query.
        // Complete sessions contribute no filter — their data is untouched.
        const watermarks = await sessionWatermarks(db, selector);
        const wm = buildWatermarkFilter(watermarks);
        const queryOpts = wm.sql === '' ? undefined : { watermark: wm };
        // Materialize the in-progress exclusion set into a temp table before the batch and
        // drop it after: buildWatermarkFilter emits a NOT EXISTS anti-join against it. A
        // per-session OR chain would grow SQLite expression depth ~1 per in-progress
        // session and blow SQLITE_MAX_EXPRESSION_DEPTH (1000) — pi has 176k in-progress
        // sessions (task 0550), which crashed every message query. A crashed mid-batch
        // run self-heals: the next materialize resets via CREATE IF NOT EXISTS + DELETE.
        const dropWatermarkExclude = await materializeWatermarkExclude(db, watermarks);

        const [
            mRows,
            tRows,
            toolRows,
            sessionRows,
            loopRows,
            driftRows,
            sourceRows,
            spanRows,
            toolDurRows,
            todoRows,
            pairings,
        ] = await Promise.all([
            messageRollup(db, selector, queryOpts),
            toolRollup(db, selector, queryOpts),
            byTool(db, selector, top, queryOpts),
            bySession(db, selector, top, queryOpts),
            loops(db, selector, queryOpts),
            drift(db, selector, queryOpts),
            // sourceSummary is import coverage — not watermarked, stays import-faithful.
            sourceSummary(db, selector),
            sessionSpans(db, selector, queryOpts),
            sessionToolDurations(db, selector, queryOpts),
            todoToolCalls(db, selector, undefined, queryOpts),
            // feature J8 R1: per-(executor, role) pairing stats over the same
            // selector window (system_events plane, not the message plane).
            pairingSummary(db, { since: selector.since ?? undefined, until: selector.until ?? undefined }),
        ]);
        await dropWatermarkExclude();

        const totals = foldTotals(mRows, tRows);
        const bySource = foldGrouped(
            mRows,
            tRows,
            (m) => m.source,
            (t) => t.source,
        );
        const byModel = foldGrouped(
            mRows,
            tRows,
            (m) => m.model ?? 'unknown',
            (t) => t.model ?? 'unknown',
        );
        const byDay = foldGrouped(
            mRows,
            tRows,
            (m) => m.day ?? '',
            (t) => t.day ?? '',
        );

        const daily = Object.entries(byDay)
            .map(([date, totals]) => ({ date, ...totals }))
            .sort((a, b) => a.date.localeCompare(b.date));

        const coverage = buildCoverage(sourceRows, tRows, driftRows, opts.coverageErrors, opts.importCoverage);
        const derived = computeDerived(spanRows, toolDurRows, todoRows);

        // R2: mark each session's completeness state so consumers can exclude in-progress
        // sessions (task 0547). Analyze always writes it; the field stays additive.
        const stateByKey = new Map<string, SessionState>();
        for (const w of watermarks) stateByKey.set(`${w.sessionId}\0${w.source}`, w.state);

        // feature J8 R2: snapshot the executor ladder from project config (executor
        // name, resolved tier, array index as order). The report renderers are pure
        // (no I/O), so the ladder is embedded at analyze time — never read at render.
        const ladderSnapshot = buildLadderSnapshot(this.ctx.agentConfig);

        const artifact: HistoryArtifact = {
            schemaVersion: HISTORY_ARTIFACT_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            spurVersion: opts.spurVersion ?? '',
            selector: { ...selector, sources: selector.sources ? [...selector.sources] : null },
            coverage,
            totals,
            bySource,
            byModel,
            daily,
            byTool: toolRows.map((r) => ({
                toolName: r.toolName,
                calls: r.calls,
                errors: r.errors,
                durationMsTotal: r.durationMsTotal ?? 0,
                durationMsMean: r.durationMsMean ?? 0,
                durationMsMax: r.durationMsMax ?? 0,
                durationUnmeasured: r.durationUnmeasured,
                resultBytes: r.resultBytes ?? 0,
            })),
            bySession: sessionRows.map((r) => ({
                sessionId: r.sessionId,
                source: r.source,
                startedAt: r.startedAt,
                messages: r.messages,
                toolCalls: r.toolCalls,
                tokens: r.tokens ?? 0,
                costUsd: r.costUsd ?? 0,
                topTool: r.topTool,
                assistantDurationMs: r.assistantDurationMs ?? 0,
                assistantDurationUnmeasured: r.assistantDurationUnmeasured,
                sessionState: stateByKey.get(`${r.sessionId}\0${r.source}`) ?? 'complete',
            })),
            loops: loopRows,
            warnings: [
                ...buildWarnings(driftRows, coverage),
                ...derivedWarnings(derived),
                ...(opts.extraWarnings ?? []),
            ],
            pairings,
            ladderSnapshot,
            derived,
        };

        if (opts.out !== undefined || opts.cwd !== undefined) {
            writeArtifact(artifact, { out: opts.out, cwd: opts.cwd ?? process.cwd() });
        }

        return artifact;
    }

    /**
     * Fan out import across sources with per-source isolation (task 0470 R1/R2/R5). Each source
     * runs in its own `try`, bounded by its own timeout; a throw or timeout records that source
     * `failed` and the loop continues. Each source commits its own transaction inside
     * {@link import} / `runJsonlImport`, so a sibling is never rolled back. Single-source import
     * is the n=1 case of this same contract — callers pass `sources: [source]`.
     */
    async importAll(opts: ImportAllOptions = {}): Promise<FanOutResult> {
        const sources = (opts.sources ?? SOURCES).map((s) => parseSource(s));
        const timeoutMs = opts.sourceTimeout ?? DEFAULT_SOURCE_TIMEOUT_MS;

        const entries: CoverageEntry[] = [];
        const warnings: ArtifactWarning[] = [];

        for (const source of sources) {
            // eslint-disable-next-line no-await-in-loop -- fan-out is deliberately sequential (R7, task 0470 Design)
            const { coverageEntry, sourceWarnings } = await this.importOneIsolated(source, opts, timeoutMs);
            entries.push(coverageEntry);
            warnings.push(...sourceWarnings);
        }

        return { entries, exitCode: computeExitCode(entries), warnings };
    }

    /**
     * Run-once daily pipeline (task 0470 R6): import-all → analyze → write artifact → prune old
     * reports beyond {@link REPORT_RETENTION_DAYS}. Exits when done; never stays resident. The
     * import step takes no date window — it relies on checkpoint resume (R7), so a missed night
     * self-heals on the next run with no gap and no double-count. Only the analyze step scopes
     * the report via `since`/`until`. `opts.mode` (0555 R4) is a pure pass-through: it only
     * adds a `.md` sidecar next to the artifact and never alters this pipeline's steps.
     */
    async daily(opts: DailyOptions = {}): Promise<DailyResult> {
        const cwd = opts.cwd ?? process.cwd();
        // Fail fast on an unknown mode — before a potentially long import fan-out.
        const renderer = opts.mode !== undefined ? resolveReportMode(opts.mode) : null;
        const db = await this.ctx.getDb();
        const fanOut = await this.importAll({
            sources: opts.sources,
            sourceTimeout: opts.sourceTimeout,
            root: opts.root,
        });

        const selector: ArtifactSelector = {
            since: opts.since ?? null,
            until: opts.until ?? null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };

        const artifact = await this.analyze(selector, {
            spurVersion: opts.spurVersion,
            cwd,
            importCoverage: fanOut.entries,
            extraWarnings: fanOut.warnings,
        });

        let reportPath: string | undefined;
        if (renderer !== null) {
            reportPath = resolveArtifactPaths(artifact, { cwd }).artifactPath.replace(/\.json$/, '.md');
            writeFileSync(reportPath, renderMarkdown(artifact, opts.mode));
        }

        const pruned = pruneReports(cwd, REPORT_RETENTION_DAYS);

        const coverage = await buildRefreshCoverage(db, selector, fanOut);

        return { fanOut, artifact, pruned, coverage, ...(reportPath !== undefined ? { reportPath } : {}) };
    }

    /**
     * Isolated per-source import wrapper (task 0470 R2/R4/R5). Checks whether the source was
     * non-empty on a previous run (checkpoint rows exist), runs {@link import} bounded by a
     * timeout, builds the {@link CoverageEntry} from the result, and catches throw/timeout into
     * a `failed` entry plus a `source-failed` warning.
     */
    private async importOneIsolated(
        source: LlmJsonlSource,
        opts: ImportAllOptions,
        timeoutMs: number,
    ): Promise<{ coverageEntry: CoverageEntry; sourceWarnings: ArtifactWarning[] }> {
        const db = await this.ctx.getDb();
        const sourceWarnings: ArtifactWarning[] = [];

        // R4 - was-non-empty detection via checkpoint rows (no artifact chaining).
        const checkpointCount = await countCheckpointsBySource(db, source);
        const wasNonEmpty = checkpointCount > 0;

        try {
            const importPromise = this.import(source, {
                file: opts.file,
                root: opts.root,
                mode: opts.mode ?? (opts.file !== undefined && opts.file.length > 0 ? 'force-file' : 'incremental'),
                dryRun: opts.dryRun,
            });
            const abort = new AbortController();
            const timer = setTimeout(
                () => abort.abort(new Error(`source '${source}' exceeded ${timeoutMs}ms timeout`)),
                timeoutMs,
            );
            const timeoutPromise = new Promise<never>((_, reject) => {
                abort.signal.addEventListener('abort', () => reject(abort.signal.reason as Error));
            });

            let result: HistoryImportResult;
            try {
                result = await Promise.race([importPromise, timeoutPromise]);
            } finally {
                clearTimeout(timer);
            }

            // R2 (task 0504): a source that imported records while skipping malformed or
            // schema-invalid ones is `degraded`, never clean `ok` — automated consumers must
            // not treat a partial import as healthy. `degraded` implies scannedFiles > 0.
            const hasDegradedInput = result.parseErrors.length > 0 || result.validationErrors.length > 0;
            const status = result.scannedFiles === 0 ? 'empty' : hasDegradedInput ? 'degraded' : 'ok';
            if (hasDegradedInput) {
                sourceWarnings.push({
                    code: 'source-degraded',
                    source,
                    detail:
                        `source '${source}' imported ${result.importedRecords} records but skipped ` +
                        `${result.parseErrors.length} parse and ${result.validationErrors.length} ` +
                        'validation error(s); samples are bounded in the artifact and streamed to the sidecar',
                });
            }
            if (status === 'empty' && wasNonEmpty) {
                sourceWarnings.push({
                    code: 'source-was-nonempty',
                    source,
                    detail: `source '${source}' previously had checkpoint rows but discovered 0 files`,
                });
            }

            const coverageEntry: CoverageEntry = {
                source,
                status,
                files: result.scannedFiles,
                messages: result.importedRecords,
                toolCalls: 0, // enriched by SQL in daily→analyze merge; standalone importAll has no tool data
                unknownRecords: result.unknownRecords,
                lastImportedAt: null,
                parseErrors: result.parseErrors.length,
                validationErrors: result.validationErrors.length,
                parseErrorSamples: result.parseErrors.slice(0, MAX_ERROR_SAMPLES).map(formatIssue),
                validationErrorSamples: result.validationErrors.slice(0, MAX_ERROR_SAMPLES).map(formatIssue),
                // 0505 R1: preserve the importer's full-mode reconciliation summary so
                // `history import --json` can report stale-row preview/applied counts.
                ...(result.reconciliation ? { reconciliation: result.reconciliation } : {}),
            };

            return { coverageEntry, sourceWarnings };
        } catch (e) {
            const detail = (e as Error).message;
            sourceWarnings.push({ code: 'source-failed', source, detail });
            return {
                coverageEntry: {
                    source,
                    status: 'failed',
                    files: 0,
                    messages: 0,
                    toolCalls: 0,
                    unknownRecords: 0,
                    lastImportedAt: null,
                    parseErrors: 0,
                    validationErrors: 0,
                    parseErrorSamples: [],
                    validationErrorSamples: [],
                },
                sourceWarnings,
            };
        }
    }
}

// ---------------------------------------------------------------------------
// Artifact assembly (fold bounded rollup rows — R2, R5)
// ---------------------------------------------------------------------------

/** A zeroed {@link ForensicTotals} accumulator. */
function emptyTotals(): ForensicTotals {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        records: 0,
        recordsWithUsage: 0,
        messages: 0,
        toolCalls: 0,
        durationMs: 0,
        durationUnmeasured: 0,
        assistantDurationMs: 0,
        assistantDurationUnmeasured: 0,
    };
}

/** Fold one message-rollup row into a bucket. */
function foldMessage(bucket: ForensicTotals, row: MessageRollupRow): void {
    bucket.messages += row.messages;
    bucket.records += row.messages;
    bucket.inputTokens += row.inputTokens ?? 0;
    bucket.outputTokens += row.outputTokens ?? 0;
    bucket.cacheReadTokens += row.cacheReadTokens ?? 0;
    bucket.cacheWriteTokens += row.cacheWriteTokens ?? 0;
    bucket.costUsd += row.costUsd ?? 0;
    bucket.recordsWithUsage += row.recordsWithUsage;
    bucket.assistantDurationMs += row.assistantDurationMs ?? 0;
    bucket.assistantDurationUnmeasured += row.assistantDurationUnmeasured;
}

/** Fold one tool-rollup row into a bucket. */
function foldTool(bucket: ForensicTotals, row: ToolRollupRow): void {
    bucket.toolCalls += row.toolCalls;
    bucket.durationMs += row.durationMs ?? 0;
    bucket.durationUnmeasured += row.durationUnmeasured;
}

/**
 * Fold the bounded rollup rows into buckets. The rows are bounded by
 * (sources × models × days), never corpus-sized, so this fold is R2-compliant —
 * no array whose length grows with the row count is materialized.
 */
function foldTotals(mRows: readonly MessageRollupRow[], tRows: readonly ToolRollupRow[]): ForensicTotals {
    const totals = emptyTotals();
    for (const row of mRows) foldMessage(totals, row);
    for (const row of tRows) foldTool(totals, row);
    return totals;
}

/** Fold rollup rows into per-key buckets (source, model, or day). */
function foldGrouped(
    mRows: readonly MessageRollupRow[],
    tRows: readonly ToolRollupRow[],
    mKey: (m: MessageRollupRow) => string,
    tKey: (t: ToolRollupRow) => string,
): Record<string, ForensicTotals> {
    const map: Record<string, ForensicTotals> = {};
    for (const row of mRows) {
        const key = mKey(row);
        const bucket = map[key] ?? emptyTotals();
        map[key] = bucket;
        foldMessage(bucket, row);
    }
    for (const row of tRows) {
        const key = tKey(row);
        const bucket = map[key] ?? emptyTotals();
        map[key] = bucket;
        foldTool(bucket, row);
    }
    return map;
}

// ---------------------------------------------------------------------------
// Coverage + warnings
// ---------------------------------------------------------------------------

/**
 * Build per-source coverage entries. Two modes (task 0470):
 *
 * 1. **SQL-only** (default): map {@link SourceSummaryRow} → {@link CoverageEntry}. Only sources
 *    with `history_message` rows appear — absent / failed sources are missing. Used by
 *    standalone `analyze` without an import step.
 * 2. **Merged** (`importCoverage` provided): the import entries are the authoritative base and
 *    carry the import-time `status` (`ok` / `empty` / `failed`). SQL counts (messages, toolCalls,
 *    unknownRecords, lastImportedAt) enrich only `'ok'` entries. `'empty'` / `'failed'` entries
 *    keep their import-time data (zeros). Used by `daily` after `importAll`.
 */
function buildCoverage(
    sourceRows: readonly SourceSummaryRow[],
    tRows: readonly ToolRollupRow[],
    driftRows: readonly DriftRow[],
    coverageErrors: CoverageErrorsInput | undefined,
    importCoverage?: readonly CoverageEntry[],
): CoverageEntry[] {
    if (importCoverage !== undefined) {
        const toolCounts: Record<string, number> = {};
        for (const row of tRows) toolCounts[row.source] = (toolCounts[row.source] ?? 0) + row.toolCalls;
        const unknownCounts: Record<string, number> = {};
        for (const row of driftRows) unknownCounts[row.source] = (unknownCounts[row.source] ?? 0) + row.n;
        const sqlBySource = new Map<string, SourceSummaryRow>();
        for (const row of sourceRows) sqlBySource.set(row.source, row);

        return importCoverage.map((imp) => {
            if (imp.status === 'ok' || imp.status === 'degraded') {
                const sql = sqlBySource.get(imp.source);
                return {
                    source: imp.source,
                    status: imp.status,
                    files: sql?.files ?? imp.files,
                    messages: sql?.messages ?? imp.messages,
                    toolCalls: toolCounts[imp.source] ?? 0,
                    unknownRecords: unknownCounts[imp.source] ?? 0,
                    lastImportedAt: sql?.lastImportedAt ?? null,
                    parseErrors: imp.parseErrors,
                    validationErrors: imp.validationErrors,
                    parseErrorSamples: imp.parseErrorSamples,
                    validationErrorSamples: imp.validationErrorSamples,
                    ...(imp.reconciliation ? { reconciliation: imp.reconciliation } : {}),
                };
            }
            return imp;
        });
    }

    const toolCounts: Record<string, number> = {};
    for (const row of tRows) toolCounts[row.source] = (toolCounts[row.source] ?? 0) + row.toolCalls;
    const unknownCounts: Record<string, number> = {};
    for (const row of driftRows) unknownCounts[row.source] = (unknownCounts[row.source] ?? 0) + row.n;

    return sourceRows.map((s) => {
        const err = coverageErrors?.[s.source] ?? { parseErrors: [], validationErrors: [] };
        // R2 (task 0504): SQL-only coverage is degraded when the import step reported
        // parse/validation errors for the source — never a clean `ok` with skipped records.
        const hasErrors = err.parseErrors.length > 0 || err.validationErrors.length > 0;
        return {
            source: s.source,
            status: s.messages > 0 ? (hasErrors ? 'degraded' : 'ok') : 'empty',
            files: s.files,
            messages: s.messages,
            toolCalls: toolCounts[s.source] ?? 0,
            unknownRecords: unknownCounts[s.source] ?? 0,
            lastImportedAt: s.lastImportedAt,
            parseErrors: err.parseErrors.length,
            validationErrors: err.validationErrors.length,
            parseErrorSamples: err.parseErrors,
            validationErrorSamples: err.validationErrors,
        };
    });
}

/** Advisory warnings from the drift alarm (Q10) and empty sources. */
function buildWarnings(
    driftRows: readonly DriftRow[],
    coverage: readonly CoverageEntry[],
): HistoryArtifact['warnings'] {
    const warnings: HistoryArtifact['warnings'] = [];
    const driftBySource = new Map<string, number>();
    for (const row of driftRows) driftBySource.set(row.source, (driftBySource.get(row.source) ?? 0) + row.n);
    for (const [source, n] of driftBySource) {
        warnings.push({ code: 'unknown-drift', source, detail: `${n} records with unknown disposition` });
    }
    for (const entry of coverage) {
        if (entry.status === 'empty') {
            warnings.push({ code: 'source-empty', source: entry.source, detail: '0 messages discovered' });
        }
        if (entry.status === 'degraded') {
            warnings.push({
                code: 'source-degraded',
                source: entry.source,
                detail:
                    `${entry.parseErrors} parse and ${entry.validationErrors} validation error(s) — ` +
                    'source imported with skipped records (task 0504 R2)',
            });
        }
    }
    return warnings;
}

/**
 * Snapshot the executor capability ladder from the project's agent config
 * (feature J8 R2). Each configured executor yields `{ name, tier, order }` with
 * the resolved capability tier (declared or inferred — the same resolution the
 * dispatch path uses) and the executor's array index as `order`. No `executors`
 * block → an empty ladder (the pairings renderer degrades to absence, never a
 * fabricated row).
 */
function buildLadderSnapshot(agentConfig: AgentConfig | undefined): LadderEntry[] {
    const executors = agentConfig?.executors;
    if (executors === undefined || executors.length === 0) return [];
    return executors.map((executor, order) => ({
        name: executor.name,
        tier: getExecutorTier(executor),
        order,
    }));
}

// ---------------------------------------------------------------------------
// Artifact writer (R4, R6)
// ---------------------------------------------------------------------------

/** Result of {@link writeArtifact}. */
export interface WriteArtifactResult {
    artifactPath: string;
    sidecarPath: string;
}

/**
 * Write the versioned artifact JSON, stream unbounded error detail to the `.errors.jsonl`
 * sidecar (R6: at most {@link MAX_ERROR_SAMPLES} samples per source stay in the artifact),
 * and refresh the `latest.json` pointer. `--out` overrides the default
 * `.spur/reports/history/<YYYY-MM-DD>/analyze-<digest>.json` path.
 */
export function writeArtifact(artifact: HistoryArtifact, opts: { out?: string; cwd: string }): WriteArtifactResult {
    const { artifactPath, sidecarPath } = resolveArtifactPaths(artifact, opts);
    const { bounded, overflow } = boundCoverage(artifact.coverage);

    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, JSON.stringify({ ...artifact, coverage: bounded }, null, 2));

    if (overflow.length > 0) {
        mkdirSync(dirname(sidecarPath), { recursive: true });
        writeFileSync(sidecarPath, `${overflow.map((line) => JSON.stringify(line)).join('\n')}\n`);
    }

    if (opts.out === undefined) {
        updateLatestPointer(opts, artifactPath);
    }

    return { artifactPath, sidecarPath };
}

/** Resolve the artifact and sidecar file paths from the selector digest or `--out`. */
function resolveArtifactPaths(
    artifact: HistoryArtifact,
    opts: { out?: string; cwd: string },
): { artifactPath: string; sidecarPath: string } {
    if (opts.out !== undefined) {
        const out = resolve(opts.out);
        return { artifactPath: out, sidecarPath: `${out.replace(/\.json$/, '')}.errors.jsonl` };
    }
    const base = resolve(opts.cwd, '.spur', 'reports', 'history');
    const dateDir = join(base, artifact.generatedAt.slice(0, 10));
    const name = `analyze-${selectorDigest(artifact.selector)}`;
    return { artifactPath: join(dateDir, `${name}.json`), sidecarPath: join(dateDir, `${name}.errors.jsonl`) };
}

/** Cap per-source error samples at {@link MAX_ERROR_SAMPLES}, returning overflow for the sidecar. */
function boundCoverage(coverage: readonly CoverageEntry[]): { bounded: CoverageEntry[]; overflow: unknown[] } {
    const overflow: unknown[] = [];
    const bounded = coverage.map((entry) => {
        const pe = entry.parseErrorSamples;
        const ve = entry.validationErrorSamples;
        for (const sample of pe.slice(MAX_ERROR_SAMPLES)) {
            overflow.push({ source: entry.source, kind: 'parse', sample });
        }
        for (const sample of ve.slice(MAX_ERROR_SAMPLES)) {
            overflow.push({ source: entry.source, kind: 'validation', sample });
        }
        return {
            ...entry,
            parseErrorSamples: pe.slice(0, MAX_ERROR_SAMPLES),
            validationErrorSamples: ve.slice(0, MAX_ERROR_SAMPLES),
        };
    });
    return { bounded, overflow };
}

/** Point `latest.json` at the newest artifact (a symlink, per 0464 R2). */
function updateLatestPointer(opts: { cwd: string }, artifactPath: string): void {
    const base = resolve(opts.cwd, '.spur', 'reports', 'history');
    const latest = join(base, 'latest.json');
    mkdirSync(base, { recursive: true });
    if (existsSync(latest)) unlinkSync(latest);
    symlinkSync(artifactPath, latest);
}

// ---------------------------------------------------------------------------
// Report rendering seam (task 0469)
// ---------------------------------------------------------------------------

/** Where the artifact came from — drives the staleness banner (R7). */
export type ArtifactResolution = 'explicit' | 'pointer';

/** Resolved artifact location + how it was found. */
export interface ResolvedArtifact {
    path: string;
    resolution: ArtifactResolution;
}

/**
 * Resolve the artifact to render. An explicit path wins (R6); otherwise follow
 * the `.spur/reports/history/latest.json` symlink. Returns the resolution so the
 * caller can decide whether to print the staleness banner — the banner is
 * suppressed when the operator named a file (R7).
 */
export function resolveArtifactPath(explicitPath: string | undefined, cwd: string): ResolvedArtifact {
    if (explicitPath !== undefined && explicitPath.length > 0) {
        return { path: resolve(explicitPath), resolution: 'explicit' };
    }
    const latest = resolve(cwd, '.spur', 'reports', 'history', 'latest.json');
    if (!existsSync(latest)) {
        throw new Error(
            `No artifact path given and no latest pointer at ${latest}. ` +
                'Run `spur history analyze` first, or pass an explicit artifact path.',
        );
    }
    // `latest.json` is a symlink to the artifact JSON (0464 R2). Resolve through it.
    const target = readlinkSync(latest);
    const resolved = isAbsolute(target) ? target : resolve(dirname(latest), target);
    if (!existsSync(resolved)) {
        throw new Error(`Latest pointer ${latest} → ${resolved}, but the target does not exist.`);
    }
    return { path: resolved, resolution: 'pointer' };
}

/** Result of {@link runHistoryReport}. */
export interface RunHistoryReportResult {
    /** Rendered stdout report (spend rollup + forensic sections). */
    report: string;
    /** Absolute path of the artifact that was rendered. */
    artifactPath: string;
    /** How the path was resolved — `pointer` enables the staleness banner (R7). */
    resolution: ArtifactResolution;
    /** Path of the `.md` sidecar written next to the artifact (R8). */
    markdownPath: string;
    /** Parsed artifact (for `--json` consumers). */
    artifact: HistoryArtifact;
    /**
     * One banner line naming the applied narrowing and the artifact (task 0564 R3).
     * Null when no narrowing was requested.
     */
    banner: string | null;
}

/**
 * Read, validate, and render a history artifact into a stdout report + `.md`
 * sidecar. This is the FS seam: it never opens the database (R1). Rendering is
 * delegated through the domain report-mode registry (`resolveReportMode`,
 * 0555 R1) — `default` reproduces the legacy {@link renderReport} output; this
 * function owns file resolution, version assertion (R4), sidecar
 * persistence (R8), and render-time narrowing (0564 R3).
 */
export function runHistoryReport(opts: {
    path?: string;
    cwd: string;
    now?: Date;
    mode?: string;
    /** Render-time task narrowing (mirrors `analyze --task`; 0564 R3). */
    task?: string;
    /** Render-time leaderboard depth (mirrors `analyze --top`; 0564 R3). */
    top?: number;
}): RunHistoryReportResult {
    const { path: artifactPath, resolution } = resolveArtifactPath(opts.path, opts.cwd);

    const raw = readFileSync(artifactPath, 'utf8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`Artifact ${artifactPath} is not valid JSON: ${(e as Error).message}`);
    }

    const artifact = parsed as HistoryArtifact;
    assertArtifactVersion(artifact.schemaVersion ?? -1, artifactPath);

    // R3 (0564): narrowing is client-side over the already-loaded artifact — never a
    // database query. A narrowing the artifact cannot answer throws ArtifactNarrowError
    // (exit 1 naming the artifact and the missing dimension), never a silent unfiltered
    // render.
    const narrowed = narrowArtifact(artifact, { task: opts.task, top: opts.top }, artifactPath);
    const banner = narrowed.banner === null ? null : `Narrowed report — ${narrowed.banner} (artifact: ${artifactPath})`;

    const renderer = resolveReportMode(opts.mode ?? 'default');
    const report = renderer(narrowed.artifact);
    const markdown = renderMarkdown(narrowed.artifact, opts.mode);
    // Same basename, `.md` extension (R8) — an extensionless explicit path must
    // yield `<path>.md`, never clobber the artifact itself.
    const markdownPath = artifactPath.endsWith('.json') ? artifactPath.replace(/\.json$/, '.md') : `${artifactPath}.md`;
    writeFileSync(markdownPath, markdown);

    return { report, artifactPath, resolution, markdownPath, artifact: narrowed.artifact, banner };
}
// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function parseSource(value: string): LlmJsonlSource {
    if (SOURCES.includes(value as LlmJsonlSource)) {
        return value as LlmJsonlSource;
    }
    throw new Error(`Invalid history source "${value}". Expected one of: ${SOURCES.join(', ')}`);
}

function parseMode(value: string): ImportMode {
    if (MODES.includes(value as ImportMode)) {
        return value as ImportMode;
    }
    throw new Error(`Invalid history import mode "${value}". Expected one of: ${MODES.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Task 0470 helpers — fan-out exit codes, issue formatting, report pruning
// ---------------------------------------------------------------------------

/**
 * Compute the fan-out exit code (task 0470 R3; degraded semantics task 0504 R2).
 *
 * - `0` — every source clean (ok or empty; no skipped records, no failures).
 * - `1` — every source failed.
 * - `2` — mixed, or any source `degraded` (imported with skipped parse/validation
 *   errors — a partial import must not read as success).
 */
export function computeExitCode(entries: readonly CoverageEntry[]): 0 | 1 | 2 {
    const failed = entries.filter((e) => e.status === 'failed').length;
    const degraded = entries.filter((e) => e.status === 'degraded').length;
    if (failed === 0 && degraded === 0) return 0;
    if (failed === entries.length) return 1;
    return 2;
}

/** Render an {@link ImportIssue} as a compact `sourceFile:sourceLine: reason` sample. */
export function formatIssue(issue: ImportIssue): string {
    return `${issue.sourceFile}:${issue.sourceLine}: ${issue.reason}`;
}

/**
 * Prune history report directories older than `retentionDays` (task 0470 R6). Scans
 * `.spur/reports/history/` for `YYYY-MM-DD` directory names, deletes those whose date is
 * before the cutoff, and returns the pruned names (oldest first). Non-date entries are
 * skipped silently. Never throws — a failed `rmSync` is ignored (best-effort cleanup).
 *
 * @param cwd project root containing `.spur/reports/history/`.
 * @param retentionDays number of days to retain (default {@link REPORT_RETENTION_DAYS}).
 * @param now injection point for tests.
 */
export function pruneReports(
    cwd: string,
    retentionDays: number = REPORT_RETENTION_DAYS,
    now: Date = new Date(),
): string[] {
    const dir = join(cwd, '.spur', 'reports', 'history');
    let entries: string[];
    try {
        entries = readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
    } catch {
        return []; // dir absent — nothing to prune
    }

    const cutoff = new Date(now);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const pruned: string[] = [];
    for (const name of entries) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
        const entryDate = new Date(`${name}T00:00:00`);
        if (entryDate >= cutoff) continue;
        try {
            rmSync(join(dir, name), { recursive: true, force: true });
            pruned.push(name);
        } catch {
            // best-effort: a stuck prune must not abort the daily run
        }
    }
    return pruned.sort((a, b) => a.localeCompare(b));
}
