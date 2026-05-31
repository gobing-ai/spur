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
    constructor(private readonly adapter: DbAdapter) {
        super(adapter.getDb(), workspaces, workspaces.id, 'workspaces');
    }

    /** Add or replace a workspace by name. */
    async add(input: AddWorkspaceInput): Promise<WorkspaceRecord> {
        const now = Date.now();
        const id = input.id ?? createId('wrk');

        // EntityDao has no upsert; the name-unique conflict path needs raw SQL.
        // Parameterized + injection-safe — this is the adapter's documented write API.
        await this.adapter.run(
            `INSERT INTO workspaces (id, name, root, purpose, default_agent, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
                 root = excluded.root,
                 purpose = excluded.purpose,
                 default_agent = excluded.default_agent,
                 updated_at = excluded.updated_at`,
            id,
            input.name,
            input.root,
            input.purpose ?? null,
            input.defaultAgent ?? null,
            now,
            now,
        );

        const record = await this.findByName(input.name);
        if (record === undefined) throw new Error(`Workspace "${input.name}" not found after upsert`);
        return record;
    }

    /** Find a workspace by its stable name. */
    async findByName(name: string): Promise<WorkspaceRecord | undefined> {
        return this.findBy(workspaces.name, name);
    }

    /** List all workspaces ordered by name for deterministic CLI output. */
    override async list(): Promise<WorkspaceRecord[]> {
        const rows = await super.list({ includeDeleted: false });
        return [...rows].sort((left, right) => left.name.localeCompare(right.name));
    }
}
