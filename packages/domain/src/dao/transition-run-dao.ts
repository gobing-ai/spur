import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { transitionRuns } from '../schema/transition-runs';
import { createId } from './base';

/** Transition-level run row for workflow integration. */
export type TransitionRunRecord = typeof transitionRuns.$inferSelect;

/** Input accepted by TransitionRunDao.create. */
export interface CreateTransitionRunInput {
    runId: string;
    fromState: string;
    toState: string;
    status?: string;
}

/** DAO for workflow transition run rows. */
export class TransitionRunDao extends EntityDao<typeof transitionRuns, typeof transitionRuns.id> {
    constructor(adapter: DbAdapter) {
        super(adapter.getDb(), transitionRuns, transitionRuns.id, 'transition_runs');
    }

    /** Create a transition run placeholder row. */
    open(input: CreateTransitionRunInput): Promise<TransitionRunRecord> {
        return super.create({
            id: createId('transition'),
            runId: input.runId,
            fromState: input.fromState,
            toState: input.toState,
            status: input.status ?? 'pending',
        });
    }
}
