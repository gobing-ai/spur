import { join } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { getProjectsFilePath, resolveProjectHost } from '@gobing-ai/spur-config';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { getDecisionService } from '../decision/decision-service';
import { computeDecisionReadiness, type DecisionReadiness } from '../workflow/decision-readiness';
import { fetchAgentProcesses } from './agent-process-status';
import { resolveGlobalConfigDir } from './global-seed';
import { normalizeProjectPath, ProjectRegistry } from './project-registry';

/**
 * Consolidated read-only readiness for `spur self status` (A93 1352, design §3).
 *
 * Every section answers one readiness question from data an owning service already has, and
 * reports what it could NOT read instead of a fabricated empty result. Two rules hold the whole
 * aggregate honest:
 *
 *  - **No mutation, ever.** Nothing here opens the project database: the installed `ts-db` facade
 *    has no proven non-mutating adapter (its opener enables WAL and creates a missing file), so
 *    ledger-derived sections report `unavailable` with the reason. Registry access is
 *    `ProjectRegistry.peek()`, which never heals or rewrites.
 *  - **One deadline.** All asynchronous probes share a single {@link SELF_STATUS_DEADLINE_MS}
 *    `AbortSignal`. A provider that misses it becomes a bounded `unavailable` section; the
 *    sections that did answer still ship.
 *
 * Synchronous local reads (existence, directory listings, small file counts) are scope-bounded:
 * they are not cancellable, and this module does not pretend they are.
 */
export const SELF_STATUS_DEADLINE_MS = 5_000;

/** Section states the renderer and consumers may see. */
export type SelfStatusState = 'ready' | 'degraded' | 'missing' | 'unavailable' | 'not-applicable' | 'error';

/** Machine or project scope of the evidence behind a section. */
export type SelfStatusScope = 'machine' | 'project';

/** One readiness section: state, where it came from, and a bounded message. */
export interface SelfStatusSection {
    state: SelfStatusState;
    scope: SelfStatusScope;
    /** Owning service or file the section reads — provenance, never file contents. */
    source: string;
    /** Empty for a healthy section; otherwise the remedy or the reason data is absent. */
    message: string;
    data?: Record<string, unknown>;
}

/** Aggregate readiness (additive to the legacy `spur status` shape). */
export type SelfStatusOverallState = 'ready' | 'degraded' | 'missing';

/** The nine sections, in render order. */
export type SelfStatusSections = {
    installation: SelfStatusSection;
    configuration: SelfStatusSection;
    schema: SelfStatusSection;
    dependencies: SelfStatusSection;
    projects: SelfStatusSection;
    agents: SelfStatusSection;
    decisions: SelfStatusSection;
    corpus: SelfStatusSection;
    workflows: SelfStatusSection;
    gateway: SelfStatusSection;
};

/** Everything the collector is allowed to read, injected by the CLI composition root. */
export interface SelfStatusContext {
    cwd: string;
    env: Record<string, string | undefined>;
    /** Merged global+project config; `null` when the project layer is absent. */
    config: SpurConfig | null;
    /** Config-load failure message; non-null means the project layer could not be read. */
    configError?: string;
    /** Already-collected Git context (legacy `git` field). */
    git: { root: string | null; branch: string | null; dirty: boolean };
    /** Version reported by the running package, when known. */
    version?: string | null;
    fetchImpl?: typeof fetch;
    deadlineMs?: number;
    /** Filesystem seam; defaults to the node implementation. Read-only use only. */
    fs?: FileSystem;
}

/** The full aggregate: legacy fields plus schemaVersion/overallState/sections. */
export interface SelfStatusAggregate {
    ok: boolean;
    packageJson: boolean;
    spurConfig: boolean;
    git: { root: string | null; branch: string | null; dirty: boolean };
    agentSpecs: string[];
    decisionMaker: DecisionReadiness;
    schemaVersion: 1;
    overallState: SelfStatusOverallState;
    sections: SelfStatusSections;
}

/** Tools Spur needs on PATH, and the optional ones it reports without installing. */
const REQUIRED_TOOLS = ['git', 'bun'] as const;
const OPTIONAL_TOOLS = ['rg', 'zg', 'a2a', 'superskill'] as const;

/** A section that could not answer within the deadline, or that has no safe reader at all. */
function unavailable(scope: SelfStatusScope, source: string, message: string): SelfStatusSection {
    return { state: 'unavailable', scope, source, message };
}

