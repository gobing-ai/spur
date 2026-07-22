import type { DbAdapter } from '@gobing-ai/ts-db';
import type { CostRecord, EtlPayload } from './types';

// SECURITY INVARIANT: these table names are interpolated directly into SQL
// (SQLite cannot parameterize identifiers). They MUST remain a hardcoded
// compile-time allowlist — never derive a source table name from user input.
// `SourceTable` narrows callers to this set so the compiler enforces it.
export const SOURCE_TABLES = [
    'history_etl_pi',
    'history_etl_claude',
    'history_etl_codex',
    'history_etl_gemini',
    'history_etl_opencode',
    'history_etl_antigravity',
    'history_etl_openclaw',
] as const;

/** A known history ETL table name — the only values safe to interpolate into SQL. */
export type SourceTable = (typeof SOURCE_TABLES)[number];

/**
 * Parse a stored `payload_json` cell. The history pipeline validates rows
 * before persist, so a parse failure means DB corruption or tampering — fail
 * loud with the table and a truncated snippet rather than a bare SyntaxError,
 * so `spur history analyze` points at the offending row instead of crashing
 * opaquely.
 */
function parsePayload(raw: string, table: string): EtlPayload {
    try {
        return JSON.parse(raw) as EtlPayload;
    } catch (error) {
        const snippet = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Malformed payload_json in ${table}: ${reason} (payload: ${snippet})`);
    }
}

/** Query all imported ETL records from one source table. */
export async function queryEtlRecords(
    db: DbAdapter,
    sourceTable: SourceTable,
    since?: string,
): Promise<readonly EtlPayload[]> {
    const rows =
        since !== undefined
            ? await db.queryAll<{ payload_json: string }>(
                  `SELECT payload_json FROM ${sourceTable} WHERE imported_at >= ?`,
                  since,
              )
            : await db.queryAll<{ payload_json: string }>(`SELECT payload_json FROM ${sourceTable}`);
    return rows.map((row) => parsePayload(row.payload_json, sourceTable));
}

/** Query ETL records from all source tables. */
export async function queryAllEtlRecords(db: DbAdapter, since?: string): Promise<readonly CostRecord[]> {
    const results: CostRecord[] = [];
    for (const table of SOURCE_TABLES) {
        const source = table.replace('history_etl_', '');
        const rows =
            since !== undefined
                ? await db.queryAll<{ payload_json: string }>(
                      `SELECT payload_json FROM ${table} WHERE imported_at >= ?`,
                      since,
                  )
                : await db.queryAll<{ payload_json: string }>(`SELECT payload_json FROM ${table}`);
        for (const row of rows) {
            const payload = parsePayload(row.payload_json, table);
            results.push(etlToCostRecord(payload, source));
        }
    }
    return results;
}

/** Token counts extracted from a provider `usage` object, with the cache split preserved. */
export interface ExtractedTokens {
    /** Total billed input: fresh input + cache reads + cache writes. */
    inputTokens: number;
    outputTokens: number;
    /** `cache_read_input_tokens` — prompt-cache hits. Included in `inputTokens`. */
    cacheReadTokens: number;
    /** `cache_creation_input_tokens` — prompt-cache writes. Included in `inputTokens`. */
    cacheCreationTokens: number;
    /** Whether a provider `usage` object was present at all. */
    usageReported: boolean;
}

/**
 * Extract token counts from a Claude-style passthrough usage object.
 *
 * `inputTokens` remains the summed total (fresh + cache read + cache write) so cost math
 * is unchanged, but the cache components are now reported alongside it instead of being
 * folded in and discarded — without them a cache-hit ratio cannot be computed from an
 * imported record even though the source JSONL carries the numbers.
 */
export function extractClaudeTokens(payload: EtlPayload): ExtractedTokens {
    const usage = payload.usage as Record<string, unknown> | undefined;
    const absent: ExtractedTokens = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        usageReported: false,
    };
    if (usage === undefined || usage === null) return absent;
    const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    const cacheRead = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
    const cacheCreate = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
    return {
        inputTokens: input + cacheRead + cacheCreate,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreate,
        usageReported: true,
    };
}

/** Convert an ETL payload to an analytics cost record with token estimates. */
export function etlToCostRecord(payload: EtlPayload, source: string): CostRecord {
    const tokens = extractClaudeTokens(payload);

    // Fallback: estimate tokens from content length when usage data is absent. The estimate
    // deliberately leaves `usageReported` false — cache dimensions are then UNKNOWN, not zero,
    // and must render as unavailable rather than 0% (0281/0284 never-fabricate invariant).
    if (tokens.inputTokens === 0 && tokens.outputTokens === 0) {
        const contentLength = payload.content?.length ?? 0;
        // Rough estimate: 4 chars per token. Split for input/output.
        if (contentLength > 0) {
            tokens.outputTokens = Math.ceil(contentLength / 4);
        }
    }

    return {
        source,
        date: payload.created_at?.slice(0, 10) ?? 'unknown',
        model: payload.model ?? 'unknown',
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        cacheReadTokens: tokens.cacheReadTokens,
        cacheCreationTokens: tokens.cacheCreationTokens,
        usageReported: tokens.usageReported,
        costUsd: 0, // Filled by cost computation
    };
}
