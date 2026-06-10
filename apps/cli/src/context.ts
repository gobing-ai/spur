import { dirname, join, resolve } from 'node:path';
import { AgentService, RuleService } from '@gobing-ai/spur-app';
import { buildConfigFromEnv } from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import { createNodeFileSystem, type FileSystem, NodeFileSystem, setFileSystem } from '@gobing-ai/ts-runtime';
import { CLI_CONFIG } from './config';
import type { CommandOutput } from './output';

/** Runtime dependencies shared by CLI commands. */
export interface CliContext {
    cwd: string;
    /** Called by command handlers to signal the intended exit code. */
    setExitCode(code: number): void;
    env: Record<string, string | undefined>;
    fs: FileSystem;
    output: CommandOutput;
    getDb(): Promise<DbAdapter>;
    agentService(): AgentService;
    ruleService(): RuleService;
}

/** Build a CLI context for production execution or tests. */
export function createCliContext(options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    output: CommandOutput;
    dbUrl?: string;
    setExitCode?: (code: number) => void;
    /** Pre-built DB adapter from runNodeApplication services.db (R4 eager injection). */
    db?: DbAdapter;
}): CliContext {
    const cwd = resolve(options.cwd ?? process.cwd());
    const env = options.env ?? process.env;
    const fs = createNodeFileSystem();
    setFileSystem(new NodeFileSystem());

    // When runNodeApplication injects an eager DB adapter, use it directly (R4).
    // Otherwise fall back to lazy creation for tests and the pre-bootstrap path.
    let dbPromise: Promise<DbAdapter> | undefined;
    if (options.db) {
        dbPromise = Promise.resolve(options.db);
    }

    return {
        cwd,
        env,
        fs,
        setExitCode: options.setExitCode ?? noopSetExitCode,
        output: options.output,
        getDb: async () => {
            dbPromise ??= createMigratedDbAdapter(cwd, env, options.dbUrl);
            return dbPromise;
        },
        agentService: () => new AgentService({ cwd, env, output: options.output }),
        ruleService: () => new RuleService({ cwd, env, fs, output: options.output }),
    };
}

/** No-op fallback when `setExitCode` is not provided to createCliContext. */
export function noopSetExitCode(_code: number): void {}

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
