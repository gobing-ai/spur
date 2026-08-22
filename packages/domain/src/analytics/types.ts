/** Analytics record produced by a single-ETL-row cost computation. */
export interface CostRecord {
    /** Source platform identifier (pi, claude, codex, etc.). */
    source: string;
    /** ISO date string for the session/record. */
    date: string;
    /** Model name extracted from the ETL record (when available). */
    model: string;
    /**
     * Estimated input tokens — the TOTAL billed input, i.e. fresh input plus
     * {@link CostRecord.cacheReadTokens} plus {@link CostRecord.cacheCreationTokens}.
     * Kept as the total so cost math and existing aggregates are unaffected by the
     * cache split; subtract the cache fields to recover fresh input. 0 when unavailable.
     */
    inputTokens: number;
    /** Estimated output tokens. 0 when unavailable. */
    outputTokens: number;
    /**
     * Input tokens served from the provider's prompt cache (`cache_read_input_tokens`).
     * Included in {@link CostRecord.inputTokens}. 0 when the provider reported no cache reads.
     */
    cacheReadTokens: number;
    /**
     * Input tokens written into the provider's prompt cache (`cache_creation_input_tokens`).
     * Included in {@link CostRecord.inputTokens}. 0 when the provider reported no cache writes.
     */
    cacheCreationTokens: number;
    /**
     * Whether the source record carried a provider `usage` object at all. False means the
     * token figures are length-based estimates, so cache dimensions are *unknown* rather
     * than zero — the 0281/0284 never-fabricate invariant. Consumers must render
     * unavailable, not 0%. See {@link cacheHitRatio}.
     */
    usageReported: boolean;
    /** Estimated USD cost for this record. */
    costUsd: number;
}

/** Token, cache, cost, and forensic aggregates shared by every analytics breakdown bucket. */
export interface TokenTotals {
    /** Total billed input tokens, cache reads and writes included. */
    inputTokens: number;
    outputTokens: number;
    /** Input tokens served from the provider's prompt cache. */
    cacheReadTokens: number;
    /** Input tokens written into the provider's prompt cache (`history_message.cache_write_tokens`). */
    cacheWriteTokens: number;
    costUsd: number;
    records: number;
    /** Records in this bucket that carried provider usage data — the ratio's denominator basis. */
    recordsWithUsage: number;
    /** Number of `history_message` rows in this bucket. */
    messages: number;
    /** Number of `history_tool_call` rows in this bucket. */
    toolCalls: number;
    /** Sum of per-step `duration_ms` across tool calls. 0 when every duration is NULL. */
    durationMs: number;
    /** Tool calls in this bucket whose `duration_ms` was NULL — the duration "unavailable" count. */
    durationUnmeasured: number;
}

/** Aggregated analytics summary across one or more platforms. */
export interface AnalyticsSummary {
    /** Overall totals. */
    totals: TokenTotals;
    /** Per-source breakdown, keyed by source identifier. */
    bySource: Record<string, TokenTotals>;
    /** Per-model breakdown, keyed by model name. */
    byModel: Record<string, TokenTotals>;
    /** Daily time-series entries. */
    daily: Array<{ date: string } & TokenTotals>;
}

/** Pricing entry for a specific model or model tier. */
export interface ModelPricing {
    /** USD per 1,000,000 input tokens. */
    inputPricePer1M: number;
    /** USD per 1,000,000 output tokens. */
    outputPricePer1M: number;
}

/**
 * Structural input for `extractClaudeTokens`: any passthrough record carrying a
 * Claude-style `usage` object. Replaces the retired `EtlPayload` (task 0624 R3) —
 * the `history_etl_*` raw-payload tables are gone; the extractor only ever read
 * `usage` off the record.
 */
export interface ClaudeUsagePayload {
    usage?: unknown;
}
