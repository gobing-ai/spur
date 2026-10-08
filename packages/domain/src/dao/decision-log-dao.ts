import type { DbAdapter } from '@gobing-ai/ts-db';

/** Maximum decision log rows retained — {@link DecisionLogDao.insert} prunes beyond this. */
export const DECISION_LOG_RETENTION_ROWS = 10_000;

/** Raw decision_logs row. Column names match the 0052 schema (task 1100 §3.5). */
export interface DecisionLogRow {
    id: string;
    decision_id: string;
    /** Catalog decision type (`choice` / `noul`); null for rows written before the type resolved. */
    decision_type: string | null;
    caller: string;
    run_id: string | null;
    workflow_name: string | null;
    node_id: string | null;
    wbs: string | null;
    /** Resolved maker name; null only for a rejected row that failed before a maker resolved. */
    maker_name: string | null;
    maker_source: string | null;
    catalog_layer: string | null;
    catalog_source: string | null;
    min_confidence: number | null;
    /** Inline-question text (workflow inline path); null for catalog ids. Null when `decisions.log = 'metadata'`. */
    question: string | null;
    /** Redacted, 16 KiB-bounded decide input; null for `metadata` mode or input-less invocations. */
    input_json: string | null;
    /** JSON array of top-level input keys — stored in every mode. */
    input_keys_json: string;
    evidence_digest: string | null;
    /** `accepted` | `fallback` | `rejected`. */
    outcome: string;
    value: string | null;
    fallback_value: string | null;
    /** `model` | `default` for served rows; null for `rejected`. */
    source: string | null;
    reason: string | null;
    confidence: number | null;
    /** Redacted maker error or rejection message (≤ 2 KiB); null when nothing failed. */
    error: string | null;
    /** Invocation start — the caller's evidence-reading clock when it supplied one. ISO string. */
    started_at: string;
    ended_at: string;
    duration_ms: number;
    /** JSON array of caller-observed phases (`resolve` / `evidence` / `maker` / `serve`). */
    phases_json: string;
    schema_version: number;
}

/** Input for inserting a decision log row (same shape as {@link DecisionLogRow}, builder-produced). */
export type CreateDecisionLogInput = DecisionLogRow;

/** Filter options for {@link DecisionLogDao.list} / {@link DecisionLogDao.summary}. */
export interface DecisionLogQuery {
    /** Only rows with `started_at` ≥ this ISO timestamp. */
    since?: string;
    /** Filter by catalog decision id (e.g. `publish.pr`). */
    decision_id?: string;
    /** Filter by maker name. */
    maker_name?: string;
    /** Filter by outcome (`accepted` | `fallback` | `rejected`). */
    outcome?: string;
    /** Filter by caller (`cli` | `workflow` | `gate`). */
    caller?: string;
    /** Filter by workflow/agent run id. */
    run_id?: string;
    /**
     * Exclusive keyset cursor. Rows strictly older than `(started_at, id)` are
     * returned; concurrent inserts with a newer timestamp cannot reappear on
     * later pages.
     */
    before?: { started_at: string; id: string };
    /** Max rows to return (newest first). Default 100. */
    limit?: number;
}

/** List page row — the full row minus `input_json`, `question` and `phases_json` (1100 §3.6). */
export type DecisionLogSummaryRow = Omit<DecisionLogRow, 'input_json' | 'question' | 'phases_json'>;

/** Result of {@link DecisionLogDao.list}. */
export interface DecisionLogListResult {
    rows: DecisionLogSummaryRow[];
    /** Cursor for the next older page; null when the page was short. */
    nextCursor: { started_at: string; id: string } | null;
}

/** Outcome counts plus the raw duration values over the filtered set (p95 is computed by the caller). */
export interface DecisionLogSummaryCounts {
    count: number;
    accepted: number;
    fallback: number;
    rejected: number;
    /** Every filtered row's `duration_ms` (unsorted, unbounded by `limit`). */
    durations: number[];
}

