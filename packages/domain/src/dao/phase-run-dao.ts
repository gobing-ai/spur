import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { phaseRuns } from '../schema/phase-runs';
import { createId } from './base';

/** Phase-level run row for workflow integration. */
export type PhaseRunRecord = typeof phaseRuns.$inferSelect;

/** Input accepted by PhaseRunDao.create. */
export interface CreatePhaseRunInput {
    runId: string;
    phase: string;
    status?: string;
}

/** DAO for workflow phase run rows. */
export class PhaseRunDao extends EntityDao<typeof phaseRuns, typeof phaseRuns.id> {
    constructor(adapter: DbAdapter) {
        super(adapter, phaseRuns, [phaseRuns.id], 'phase_runs');
    }

    /** Create a phase run placeholder row. */
    open(input: CreatePhaseRunInput): Promise<PhaseRunRecord> {
        return super.create({
            id: createId('phase'),
            runId: input.runId,
            phase: input.phase,
            status: input.status ?? 'pending',
            startedAt: null,
            completedAt: null,
        });
    }

    /** Raw phase rows by run id for trace timeline. */
    phaseRowsByRunId(runId: string): Promise<
        Array<{
            phase: string;
            status: string;
            started_at: string | null;
            completed_at: string | null;
            created_at: number;
        }>
    > {
        return this.adapter.queryAll(
            'SELECT phase, status, started_at, completed_at, created_at FROM phase_runs WHERE run_id = ? ORDER BY created_at',
            runId,
        );
    }
}
