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
        super(adapter.getDb(), runs, runs.id, 'runs');
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
}
