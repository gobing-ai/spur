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
        super(adapter.getDb(), phaseRuns, phaseRuns.id, 'phase_runs');
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
}
