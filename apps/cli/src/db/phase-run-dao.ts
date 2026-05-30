import type { DbAdapter } from '@gobing-ai/ts-db';
import { createId, SpurDao } from './base';
import type { PhaseRunRecord } from './types';

/** DAO for workflow phase run rows. */
export class PhaseRunDao extends SpurDao {
    constructor(adapter: DbAdapter) {
        super(adapter);
    }

    /** Create a phase run placeholder row. */
    async create(input: { runId: string; phase: string; status?: string }): Promise<PhaseRunRecord> {
        const now = this.timestamp();
        const record: PhaseRunRecord = {
            id: createId('phase'),
            runId: input.runId,
            phase: input.phase,
            status: input.status ?? 'pending',
            startedAt: null,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
        };
        await this.adapter.run(
            `INSERT INTO phase_runs (id, run_id, phase, status, started_at, completed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            record.id,
            record.runId,
            record.phase,
            record.status,
            record.startedAt,
            record.completedAt,
            record.createdAt,
            record.updatedAt,
        );
        return record;
    }
}
