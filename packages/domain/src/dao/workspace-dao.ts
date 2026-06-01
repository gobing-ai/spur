import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { workspaces } from '../schema/workspaces';
import { createId } from './base';

/** Input for adding a workspace binding. */
export interface AddWorkspaceInput {
    id?: string;
    name: string;
    root: string;
    purpose?: string;
    defaultAgent?: string;
}

/** Workspace registry row stored by the CLI. */
export type WorkspaceRecord = typeof workspaces.$inferSelect;

/** DAO for the static workspace binding registry. */
export class WorkspaceDao extends EntityDao<typeof workspaces, typeof workspaces.id> {
    constructor(adapter: DbAdapter) {
        super(adapter, workspaces, [workspaces.id], 'workspaces');
    }

    /** Add or replace a workspace by name (upsert on the unique name). */
    async add(input: AddWorkspaceInput): Promise<WorkspaceRecord> {
        return this.upsert(
            {
                id: input.id ?? createId('wrk'),
                name: input.name,
                root: input.root,
                purpose: input.purpose ?? null,
                defaultAgent: input.defaultAgent ?? null,
            },
            [workspaces.name],
            {
                root: input.root,
                purpose: input.purpose ?? null,
                defaultAgent: input.defaultAgent ?? null,
            },
        );
    }

    /** List all workspaces ordered by name for deterministic CLI output. */
    override async list(): Promise<WorkspaceRecord[]> {
        const rows = await super.list({ includeDeleted: false });
        return [...rows].sort((left, right) => left.name.localeCompare(right.name));
    }
}
