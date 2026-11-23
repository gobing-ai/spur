import { join } from 'node:path';
import {
    FleetService,
    type InboxMessage,
    type InboxService,
    normalizeProjectPath,
    ProjectRegistry,
    RequestKeyConflictError,
} from '@gobing-ai/spur-app';
import { buildConfigFromEnv, isLocalHost, resolveProjectGatewayUrl } from '@gobing-ai/spur-config';
import { CoordinationRunDao, type CoordinationRunRow } from '@gobing-ai/spur-domain';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import { bearerEnv, bearerGuard } from '../../middleware/bearer-guard';
import type { ServerModule } from '../types';
import { type A2ATask, a2aError, agentCard, cardOrigin, projectState, textParts } from './projection';

/**
 * `spur self serve` speaks A2A (feature G9, task 1336; ADR-148, design `a2a-member-transport` §3.5).
 *
 * A thin facade over the existing services — no new table and no second inbox writer (ADR-143):
 * each enabled fleet member is published as an Agent Card, `SendMessage` becomes ONE keyed inbox
 * request (`messageId` → request key), `GetTask` reads the `coordination_runs` receipt, and
 * `CancelTask` stops the member's run through the supervisor's existing stop path. The inbox and
 * the run rows are the task store, which is what makes a task survive a `spur self serve` restart.
 *
 * Off by default (R1): with `server.a2a.enabled` false no route is mounted at all, so the four
 * paths below answer 404 like any other unknown path.
 */

/** The sender identity an A2A-originated request carries; callers read state, never replies. */
const A2A_SENDER = 'a2a';

/** Paths, as the HTTP+JSON binding defines them (`google.api.http` annotations of a2a.proto). */
const CARD_SUFFIX = '.well-known/agent-card.json';
const SEND_PATH = 'message:send';
const CANCEL_SUFFIX = ':cancel';

/** The canonical gateway base for a direct-root card, or undefined when no local prefix exists. */
function localCardOrigin(ctx: ServerContext): string | undefined {
    const entry = new ProjectRegistry()
        .peek()
        .projects.find(
            (candidate) =>
                isLocalHost(candidate.host) && normalizeProjectPath(candidate.path) === normalizeProjectPath(ctx.cwd),
        );
    if (entry === undefined) return undefined;
    const server = buildConfigFromEnv(bearerEnv(ctx)).server;
    return resolveProjectGatewayUrl(entry, { host: server.host, port: server.gateway.port }, '') ?? undefined;
}

/** The fleet seam the inbox module uses: an injected `fleetService()` wins, else resolve locally. */
interface FleetSeams {
    memberAddresses(
        projectPath: string,
    ): Promise<
        { instanceId: string; localId?: string; executor: string; enabled: boolean; role?: string; purpose?: string }[]
    >;
}

function fleetOver(ctx: ServerContext): FleetSeams {
    const injected = (ctx as unknown as { fleetService?: () => FleetSeams }).fleetService;
    if (typeof injected === 'function') return injected.call(ctx);
    return new FleetService({
        fs: ctx.fs,
        reloadAgentConfig: () => ctx.reloadAgentConfig(),
        openDb: () => ctx.getDb(),
    });
}

/** The listener switch and the NAME of the variable holding its token (never the value). */
function a2aSettings(ctx: ServerContext): { enabled: boolean; authEnv: string | null } {
    // Embedded/test contexts may omit bootConfig; that is the default-off case, never a crash.
    const a2a = typeof ctx.bootConfig === 'function' ? ctx.bootConfig()?.a2a : undefined;
    return { enabled: a2a?.enabled === true, authEnv: a2a?.authEnv ?? null };
}

/** The live member a path segment addresses — by inbox address, or by its local id suffix. */
async function resolveMember(ctx: ServerContext, segment: string | undefined) {
    if (segment === undefined || segment === '') return null;
    const members = await fleetOver(ctx).memberAddresses(ctx.cwd);
    const decode = (value: string) => {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    };
    const wanted = decode(segment);
    return (
        members.find((member) => member.enabled && member.instanceId === wanted) ??
        members.find((member) => member.enabled && member.instanceId.endsWith(`-${wanted}`)) ??
        null
    );
}

/** Newest run row for one message id: the receipt the A2A task state is read from (R4). */
async function latestRun(ctx: ServerContext, messageId: string): Promise<CoordinationRunRow | null> {
    const rows = await new CoordinationRunDao(await ctx.getDb()).listByMessageId(messageId);
    const sorted = [...rows].sort((a, b) =>
        a.started_at === b.started_at ? b.generation - a.generation : a.started_at < b.started_at ? 1 : -1,
    );
    return sorted[0] ?? null;
}

