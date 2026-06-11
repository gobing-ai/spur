import type { DbAdapter } from '@gobing-ai/ts-db';

/** Raw action run row returned by trace timeline queries. */
export interface ActionRunRow {
    id: string;
    node: string;
    kind: string;
    status: string;
    duration_ms: number | null;
    ok: number | null;
    result_json: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: number;
}

/** Lightweight DAO for action_runs table (persisted by the workflow engine). */
export class ActionRunDao {
    constructor(private readonly db: DbAdapter) {}

    /** Raw action rows by run id for trace timeline, ordered by created_at. */
    async actionRowsByRunId(runId: string): Promise<ActionRunRow[]> {
        try {
            return await this.db.queryAll<ActionRunRow>(
                'SELECT id, node, kind, status, duration_ms, ok, result_json, started_at, completed_at, created_at FROM action_runs WHERE run_id = ? ORDER BY created_at',
                runId,
            );
        } catch (error) {
            // Table doesn't exist yet (engine schema not applied) — graceful empty
            if (error instanceof Error && error.message.includes('no such table: action_runs')) {
                return [];
            }
            throw error;
        }
    }
}