/** Distinct filter-facet values over a window (1100 §3.6). */
export interface DecisionLogFacets {
    decisionIds: string[];
    makers: string[];
}

const SUMMARY_COLUMNS = [
    'id',
    'decision_id',
    'decision_type',
    'caller',
    'run_id',
    'workflow_name',
    'node_id',
    'wbs',
    'maker_name',
    'maker_source',
    'catalog_layer',
    'catalog_source',
    'min_confidence',
    'input_keys_json',
    'evidence_digest',
    'outcome',
    'value',
    'fallback_value',
    'source',
    'reason',
    'confidence',
    'error',
    'started_at',
    'ended_at',
    'duration_ms',
    'schema_version',
] as const;

function buildWhere(spec: DecisionLogQuery): { clauses: string[]; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (spec.since !== undefined) {
        clauses.push('started_at >= ?');
        params.push(spec.since);
    }
    if (spec.decision_id !== undefined) {
        clauses.push('decision_id = ?');
        params.push(spec.decision_id);
    }
    if (spec.maker_name !== undefined) {
        clauses.push('maker_name = ?');
        params.push(spec.maker_name);
    }
    if (spec.outcome !== undefined) {
        clauses.push('outcome = ?');
        params.push(spec.outcome);
    }
    if (spec.caller !== undefined) {
        clauses.push('caller = ?');
        params.push(spec.caller);
    }
    if (spec.run_id !== undefined) {
        clauses.push('run_id = ?');
        params.push(spec.run_id);
    }
    if (spec.before !== undefined) {
        clauses.push('(started_at < ? OR (started_at = ? AND id < ?))');
        params.push(spec.before.started_at, spec.before.started_at, spec.before.id);
    }
    return { clauses, params };
}

/**
 * DAO for the `decision_logs` table (task 1100). Written by the decision log sink after the
 * lifecycle's terminal event; read by the Board's Decisions tab. Reads tolerate a missing
 * table (foundation-only DBs) exactly like {@link SystemEventDao}; writes surface failures to
 * the sink's warn path.
 */
export class DecisionLogDao {
    constructor(private readonly adapter: DbAdapter) {}

