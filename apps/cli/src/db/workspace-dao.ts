import type { DbAdapter } from '@gobing-ai/ts-db';
import { createId, SpurDao } from './base';
import type { AddWorkspaceInput, WorkspaceRecord } from './types';

interface WorkspaceRow {
    id: string;
    name: string;
    root: string;
    purpose: string | null;
    default_agent: string | null;
    created_at: number;
    updated_at: number;
}

/** DAO for the static workspace binding registry. */
export class WorkspaceDao extends SpurDao {
    constructor(adapter: DbAdapter) {
        super(adapter);
    }

    /** Add or replace a workspace by name. */
    async add(input: AddWorkspaceInput): Promise<WorkspaceRecord> {
        const now = this.timestamp();
        const record: WorkspaceRecord = {
            id: input.id ?? createId('wrk'),
            name: input.name,
            root: input.root,
            purpose: input.purpose ?? null,
            defaultAgent: input.defaultAgent ?? null,
            createdAt: now,
            updatedAt: now,
        };

        await this.adapter.run(
            `INSERT INTO workspaces (id, name, root, purpose, default_agent, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
                 root = excluded.root,
                 purpose = excluded.purpose,
                 default_agent = excluded.default_agent,
                 updated_at = excluded.updated_at`,
            record.id,
            record.name,
            record.root,
            record.purpose,
            record.defaultAgent,
            record.createdAt,
            record.updatedAt,
        );

        return (await this.findByName(record.name)) ?? record;
    }

    /** Find a workspace by its stable name. */
    async findByName(name: string): Promise<WorkspaceRecord | undefined> {
        const row = await this.adapter.queryFirst<WorkspaceRow>('SELECT * FROM workspaces WHERE name = ?', name);
        return row == null ? undefined : mapWorkspace(row);
    }

    /** List all workspaces ordered by name for deterministic CLI output. */
    async list(): Promise<WorkspaceRecord[]> {
        const rows = await this.adapter.queryAll<WorkspaceRow>('SELECT * FROM workspaces ORDER BY name ASC');
        return rows.map(mapWorkspace);
    }
}

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
    return {
        id: row.id,
        name: row.name,
        root: row.root,
        purpose: row.purpose,
        defaultAgent: row.default_agent,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
