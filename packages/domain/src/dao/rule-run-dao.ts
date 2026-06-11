import type { DbAdapter } from '@gobing-ai/ts-db';

/** Raw rule run row returned by trace queries. */
export interface RuleRunRow {
    id: string;
    preset: string | null;
    source_kind: string;
    source_value: string | null;
    status: string;
    rule_count: number;
    finding_count: number;
    fix_count: number;
    applied_fix_count: number;
    fail_on: string | null;
    stop_on_first: string | null;
    fix_mode: string;
    dry_run: number;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    metadata_json: string;
}

/** Raw rule eval row returned by trace detail queries. */
export interface RuleEvalRunRow {
    id: string;
    run_id: string;
    rule_id: string;
    severity: string;
    evaluator: string;
    status: string;
    finding_count: number;
    fix_count: number;
    duration_ms: number | null;
    error: string | null;
    findings_json: string | null;
    fixes_json: string | null;
    started_at: string;
    completed_at: string | null;
}

/** Lightweight DAO for querying rule_runs (persisted by the rule engine). */
export class RuleRunDao {
    constructor(private readonly db: DbAdapter) {}

    /** List recent rule runs with optional filters, newest first. */
    async list(filter: { preset?: string; status?: string; since?: string; limit: number }): Promise<RuleRunRow[]> {
        try {
            return await this.db.queryAll<RuleRunRow>(
                `SELECT id, preset, source_kind, source_value, status, rule_count,
                        finding_count, fix_count, applied_fix_count, fail_on,
                        stop_on_first, fix_mode, dry_run, started_at, completed_at,
                        duration_ms, metadata_json
                 FROM rule_runs
                 WHERE (?1 IS NULL OR preset = ?1)
                   AND (?2 IS NULL OR status = ?2)
                   AND (?3 IS NULL OR started_at >= ?3)
                 ORDER BY started_at DESC
                 LIMIT ?4`,
                filter.preset ?? null,
                filter.status ?? null,
                filter.since ?? null,
                filter.limit,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: rule_runs')) {
                return [];
            }
            throw error;
        }
    }

    /** Fetch a single rule run by id. */
    async byId(runId: string): Promise<RuleRunRow | undefined> {
        try {
            const row = await this.db.queryFirst<RuleRunRow>(
                `SELECT id, preset, source_kind, source_value, status, rule_count,
                        finding_count, fix_count, applied_fix_count, fail_on,
                        stop_on_first, fix_mode, dry_run, started_at, completed_at,
                        duration_ms, metadata_json
                 FROM rule_runs
                 WHERE id = ?`,
                runId,
            );
            return row ?? undefined;
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: rule_runs')) {
                return undefined;
            }
            throw error;
        }
    }
}

/** Lightweight DAO for querying rule_eval_runs (persisted by the rule engine). */
export class RuleEvalRunDao {
    constructor(private readonly db: DbAdapter) {}

    /** Per-rule eval rows for a run, ordered by creation time. */
    async byRunId(runId: string): Promise<RuleEvalRunRow[]> {
        try {
            return await this.db.queryAll<RuleEvalRunRow>(
                `SELECT id, run_id, rule_id, severity, evaluator, status,
                        finding_count, fix_count, duration_ms, error,
                        findings_json, fixes_json, started_at, completed_at
                 FROM rule_eval_runs
                 WHERE run_id = ?
                 ORDER BY started_at`,
                runId,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: rule_eval_runs')) {
                return [];
            }
            throw error;
        }
    }
}
