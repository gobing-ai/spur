import type { DbAdapter } from '@gobing-ai/ts-db';
import { createId, SpurDao } from './base';
import type { ArtifactRecord } from './types';

/** DAO for artifact metadata created by CLI workflows. */
export class ArtifactDao extends SpurDao {
    constructor(adapter: DbAdapter) {
        super(adapter);
    }

    /** Persist artifact metadata. */
    async create(input: { path: string; kind: string; runId?: string }): Promise<ArtifactRecord> {
        const now = this.timestamp();
        const record: ArtifactRecord = {
            id: createId('artifact'),
            runId: input.runId ?? null,
            path: input.path,
            kind: input.kind,
            createdAt: now,
            updatedAt: now,
        };
        await this.adapter.run(
            `INSERT INTO artifacts (id, run_id, path, kind, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            record.id,
            record.runId,
            record.path,
            record.kind,
            record.createdAt,
            record.updatedAt,
        );
        return record;
    }
}
