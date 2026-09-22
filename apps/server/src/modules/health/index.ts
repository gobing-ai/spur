import { basename } from 'node:path';
import {
    DeliveryReconciler,
    FleetService,
    isPortLive,
    normalizeProjectPath,
    type OrchestratorBinding,
    ProjectRegistry,
    type ResolvedFleetMember,
    resolveAgentRoles,
    type StrategyName,
    StrategyRuntime,
    startRegisteredProject,
} from '@gobing-ai/spur-app';
import { normalizeExecutorAvailability } from '@gobing-ai/spur-config';
import {
    declaresExecutor,
    ExecutorUpdateError,
    getDeclaredExecutorNames,
    resolveConfigLayers,
    setExecutorAvailability,
} from '@gobing-ai/spur-config/loader';
import { CoordinationRunDao, InboxMessageDao, TIER_RANK } from '@gobing-ai/spur-domain';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/** Server start timestamp for uptime calculation. */
const startedAt = Date.now();

/** The operator mailbox the Board submits from (0841) — twin of the web constant. */
const OPERATOR_AGENT_ID = 'board-operator';

/**
 * Health module — the reference ServerModule implementation.
 *
 * Proves the registry pattern (design §2.4): the liveness + readiness
 * endpoints register through the same `ServerModule` interface every
 * domain module uses. Routes are raw Hono handlers (not oRPC) because
 * health is infrastructure, not an API domain.
 */
