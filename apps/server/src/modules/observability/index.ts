import {
    AgentTraceService,
    DecisionLogQueryService,
    type DecisionLogQuerySpec,
    InvalidWorkflowRunIdError,
    summarizeProjectOutcome,
    type ToolUseEvent,
} from '@gobing-ai/spur-app';
import type { ObservabilitySummaryResponse } from '@gobing-ai/spur-contracts';
import {
    CoordinationRunDao,
    DecisionLogDao,
    queueJobKpis,
    type RoutingSummaryQuery,
    RunDao,
    roleTokenSummary,
} from '@gobing-ai/spur-domain';
import type { Context, Hono } from 'hono';
import type { ServerContext } from '../../context';
import { enqueueSseFrame, sendSseKeepalive } from '../sse/stream-helpers';
import type { ServerModule } from '../types';

/** Process-local ledger watcher (lazy, shared across SSE clients). */
interface LedgerWatcher {
    stop(): void;
    start(): void;
    subscribe(listener: (event: Omit<ToolUseEvent, 'seq'>) => void): () => void;
    pollNewBytes(): void;
}

let ledgerWatcher: LedgerWatcher | undefined;
let ledgerWatcherLoad: Promise<LedgerWatcher> | undefined;
let watcherPath: string | undefined;

/**
 * Lazy shared watcher for the ledger path (tests may call
 * {@link TokenLedgerWatcher.pollNewBytes} on the returned instance).
 */
export async function getLedgerWatcher(path: string): Promise<LedgerWatcher> {
    if (watcherPath === path) {
        if (ledgerWatcher) return ledgerWatcher;
        if (ledgerWatcherLoad) return ledgerWatcherLoad;
    }

    ledgerWatcher?.stop();
    ledgerWatcher = undefined;
    watcherPath = path;

    // Node-only implementation: defer loading node:fs until a local server
    // actually opens the ledger SSE route. Worker bootstrap never loads it.
    const load = import('@gobing-ai/spur-app').then(({ TokenLedgerWatcher }) => {
        const watcher = new TokenLedgerWatcher({ ledgerPath: path });
        watcher.start();
        return watcher;
    });
    ledgerWatcherLoad = load;

    const watcher = await load;
    if (watcherPath === path && ledgerWatcherLoad === load) {
        ledgerWatcher = watcher;
        ledgerWatcherLoad = undefined;
    } else {
        watcher.stop();
    }
    return watcher;
}

/** Test helper: drop the process-local watcher so the next stream bind is clean. */
export function resetLedgerWatcherForTests(): void {
    try {
        ledgerWatcher?.stop();
    } catch {
        /* ignore */
    }
    ledgerWatcher = undefined;
    ledgerWatcherLoad = undefined;
    watcherPath = undefined;
}

/** SSE payload for one ledger append (pure — unit-testable). */
export function toolUseSsePayload(event: Omit<ToolUseEvent, 'seq'>): {
    type: 'tool-use';
    occurredAt: string;
    event: Omit<ToolUseEvent, 'seq'>;
} {
    return {
        type: 'tool-use',
        occurredAt: event.ts,
        event,
    };
}

function handleProcesses(ctx: ServerContext) {
    return async (c: Context) => {
        try {
            const snapshot = await ctx.processInventory().snapshot();
            return c.json(snapshot);
        } catch (err) {
            if (err instanceof Error && 'code' in err && err.code === 'UNSUPPORTED_PLATFORM') {
                return c.json({ error: err.message, code: err.code }, 501);
            }
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 500);
        }
    };
}

function handleToolUseGet(ctx: ServerContext) {
    return (c: Context) => {
        try {
            const limitParam = c.req.query('limit');
            let limitRaw: number | undefined;
            if (limitParam !== undefined) {
                const parsed = Number.parseInt(limitParam, 10);
                if (!Number.isNaN(parsed)) limitRaw = parsed;
            }
            const before = c.req.query('before') ?? undefined;
            const limit =
                limitRaw === undefined || !Number.isFinite(limitRaw) || limitRaw <= 0 ? 200 : Math.min(limitRaw, 1000);
            const snapshot = ctx.tokenLedger().snapshot({ limit, before });
            return c.json(snapshot);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 500);
        }
    };
}

