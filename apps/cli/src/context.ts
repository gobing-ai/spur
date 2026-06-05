import { dirname, join, resolve } from 'node:path';
import { buildConfigFromEnv } from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import { createNodeFileSystem, type FileSystem, NodeFileSystem, setFileSystem } from '@gobing-ai/ts-runtime';
import { CLI_CONFIG } from './config';
import type { CommandOutput } from './output';

/** Runtime dependencies shared by CLI commands. */
export interface CliContext {
    cwd: string;
    env: Record<string, string | undefined>;
    fs: FileSystem;
    output: CommandOutput;
    getDb(): Promise<DbAdapter>;
}

/** Build a CLI context for production execution or tests. */
export function createCliContext(options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    output: CommandOutput;
    dbUrl?: string;
}): CliContext {
    const cwd = resolve(options.cwd ?? process.cwd());
    const env = options.env ?? process.env;
    const fs = createNodeFileSystem();
    setFileSystem(new NodeFileSystem());

    let dbPromise: Promise<DbAdapter> | undefined;

    return {
        cwd,
        env,
        fs,
        output: options.output,
        getDb: async () => {
            dbPromise ??= createMigratedDbAdapter(cwd, env, options.dbUrl);
            return dbPromise;
        },
    };
}

/** Create the CLI SQLite adapter and apply the local Spur schema. */
export async function createMigratedDbAdapter(
    cwd = process.cwd(),
    env: Record<string, string | undefined> = process.env,
    dbUrl?: string,
): Promise<DbAdapter> {
    const config = buildConfigFromEnv(env);
    const configuredUrl = env.DATABASE_URL === undefined ? join(cwd, CLI_CONFIG.databaseFile) : config.database.url;
    const url = dbUrl ?? configuredUrl;
    if (url !== ':memory:') {
        await createNodeFileSystem().ensureDir(dirname(url));
    }
    return createMigratedDb({ url });
}