/** Resolve `name` on PATH without executing it (a lookup, never an install or a probe). */
async function whichOnPath(
    fs: FileSystem,
    name: string,
    env: Record<string, string | undefined>,
): Promise<string | null> {
    const dirs = (env.PATH ?? '').split(':').filter((dir) => dir.length > 0);
    for (const dir of dirs) {
        const candidate = join(dir, name);
        const stat = await fs.stat(candidate);
        // A missing tool is a reported state, not an error — keep looking.
        if (stat?.isFile()) return candidate;
    }
    return null;
}

/**
 * Race one async probe against the shared deadline. The probe's own signal is aborted on timeout so
 * an in-flight request is cancelled instead of leaking past the aggregate budget.
 */
async function bounded<T>(
    controller: AbortController,
    probe: (signal: AbortSignal) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
    const { signal } = controller;
    if (signal.aborted) return { ok: false };
    let onAbort: (() => void) | undefined;
    // Race the deadline explicitly: the signal cancels a cooperative provider, and this rejection
    // bounds one that ignores it. Without the race a hung client would stall the whole aggregate.
    const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error('deadline'));
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return { ok: true, value: await Promise.race([probe(signal), aborted]) };
    } catch {
        return { ok: false };
    } finally {
        if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
    }
}

/** Tolerant spec-id listing (file stems), the legacy `agentSpecs` contract. */
async function listAgentSpecIdsFromDisk(fs: FileSystem, cwd: string): Promise<string[]> {
    const dir = join(cwd, '.spur', 'agents');
    if (!(await fs.exists(dir))) return [];
    try {
        return (await fs.readDir(dir))
            .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
            .map((name) => name.replace(/\.ya?ml$/, ''))
            .sort();
    } catch {
        return [];
    }
}

/** How the running Spur was launched: source checkout, packed bundle or compiled binary. */
export function installationProvenance(entry: string | null): 'source' | 'packed' | 'standalone' | 'unknown' {
    if (entry === null) return 'unknown';
    if (entry.includes(`${join('apps', 'cli', 'src')}`)) return 'source';
    if (entry.endsWith('.js') || entry.endsWith('.mjs')) return 'packed';
    return 'standalone';
}

/** Absolute project database path this invocation would use, without opening it. */
function databasePath(cwd: string, env: Record<string, string | undefined>): string {
    return env.DATABASE_URL === undefined ? join(cwd, '.spur', 'spur.db') : env.DATABASE_URL;
}

/** Count `.md` files directly inside a planning directory; a missing directory is `null`. */
async function countMarkdown(fs: FileSystem, dir: string): Promise<number | null> {
    if (!(await fs.exists(dir))) return null;
    try {
        return (await fs.readDir(dir)).filter((name) => name.endsWith('.md')).length;
    } catch {
        return null;
    }
}

/** Probe the registered serve for this project, bounded by the shared signal. */
async function probeProjectServer(
    cwd: string,
    ctx: SelfStatusContext,
    signal: AbortSignal,
): Promise<SelfStatusSection> {
    const source = 'services/project-registry.ts';
    const registry = new ProjectRegistry(ctx.env.SPUR_PROJECTS_FILE ?? getProjectsFilePath());
    const snapshot = registry.peek();
    if (snapshot.unreadable) {
        return {
            state: 'degraded',
            scope: 'project',
            source,
            message: 'project registry is unreadable; run `spur projects list` to rewrite it',
            data: { registered: 0, serve: 'unknown' },
        };
    }
    const entry = snapshot.projects.find((project) => normalizeProjectPath(project.path) === normalizeProjectPath(cwd));
    if (entry === undefined) {
        return {
            state: 'not-applicable',
            scope: 'project',
            source,
            message: 'this directory is not registered; `spur serve` registers it',
            data: { registered: snapshot.projects.length },
        };
    }
    if (entry.port === 0) {
        return {
            state: 'not-applicable',
            scope: 'project',
            source,
            message: 'no serve is running for this project; `spur serve` starts one',
            data: { registered: snapshot.projects.length, port: 0 },
        };
    }
    const host = resolveProjectHost(entry);
    const fetchImpl = ctx.fetchImpl ?? fetch;
    try {
        const response = await fetchImpl(`http://${host}:${entry.port}/api/health`, {
            redirect: 'error',
            signal,
        });
        if (!response.ok) {
            return {
                state: 'degraded',
                scope: 'project',
                source,
                message: `registered serve answered ${response.status}; restart it with \`spur serve\``,
                data: { registered: snapshot.projects.length, port: entry.port, host },
            };
        }
        return {
            state: 'ready',
            scope: 'project',
            source,
            message: '',
            data: { registered: snapshot.projects.length, port: entry.port, host },
        };
    } catch {
        return {
            state: 'degraded',
            scope: 'project',
            source,
            message: `registered serve on ${host}:${entry.port} is unreachable; restart it with \`spur serve\``,
            data: { registered: snapshot.projects.length, port: entry.port, host },
        };
    }
}