function handleToolUseStream(ctx: ServerContext) {
    return (c: Context) => {
        const closed = { current: false };
        let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
        let unsubscribe: (() => void) | undefined;
        const signal = c.req.raw.signal;
        let closeController = () => {
            /* set in start */
        };

        const teardown = () => {
            if (closed.current) return;
            closed.current = true;
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            try {
                unsubscribe?.();
            } catch {
                /* ignore */
            }
            signal.removeEventListener('abort', teardown);
            closeController();
        };

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                closeController = () => {
                    try {
                        controller.close();
                    } catch {
                        /* already closed */
                    }
                };

                if (signal.aborted) {
                    teardown();
                    return;
                }
                signal.addEventListener('abort', teardown);

                heartbeatInterval = setInterval(sendSseKeepalive, 15_000, closed, controller, encoder);

                try {
                    const path = ctx.tokenLedger().path;
                    const watcher = await getLedgerWatcher(path);
                    unsubscribe = watcher.subscribe((event) => {
                        // On backpressure / closed controller, enqueue returns false — tear down.
                        if (!enqueueSseFrame(closed, controller, encoder, toolUseSsePayload(event))) teardown();
                    });
                    enqueueSseFrame(closed, controller, encoder, {
                        type: 'connected',
                        occurredAt: new Date().toISOString(),
                    });
                } catch {
                    enqueueSseFrame(closed, controller, encoder, {
                        type: 'error',
                        error: 'ledger watch unavailable',
                        occurredAt: new Date().toISOString(),
                    });
                }
            },
            cancel() {
                teardown();
            },
        });

        return c.newResponse(stream, 200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
        });
    };
}

/**
 * Routing + token aggregates for the Board (task 0552).
 *
 * Composes the two J6 queries — `SystemEventDao.routingSummary` (0546) and
 * `roleTokenSummary` (0547) — with no query of its own. `since`/`until` are
 * forwarded as-is; the domain surfaces apply their own bounded defaults, so
 * the route holds no window logic to drift.
 *
 * ADR-005 §4 type seam (mirrors `setFetchForTesting` in the web rpc-client):
 * the indirection lets the module tests stub the domain fold instead of
 * running it against a scratch DB — the fold itself is already covered by the
 * domain package's suite.
 */
let loadRoleTokenSummary: typeof roleTokenSummary = roleTokenSummary;

/** Test seam: replace the role-token fold (ADR-005 §4). */
export function setRoleTokenSummaryForTesting(fn: typeof roleTokenSummary): void {
    loadRoleTokenSummary = fn;
}

/** Resets the seam to the production domain surface. */
export function resetRoleTokenSummaryForTesting(): void {
    loadRoleTokenSummary = roleTokenSummary;
}

/** Task 1100: parse `GET /api/observability/decisions` query params; null ⇒ respond 400. */
function parseDecisionLogQuery(c: Context): DecisionLogQuerySpec | null {
    const invalid = (param: string, value: string, expected: string): string =>
        `invalid ${param}: "${value}" — expected ${expected}`;
    const spec: DecisionLogQuerySpec = {};
    const since = c.req.query('since');
    if (since !== undefined && since !== '') spec.since = since;
    const decisionId = c.req.query('decision');
    if (decisionId !== undefined && decisionId !== '') spec.decisionId = decisionId;
    const maker = c.req.query('maker');
    if (maker !== undefined && maker !== '') spec.maker = maker;
    const runId = c.req.query('run');
    if (runId !== undefined && runId !== '') spec.runId = runId;
    const before = c.req.query('before');
    if (before !== undefined && before !== '') spec.before = before;
    const outcome = c.req.query('outcome');
    if (outcome !== undefined && outcome !== '') {
        if (outcome !== 'accepted' && outcome !== 'fallback' && outcome !== 'rejected') {
            throw new Error(invalid('outcome', outcome, 'accepted | fallback | rejected'));
        }
        spec.outcome = outcome;
    }
    const caller = c.req.query('caller');
    if (caller !== undefined && caller !== '') {
        if (caller !== 'cli' && caller !== 'workflow' && caller !== 'gate') {
            throw new Error(invalid('caller', caller, 'cli | workflow | gate'));
        }
        spec.caller = caller;
    }
    const limitParam = c.req.query('limit');
    if (limitParam !== undefined && limitParam !== '') {
        const limit = Number(limitParam);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
            throw new Error(invalid('limit', limitParam, 'an integer between 1 and 200'));
        }
        spec.limit = limit;
    }
    return spec;
}

function handleDecisionLogs(ctx: ServerContext) {
    return async (c: Context) => {
        try {
            const spec = parseDecisionLogQuery(c);
            const service = new DecisionLogQueryService(new DecisionLogDao(await ctx.getDb()));
            return c.json(await service.list(spec ?? {}));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, message.startsWith('invalid ') ? 400 : 500);
        }
    };
}

function handleDecisionLogDetail(ctx: ServerContext) {
    return async (c: Context) => {
        const id = c.req.param('id');
        if (id === undefined || id === '') return c.json({ error: 'missing decision log id' }, 400);
        try {
            const service = new DecisionLogQueryService(new DecisionLogDao(await ctx.getDb()));
            const row = await service.get(id);
            if (row === null) return c.json({ error: `decision log row not found: ${id}` }, 404);
            return c.json(row);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 500);
        }
    };
}