/** The member's answer: its newest reply on this thread (cancellation is a separate marker). */
async function answerText(inbox: InboxService, messageId: string): Promise<string | null> {
    const thread = await inbox.thread(messageId);
    const reply = thread.filter((row) => row.inReplyTo === messageId && row.fromId !== A2A_SENDER).at(-1);
    return reply === undefined ? null : reply.body;
}

/** A cancel intent, written before the request so a restart still reads `canceled` (R4/R5). */
function cancelMarkerPath(ctx: ServerContext, messageId: string): string {
    return join(ctx.runDir, `a2a-canceled-${messageId}`);
}

/** How long the cancel response waits for the run row to leave `running` (1422 R3). */
const CANCEL_WAIT_MS = 10_000;

/** How often that wait re-reads the coordination row (1422 R3; the member polls at 1s). */
const CANCEL_POLL_MS = 250;

/** The per-run marker a live drain polls; the run id makes it impossible to abort a later run. */
function cancelRequestPath(ctx: ServerContext, runId: string): string {
    return join(ctx.runDir, runId, 'cancel-requested');
}

/**
 * Ask ONE run to stop (1422 R2/R3): write its `cancel-requested` marker, then wait — bounded — for
 * its coordination row to leave `running`. Nothing here touches the member process, so the loop
 * keeps running and claims its next request; `false` means the row did not clear in time.
 */
async function requestRunCancel(ctx: ServerContext, runId: string, messageId: string): Promise<boolean> {
    try {
        const marker = cancelRequestPath(ctx, runId);
        await ctx.fs.ensureDir(join(ctx.runDir, runId));
        await ctx.fs.writeFile(marker, `${new Date().toISOString()}\n`);
    } catch (error) {
        ctx.logger.warn('a2a cancel: cannot write the per-run cancel marker', { runId, error: String(error) });
        return false;
    }
    const deadline = Date.now() + CANCEL_WAIT_MS;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, CANCEL_POLL_MS));
        const row = await latestRun(ctx, messageId);
        if (row === null || row.run_id !== runId || row.status !== 'running') return true;
    }
    return false;
}

async function readCanceled(ctx: ServerContext, messageId: string): Promise<boolean> {
    try {
        return (await ctx.fs.exists(cancelMarkerPath(ctx, messageId))) === true;
    } catch {
        return false;
    }
}

/** The member's current working branch, exposed only on completed tasks (1337 R4, 1421 R5). */
async function remoteBranch(ctx: ServerContext, runId: string | undefined): Promise<string | null> {
    try {
        if (runId !== undefined) {
            const path = join(ctx.runDir, runId, 'a2a-branch');
            if (await ctx.fs.exists(path)) {
                const branch = (await ctx.fs.readFile(path)).trim();
                if (branch !== '') return branch;
            }
        }
        const result = await new NodeProcessExecutor().run({
            command: 'git',
            args: ['branch', '--show-current'],
            cwd: ctx.cwd,
            timeout: 5_000,
            rejectOnError: false,
        });
        if (result.exitCode !== 0) return null;
        const branch = result.stdout.trim();
        return branch === '' ? null : branch;
    } catch {
        return null;
    }
}

/** Project one inbox request onto the A2A `Task` object. */
async function projectTask(ctx: ServerContext, inbox: InboxService, message: InboxMessage): Promise<A2ATask> {
    const run = await latestRun(ctx, message.id);
    const state = projectState({
        canceled: await readCanceled(ctx, message.id),
        runStatus: (run?.status as 'running' | 'exited' | 'errored' | undefined) ?? null,
        messageStatus: message.status,
    });
    const history = [
        { messageId: message.requestKey ?? message.id, role: 'ROLE_USER' as const, parts: [{ text: message.body }] },
    ];
    const status: A2ATask['status'] = { state };
    if (state === 'TASK_STATE_FAILED') {
        const reason =
            message.error ?? (run?.status === 'errored' ? 'the member run failed' : 'the member run did not complete');
        status.message = { messageId: message.id, role: 'ROLE_AGENT', parts: [{ text: reason }] };
    }
    if (state === 'TASK_STATE_COMPLETED' || state === 'TASK_STATE_CANCELED') {
        const timestamp = run?.completed_at;
        if (typeof timestamp === 'string') status.timestamp = timestamp;
    }
    const answer = state === 'TASK_STATE_COMPLETED' ? await answerText(inbox, message.id) : null;
    const branch = state === 'TASK_STATE_COMPLETED' ? await remoteBranch(ctx, run?.run_id) : null;
    return {
        id: message.id,
        contextId: message.threadId,
        status,
        ...(answer === null ? {} : { artifacts: [{ artifactId: `${message.id}-answer`, parts: [{ text: answer }] }] }),
        ...(branch === null ? {} : { metadata: { remoteBranch: branch } }),
        history,
    };
}