export const healthModule: ServerModule = {
    name: 'health',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        // ── Liveness ──
        app.get('/api/health', (c) => {
            const uptime = (Date.now() - startedAt) / 1000;
            const memory = process.memoryUsage();
            return c.json({
                status: 'ok',
                uptime_seconds: Math.round(uptime),
                memory_rss_mb: Math.round((memory.rss / 1_048_576) * 100) / 100,
                memory_heap_mb: Math.round((memory.heapUsed / 1_048_576) * 100) / 100,
            });
        });

        // ── Readiness ──
        app.get('/api/health/ready', async (c) => {
            if (!ctx) {
                return c.json({ status: 'error', db: 'unavailable' }, 503);
            }
            const ok = await ctx.checkDbHealth();
            if (ok) {
                return c.json({ status: 'ok', db: 'connected' });
            }
            return c.json({ status: 'error', db: 'unreachable' }, 503);
        });

        // ── Project identity ──
        // The board sidebar labels itself with the served project (basename of
        // the cwd `spur serve` runs in). `null` when there is no ServerContext
        // (e.g. the Cloudflare Worker, which has no meaningful cwd).
        //
        // `path` (0840 R4): the canonical worktree through the SAME
        // `normalizeProjectPath` call `/api/projects` uses for its `current`
        // marker, so the module's identity key and the switcher can never
        // disagree. `name` stays byte-identical (LeftSidebar title reads it).
        app.get('/api/project', (c) => {
            return c.json({ name: ctx ? basename(ctx.cwd) : null, path: ctx ? normalizeProjectPath(ctx.cwd) : null });
        });

        // ── Project fleet snapshot (0840 R2/R5) ──
        // One server serves one project, so the runtime facts are read from
        // THIS project: fleet declaration + orchestrator binding through
        // FleetService (0835/0836) and the persisted strategy through
        // StrategyRuntime (0838, read-only). The endpoint is a value, not an
        // exception surface: every degraded fact resolves to a NAMED state
        // (`strategy: null`, `orchestrator: { state: 'unresolvable' }`) and
        // the route returns 200, never a 500.
        app.get('/api/project/fleet', async (c) => {
            if (!ctx) {
                return c.json({
                    path: null,
                    enabled: false,
                    strategy: null,
                    orchestrator: { state: 'unresolvable', reason: 'no-project-context' },
                    members: [],
                    capacity: { total: 0, enabled: 0, writeCapable: 0, missing: [] },
                    roles: [],
                    executors: [],
                });
            }
            const path = normalizeProjectPath(ctx.cwd);
            // The server's own migrated db IS the served project's db (one
            // instance serves one project) — the same adapter
            // project_claims/project_strategy read through.
            const openDb = () => ctx.getDb();
            const fleet = new FleetService({
                fs: ctx.fs,
                // 0799 R3 parity with the CLI's --fleet: resolve against a fresh
                // merged config of THIS project; a load failure degrades to null.
                // Loader lives at the composition root (ServerContext) by gate rule.
                reloadAgentConfig: () => ctx.reloadAgentConfig(),
                openDb,
            });
            // Read-only runtime: only getStrategy is consumed here.
            // dependencyBlocked is a selectNext seam with no server owner yet.
            const runtime = new StrategyRuntime({
                openDb,
                tasks: ctx.taskService(),
                fleet,
                dependencyBlocked: async () => null,
            });

            let members: ResolvedFleetMember[] = [];
            let missing: string[] = [];
            // 0858 R5: the declared switch rides the snapshot so the Board can name a
            // disabled fleet instead of rendering an empty roster. `false` is also the
            // truth for an absent section and for an unresolvable one (degraded).
            let fleetEnabled = false;
            let orchestrator: OrchestratorBinding = { state: 'unresolvable', reason: 'unavailable' };
            let strategy: { name: StrategyName; version: number } | null = null;
            let roles: Array<{
                name: string;
                tier: string;
                stages: string[];
                isCustom: boolean;
                electedExecutor?: string | null;
                candidateExecutors?: string[];
            }> = [];
            let executors: Array<{
                name: string;
                agent: string;
                model?: string;
                tier: string;
                disabled: boolean;
                disabledOwner?: string;
                disabledReason?: string;
                disabledSince?: string;
                installed?: boolean;
                usable?: boolean;
                version?: string | null;
                error?: string | null;
                elected?: string[];
                executionCapabilities?: Record<string, unknown>;
                sourceLayer?: 'project' | 'global';
                sourcePath?: string;
            }> = [];

            try {
                const config = await ctx.reloadAgentConfig();
                if (config?.agent) {
                    const rolesMap = resolveAgentRoles(config.agent);
                    const customRoles = config.agent.roles ?? {};
                    roles = Array.from(rolesMap.entries()).map(([name, def]) => ({
                        name,
                        tier: def.tier,
                        stages: [...def.stages],
                        isCustom: name in customRoles,
                        electedExecutor: null,
                    }));

                    const doctorMap = new Map<
                        string,
                        { installed?: boolean; version?: string | null; usable?: boolean; error?: string | null }
                    >();
                    try {
                        const doctorCacheFile = `${ctx.cwd}/.spur/run/agent-doctor.json`;
                        if (ctx.fs && (await ctx.fs.exists(doctorCacheFile))) {
                            const raw = await ctx.fs.readFile(doctorCacheFile);
                            const parsed = JSON.parse(raw);
                            if (Array.isArray(parsed?.results)) {
                                for (const item of parsed.results) {
                                    if (item?.agent) {
                                        doctorMap.set(item.agent, item);
                                    }
                                }
                            }
                        }
                    } catch {
                        // ignore doctor cache read errors
                    }

                    let projectExecutors = new Set<string>();
                    let globalExecutors = new Set<string>();
                    let layers: { project?: string; global?: string } = {};
                    try {
                        layers = resolveConfigLayers(ctx.cwd);
                        if (layers.project) {
                            projectExecutors = await getDeclaredExecutorNames(layers.project);
                        }
                        if (layers.global) {
                            globalExecutors = await getDeclaredExecutorNames(layers.global);
                        }
                    } catch {
                        // ignore layer discovery errors
                    }

                    executors = (config.agent.executors ?? []).map((ex) => {
                        const avail = normalizeExecutorAvailability(ex.disabled);
                        const doc = doctorMap.get(ex.name);
                        const installed = doc?.installed ?? !avail.disabled;
                        const usable = doc?.usable ?? !avail.disabled;
                        const version = doc?.version ?? null;
                        const error = doc?.error ?? null;
                        const isProject = projectExecutors.has(ex.name);
                        const isGlobal = globalExecutors.has(ex.name);
                        const sourceLayer: 'project' | 'global' | undefined = isProject
                            ? 'project'
                            : isGlobal
                              ? 'global'
                              : undefined;
                        const sourcePath = isProject ? layers.project : isGlobal ? layers.global : undefined;

                        return {
                            name: ex.name,
                            agent: ex.agent,
                            model: ex.model,
                            tier: ex.tier ?? 'standard',
                            disabled: avail.disabled,
                            disabledOwner: avail.owner,
                            disabledReason: avail.reason,
                            disabledSince: avail.since,
                            installed,
                            usable,
                            version,
                            error,
                            elected: [] as string[],
                            executionCapabilities: ex.executionCapabilities as Record<string, unknown> | undefined,
                            sourceLayer,
                            sourcePath,
                        };
                    });

                    // Role elections: cheapest usable executor for each role tier (doctor parity)
                    const usableSet = new Set(executors.filter((e) => !e.disabled && e.usable).map((e) => e.name));
                    const elections = new Map<string, string>();
                    const roleCandidatesMap = new Map<string, string[]>();
                    for (const [roleId, roleDef] of rolesMap) {
                        const minRank = TIER_RANK[roleDef.tier as keyof typeof TIER_RANK] ?? 0;
                        const candidates = (config.agent.executors ?? [])
                            .filter((e) => {
                                const rank = TIER_RANK[(e.tier ?? 'standard') as keyof typeof TIER_RANK] ?? 0;
                                return rank >= minRank;
                            })
                            .sort((a, b) => {
                                const rankA = TIER_RANK[(a.tier ?? 'standard') as keyof typeof TIER_RANK] ?? 0;
                                const rankB = TIER_RANK[(b.tier ?? 'standard') as keyof typeof TIER_RANK] ?? 0;
                                return rankA - rankB;
                            });
                        const winner = candidates.find((c) => usableSet.has(c.name));
                        if (winner) {
                            elections.set(roleId, winner.name);
                        }

                        // Collect candidate executors in current tier, winner first
                        let inTier = (config.agent.executors ?? []).filter(
                            (e) => (e.tier ?? 'standard') === roleDef.tier,
                        );
                        if (inTier.length === 0) {
                            inTier = candidates;
                        }
                        const winnerName = winner?.name;
                        const ordered: string[] = [];
                        if (winnerName) {
                            ordered.push(winnerName);
                        }
                        for (const ex of inTier) {
                            if (ex.name !== winnerName) {
                                ordered.push(ex.name);
                            }
                        }
                        roleCandidatesMap.set(roleId, ordered);
                    }

                    roles = roles.map((r) => ({
                        ...r,
                        electedExecutor: elections.get(r.name) ?? null,
                        candidateExecutors: roleCandidatesMap.get(r.name) ?? [],
                    }));

                    for (const ex of executors) {
                        for (const [roleId, execName] of elections.entries()) {
                            if (execName === ex.name) {
                                ex.elected?.push(roleId);
                            }
                        }
                    }
                }
            } catch {
                // Config load issues degrade gracefully (never 500)
            }

            try {
                const resolved = await fleet.resolve(path);
                members = resolved.members;
                missing = resolved.missing;
                fleetEnabled = resolved.enabled;
            } catch (err) {
                // Unreadable/invalid declaration is an environment fact, not a
                // 500 — keep FleetService's purpose-built detail (its load()
                // throw names the declaration file and every schema issue)
                // instead of flattening it to a placeholder.
                missing = [err instanceof Error ? err.message : 'unresolved'];
            }
            try {
                // Wire contract (0840 review F1): project the claim to its
                // binding fields. holderId is intentionally INCLUDED; the raw
                // ProjectClaim row is never echoed. 0841-0843 freeze on this
                // shape.
                const { state, instanceId, holderId, reason } = await fleet.resolveOrchestrator(path);
                orchestrator = { state, instanceId, holderId, reason };
            } catch {
                orchestrator = { state: 'unresolvable', reason: 'unavailable' };
            }
            try {
                strategy = await runtime.getStrategy(path);
            } catch {
                strategy = null;
            }

            return c.json({
                path,
                enabled: fleetEnabled,
                strategy,
                orchestrator,
                members,
                capacity: {
                    total: members.length,
                    enabled: members.filter((m) => m.enabled).length,
                    writeCapable: members.filter((m) => m.writeCapable).length,
                    missing,
                },
                roles,
                executors,
            });
        });

        // ── Project request receipts (0844 R1/R5) ──
        // Durable results feed for the global input: the operator's
        // `inbox_messages` rows addressed to the orchestrator, joined with the
        // delivery classification (DeliveryReconciler.classify — the PURE pass,
        // it never writes the attempts-exhausted marking) and the coordination
        // run receipt. Same mailbox selection as 0841's buildThread: rows to
        // the orchestrator instance from `board-operator`. Degraded facts are
        // named states, never a 500 — no project context or no bound
        // orchestrator returns `{ requests: [] }`.
        app.get('/api/project/requests', async (c) => {
            if (!ctx) {
                return c.json({ requests: [] });
            }
            const limitRaw = c.req.query('limit');
            const parsedLimit = limitRaw === undefined ? NaN : Number.parseInt(limitRaw, 10);
            const limit = Number.isNaN(parsedLimit) || parsedLimit < 0 ? 50 : Math.min(parsedLimit, 200);
            const path = normalizeProjectPath(ctx.cwd);
            const openDb = () => ctx.getDb();
            const fleet = new FleetService({
                fs: ctx.fs,
                // Same loader seam the /api/project/fleet route uses (0799 R3).
                reloadAgentConfig: () => ctx.reloadAgentConfig(),
                openDb,
            });
            const runtime = new StrategyRuntime({
                openDb,
                tasks: ctx.taskService(),
                fleet,
                dependencyBlocked: async () => null,
            });
            // Wire contract (0840 review F1): project the claim to its binding
            // fields; the raw project_claims row is never echoed.
            let orchestrator: OrchestratorBinding = { state: 'unresolvable', reason: 'unavailable' };
            try {
                const { state, instanceId, holderId, reason } = await fleet.resolveOrchestrator(path);
                orchestrator = { state, instanceId, holderId, reason };
            } catch {
                orchestrator = { state: 'unresolvable', reason: 'unavailable' };
            }
            const instanceId =
                orchestrator.state === 'missing' || orchestrator.state === 'unresolvable'
                    ? undefined
                    : orchestrator.instanceId;
            if (instanceId === undefined) {
                return c.json({ requests: [] });
            }

            const db = await openDb();
            const unresolved = await new DeliveryReconciler({ getDb: openDb }).classify(instanceId);
            const reasonByMessage = new Map(unresolved.map((u) => [u.messageId, u.reason]));
            const runs = new CoordinationRunDao(db);
            // Strategy holds, keyed by wbs, joined onto the request's task id
            // (0838). A selectNext failure leaves holds empty — named as null
            // on the wire, never a 500.
            const holdByTask = new Map<string, string>();
            try {
                for (const h of (await runtime.selectNext(path, { readOnly: true })).holds) {
                    holdByTask.set(h.wbs, h.reason);
                }
            } catch {
                // holds stay empty
            }

            const REQUESTED_RUN_OUTCOMES = ['run-exit-only', 'errored', 'verified'] as const;
            const requests = [];
            // Read the max page once; filter to the operator mailbox, then cap.
            for (const row of await new InboxMessageDao(db).inbox(instanceId, 200)) {
                if (row.fromId !== OPERATOR_AGENT_ID) continue;
                if (requests.length >= limit) break;
                const runRow = (await runs.listByMessageId(row.id))[0];
                requests.push({
                    messageId: row.id,
                    requestKey: row.requestKey,
                    deliveryStatus: row.status,
                    injectAttempts: row.injectAttempts,
                    injectError: row.injectError,
                    runId: runRow?.run_id ?? null,
                    taskId: runRow?.task_id ?? null,
                    outcome:
                        runRow !== undefined && REQUESTED_RUN_OUTCOMES.includes(runRow.outcome as never)
                            ? (runRow.outcome as (typeof REQUESTED_RUN_OUTCOMES)[number])
                            : null,
                    reason: reasonByMessage.get(row.id) ?? null,
                    hold:
                        runRow?.task_id !== null && runRow?.task_id !== undefined
                            ? (holdByTask.get(runRow.task_id) ?? null)
                            : null,
                });
            }
            return c.json({ requests });
        });

        // ── Multi-project list ──
        app.get('/api/projects', async (c) => {
            if (!ctx) {
                return c.json({ projects: [] });
            }
            const registry = new ProjectRegistry();
            const rawProjects = await registry.list();
            const currentNorm = normalizeProjectPath(ctx.cwd);

            const projects = await Promise.all(
                rawProjects.map(async (p) => {
                    const normPath = normalizeProjectPath(p.path);
                    const running = p.port > 0 ? await isPortLive(p.port) : false;
                    return {
                        name: p.name,
                        path: p.path,
                        port: p.port,
                        running,
                        current: normPath === currentNorm,
                    };
                }),
            );

            return c.json({ projects });
        });

        // ── Multi-project start ──
        app.post('/api/projects/start', async (c) => {
            if (!ctx) {
                return c.json({ error: 'Multi-project registry unavailable on Cloudflare Workers' }, 501);
            }
            let body: { name?: string; path?: string } = {};
            try {
                body = await c.req.json();
            } catch {
                // Empty body tolerated if target passed via path query
            }

            const target = body.name ?? body.path;
            if (!target) {
                return c.json({ error: 'Missing name or path in request body' }, 400);
            }

            try {
                const registry = new ProjectRegistry();
                const result = await startRegisteredProject(registry, target);
                return c.json({
                    name: result.name,
                    path: result.path,
                    port: result.port,
                    running: true,
                    alreadyRunning: result.alreadyRunning,
                    url: result.url,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                const status = message.includes('not found') ? 404 : 500;
                return c.json({ error: message }, status);
            }
        });

        // ── Agent executor availability toggle (Ready / Disabled) ──
        app.post('/api/project/executors/availability', async (c) => {
            if (!ctx) {
                return c.json({ error: 'Executor availability updates unavailable on Cloudflare Workers' }, 501);
            }
            let body: { name?: string; executor?: string; disabled?: boolean; layer?: 'project' | 'global' } = {};
            try {
                body = await c.req.json();
            } catch {
                return c.json({ error: 'Invalid JSON request body' }, 400);
            }

            const executorName = body.name ?? body.executor;
            if (!executorName || typeof executorName !== 'string' || executorName.trim().length === 0) {
                return c.json({ error: 'Missing or invalid executor name' }, 400);
            }
            if (typeof body.disabled !== 'boolean') {
                return c.json({ error: 'Missing or non-boolean "disabled" field' }, 400);
            }

            try {
                const layers = resolveConfigLayers(ctx.cwd);
                const isProject = layers.project ? await declaresExecutor(layers.project, executorName) : false;

                const targetLayer: 'project' | 'global' = body.layer ?? (isProject ? 'project' : 'global');
                const targetPath = targetLayer === 'project' ? layers.project : layers.global;

                const result = await setExecutorAvailability({
                    layer: targetLayer,
                    projectRoot: ctx.cwd,
                    executor: executorName,
                    disabled: body.disabled,
                });

                if (result.status === 'unchanged' && result.reason === 'missing-executor') {
                    return c.json(
                        {
                            error: `Executor "${executorName}" not declared in ${targetLayer} config`,
                            reason: result.reason,
                        },
                        404,
                    );
                }

                if (result.status === 'updated') {
                    await ctx.reloadAgentConfig();
                }

                return c.json({
                    ok: true,
                    status: result.status,
                    reason: 'reason' in result ? result.reason : undefined,
                    targetLayer,
                    targetPath,
                });
            } catch (err) {
                if (err instanceof ExecutorUpdateError) {
                    const status = err.code === 'CONFIG_CONFLICT' ? 409 : 400;
                    return c.json({ error: err.message, code: err.code }, status);
                }
                const message = err instanceof Error ? err.message : String(err);
                return c.json({ error: message }, 500);
            }
        });
    },
};
