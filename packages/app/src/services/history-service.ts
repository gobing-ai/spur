import type { DbAdapter } from '@gobing-ai/spur-domain';
import { type AnalyticsSummary, aggregateCosts, computeRecordCost, queryAllEtlRecords } from '@gobing-ai/spur-domain';
import {
    type ImportMode,
    type ImportResult,
    type LlmJsonlSource,
    runJsonlImport,
} from '@gobing-ai/ts-llm-jsonl-importer';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of a history import operation. */
export type HistoryImportResult = ImportResult;

/** Result of a history analyze operation. */
export type HistoryAnalyzeResult = AnalyticsSummary;

/** Context injected into HistoryService. */
export interface HistoryServiceContext {
    getDb(): Promise<DbAdapter>;
}

// ---------------------------------------------------------------------------
// Private constants
// ---------------------------------------------------------------------------

const SOURCES: readonly LlmJsonlSource[] = ['pi', 'claude', 'codex', 'gemini', 'opencode', 'antigravity', 'openclaw'];
const MODES: readonly ImportMode[] = ['full', 'incremental', 'force-file'];

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

        return runJsonlImport(parsedSource, {
            db: await this.ctx.getDb(),
            mode,
            ...(opts.file !== undefined && opts.file.length > 0 ? { files: [opts.file] } : {}),
            ...(opts.root !== undefined && opts.root.length > 0 ? { roots: [opts.root] } : {}),
            dryRun: opts.dryRun ?? false,
        });
    }

    /** Analyze cost and usage from imported ETL records. */
    async analyze(since?: string): Promise<HistoryAnalyzeResult> {
        const db = await this.ctx.getDb();
        const records = await queryAllEtlRecords(db, since !== undefined && since.length > 0 ? since : undefined);
        const priced = records.map((record) => computeRecordCost(record));
        return aggregateCosts(priced);
    }
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