function handleRoutingSummary(ctx: ServerContext) {
    return async (c: Context) => {
        try {
            const since = c.req.query('since') ?? undefined;
            const until = c.req.query('until') ?? undefined;
            const spec: RoutingSummaryQuery = { since, until };
            const dao = await ctx.systemEventDao();
            const db = await ctx.getDb();
            const [routing, tokens] = await Promise.all([dao.routingSummary(spec), loadRoleTokenSummary(db, spec)]);
            return c.json({ routing, tokens });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 500);
        }
    };
}

function handleObservabilitySummary(ctx: ServerContext) {
    return async (c: Context) => {
        try {
            const sinceParam = c.req.query('since');
            const untilParam = c.req.query('until');
            const bucketParam = c.req.query('bucket');

            let untilMs = Date.now();
            if (untilParam !== undefined && untilParam !== '') {
                untilMs = Date.parse(untilParam);
                if (Number.isNaN(untilMs)) {
                    return c.json(
                        {
                            error: `malformed until: "${untilParam}" is not a valid ISO timestamp`,
                            code: 'MALFORMED_TIMESTAMP',
                        },
                        400,
                    );
                }
            }

            let sinceMs = untilMs - 4 * 60 * 60_000;
            if (sinceParam !== undefined && sinceParam !== '') {
                sinceMs = Date.parse(sinceParam);
                if (Number.isNaN(sinceMs)) {
                    return c.json(
                        {
                            error: `malformed since: "${sinceParam}" is not a valid ISO timestamp`,
                            code: 'MALFORMED_TIMESTAMP',
                        },
                        400,
                    );
                }
            }

            if (untilMs < sinceMs) {
                return c.json(
                    {
                        error: 'until timestamp must not precede since timestamp',
                        code: 'MALFORMED_RANGE',
                    },
                    400,
                );
            }

            let bucketMs: number | undefined;
            if (bucketParam !== undefined && bucketParam !== '') {
                const parsed = Number(bucketParam);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    bucketMs = parsed;
                }
            }

            const since = new Date(sinceMs).toISOString();
            const until = new Date(untilMs).toISOString();

            const dao = await ctx.systemEventDao();
            const db = await ctx.getDb();
            const decisionDao = new DecisionLogDao(db);

            const [eventSummary, jobKpis, decisionBuckets] = await Promise.all([
                dao.eventSummary({ since, until, bucketMs }),
                queueJobKpis(db, sinceMs, untilMs),
                decisionDao.volumeBuckets({ since, until, bucketMs }).catch(() => []),
            ]);

            let outcomes: ObservabilitySummaryResponse['outcomes'];
            try {
                const corpus =
                    ctx.cwd && ctx.fs
                        ? {
                              cwd: ctx.cwd,
                              fs: ctx.fs,
                              locator:
                                  typeof ctx.taskService === 'function'
                                      ? {
                                            findByWbs: async (wbs: string) => {
                                                const filePath = await ctx.taskService().getFilePath(wbs);
                                                return filePath === null ? null : { filePath };
                                            },
                                        }
                                      : undefined,
                          }
                        : {};
                outcomes = await summarizeProjectOutcome({ db, ...corpus }, { since, until });
            } catch {
                outcomes = undefined;
            }

            const combinedErrors = [
                ...eventSummary.recentErrors.map((e) => ({
                    id: e.id,
                    source: 'event' as const,
                    name: e.name,
                    occurredAt: e.occurredAt,
                    message: e.message,
                    ...(e.refId ? { refId: e.refId } : {}),
                })),
                ...jobKpis.recentJobErrors.map((j) => ({
                    id: j.id,
                    source: 'job' as const,
                    name: j.name,
                    occurredAt: j.occurredAt,
                    message: j.message,
                })),
            ]
                .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
                .slice(0, 10);

            const payload: ObservabilitySummaryResponse = {
                window: {
                    since,
                    until,
                    range: c.req.query('range') ?? 'custom',
                },
                kpis: {
                    totalEvents: eventSummary.totalEvents,
                    activeJobs: jobKpis.activeJobs,
                    completedJobs: jobKpis.completedJobs,
                    failedJobs: jobKpis.failedJobs,
                    successRatePct: jobKpis.successRatePct,
                    errorEventCount: eventSummary.errorEventCount,
                    warningEventCount: eventSummary.warningEventCount,
                },
                eventVolumeBuckets: eventSummary.eventVolumeBuckets,
                decisionVolumeBuckets: decisionBuckets,
                topEventTypes: eventSummary.topEventTypes,
                recentErrors: combinedErrors,
                ...(outcomes ? { outcomes } : {}),
            };

            return c.json(payload);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 500);
        }
    };
}

