import type { DbAdapter } from '@gobing-ai/ts-db';
import { createId, SpurDao } from './base';
import type { RunRecord } from './types';

interface RunRow {
    id: string;
    workspace_id: string | null;
    status: string;
    agent: string | null;
    started_at: number;
    completed_at: number | null;
    created_at: number;
    updated_at: number;
}

/** DAO for workflow run persistence owned by Spur. */
export class RunDao extends SpurDao {
    constructor(adapter: DbAdapter) {
        super(adapter);
    }

    /** Create a new run row. */
    async create(input: { workspaceId?: string; status?: string; agent?: string }): Promise<RunRecord> {
        const now = this.timestamp();
        const record: RunRecord = {
            id: createId('run'),
            workspaceId: input.workspaceId ?? null,
            status: input.status ?? 'pending',
            agent: input.agent ?? null,
            startedAt: now,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
        };

        await this.adapter.run(
            `INSERT INTO runs (id, workspace_id, status, agent, started_at, completed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            record.id,
            record.workspaceId,
            record.status,
            record.agent,
            record.startedAt,
            record.completedAt,
            record.createdAt,
            record.updatedAt,
        );
        return record;
    }

    /** Find a run by id. */
    async findById(id: string): Promise<RunRecord | undefined> {
        const row = await this.adapter.queryFirst<RunRow>('SELECT * FROM runs WHERE id = ?', id);
        return row == null ? undefined : mapRun(row);
    }
}

function mapRun(row: RunRow): RunRecord {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        status: row.status,
        agent: row.agent,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
