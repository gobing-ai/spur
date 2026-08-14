import { dirname, join, resolve } from 'node:path';
import { isatty } from 'node:tty';
import { type AgentConfig, AgentService, type AgentServiceContext, RuleService } from '@gobing-ai/spur-app';
import {
    buildConfigFromEnv,
    DEFAULT_DATABASE_URL,
    type ExecutorCapabilityTier,
    IN_MEMORY_DATABASE_URL,
} from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import type { HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import type { CommandOutput } from './output';
import { ClackHitlResponder } from './workflow/hitl/clack-responder';
import { DefaultHitlResponder } from './workflow/hitl/default-responder';

/** Sync node FS seam for the bundled-roles bootstrap (no-direct-fs-io). */
const fs = createNodeFileSystem();

// ---------------------------------------------------------------------------
// Layer-1 role table (0536 R1) — parsed at the CLI boundary
// ---------------------------------------------------------------------------

/** Memoized roles-file path (0536 R1). */
let cachedRolesFile: string | null | undefined;

/**
 * Resolve the Layer-1 role table `plugins/sp/references/roles.md` (task 0535).
 * Walks up from this module like `bundledConfigRoot` (packages/config): repo-root
 * `plugins/` in the dev tree, package-root `plugins/` in the npm layout produced
 * by `bundle-plugins`. Returns `null` when unreachable (e.g. a `--compile` single
 * binary with no sibling filesystem).
 */
export function bundledRolesFile(): string | null {
    if (cachedRolesFile !== undefined) return cachedRolesFile;
    let dir = import.meta.dir;
    while (true) {
        const candidate = join(dir, 'plugins', 'sp', 'references', 'roles.md');
        if (fs.exists(candidate)) {
            cachedRolesFile = candidate;
            return cachedRolesFile;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    cachedRolesFile = null;
    return cachedRolesFile;
}

/**
 * Parse the Layer-1 role → tier map from `roles.md`'s fenced YAML block (0536 R1).
 * The block shape (`version: 1`, `roles[].id` / `roles[].tier`) is frozen by
 * `plugins/sp/tests/roles.test.ts`; a shape change is a 0535 regression, not
 * handled here. Regex parse keeps the CLI dependency-free — the vocabulary is
 * closed (four roles, five tiers).
 */
export function parseAgentRoles(source: string): Map<string, ExecutorCapabilityTier> {
    const block = source.match(/```yaml\n([\s\S]*?)\n```/)?.[1] ?? source;
    const roles = new Map<string, ExecutorCapabilityTier>();
    for (const m of block.matchAll(/- id: (\w+)\s*\n\s*tier: ([\w-]+)/g)) {
        const id = m[1];
        const tier = m[2];
        if (id !== undefined && tier !== undefined) roles.set(id, tier as ExecutorCapabilityTier);
    }
    return roles;
}

/** Load the bundled role → tier map, or undefined when the file is unreachable or unparseable. */
export function loadAgentRoles(): Map<string, ExecutorCapabilityTier> | undefined {
    const file = bundledRolesFile();
    if (file === null) return undefined;
    try {
        // node FS seam is synchronous (readFileSync); cast narrows the portable union.
        return parseAgentRoles(fs.readFile(file) as string);
    } catch {
        return undefined;
    }
}

/** Optional overrides when constructing an {@link AgentService} from the CLI context. */
export type AgentServiceOptions = Pick<AgentServiceContext, 'events' | 'processRegistry'>;

/** Runtime dependencies shared by CLI commands. */
export interface CliContext {
    cwd: string;
    /** Called by command handlers to signal the intended exit code. */
    setExitCode(code: number): void;
    env: Record<string, string | undefined>;
    fs: FileSystem;
    output: CommandOutput;
    getDb(): Promise<DbAdapter>;
    /**
     * Validated `agent` config block (executors + phase map) from the project
     * config, when present. Threaded into every {@link agentService} construction
     * so phase-aware `--agent auto` works (task 0126 / 0370).
     */
    agentConfig?: AgentConfig;
    /**
     * Layer-1 role → tier map parsed from `plugins/sp/references/roles.md`
     * (task 0535) at the CLI boundary (0536 R1). Threaded into every
     * {@link agentService} construction so `--agent <role>` resolves; absent
     * when the file is unreachable (role selectors then fall through).
     */
    agentRoles?: ReadonlyMap<string, ExecutorCapabilityTier>;
    /**
     * Build an {@link AgentService}. Optional overrides let the direct
     * `spur agent run` path attach a CLI EventBus for the system_events ledger
     * (task 0370) without the workflow path inheriting it (R4 no double-count).
     */
    agentService(options?: AgentServiceOptions): AgentService;
    ruleService(): RuleService;
    /**
     * Create a HITL responder: interactive Clack only when stdout is a TTY AND output is not `--json`,
     * otherwise the non-interactive default. `--json` must never trigger an interactive prompt — it
     * would corrupt the JSON stream and block a machine consumer.
     *
     * DesktopNotifierHitlResponder (native OS dialogs + node-notifier) is available via
     * explicit import from `./workflow/hitl/desktop-notifier-responder`.
     */
    hitlResponder(json?: boolean): HitlResponder;
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
    /** Validated `agent` config block, threaded into AgentService for phase-aware resolution. */
    agentConfig?: AgentConfig;
    /**
     * Layer-1 role → tier map (0536 R1). Defaults to parsing
     * `plugins/sp/references/roles.md` from the bundled plugin tree.
     */
    agentRoles?: ReadonlyMap<string, ExecutorCapabilityTier>;
}): CliContext {
    const cwd = resolve(options.cwd ?? process.cwd());
    const env = options.env ?? process.env;
    const fs = createNodeFileSystem(cwd);
    const agentRoles = options.agentRoles ?? loadAgentRoles();

    // When runNodeApplication injects an eager DB adapter, use it directly (R4).
    // Otherwise fall back to lazy creation for tests and the pre-bootstrap path.
    let dbPromise: Promise<DbAdapter> | undefined;
    if (options.db) {
        dbPromise = Promise.resolve(options.db);
    }
    const getDb = async (): Promise<DbAdapter> => {
        dbPromise ??= createMigratedDbAdapter(cwd, env, options.dbUrl);
        return dbPromise;
    };

    return {
        cwd,
        env,
        fs,
        setExitCode: options.setExitCode ?? noopSetExitCode,
        output: options.output,
        getDb,
        ...(options.agentConfig !== undefined ? { agentConfig: options.agentConfig } : {}),
        ...(agentRoles !== undefined ? { agentRoles } : {}),
        agentService: (serviceOptions?: AgentServiceOptions) =>
            new AgentService({
                cwd,
                env,
                output: options.output,
                agentConfig: options.agentConfig,
                ...(agentRoles !== undefined ? { roles: agentRoles } : {}),
                getDb,
                ...(serviceOptions?.events !== undefined ? { events: serviceOptions.events } : {}),
                ...(serviceOptions?.processRegistry !== undefined
                    ? { processRegistry: serviceOptions.processRegistry }
                    : {}),
            }),
        ruleService: () => new RuleService({ cwd, env, fs, output: options.output, getDb }),
        hitlResponder: (json?: boolean) => {
            if (isatty(1) && json !== true) return new ClackHitlResponder();
            // Default-deny for headless/json; SPUR_HITL_AUTO_APPROVE=1 opts in.
            const confirmDefault = env.SPUR_HITL_AUTO_APPROVE === '1' ? 'yes' : 'no';
            return new DefaultHitlResponder({ confirmDefault });
        },
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
    const configuredUrl = env.DATABASE_URL === undefined ? join(cwd, DEFAULT_DATABASE_URL) : config.database.url;
    const url = dbUrl ?? configuredUrl;
    if (url !== IN_MEMORY_DATABASE_URL) {
        await createNodeFileSystem().ensureDir(dirname(url));
    }
    return createMigratedDb({ url });
}