/**
 * The one-port gateway is machine state, not project readiness: probe its fixed port and report what
 * it says about itself (1385 R3). A closed port is legitimate — no gateway is running — while a
 * listener that is not the gateway must be named, because a project serve there would swallow every
 * prefix silently.
 */
async function probeGateway(ctx: SelfStatusContext, signal: AbortSignal): Promise<SelfStatusSection> {
    const source = 'services/project-gateway.ts';
    // The shared config type carries no `server` block (project files cannot set it; the env mapping
    // is the K41 gap), so the port is read structurally and falls back to the documented default.
    const port = (ctx.config as { server?: { gateway?: { port?: number } } } | null)?.server?.gateway?.port ?? 3000;
    const host = 'localhost';
    const fetchImpl = ctx.fetchImpl ?? fetch;
    let response: Response;
    try {
        response = await fetchImpl(`http://${host}:${port}/api/health`, { redirect: 'error', signal });
    } catch {
        return {
            state: 'not-applicable',
            scope: 'machine',
            source,
            message: `no gateway is listening on ${host}:${port}; \`spur serve\` starts one`,
            data: { port, host },
        };
    }
    const body = (await response.json().catch(() => null)) as { gateway?: unknown; counters?: unknown } | null;
    if (!response.ok || body?.gateway !== true) {
        return {
            state: 'degraded',
            scope: 'machine',
            source,
            message: `${host}:${port} is held by a listener that is not the gateway; stop it or change \`server.gateway.port\``,
            data: { port, host },
        };
    }
    return { state: 'ready', scope: 'machine', source, message: '', data: { port, host, counters: body.counters } };
}

/** Agent specs plus live process state when a serve answers; specs alone otherwise. */
async function collectAgents(
    ctx: SelfStatusContext,
    signal: AbortSignal,
    specs: readonly string[],
): Promise<SelfStatusSection> {
    const source = 'services/agent-coordination-service.ts';
    const base = { specs: [...specs], live: false };
    const registry = new ProjectRegistry(ctx.env.SPUR_PROJECTS_FILE ?? getProjectsFilePath());
    const entry = registry
        .peek()
        .projects.find((project) => normalizeProjectPath(project.path) === normalizeProjectPath(ctx.cwd));
    if (entry === undefined || entry.port === 0) {
        return {
            state: specs.length === 0 ? 'not-applicable' : 'ready',
            scope: 'project',
            source,
            message: specs.length === 0 ? 'no agent specs under .spur/agents/' : 'live process state needs a run',
            data: base,
        };
    }
    const host = resolveProjectHost(entry);
    const fetchImpl = ctx.fetchImpl ?? fetch;
    try {
        const processes = await fetchAgentProcesses(`http://${host}:${entry.port}/api`, { fetchImpl, signal });
        if (processes === null) throw new Error('process status unavailable');
        const running = [...processes].filter(([, process]) => process.status === 'running').map(([id]) => id);
        return {
            state: 'ready',
            scope: 'project',
            source,
            message: '',
            data: { specs: [...specs], live: true, running },
        };
    } catch {
        return {
            state: specs.length === 0 ? 'not-applicable' : 'degraded',
            scope: 'project',
            source,
            message: `live process state unavailable: serve on ${host}:${entry.port} did not answer`,
            data: base,
        };
    }
}

/**
 * Collect the nine readiness sections (design §3). The aggregate is additive: the legacy `ok`,
 * `packageJson`, `spurConfig`, `git`, `agentSpecs` and `decisionMaker` fields keep their meaning and
 * the exit contract stays project-scaffold health.
 */
