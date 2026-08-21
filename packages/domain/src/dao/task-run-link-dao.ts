import type { DbAdapter } from '@gobing-ai/ts-db';

/** Raw task_run_links row. */
export interface TaskRunLinkRow {
    id: string;
    wbs: string;
    run_id: string;
    kind: string;
    created_at: string;
}

/** Input for inserting a task-run link. */
export interface CreateTaskRunLinkInput {
    id: string;
    wbs: string;
    run_id: string;
    kind: string;
    created_at: string;
}

/** DAO for the task_run_links traceability table (D06). */
export class TaskRunLinkDao {
    constructor(private readonly db: DbAdapter) {}

    /** Insert a single task-run link. */
    async insert(input: CreateTaskRunLinkInput): Promise<void> {
        await this.db.run(
            `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [input.id, input.wbs, input.run_id, input.kind, input.created_at],
        );
    }

    /** Re-point an existing link's run_id (R3, 0622 — inline drive provenance). */
    async updateRunId(id: string, runId: string): Promise<void> {
        await this.db.run(`UPDATE task_run_links SET run_id = ?1 WHERE id = ?2`, runId, id);
    }

    /** List links for a given WBS, newest first. */
    async listByWbs(wbs: string, limit: number): Promise<TaskRunLinkRow[]> {
        try {
            return await this.db.queryAll<TaskRunLinkRow>(
                `SELECT id, wbs, run_id, kind, created_at
                 FROM task_run_links
                 WHERE wbs = ?1
                 ORDER BY created_at DESC
                 LIMIT ?2`,
                wbs,
                limit,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: task_run_links')) {
                return [];
            }
            throw error;
        }
    }

    /** List links for a given run_id, newest first. */
    async listByRun(runId: string, limit: number): Promise<TaskRunLinkRow[]> {
        try {
            return await this.db.queryAll<TaskRunLinkRow>(
                `SELECT id, wbs, run_id, kind, created_at
                 FROM task_run_links
                 WHERE run_id = ?1
                 ORDER BY created_at DESC
                 LIMIT ?2`,
                runId,
                limit,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: task_run_links')) {
                return [];
            }
            throw error;
        }
    }

    /** Delete all rows (test teardown only). */
    async deleteAll(): Promise<void> {
        await this.db.run('DELETE FROM task_run_links');
    }
}
