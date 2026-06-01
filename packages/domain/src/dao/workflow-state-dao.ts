import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { workflowStates } from '../schema/workflow-states';
import { createId } from './base';

/** Persisted workflow state snapshot for workflow integration. */
export type WorkflowStateRecord = typeof workflowStates.$inferSelect;

/** Input accepted by WorkflowStateDao.create. */
export interface CreateWorkflowStateInput {
    runId: string;
    state: string;
    data?: unknown;
}

/** DAO for persisted workflow state snapshots. */
export class WorkflowStateDao extends EntityDao<typeof workflowStates, typeof workflowStates.id> {
    constructor(adapter: DbAdapter) {
        super(adapter, workflowStates, [workflowStates.id], 'workflow_states');
    }

    /** Persist a workflow state snapshot as JSON. */
    snapshot(input: CreateWorkflowStateInput): Promise<WorkflowStateRecord> {
        return super.create({
            id: createId('state'),
            runId: input.runId,
            state: input.state,
            dataJson: JSON.stringify(input.data ?? {}),
        });
    }
}
