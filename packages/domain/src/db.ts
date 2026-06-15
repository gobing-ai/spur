import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import type { DatabaseConfig } from '@gobing-ai/ts-runtime';
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

/**
 * Create a platform-selected DB adapter via ts-runtime and apply Spur's
 * CLI schema migrations (design §2.3, §2.1.1, invariant #9).
 *
 * The runtime owns connection + platform selection; spur-domain owns schema
 * + the widening cast from RuntimeDbAdapter to the full DbAdapter.
 *
 * On the Cloudflare Workers path, `createDbAdapter` throws
 * `D1NotConfiguredError` until D1 ships — the caller propagates it.
 */
export async function createMigratedDbViaRuntime(config: DatabaseConfig): Promise<DbAdapter> {
    const { loadRuntimeFactory } = await import('@gobing-ai/ts-runtime');
    const factory = await loadRuntimeFactory();
    const runtimeAdapter = await factory.createDbAdapter(config);
    await applyCliMigrations(runtimeAdapter as unknown as DbAdapter);
    return runtimeAdapter as unknown as DbAdapter;
}

export type { DbAdapter } from '@gobing-ai/ts-db';
export type { DatabaseConfig } from '@gobing-ai/ts-runtime';
