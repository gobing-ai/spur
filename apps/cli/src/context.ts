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
    type SpurConfig,
} from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter, getCanonicalStage, TIER_RANK } from '@gobing-ai/spur-domain';
import type { HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import type { CommandOutput } from './output';
import { ClackHitlResponder } from './workflow/hitl/clack-responder';
import { DefaultHitlResponder } from './workflow/hitl/default-responder';

// ---------------------------------------------------------------------------
// Layer-1 role table (0536 R1 / 0572) — resolved at the CLI boundary
// ---------------------------------------------------------------------------

/**
 * Resolve the Layer-1 role table (ADR-078, superseding ADR-061): the config
 * layer is the SSOT. `agent.roles` — merged global-then-project by the layered
 * loader (task 0640) and validated against the closed vocabulary at config load
 * — wins per-field over `DEFAULT_AGENT_ROLES`, which ADR-078 demotes to a
 * byte-identical fallback used only when NO layer supplies a table (the CF-safe
 * core must resolve roles with no filesystem). The shipped table lives in
 * `config/config.global.yaml`; the roles.md runtime parse stays deleted — the
 * plugin file survives as a parity-gated projection
 * (`plugins/sp/tests/roles.test.ts` R9, three-way since 0647).
 *
 * Override stage ids are validated HERE (0572 R10): the CF-safe config core
 * cannot import the stage registry, and `AgentService.stageForRole` silently
 * skips unknown ids — so an unvalidated typo (`stages: [implment]`) or an
 * empty array (hand-built config bypassing the schema) would quietly cut a
 * role-only dispatch off from `model_policy` and the escalation ladder.
 * Throws naming the role and the offending ids, matching the config-load
 * fail-fast for unknown role keys.
 *
 * The merged row must also keep the role-table floor invariant (roles R4):
 * a role's tier may not sit below the highest `min_tier` among its folded
 * stages. The parity gate enforces it for `DEFAULT_AGENT_ROLES` only — a
 * re-tier or re-stage override could otherwise let a role-only dispatch
 * start cheaper than its stage floor with no clamp downstream.
 */
export function resolveAgentRoles(agentConfig?: AgentConfig): Map<string, AgentRoleDefinition> {
    const overrides = agentConfig?.roles;
    if (overrides === undefined) return new Map(DEFAULT_AGENT_ROLES);
    const resolved = new Map<string, AgentRoleDefinition>();
    for (const [role, spec] of DEFAULT_AGENT_ROLES) {
        const override = overrides[role];
        if (override?.stages !== undefined) {
            const unknown = override.stages.filter((id) => getCanonicalStage(id) === undefined);
            if (override.stages.length === 0 || unknown.length > 0) {
                const detail =
                    unknown.length > 0
                        ? `unknown stage id(s): ${unknown.join(', ')}`
                        : 'empty stages array (omit the field to keep the default)';
                throw new Error(
                    `Invalid agent.roles.${role}.stages — ${detail}. Stage ids must come from the canonical stage registry.`,
                );
            }
        }
        const tier = override?.tier ?? spec.tier;
        const stages = override?.stages ?? spec.stages;
        // Floor invariant (roles R4): merged tier must meet the highest stage min_tier.
        let floorStage: { id: string; minTier: keyof typeof TIER_RANK } | undefined;
        for (const id of stages) {
            const record = getCanonicalStage(id);
            if (record === undefined) continue; // override ids validated above; defaults parity-gated
            if (floorStage === undefined || TIER_RANK[record.model_policy.min_tier] > TIER_RANK[floorStage.minTier]) {
                floorStage = { id, minTier: record.model_policy.min_tier };
            }
        }
        if (floorStage !== undefined && TIER_RANK[tier] < TIER_RANK[floorStage.minTier]) {
            throw new Error(
                `Invalid agent.roles.${role} — tier '${tier}' sits below the role's stage floor: ` +
                    `stage '${floorStage.id}' requires min_tier '${floorStage.minTier}'. ` +
                    `A role-only dispatch may never start cheaper than its stage floor (roles R4 / ADR-061).`,
            );
        }
        resolved.set(role, { tier, stages });
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
     * Merged global+project config, loaded once in main() (A5 / ADR-082). The
     * only app-config source threaded into the dispatch context — per-slice
     * `loadSpurConfig` calls are deleted (R5)
     */
    spurConfig?: SpurConfig;
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
     * Layer-1 role → tier map (0536 R1 / 0572). Defaults to
     * `resolveAgentRoles(agentConfig)` — `DEFAULT_AGENT_ROLES` merged with the
     * project's `agent.roles` override.
     */
    agentRoles?: ReadonlyMap<string, AgentRoleDefinition>;
}): CliContext {
    const cwd = resolve(options.cwd ?? process.cwd());
    const env = options.env ?? process.env;
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

    return {
        cwd,
        env,
        fs,
        setExitCode: options.setExitCode ?? noopSetExitCode,
        output: options.output,
        getDb,
        ...(agentConfig !== undefined ? { agentConfig } : {}),
        ...(options.spurConfig !== undefined ? { spurConfig: options.spurConfig } : {}),
        agentRoles,
        agentRolesSource,
        agentService: (serviceOptions?: AgentServiceOptions) =>
            new AgentService({
                cwd,
                env,
                output: options.output,
                agentConfig: agentConfig,
                roles: agentRoles,
                rolesSource: agentRolesSource,
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
