/** Analytics record produced by a single-ETL-row cost computation. */
export interface CostRecord {
    /** Source platform identifier (pi, claude, codex, etc.). */
    source: string;
    /** ISO date string for the session/record. */
    date: string;
    /** Model name extracted from the ETL record (when available). */
    model: string;
    /** Estimated input tokens. 0 when unavailable. */
    inputTokens: number;
    /** Estimated output tokens. 0 when unavailable. */
    outputTokens: number;
    /** Estimated USD cost for this record. */
    costUsd: number;
}

/** Aggregated analytics summary across one or more platforms. */
export interface AnalyticsSummary {
    /** Overall totals. */
    totals: {
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        records: number;
    };
    /** Per-source breakdown, keyed by source identifier. */
    bySource: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; records: number }>;
    /** Per-model breakdown, keyed by model name. */
    byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; records: number }>;
    /** Daily time-series entries. */
    daily: Array<{ date: string; inputTokens: number; outputTokens: number; costUsd: number; records: number }>;
}

/** Pricing entry for a specific model or model tier. */
export interface ModelPricing {
    /** USD per 1,000,000 input tokens. */
    inputPricePer1M: number;
    /** USD per 1,000,000 output tokens. */
    outputPricePer1M: number;
}

/** Canonical ETL record shape stored in history_etl_* tables' payload_json. */
export interface EtlPayload {
    source_record_id: string;
    created_at: string;
    content: string;
    role?: string;
    model?: string;
    /** Passthrough fields from the original JSONL record. */
    [key: string]: unknown;
}
