import type { DbAdapter } from '@gobing-ai/ts-db';
import type { CostRecord, EtlPayload } from './types';

const SOURCE_TABLES = [
    'history_etl_pi',
    'history_etl_claude',
    'history_etl_codex',
    'history_etl_gemini',
    'history_etl_opencode',
    'history_etl_antigravity',
    'history_etl_openclaw',
] as const;

/** Query all imported ETL records from one source table. */
export async function queryEtlRecords(
    db: DbAdapter,
    sourceTable: string,
    since?: string,
): Promise<readonly EtlPayload[]> {
    const rows =
        since !== undefined
            ? await db.queryAll<{ payload_json: string }>(
                  `SELECT payload_json FROM ${sourceTable} WHERE imported_at >= ?`,
                  since,
              )
            : await db.queryAll<{ payload_json: string }>(`SELECT payload_json FROM ${sourceTable}`);
    return rows.map((row) => JSON.parse(row.payload_json) as EtlPayload);
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
            const payload = JSON.parse(row.payload_json) as EtlPayload;
            results.push(etlToCostRecord(payload, source));
        }
    }
    return results;
}

/** Extract token counts from a Claude-style passthrough usage object. */
export function extractClaudeTokens(payload: EtlPayload): { inputTokens: number; outputTokens: number } {
    const usage = payload.usage as Record<string, unknown> | undefined;
    if (usage === undefined || usage === null) return { inputTokens: 0, outputTokens: 0 };
    const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    const cacheRead = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
    const cacheCreate = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
    return { inputTokens: input + cacheRead + cacheCreate, outputTokens: output };
}

/** Convert an ETL payload to an analytics cost record with token estimates. */
export function etlToCostRecord(payload: EtlPayload, source: string): CostRecord {
    const tokens = extractClaudeTokens(payload);

    // Fallback: estimate tokens from content length when usage data is absent.
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
        costUsd: 0, // Filled by cost computation
    };
}
