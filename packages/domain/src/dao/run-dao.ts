import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { runs } from '../schema/runs';
import { createId } from './base';

/** Workflow run row stored by the CLI persistence layer. */
export type RunRecord = typeof runs.$inferSelect;

/** Input accepted by RunDao.create. */
export interface CreateRunInput {
    workspaceId?: string;
    status?: string;
    agent?: string;
}

/** DAO for workflow run persistence owned by Spur. */
export class RunDao extends EntityDao<typeof runs, typeof runs.id> {
    constructor(adapter: DbAdapter) {
        super(adapter, runs, [runs.id], 'runs');
    }

    /** Create a new run row. */
    open(input: CreateRunInput = {}): Promise<RunRecord> {
        return super.create({
            id: createId('run'),
            workspaceId: input.workspaceId ?? null,
            status: input.status ?? 'pending',
            agent: input.agent ?? null,
            startedAt: Date.now(),
            completedAt: null,
        });
    }

    // ── Trace queries (raw SQL — engine-writes use TEXT timestamps that
    //    differ from the integer schema; parameterized SQL handles this.)

    /** Raw row shape returned by trace queries. */
    traceRows(filter: { workflow?: string; status?: string; since?: string; limit: number }): Promise<
        Array<{
            id: string;
            workflow_name: string;
            mode: string;
            status: string;
            started_at: string;
            completed_at: string | null;
            metadata_json: string;
        }>
    > {
        return this.adapter.queryAll(
            `SELECT id, workflow_name, mode, status, started_at, completed_at, metadata_json
             FROM runs
             WHERE (?1 IS NULL OR workflow_name = ?1)
               AND (?2 IS NULL OR status = ?2)
               AND (?3 IS NULL OR started_at >= ?3)
             ORDER BY started_at DESC
             LIMIT ?4`,
            filter.workflow ?? null,
            filter.status ?? null,
            filter.since ?? null,
            filter.limit,
        );
    }

    /** Fetch a single run row by id for trace timeline. */
    traceRowById(runId: string): Promise<
        | {
              id: string;
              workflow_name: string;
              mode: string;
              status: string;
              started_at: string;
              completed_at: string | null;
              metadata_json: string;
          }
        | undefined
    > {
        return this.adapter.queryFirst(
            'SELECT id, workflow_name, mode, status, started_at, completed_at, metadata_json FROM runs WHERE id = ?',
            runId,
        );
    }

    /** Stamp metadata_json for a run (e.g. dryRun flag). */
    stampMetadata(runId: string, metadata: Record<string, unknown>): Promise<void> {
        return this.adapter.run('UPDATE runs SET metadata_json = ? WHERE id = ?', JSON.stringify(metadata), runId);
    }

    /** Merge a terminal workflow failure reason without replacing existing metadata. */
    stampFailureReason(runId: string, reason: string): Promise<void> {
        return this.adapter.run(
            `UPDATE runs
             SET metadata_json = json_set(
                 COALESCE(NULLIF(metadata_json, ''), '{}'),
                 '$.failureReason',
                 ?1
             )
             WHERE id = ?2`,
            reason,
            runId,
        );
    }

    /**
     * Find runs stuck in a non-terminal status (`running`/`pending`) that started
     * before `cutoffIso`. These are orphans — a process was killed (timeout, crash,
     * Ctrl-C) before the engine could finalize the run. Returns the rows; the caller
     * decides whether to finalize them.
     *
     * Comparison is on `started_at`, which the engine writes as a TEXT ISO-8601 string
     * (lexicographically ordered, so a string `<` is a chronological `<`). `updated_at`
     * is deliberately not used — it is an INTEGER epoch on engine writes, so mixing it
     * with the ISO cutoff would compare incompatible types. "Started long ago and still
     * running" is the sound, type-safe staleness signal.
     */
    listStaleRuns(cutoffIso: string): Promise<Array<{ id: string; status: string; started_at: string }>> {
        return this.adapter.queryAll(
            `SELECT id, status, started_at
             FROM runs
             WHERE status IN ('running', 'pending')
               AND started_at < ?1
             ORDER BY started_at ASC`,
            cutoffIso,
        );
    }

    /**
     * Mark a non-terminal run as `failed` with a completion timestamp and a reason
     * stamped into metadata_json. Idempotent against already-terminal runs (the
     * status guard in the WHERE clause prevents clobbering a `done`/`failed` run).
     */
    async finalizeStale(runId: string, reason: string): Promise<void> {
        const nowIso = new Date().toISOString();
        await this.adapter.run(
            `UPDATE runs
             SET status = 'failed', completed_at = ?1, updated_at = ?1,
                 metadata_json = json_set(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.staleReason', ?2)
             WHERE id = ?3 AND status IN ('running', 'pending')`,
            nowIso,
            reason,
            runId,
        );
    }

    /**
     * Record the OS pid of the worker subprocess for an async run, so
     * `spur workflow cancel <run-id>` can SIGTERM it. The `pid` column is added
     * by the `0005_spur_cli_run_pid` migration. `null` clears it.
     */
    async setPid(runId: string, pid: number | null): Promise<void> {
        await this.adapter.run('UPDATE runs SET pid = ? WHERE id = ?', pid, runId);
    }

    /**
     * Read the recorded worker pid for a run, or `null` when none was recorded
     * (sync runs, runs from before the pid column, or a cleared pid).
     */
    async getPid(runId: string): Promise<number | null> {
        const row = await this.adapter.queryFirst<{ pid: number | null }>('SELECT pid FROM runs WHERE id = ?', runId);
        return row?.pid ?? null;
    }
}