/** Read the JSON body, mapping a malformed one to `null` (the caller answers INVALID_ARGUMENT). */
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
    try {
        const body = await c.req.json();
        return typeof body === 'object' && body !== null && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/** The A2A listener module: mounts nothing unless `server.a2a.enabled` is on (R1). */
export const a2aModule: ServerModule = {
    name: 'a2a',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;
        const settings = a2aSettings(ctx);
        // R1: off by default. No route, no handler, no path — the surface does not exist.
        if (!settings.enabled) return;
        // R6: every route below the card is bearer-only, and the check precedes any write — the
        // shared guard (task 1375) carries the a2a realm and envelope; this module keeps the
        // mount-time warning and the per-route call. 1421 R3: the Agent Card is the ONE public
        // route, because a client must discover a member before it holds a token; nothing else
        // may skip `authorize`.
        const guard = bearerGuard({
            realm: 'spur-a2a',
            authEnv: settings.authEnv,
            env: bearerEnv(ctx),
            unauthenticated: () => a2aError(401, 'UNAUTHENTICATED', 'a bearer token is required'),
            unconfigured: () =>
                a2aError(
                    500,
                    'INTERNAL',
                    'the A2A listener has no token configured; set the variable named by server.a2a.authEnv',
                ),
            // 1376 R4: one shared refusal event across both surfaces — no token material.
            onDenied: ({ reason, path }) => {
                // A partial context (test slice, older embedding) may carry no bus; observability
                // must never turn a 401 into a 500.
                ctx.eventBus?.()?.emit('auth.denied', { surface: 'a2a', reason, path });
            },
        });
        // Enabled with an unreadable token variable is a misconfiguration, and mounting a surface
        // that refuses everyone is still better than a 404 the operator cannot tell from "off".
        if (guard.configured === false) {
            ctx.logger.warn('a2a listener enabled but its token variable is unset; every request will be refused', {
                variable: settings.authEnv ?? '(server.a2a.authEnv is not configured)',
            });
        }
        const authorize = guard.authorize;
        const inbox = ctx.inbox();

        app.get(`/a2a/members/:member/${CARD_SUFFIX}`, async (c) => {
            // 1421 R3: public by design (the one route with no `authorize`). It exposes only
            // declared identity — never a token value, a run state or a message body.
            const member = await resolveMember(ctx, c.req.param('member'));
            if (member === null) return notFoundMember(c.req.param('member'));
            return c.json(
                agentCard({
                    instanceId: member.instanceId,
                    executor: member.executor ?? '',
                    origin: cardOrigin(
                        {
                            host: c.req.header('x-forwarded-host'),
                            prefix: c.req.header('x-forwarded-prefix'),
                            proto: c.req.header('x-forwarded-proto'),
                        },
                        localCardOrigin(ctx) ?? new URL(c.req.url).origin,
                    ),
                    ...(member.role === undefined ? {} : { role: member.role }),
                    ...(member.purpose === undefined ? {} : { purpose: member.purpose }),
                }),
            );
        });

        app.post(`/a2a/members/:member/${SEND_PATH}`, async (c) => {
            const denied = authorize(c);
            if (denied !== null) return denied;
            const member = await resolveMember(ctx, c.req.param('member'));
            if (member === null) return notFoundMember(c.req.param('member'));
            const body = await readJson(c);
            const message = body?.message as Record<string, unknown> | undefined;
            const messageId = typeof message?.messageId === 'string' ? message.messageId.trim() : '';
            const text = textParts(message?.parts);
            if (messageId === '' || text === '') {
                return c.json(
                    a2aError(400, 'INVALID_ARGUMENT', 'message.messageId and at least one text part are required'),
                    400,
                );
            }
            try {
                const sent = await inbox.send({
                    from: A2A_SENDER,
                    to: member.instanceId,
                    body: text,
                    kind: 'request',
                    requestKey: `a2a:${member.instanceId}:${messageId}`,
                });
                // 1377 R2/R4: ids and the inbox's own dedup truth only — never the body text.
                ctx.eventBus().emit('a2a.message.received', {
                    member: member.instanceId,
                    messageId,
                    requestKey: `a2a:${member.instanceId}:${messageId}`,
                    outcome: sent.replayed ? 'replayed' : 'accepted',
                    inboxMessageId: sent.message.id,
                });
                return c.json({ task: await projectTask(ctx, inbox, sent.message) });
            } catch (error) {
                if (error instanceof RequestKeyConflictError) {
                    // A replay is a benign client retry; a conflict is a client bug — distinct signals.
                    ctx.eventBus().emit('a2a.message.received', {
                        member: member.instanceId,
                        messageId,
                        requestKey: `a2a:${member.instanceId}:${messageId}`,
                        outcome: 'conflict',
                    });
                    return c.json(
                        a2aError(409, 'ALREADY_EXISTS', error.message, {
                            reason: 'REQUEST_KEY_CONFLICT',
                            metadata: { messageId },
                        }),
                        409,
                    );
                }
                throw error;
            }
        });

        app.get('/a2a/members/:member/tasks/:id', async (c) => {
            const denied = authorize(c);
            if (denied !== null) return denied;
            const member = await resolveMember(ctx, c.req.param('member'));
            if (member === null) return notFoundMember(c.req.param('member'));
            const message = await inbox.get(c.req.param('id'));
            if (message === null || message.toId !== member.instanceId) return notFoundTask(c.req.param('id'));
            return c.json(await projectTask(ctx, inbox, message));
        });

        // `POST /tasks/{id}:cancel` — the trailing `:cancel` is a literal of the A2A binding, so
        // the whole `{id}:cancel` token arrives as one segment.
        app.post('/a2a/members/:member/tasks/:target', async (c) => {
            const denied = authorize(c);
            if (denied !== null) return denied;
            const member = await resolveMember(ctx, c.req.param('member'));
            if (member === null) return notFoundMember(c.req.param('member'));
            const target = c.req.param('target');
            if (!target.endsWith(CANCEL_SUFFIX)) return notFoundTask(target);
            const taskId = target.slice(0, -CANCEL_SUFFIX.length);
            const message = await inbox.get(taskId);
            if (message === null || message.toId !== member.instanceId) return notFoundTask(taskId);
            const before = await projectTask(ctx, inbox, message);
            const run = await latestRun(ctx, taskId);
            // Only a RUNNING run can be stopped (1422 R1). A queued request has no child to signal,
            // and the member loop owns claiming it — recording a cancel intent would promise a stop
            // we cannot deliver, so it is refused instead of faked.
            if (before.status.state !== 'TASK_STATE_WORKING' || run === null || run.status !== 'running') {
                return c.json(
                    a2aError(
                        400,
                        'FAILED_PRECONDITION',
                        `task ${taskId} has no run in progress (${before.status.state})`,
                        {
                            reason: 'TASK_NOT_CANCELABLE',
                            metadata: { taskId, state: before.status.state },
                        },
                    ),
                    400,
                );
            }
            // Intent first (durable, survives a restart), then the per-run request (R2).
            const marker = cancelMarkerPath(ctx, taskId);
            try {
                await ctx.fs.ensureDir(ctx.runDir);
                await ctx.fs.writeFile(marker, `${new Date().toISOString()} ${member.instanceId}\n`);
            } catch (error) {
                return c.json(a2aError(500, 'INTERNAL', `cannot record the cancel: ${String(error)}`), 500);
            }
            // 1422 R2/R3: only this run's child is aborted; the member loop is never stopped.
            const runStopped = await requestRunCancel(ctx, run.run_id, taskId);
            // 1377 R3 / 1422 R4: `runStopped` separates "intent recorded" from "child actually
            // stopped", and `runId` names the run the Board has to look up.
            ctx.eventBus().emit('a2a.task.cancelled', {
                member: member.instanceId,
                taskId,
                runId: run.run_id,
                runStopped,
            });
            const task = await projectTask(ctx, inbox, (await inbox.get(taskId)) ?? message);
            return c.json({ ...task, metadata: { ...task.metadata, runStopped } });
        });
    },
};

function notFoundMember(segment: string | undefined): Response {
    return Response.json(
        a2aError(404, 'NOT_FOUND', `unknown fleet member ${segment ?? ''}`, { reason: 'MEMBER_NOT_FOUND' }),
        { status: 404 },
    );
}

function notFoundTask(taskId: string): Response {
    return Response.json(
        a2aError(404, 'NOT_FOUND', `unknown task ${taskId}`, { reason: 'TASK_NOT_FOUND', metadata: { taskId } }),
        { status: 404 },
    );
}
