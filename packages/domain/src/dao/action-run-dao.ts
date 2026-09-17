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

    /** Completed_at for one action row — the backdate anchor (ADR-117 startedAt reconstruction). */
    async completedAtById(id: string): Promise<string | null> {
        const row = await this.db.queryFirst<{ completed_at: string | null }>(
            'SELECT completed_at FROM action_runs WHERE id = ?',
            id,
        );
        return row?.completed_at ?? null;
    }

    /** Reconstruct started_at from the stored completed_at minus the measured wall clock. */
    async setStartedAt(id: string, startedAt: string): Promise<void> {
        await this.db.run('UPDATE action_runs SET started_at = ? WHERE id = ?', startedAt, id);
    }

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