/**
 * Observability HTTP surfaces (tasks 0243, 0245–0247, 0552, 0789).
 *
 * - GET /api/observability/processes — serve-rooted process inventory
 * - GET /api/observability/tool-use — token-ledger tail (+ cursor `before`)
 * - GET /api/observability/tool-use/stream — SSE live appends (fs.watch)
 * - GET /api/observability/routing-summary — routing aggregate + per-role token totals (0552)
 * - GET /api/observability/summary — summary aggregations, KPIs, volume buckets (0789)
 * - GET /api/observability/decisions — decision-log list: rows, KPI strip, facets, cursor `before` (1100)
 * - GET /api/observability/decisions/:id — one decision-log row incl. redacted input and phases (1100)
 */
/** Run ids in this store are UUIDs; anything else cannot name one, so it is refused before a read. */
const RUN_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The exact-run lineage the Board's Trace tab renders (1440 R3): identity and shape only. Log paths,
 * session ids and message contents are deliberately dropped — the deep link answers "which run is
 * this and what did it dispatch", not "show me its transcript".
 */
export interface AgentTraceNodeView {
    runId: string;
    kind: 'workflow' | 'agent';
    status: string;
    parentRunId: string | null;
}

/** The wire shape of `GET /api/observability/agent-trace/:runId`. */
export interface AgentTraceResponse {
    rootRunId: string;
    requestedRunId: string;
    nodes: AgentTraceNodeView[];
}

/** Project a {@link TraceTree} down to the display shape above. */
export function projectAgentTrace(
    tree: { rootRunId: string; nodes: AgentTraceNodeView[] },
    runId: string,
): AgentTraceResponse {
    return {
        rootRunId: tree.rootRunId,
        requestedRunId: runId,
        nodes: tree.nodes.map((node) => ({
            runId: node.runId,
            kind: node.kind,
            status: node.status,
            parentRunId: node.parentRunId,
        })),
    };
}

/** The observability module: read-only process/tool-use/decision/run-record and exact-run trace routes. */
export const observabilityModule: ServerModule = {
    name: 'observability',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        app.get('/api/observability/processes', handleProcesses(ctx));
        app.get('/api/observability/tool-use', handleToolUseGet(ctx));
        app.get('/api/observability/tool-use/stream', handleToolUseStream(ctx));
        app.get('/api/observability/routing-summary', handleRoutingSummary(ctx));
        // Task 1100: decision-log reads for the Board Decisions tab. Reads recorded rows
        // only — never calls a maker; identical reads tolerate a pre-migration DB via the DAO.
        app.get('/api/observability/decisions', handleDecisionLogs(ctx));
        app.get('/api/observability/decisions/:id', handleDecisionLogDetail(ctx));
        app.get('/api/observability/summary', handleObservabilitySummary(ctx));
        // GET /api/observability/run-record/:runId — bounded, confined run-record
        // inspection for the Tasks run detail (0929 R1/R2). Read-only; text is
        // re-redacted and capped in the application layer before it is served.
        app.get('/api/observability/run-record/:runId', (c) => {
            const runId = c.req.param('runId');
            try {
                return c.json(ctx.workflowService().inspectRunRecord(runId));
            } catch (err) {
                // Map the typed seam error, not its message text (0948 R5). A
                // wording change must not turn this 400 into a 500.
                if (err instanceof InvalidWorkflowRunIdError) {
                    return c.json({ error: err.message, code: err.code, runId }, 400);
                }
                throw err;
            }
        });
        // GET /api/observability/agent-trace/:runId — the exact run a deep link names (1440 R3).
        // Read-only lineage over `runs`/`coordination_runs`, no remote refresh adapter: the Board must
        // open an older run without the trace layer reaching out to an A2A peer.
        app.get('/api/observability/agent-trace/:runId', async (c) => {
            const runId = c.req.param('runId');
            if (!RUN_ID_UUID.test(runId)) {
                return c.json({ error: 'runId must be a UUID', code: 'invalid-run-id', runId }, 400);
            }
            const service = new AgentTraceService({ projectPath: ctx.cwd, openDb: () => ctx.getDb() });
            const tree = await service.trace(runId);
            // `trace` synthesizes a placeholder node for an id it cannot find, so existence is asked
            // of the store directly — a dead link must say 404, not render an "unknown" run.
            const db = await ctx.getDb();
            const known =
                (await new CoordinationRunDao(db).getByRunId(runId)) !== null ||
                (await new RunDao(db).findById(runId)) != null;
            if (!known) {
                return c.json({ error: `no run ${runId}`, code: 'run-not-found', runId }, 404);
            }
            return c.json(projectAgentTrace(tree, runId));
        });
    },
};
