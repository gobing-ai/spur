import { dirname, join, resolve } from 'node:path';
import { isatty } from 'node:tty';
import {
    type AgentConfig,
    type AgentRoleDefinition,
    AgentService,
    type AgentServiceContext,
    RuleService,
} from '@gobing-ai/spur-app';
import {
    buildConfigFromEnv,
    DEFAULT_AGENT_ROLES,
    DEFAULT_DATABASE_URL,
    IN_MEMORY_DATABASE_URL,
} from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import type { HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import type { CommandOutput } from './output';
import { ClackHitlResponder } from './workflow/hitl/clack-responder';
import { DefaultHitlResponder } from './workflow/hitl/default-responder';

// ---------------------------------------------------------------------------
// Layer-1 role table (0536 R1 / 0572) — resolved at the CLI boundary
// ---------------------------------------------------------------------------

/**
 * Resolve the Layer-1 role table (task 0572 / ADR-061): project config
 * `agent.roles` (validated against the closed vocabulary at config load)
 * wins per-field over `DEFAULT_AGENT_ROLES` from `@gobing-ai/spur-config`;
 * with no override the defaults are returned wholesale. The roles.md runtime
 * parse was deleted in this move — the plugin file survives only as a
 * parity-gated projection (`plugins/sp/tests/roles.test.ts` R9).
 */
export function resolveAgentRoles(agentConfig?: AgentConfig): Map<string, AgentRoleDefinition> {
    const overrides = agentConfig?.roles;
    if (overrides === undefined) return new Map(DEFAULT_AGENT_ROLES);
    const resolved = new Map<string, AgentRoleDefinition>();
    for (const [role, spec] of DEFAULT_AGENT_ROLES) {
        const override = overrides[role];
        resolved.set(role, {
            tier: override?.tier ?? spec.tier,
            stages: override?.stages ?? spec.stages,
        });
    }
    return resolved;
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
     * Layer-1 role → tier map resolved from `DEFAULT_AGENT_ROLES`
     * (packages/config SSOT, 0572 / ADR-061) with the project's validated
     * `agent.roles` override merged per-field. Threaded into every
     * {@link agentService} construction so `--agent <role>` resolves. Always
     * defined — `resolveAgentRoles` cannot yield undefined (0572 P3 cleanup).
     */
    agentRoles: ReadonlyMap<string, AgentRoleDefinition>;
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
     * Layer-1 role → tier map (0536 R1 / 0572). Defaults to
     * `resolveAgentRoles(agentConfig)` — `DEFAULT_AGENT_ROLES` merged with the
     * project's `agent.roles` override.
     */
    agentRoles?: ReadonlyMap<string, AgentRoleDefinition>;
}): CliContext {
    const cwd = resolve(options.cwd ?? process.cwd());
    const env = options.env ?? process.env;
    const fs = createNodeFileSystem(cwd);
    const agentRoles = options.agentRoles ?? resolveAgentRoles(options.agentConfig);

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
        agentRoles,
        agentService: (serviceOptions?: AgentServiceOptions) =>
            new AgentService({
                cwd,
                env,
                output: options.output,
                agentConfig: options.agentConfig,
                roles: agentRoles,
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