    /** Insert one row, then prune everything beyond the newest 10,000 rows by started_at. */
    async insert(row: CreateDecisionLogInput): Promise<void> {
        await this.adapter.run(
            `INSERT INTO decision_logs (
                id, decision_id, decision_type, caller, run_id, workflow_name, node_id, wbs,
                maker_name, maker_source, catalog_layer, catalog_source, min_confidence,
                question, input_json, input_keys_json, evidence_digest, outcome, value,
                fallback_value, source, reason, confidence, error, started_at, ended_at,
                duration_ms, phases_json, schema_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            row.id,
            row.decision_id,
            row.decision_type,
            row.caller,
            row.run_id,
            row.workflow_name,
            row.node_id,
            row.wbs,
            row.maker_name,
            row.maker_source,
            row.catalog_layer,
            row.catalog_source,
            row.min_confidence,
            row.question,
            row.input_json,
            row.input_keys_json,
            row.evidence_digest,
            row.outcome,
            row.value,
            row.fallback_value,
            row.source,
            row.reason,
            row.confidence,
            row.error,
            row.started_at,
            row.ended_at,
            row.duration_ms,
            row.phases_json,
            row.schema_version,
        );
        // Retention (1100 §3.5): keep the newest 10,000 rows by (started_at, id). The count
        // gate keeps per-insert cost O(1) until the bound is crossed; the row-value DELETE
        // then trims back to exactly the bound (no rows removed while total ≤ bound).
        const count = await this.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM decision_logs');
        if (count !== undefined && count.n > DECISION_LOG_RETENTION_ROWS) {
            await this.adapter.run(
                `DELETE FROM decision_logs WHERE (started_at, id) < (
                    SELECT started_at, id FROM decision_logs
                    ORDER BY started_at DESC, id DESC
                    LIMIT 1 OFFSET ?
                )`,
                DECISION_LOG_RETENTION_ROWS - 1,
            );
        }
    }

    /** Newest-first summary page ({@link DecisionLogSummaryRow} omits input/question/phases). */
    async list(spec: DecisionLogQuery = {}): Promise<DecisionLogListResult> {
        const { clauses, params } = buildWhere(spec);
        const limit = spec.limit ?? 100;
        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = await this.adapter
            .queryAll<DecisionLogSummaryRow>(
                `SELECT ${SUMMARY_COLUMNS.join(', ')} FROM decision_logs ${where}
             ORDER BY started_at DESC, id DESC LIMIT ?`,
                ...params,
                limit,
            )
            .catch((error: unknown) => {
                if (error instanceof Error && error.message.includes('no such table: decision_logs')) return [];
                throw error;
            });
        const last = rows.at(-1);
        return {
            rows,
            nextCursor:
                rows.length === limit && last !== undefined ? { started_at: last.started_at, id: last.id } : null,
        };
    }

    /** Outcome counts plus raw durations over the filtered set — the caller computes rates and p95. */
    async summary(spec: DecisionLogQuery = {}): Promise<DecisionLogSummaryCounts> {
        const { clauses, params } = buildWhere({ ...spec, before: undefined, limit: undefined });
        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const empty: DecisionLogSummaryCounts = { count: 0, accepted: 0, fallback: 0, rejected: 0, durations: [] };
        try {
            const grouped = await this.adapter.queryAll<{ outcome: string; n: number }>(
                `SELECT outcome, COUNT(*) AS n FROM decision_logs ${where} GROUP BY outcome`,
                ...params,
            );
            if (grouped.length === 0) return empty;
            const durations = await this.adapter.queryAll<{ duration_ms: number }>(
                `SELECT duration_ms FROM decision_logs ${where}`,
                ...params,
            );
            const byOutcome = (outcome: string): number => grouped.find((row) => row.outcome === outcome)?.n ?? 0;
            return {
                count: grouped.reduce((sum, row) => sum + row.n, 0),
                accepted: byOutcome('accepted'),
                fallback: byOutcome('fallback'),
                rejected: byOutcome('rejected'),
                durations: durations.map((row) => row.duration_ms),
            };
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: decision_logs')) return empty;
            throw error;
        }
    }

    /** Distinct decision ids and maker names over a window, for Board filter facets. */
    async facets(spec: Pick<DecisionLogQuery, 'since'> = {}): Promise<DecisionLogFacets> {
        const empty: DecisionLogFacets = { decisionIds: [], makers: [] };
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (spec.since !== undefined) {
            clauses.push('started_at >= ?');
            params.push(spec.since);
        }
        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        try {
            const decisionIds = await this.adapter.queryAll<{ decision_id: string }>(
                `SELECT DISTINCT decision_id FROM decision_logs ${where} ORDER BY decision_id`,
                ...params,
            );
            const makerWhere =
                clauses.length > 0
                    ? `WHERE ${clauses.join(' AND ')} AND maker_name IS NOT NULL`
                    : 'WHERE maker_name IS NOT NULL';
            const makers = await this.adapter.queryAll<{ maker_name: string | null }>(
                `SELECT DISTINCT maker_name FROM decision_logs ${makerWhere} ORDER BY maker_name`,
                ...params,
            );
            return {
                decisionIds: decisionIds.map((row) => row.decision_id),
                makers: makers.map((row) => row.maker_name).filter((name): name is string => name !== null),
            };
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: decision_logs')) return empty;
            throw error;
        }
    }

    /** Full row by invocation id, or null. */
    async get(id: string): Promise<DecisionLogRow | null> {
        try {
            const row = await this.adapter.queryFirst<DecisionLogRow>('SELECT * FROM decision_logs WHERE id = ?', id);
            return row ?? null;
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: decision_logs')) return null;
            throw error;
        }
    }
}