export async function collectSelfStatus(ctx: SelfStatusContext): Promise<SelfStatusAggregate> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.deadlineMs ?? SELF_STATUS_DEADLINE_MS);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();

    try {
        const fs = ctx.fs ?? createNodeFileSystem();
        const spurConfigPath = join(ctx.cwd, '.spur', 'config.yaml');
        const packageJsonPath = join(ctx.cwd, 'package.json');
        const spurConfigExists = await fs.exists(spurConfigPath);
        const packageJsonExists = await fs.exists(packageJsonPath);
        const globalPath = join(resolveGlobalConfigDir(ctx), 'config.yaml');
        const globalConfigExists = await fs.exists(globalPath);
        const dbPath = databasePath(ctx.cwd, ctx.env);
        const dbExists = await fs.exists(dbPath);

        // The legacy field stays tolerant (file stems), exactly as `spur status` always reported it.
        // The richer `AgentCoordinationService` read merges fleet members through the project database,
        // which status must not open, so the aggregate reports the specs it can read and names that limit.
        const agentSpecs = await listAgentSpecIdsFromDisk(fs, ctx.cwd);
        const fleetConfigured = ctx.config?.agent?.fleet !== undefined;

        const entry = process.argv[1] ?? null;
        const executable = process.execPath;
        const provenance = installationProvenance(entry);

        const installation: SelfStatusSection = {
            state: 'ready',
            scope: 'machine',
            source: 'process',
            message: '',
            data: {
                executable,
                entry,
                version: ctx.version ?? null,
                provenance,
                onPath: await whichOnPath(fs, 'spur', ctx.env),
            },
        };

        const configuration: SelfStatusSection =
            ctx.configError !== undefined
                ? { state: 'error', scope: 'project', source: '.spur/config.yaml', message: ctx.configError }
                : {
                      state: spurConfigExists ? 'ready' : 'missing',
                      scope: 'project',
                      source: '.spur/config.yaml',
                      message: spurConfigExists ? '' : 'no project config; run `spur self init` in this directory',
                      data: {
                          project: spurConfigExists,
                          projectPath: spurConfigPath,
                          globalPath,
                          globalLayers: globalConfigExists ? 1 : 0,
                      },
                  };

        const ledgerReason =
            'the installed ts-db facade has no proven non-mutating read; ledger data is reported unavailable rather than guessed';
        const schema: SelfStatusSection = dbExists
            ? unavailable('project', dbPath, ledgerReason)
            : {
                  state: 'missing',
                  scope: 'project',
                  source: dbPath,
                  message: 'no project database yet; `spur self migrate` creates it',
              };

        const required = await Promise.all(
            REQUIRED_TOOLS.map(async (name) => ({ name, path: await whichOnPath(fs, name, ctx.env) })),
        );
        const optional = await Promise.all(
            OPTIONAL_TOOLS.map(async (name) => ({ name, path: await whichOnPath(fs, name, ctx.env) })),
        );
        const missingRequired = required.filter((tool) => tool.path === null).map((tool) => tool.name);
        const dependencies: SelfStatusSection = {
            state: missingRequired.length === 0 ? 'ready' : 'degraded',
            scope: 'machine',
            source: 'PATH',
            message:
                missingRequired.length === 0
                    ? ''
                    : `missing required tool(s): ${missingRequired.join(', ')} — install them, Spur never does`,
            data: {
                required,
                optional,
                missingOptional: optional.filter((tool) => tool.path === null).map((tool) => tool.name),
            },
        };

        const decisionMaker = decisionMakerSummary(ctx.config, ctx.env);
        const [projectsProbe, agentsProbe, decisionsProbe, docsSelfProbe] = await Promise.all([
            bounded(controller, (signal) => probeProjectServer(ctx.cwd, ctx, signal)),
            bounded(controller, (signal) => collectAgents(ctx, signal, agentSpecs)),
            bounded(controller, () => collectDecisions(ctx, decisionMaker)),
            bounded(controller, (signal) => probeGateway(ctx, signal)),
        ]);
        const projects = projectsProbe.ok
            ? projectsProbe.value
            : unavailable(
                  'project',
                  'services/project-registry.ts',
                  'project readiness exceeded the collection deadline',
              );

        const agents: SelfStatusSection = !agentsProbe.ok
            ? unavailable(
                  'project',
                  'services/agent-coordination-service.ts',
                  'agent readiness exceeded the collection deadline',
              )
            : fleetConfigured
              ? {
                    ...agentsProbe.value,
                    message:
                        agentsProbe.value.message === ''
                            ? 'fleet members are not merged here: `spur agent status` reads them from the project database'
                            : agentsProbe.value.message,
                    data: { ...(agentsProbe.value.data ?? {}), fleetConfigured: true },
                }
              : agentsProbe.value;

        const decisions = decisionsProbe.ok
            ? decisionsProbe.value
            : unavailable(
                  'project',
                  'decision/decision-service.ts',
                  'decision readiness exceeded the collection deadline',
              );

        const tasksDir = join(ctx.cwd, (ctx.config?.tasks?.active as string | undefined) ?? 'docs/tasks');
        const featuresDir = join(ctx.cwd, (ctx.config?.features?.dir as string | undefined) ?? 'docs/features');
        const taskCount = await countMarkdown(fs, tasksDir);
        const featureCount = await countMarkdown(fs, featuresDir);
        const corpus: SelfStatusSection =
            taskCount === null && featureCount === null
                ? {
                      state: 'not-applicable',
                      scope: 'project',
                      source: 'planning folders',
                      message: 'no task or feature corpus in this project',
                  }
                : {
                      state: 'ready',
                      scope: 'project',
                      source: 'planning folders',
                      message: '',
                      data: { tasksDir, taskCount, featuresDir, featureCount },
                  };

        const workflows: SelfStatusSection = {
            state: 'unavailable',
            scope: 'project',
            source: dbPath,
            message: dbExists
                ? `run history is not readable without opening the database; ${ledgerReason}`
                : 'no project database yet; run summaries appear after `spur self migrate`',
        };

        const gateway = docsSelfProbe.ok
            ? docsSelfProbe.value
            : unavailable(
                  'machine',
                  'services/project-gateway.ts',
                  'gateway readiness exceeded the collection deadline',
              );

        const sections: SelfStatusSections = {
            installation,
            configuration,
            schema,
            dependencies,
            projects,
            agents,
            decisions,
            corpus,
            workflows,
            gateway,
        };

        const degraded = Object.values(sections).some(
            (section) => section.state === 'degraded' || section.state === 'error' || section.state === 'unavailable',
        );
        const ok = spurConfigExists && ctx.configError === undefined;
        return {
            ok,
            packageJson: packageJsonExists,
            spurConfig: spurConfigExists,
            git: ctx.git,
            agentSpecs,
            decisionMaker,
            schemaVersion: 1,
            overallState: !ok ? 'missing' : degraded ? 'degraded' : 'ready',
            sections,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Offline DecisionMaker readiness: configured intent plus credential presence, never the value.
 * Returns the full `DecisionReadiness` so the legacy `decisionMaker` field keeps every key callers
 * already read (`enabled`, `provider`, `connectivity`, `inlineSupport`).
 */
function decisionMakerSummary(config: SpurConfig | null, env: Record<string, string | undefined>): DecisionReadiness {
    return computeDecisionReadiness(
        config?.workflows?.hitlDecisionMaker === true,
        typeof env.TYPESAFE_API_KEY === 'string' && env.TYPESAFE_API_KEY.length > 0,
    );
}

/** Decision catalog/maker readiness from config only; ledger-backed readiness stays unavailable. */
async function collectDecisions(ctx: SelfStatusContext, decisionMaker: DecisionReadiness): Promise<SelfStatusSection> {
    const source = 'decision/decision-service.ts';
    const configuredMakers = Object.keys(ctx.config?.decisions?.makers ?? {}).sort();
    const defaultMaker = ctx.config?.decisions?.maker;
    const reason = 'catalog ledger readiness needs the project database, which status does not open';
    if (ctx.configError !== undefined) {
        return {
            state: 'error',
            scope: 'project',
            source,
            message: ctx.configError,
            data: { decisionMaker, configuredMakers, ledger: reason },
        };
    }
    const status = (await getDecisionService(ctx.config, ctx.cwd)).status();
    return {
        state: status.errors.length === 0 ? 'ready' : 'degraded',
        scope: 'project',
        source,
        message: status.errors.join('; '),
        data: {
            ...status,
            decisionMaker,
            configuredMakers,
            defaultMaker: defaultMaker ?? null,
            ledger: reason,
        },
    };
}
