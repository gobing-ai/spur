import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations } from './migrations';

/** Options for creating the Spur domain database. */
export interface CreateDomainDbOptions {
    /** SQLite URL or `:memory:`. */
    url: string;
}

/** Create a bun-sqlite adapter and apply the Spur CLI-owned schema. */
export async function createMigratedDb(options: CreateDomainDbOptions): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: options.url });
    await applyCliMigrations(adapter);
    return adapter;
}

export type { DbAdapter } from '@gobing-ai/ts-db';
