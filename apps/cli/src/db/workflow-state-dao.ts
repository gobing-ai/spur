import type { DbAdapter } from '@gobing-ai/ts-db';
import { createId, SpurDao } from './base';
import type { WorkflowStateRecord } from './types';

/** DAO for persisted workflow state snapshots. */
export class WorkflowStateDao extends SpurDao {
    constructor(adapter: DbAdapter) {
        super(adapter);
    }

    /** Persist a workflow state snapshot as JSON. */
    async create(input: { runId: string; state: string; data?: unknown }): Promise<WorkflowStateRecord> {
        const now = this.timestamp();
        const record: WorkflowStateRecord = {
            id: createId('state'),
            runId: input.runId,
            state: input.state,
            dataJson: JSON.stringify(input.data ?? {}),
            createdAt: now,
            updatedAt: now,
        };
        await this.adapter.run(
            `INSERT INTO workflow_states (id, run_id, state, data_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            record.id,
            record.runId,
            record.state,
            record.dataJson,
            record.createdAt,
            record.updatedAt,
        );
        return record;
    }
}
