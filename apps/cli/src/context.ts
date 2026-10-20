import { dirname, join, resolve } from 'node:path';
import { isatty } from 'node:tty';
import {
    type AgentConfig,
    type AgentRoleDefinition,
    AgentService,
    type AgentServiceContext,
    configuredSecretValues,
    type DecisionCorrelation,
    decisionLogSink,
    getDecisionService,
    RuleService,
    rescueEvidenceTail,
    resolveAgentRoles,
} from '@gobing-ai/spur-app';
import {
    buildConfigFromEnv,
    DEFAULT_DATABASE_URL,
    getEnvVars,
    IN_MEMORY_DATABASE_URL,
    type SpurConfig,
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

export { resolveAgentRoles } from '@gobing-ai/spur-app';

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
     * Merged global+project config, loaded once in main() (A5 / ADR-082). The
     * only app-config source threaded into the dispatch context — per-slice
     * `loadSpurConfig` calls are deleted (R5)
     */
    spurConfig?: SpurConfig;
    /**
     * Effective-config accessor for quota updates (0799, ADR-082): the CLI
     * composition root owns loader calls, so re-loads (R3 executor refresh,
     * drain-time binding checks) go through this threaded closure instead of
     * command-level loader calls. Returns `null` when the config cannot load.
     */
    loadAgentConfig: (projectRoot: string) => Promise<SpurConfig | null>;
    /**
     * Fail-loud sibling of {@link loadAgentConfig} (0858 R2/R5): returns the merged
     * project config or throws with the loader's message. The tolerant accessor
     * above answers "is there a usable config", which is right for a re-load that
     * keeps a working snapshot — but a read surface that reports a project's
     * declared state must name a broken config instead of reporting it undeclared.
     * Absent when the caller supplied no layer loader (then callers fall back to
     * {@link loadAgentConfig}); the composition root always supplies it.
     */
    loadAgentConfigStrict?: (projectRoot: string) => Promise<SpurConfig>;
    /**
     * Provenance of `agentRoles`: 'fallback' iff no config layer supplied an
     * `agent.roles` table at all (whole-table, not per-role). Computed at the
     * CLI root from the merged config; observability only (R3).
     */
    agentRolesSource: 'config' | 'fallback';
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
    /** Merged global+project config (A5 / ADR-082) — the only app-config source. */
    spurConfig?: SpurConfig;
    /**
     * Composition-root-supplied effective-config accessor (0799, ADR-082).
     * Defaults to the boot snapshot — a command that never re-loads keeps the
     * exact config it was dispatched with.
     */
    loadAgentConfig?: (projectRoot: string) => Promise<SpurConfig | null>;
    /** Fail-loud companion of {@link loadAgentConfig} (0858 R2/R5); no default — see the context field. */
    loadAgentConfigStrict?: (projectRoot: string) => Promise<SpurConfig>;
    /**
     * Layer-1 role → tier map (0536 R1 / 0572). Defaults to
     * `resolveAgentRoles(agentConfig)` — `DEFAULT_AGENT_ROLES` merged with the
     * project's `agent.roles` override.
     */
    agentRoles?: ReadonlyMap<string, AgentRoleDefinition>;
}): CliContext {
    const cwd = resolve(options.cwd ?? process.cwd());
    const env = options.env ?? getEnvVars();
    const fs = createNodeFileSystem(cwd);

    // When runNodeApplication injects an eager DB adapter, use it directly (R4).
    // Otherwise fall back to lazy creation for tests and the pre-bootstrap path.
    const agentConfig = options.agentConfig ?? options.spurConfig?.agent;
    const agentRoles = options.agentRoles ?? resolveAgentRoles(agentConfig);
    const agentRolesSource: 'config' | 'fallback' = agentConfig?.roles === undefined ? 'fallback' : 'config';
    let dbPromise: Promise<DbAdapter> | undefined;
    if (options.db) {
        dbPromise = Promise.resolve(options.db);
    }
    const getDb = async (): Promise<DbAdapter> => {
        dbPromise ??= createMigratedDbAdapter(cwd, env, options.dbUrl);
        return dbPromise;
    };
    const loadAgentConfig =
        options.loadAgentConfig ?? (async (): Promise<SpurConfig | null> => options.spurConfig ?? null);

    return {
        cwd,
        env,
        fs,
        setExitCode: options.setExitCode ?? noopSetExitCode,
        output: options.output,
        getDb,
        loadAgentConfig: (projectRoot: string) => loadAgentConfig(projectRoot),
        ...(options.loadAgentConfigStrict !== undefined
            ? { loadAgentConfigStrict: options.loadAgentConfigStrict }
            : {}),
        ...(agentConfig !== undefined ? { agentConfig } : {}),
        ...(options.spurConfig !== undefined ? { spurConfig: options.spurConfig } : {}),
        agentRoles,
        agentRolesSource,
        agentService: (serviceOptions?: AgentServiceOptions) =>
            new AgentService({
                cwd,
                env,
                fs,
                output: options.output,
                agentConfig: agentConfig,
                roles: agentRoles,
                rolesSource: agentRolesSource,
                getDb,
                // 0858 R3: the fleet gate a spec-id dispatch runs reads agent.fleet from
                // the project's merged config — the CLI owns that loader call (ADR-082).
                reloadAgentConfig: () => loadAgentConfig(cwd),
                ...(serviceOptions?.events !== undefined ? { events: serviceOptions.events } : {}),
                ...(serviceOptions?.processRegistry !== undefined
                    ? { processRegistry: serviceOptions.processRegistry }
                    : {}),
                // 1264 R4: the composition root is the only place that reads the flag; the
                // executor gets one function and never a DecisionService or a network client.
                ...executorRescue(spurConfigOrNull(options), cwd, env, options.output, getDb),
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

/**
 * The opt-in catalog rescue for unmatched dispatch failures (task 1264 R4/R2).
 *
 * Returns an empty object unless `workflows.executorFailureDecisionMaker` is true, so the default
 * service context is byte-identical to the pre-1264 one. When wired it redacts the FULL failure
 * text with the configured secrets and only then keeps the last 4096 characters: `redactAndBound`
 * keeps the head, and tailing before redacting can cut a secret at the boundary and send its
 * unmatched fragment to a maker.
 */
export function executorRescue(
    config: SpurConfig | null,
    cwd: string,
    env: Record<string, string | undefined>,
    output: CommandOutput,
    getDb: () => Promise<DbAdapter>,
): Pick<AgentServiceContext, 'classifyUnmatchedFailure'> {
    if (config?.workflows?.executorFailureDecisionMaker !== true) return {};
    return {
        classifyUnmatchedFailure: async (evidence: string, correlation: DecisionCorrelation) => {
            try {
                const tail = rescueEvidenceTail(evidence, configuredSecretValues(env));
                const service = await getDecisionService(config, cwd);
                const served = await service.decide(
                    'executor-failure-class',
                    { instructions: tail },
                    // The sink rides the CLI context DB, like every other CLI-context decision call.
                    { context: { caller: 'executor', correlation }, ...(await sinkFor(getDb, config, env)) },
                );
                if (served.source !== 'model' || served.reason !== 'accepted') return undefined;
                if (served.value === 'resource-exhaustion' || served.value === 'auth') return served.value;
                return undefined;
            } catch (error) {
                // A rescue never fails the run: an unrouted failure keeps today's behaviour, and
                // the operator still sees why the rescue did not answer.
                output.error(`executor failure rescue: ${error instanceof Error ? error.message : String(error)}`);
                return undefined;
            }
        },
    };
}

/** Decision-log sink for the rescue, when the project DB is reachable (rows are best-effort). */
async function sinkFor(
    getDb: () => Promise<DbAdapter>,
    config: SpurConfig | null,
    env: Record<string, string | undefined>,
): Promise<{ decisionLog?: { sink: NonNullable<ReturnType<typeof decisionLogSink>> } }> {
    try {
        const sink = decisionLogSink(await getDb(), config, env);
        return sink !== undefined ? { decisionLog: { sink } } : {};
    } catch {
        return {};
    }
}

/** The merged config as the service sees it; `undefined` inputs stay `null`. */
function spurConfigOrNull(options: { spurConfig?: SpurConfig }): SpurConfig | null {
    return options.spurConfig ?? null;
}

/** No-op fallback when `setExitCode` is not provided to createCliContext. */
export function noopSetExitCode(_code: number): void {}

/** The project database URL: `DATABASE_URL` when set, else `<cwd>/.spur/spur.db` (the default). */
export function resolveDatabaseUrl(cwd: string, env: Record<string, string | undefined>): string {
    return env.DATABASE_URL === undefined ? join(cwd, DEFAULT_DATABASE_URL) : buildConfigFromEnv(env).database.url;
}

/** Create the CLI SQLite adapter and apply the local Spur schema. */
export async function createMigratedDbAdapter(
    cwd = process.cwd(),
    env: Record<string, string | undefined> = getEnvVars(),
    dbUrl?: string,
): Promise<DbAdapter> {
    const url = dbUrl ?? resolveDatabaseUrl(cwd, env);
    if (url !== IN_MEMORY_DATABASE_URL) {
        await createNodeFileSystem().ensureDir(dirname(url));
    }
    return createMigratedDb({ url });
}
