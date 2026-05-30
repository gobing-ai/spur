import type { DbAdapter } from '@gobing-ai/ts-db';
import { createId, SpurDao } from './base';
import type { TransitionRunRecord } from './types';

/** DAO for workflow transition run rows. */
export class TransitionRunDao extends SpurDao {
    constructor(adapter: DbAdapter) {
        super(adapter);
    }

    /** Create a transition run placeholder row. */
    async create(input: {
        runId: string;
        fromState: string;
        toState: string;
        status?: string;
    }): Promise<TransitionRunRecord> {
        const now = this.timestamp();
        const record: TransitionRunRecord = {
            id: createId('transition'),
            runId: input.runId,
            fromState: input.fromState,
            toState: input.toState,
            status: input.status ?? 'pending',
            createdAt: now,
            updatedAt: now,
        };
        await this.adapter.run(
            `INSERT INTO transition_runs (id, run_id, from_state, to_state, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            record.id,
            record.runId,
            record.fromState,
            record.toState,
            record.status,
            record.createdAt,
            record.updatedAt,
        );
        return record;
    }
}
