import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { runs } from '../schema/runs';
import { createId } from './base';

/** Workflow run row stored by the CLI persistence layer. */
export type RunRecord = typeof runs.$inferSelect;

/**
 * Resolved launch source recorded alongside run identity (0784 R1): resume must
 * replay this exact file from this exact workdir instead of re-deriving a path
 * from `workflow_name` (which can silently resolve a same-named replacement).
 */
export interface RunDefinitionSource {
    /** Absolute path of the launched definition file. */
    path: string;
    /** Resolver layer the launch resolved through. */
    layer: 'project' | 'bundled';
    /** Absolute working directory the run was launched from. */
    workdir: string;
}

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

    /** Raw row shape returned by trace / run-store list queries. */
    traceRows(filter: {
        workflow?: string;
        status?: string;
        since?: string;
        /** Exclusive keyset: rows strictly older than this cursor (task 0373). */
        before?: { started_at: string; id: string };
        limit: number;
    }): Promise<
        Array<{
            id: string;
            workflow_name: string;
            mode: string;
            status: string;
            agent: string | null;
            started_at: string;
            completed_at: string | null;
            metadata_json: string;
        }>
    > {
        return this.adapter.queryAll(
            `SELECT id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json
             FROM runs
             WHERE (?1 IS NULL OR workflow_name = ?1)
               AND (?2 IS NULL OR status = ?2)
               AND (?3 IS NULL OR started_at >= ?3)
               AND (
                 ?4 IS NULL
                 OR started_at < ?4
                 OR (started_at = ?4 AND id < ?5)
               )
             ORDER BY started_at DESC, id DESC
             LIMIT ?6`,
            filter.workflow ?? null,
            filter.status ?? null,
            filter.since ?? null,
            filter.before?.started_at ?? null,
            filter.before?.id ?? null,
            filter.limit,
        );
    }

    /** Fetch a single run row by id for trace timeline / run-store detail. */
    traceRowById(runId: string): Promise<
        | {
              id: string;
              workflow_name: string;
              mode: string;
              status: string;
              agent: string | null;
              started_at: string;
              completed_at: string | null;
              metadata_json: string;
          }
        | undefined
    > {
        return this.adapter.queryFirst(
            'SELECT id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json FROM runs WHERE id = ?',
            runId,
        );
    }

    /** Merge metadata into metadata_json using json_patch without replacing existing keys. */
    mergeMetadata(runId: string, patch: Record<string, unknown>): Promise<void> {
        return this.adapter.run(
            `UPDATE runs
             SET metadata_json = json_patch(
                 COALESCE(NULLIF(metadata_json, ''), '{}'),
                 ?1
             )
             WHERE id = ?2`,
            JSON.stringify(patch),
            runId,
        );
    }

    /** Stamp metadata_json for a run (merges patch into metadata_json). */
    stampMetadata(runId: string, metadata: Record<string, unknown>): Promise<void> {
        return this.mergeMetadata(runId, metadata);
    }

    /**
     * Record the workflow run identity (0768) — and, when supplied, the resolved
     * launch source (0784 R1) — into metadata_json. Uses json_set instead of
     * json_patch: RFC-7396 merge patch DELETES keys whose patch value is null,
     * but a known-unversioned run must record workflowVersion as JSON null so
     * resume can distinguish it from a pre-0768 row with no key.
     *
     * The merge is CONDITIONAL on `$.definitionDigest` being absent (0784 R1):
     * identity is immutable once stamped, so an attach/race can never overwrite
     * the original launch digest — or its documented legacy absence — with a
     * later resolution. The definitionSource object is written as three flat
     * json_set paths in the SAME statement, so a row can never be half-sourced.
     */
    stampRunIdentity(
        runId: string,
        definitionDigest: string,
        workflowVersion: string | null,
        source?: RunDefinitionSource,
    ): Promise<void> {
        const sourceSet =
            source === undefined
                ? ''
                : `,
                 '$.definitionSource.path', ?4,
                 '$.definitionSource.layer', ?5,
                 '$.definitionSource.workdir', ?6`;
        return this.adapter.run(
            `UPDATE runs
             SET metadata_json = json_set(
                 COALESCE(NULLIF(metadata_json, ''), '{}'),
                 '$.definitionDigest', ?1,
                 '$.workflowVersion', ?2${sourceSet}
             )
             WHERE id = ?3
               AND json_type(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.definitionDigest') IS NULL`,
            definitionDigest,
            workflowVersion,
            runId,
            ...(source !== undefined ? [source.path, source.layer, source.workdir] : []),
        );
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
    /**
     * Every non-terminal run, regardless of age (task 0711 R5). Checkpoint
     * reclamation keeps any checkpoint whose `run_id` appears here — a run may
     * legitimately outlive typical staleness windows.
     */
    listActiveRuns(): Promise<Array<{ id: string; status: string; started_at: string }>> {
        return this.adapter.queryAll(
            `SELECT id, status, started_at
             FROM runs
             WHERE status IN ('running', 'pending')
             ORDER BY started_at ASC`,
        );
    }

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
