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
}
