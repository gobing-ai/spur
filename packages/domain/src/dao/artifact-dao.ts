import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { artifacts } from '../schema/artifacts';
import { createId } from './base';

/** Artifact metadata row for CLI-created project files. */
export type ArtifactRecord = typeof artifacts.$inferSelect;

/** Input accepted by ArtifactDao.create. */
export interface CreateArtifactInput {
    path: string;
    kind: string;
    runId?: string;
}

/** DAO for artifact metadata created by CLI workflows. */
export class ArtifactDao extends EntityDao<typeof artifacts, typeof artifacts.id> {
    constructor(adapter: DbAdapter) {
        super(adapter.getDb(), artifacts, artifacts.id, 'artifacts');
    }

    /** Persist artifact metadata. */
    record(input: CreateArtifactInput): Promise<ArtifactRecord> {
        return super.create({
            id: createId('artifact'),
            runId: input.runId ?? null,
            path: input.path,
            kind: input.kind,
        });
    }
}
