import { join } from 'node:path';
import {
    type ExposedWorkflowTool,
    type FeatureShowResult,
    MCP_BUILTIN_TOOL_NAMES,
    registeredWorkflowPaths,
    resolveExposedWorkflowTools,
    resolveMcpNamespace,
    type TaskShowResult,
    type TaskSummary,
    type WorkflowRunResult,
    type WorkflowTraceListResult,
    type WorkflowTraceTimeline,
    workflowLayers,
} from '@gobing-ai/spur-app';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import { bearerEnv, bearerGuard } from '../../middleware/bearer-guard';
import type { ServerModule } from '../types';
import {
    handleMcpHttpRequest,
    type McpHandlerRegistry,
    type McpResourceDescriptor,
    type McpToolDescriptor,
} from './protocol';

/**
 * Embedded MCP 2.0+ server (feature B9, task 1372): `mcpModule` mounts the stateless protocol
 * adapter (task 1371) on `POST /mcp` and delegates every tool and `spur://` resource to the
 * in-process `@gobing-ai/spur-app` services — no CLI spawn, no second workflow state machine
 * (anti-pattern). Off by default: the module mounts nothing unless
 * `ctx.bootConfig()?.mcp?.enabled === true`, and the endpoint is bearer-only when on
 * (`server.mcp.authEnv` names the token variable; the value never rests in configuration).
 */

/** The harness tools the embedded server advertises (built-ins live in the `sp` namespace, task 1379 R1). */
export const TOOL_DESCRIPTORS: McpToolDescriptor[] = [
    {
        name: 'sp_task_show',
        description: 'Show one Spur task: metadata plus the full markdown content.',
        inputSchema: {
            type: 'object',
            properties: { wbs: { type: 'string', description: 'Task WBS (e.g. "1372")' } },
            required: ['wbs'],
        },
    },
    {
        name: 'sp_task_list',
        description: 'List Spur tasks, optionally filtered.',
        inputSchema: {
            type: 'object',
            properties: {
                status: { type: 'string' },
                featureId: { type: 'string' },
                parentWbs: { type: 'string' },
                folder: { type: 'string' },
            },
        },
    },
    {
        name: 'sp_workflow_status',
        description: 'Inspect a workflow run (per-run timeline), or list recent runs without a runId.',
        inputSchema: {
            type: 'object',
            properties: { runId: { type: 'string' } },
        },
    },
    {
        name: 'sp_workflow_run',
        description: 'Run a workflow YAML file through the existing task-pipeline engine.',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Workflow file or bare name' },
                vars: { type: 'object', additionalProperties: { type: 'string' } },
                dryRun: { type: 'boolean' },
            },
            required: ['file'],
        },
    },
    {
        name: 'sp_workflow_continue',
        description: 'Resume a paused workflow run (HITL); runId defaults to the most recent paused run.',
        inputSchema: {
            type: 'object',
            properties: {
                runId: { type: 'string' },
                answerText: { type: 'string', description: 'Free-text answer for a pending input gate' },
            },
        },
    },
];

/** Old unprefixed names are refused with a rename hint — no alias period (task 1379 R2, breaking rename). */
const RENAMED_TOOLS: Readonly<Record<string, string>> = {
    task_show: 'sp_task_show',
    task_list: 'sp_task_list',
    workflow_status: 'sp_workflow_status',
    workflow_run: 'sp_workflow_run',
    workflow_continue: 'sp_workflow_continue',
};

/** The built-in tool names in their final `sp` form (handoff: 1381 collision checks). */
export const BUILTIN_TOOL_NAMES: readonly string[] = TOOL_DESCRIPTORS.map((tool) => tool.name);

/**
 * A workflow's tool descriptor (task 1381 R2): one optional string property per declared var,
 * carrying its default, and no other accepted argument (R3 refuses extras).
 */
function workflowToolDescriptor(tool: ExposedWorkflowTool): McpToolDescriptor {
    const properties: Record<string, { type: 'string'; default: string }> = {};
    for (const [name, value] of Object.entries(tool.vars)) properties[name] = { type: 'string', default: value };
    return {
        name: tool.tool,
        description: tool.description ?? `Run the "${tool.workflow}" workflow.`,
        inputSchema: { type: 'object', properties, additionalProperties: false },
    };
}

/** The `spur://` resources the embedded server advertises (frozen URIs, task 1372 R3). */
const RESOURCE_DESCRIPTORS: McpResourceDescriptor[] = [
    { uri: 'spur://tasks/{wbs}', name: 'Task by WBS', mimeType: 'text/markdown' },
    { uri: 'spur://features/{id}', name: 'Feature by id', mimeType: 'text/markdown' },
    { uri: 'spur://context/{name}', name: 'Indexed context file', mimeType: 'text/markdown' },
];

/** One service result the dispatcher serializes verbatim as the tool-call value. */
type McpToolResult =
    | TaskShowResult
    | TaskSummary[]
    | WorkflowTraceTimeline
    | WorkflowTraceListResult
    | WorkflowRunResult;

/** The narrow context slice the dispatcher reads; tests stub these accessors. */
class McpDispatcher implements McpHandlerRegistry {
    private resolvedNamespace: string | null = null;
    private readonly namespaceReady: Promise<void>;

    constructor(private readonly ctx: ServerContext) {
        const configured = mcpSettings(ctx).namespace;
        this.namespaceReady = resolveMcpNamespace({
            configured,
            projectRoot: ctx.cwd,
            fs: ctx.fs,
        })
            .then((resolved) => {
                this.resolvedNamespace = resolved.namespace;
            })
            .catch(() => {
                this.resolvedNamespace = null;
            });
    }

    namespace(): string | null {
        return this.resolvedNamespace;
    }

    async listTools(): Promise<McpToolDescriptor[]> {
        await this.namespaceReady;
        const exposed = await this.exposedWorkflowTools();
        return [...TOOL_DESCRIPTORS, ...exposed.map(workflowToolDescriptor)];
    }

    /**
     * Workflows this project exposes as tools (task 1381 R2). Recomputed per call: the server is
     * stateless and the resolver is one directory walk, so a cache would only add staleness.
     */
    private async exposedWorkflowTools(): Promise<ExposedWorkflowTool[]> {
        // The namespace resolves asynchronously; a `tools/call` can be the very first request,
        // so awaiting here is what stops it reading a not-yet-resolved `null` (task 1381 R3).
        await this.namespaceReady;
        const { tools } = await resolveExposedWorkflowTools({
            namespace: this.resolvedNamespace,
            reserved: MCP_BUILTIN_TOOL_NAMES,
            roots: workflowLayers({
                cwd: this.ctx.cwd,
                registered: registeredWorkflowPaths(this.ctx.spurConfig ?? null),
            }).map((layer) => layer.path),
            fs: this.ctx.fs,
        });
        return tools;
    }

    /** R3: run an exposed workflow through the same service path as `sp_workflow_run`. */
    private async callWorkflowTool(
        tool: ExposedWorkflowTool,
        args: Record<string, unknown>,
    ): Promise<WorkflowRunResult> {
        const accepted = Object.keys(tool.vars);
        const vars: Record<string, string> = {};
        for (const [key, value] of Object.entries(args)) {
            if (!(key in tool.vars)) {
                throw new Error(
                    `invalid_arguments: tool "${tool.tool}" accepts only ${accepted.length === 0 ? 'no arguments' : accepted.join(', ')}; got "${key}"`,
                );
            }
            if (typeof value !== 'string') {
                throw new Error(`invalid_arguments: tool "${tool.tool}" argument "${key}" must be a string`);
            }
            vars[key] = value;
        }
        return this.ctx.workflowService().run(tool.file, { vars });
    }

    async listResources(): Promise<McpResourceDescriptor[]> {
        await this.namespaceReady;
        return RESOURCE_DESCRIPTORS;
    }

    /** Route one harness tool to its `@gobing-ai/spur-app` service; unknown names are refused. */
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
        const startedAt = performance.now();
        const argKeys = Object.keys(args).sort();
        try {
            const result = await this.dispatchTool(name, args);
            await this.emitEvent('mcp.tool.called', {
                tool: name,
                argKeys,
                durationMs: Math.round(performance.now() - startedAt),
                outcome: 'ok',
                ...correlation(args, result),
            });
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.emitEvent('mcp.tool.failed', {
                tool: name,
                argKeys,
                durationMs: Math.round(performance.now() - startedAt),
                outcome: 'error',
                errorCode: toolErrorCode(message),
                // `redacted` payload policy: the message quotes the dispatcher, never an argument value.
                error: message,
                ...correlation(args, undefined),
            });
            throw error;
        }
    }

    /**
     * Observability must never fail the call it describes: a bus handler that throws is logged,
     * not surfaced as a tool error (1376). Awaited so the ledger row exists before the response.
     */
    private async emitEvent(name: string, payload: Record<string, unknown>): Promise<void> {
        try {
            await this.ctx.eventBus()?.emit(name, payload);
        } catch (error) {
            this.ctx.logger.warn('mcp event emit failed', {
                name,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /** The tool switch itself; the wrapper above owns timing and the event (task 1376). */
    private async dispatchTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
        switch (name) {
            case 'sp_task_show':
                return this.ctx.taskService().show(requiredString(args, 'wbs'));
            case 'sp_task_list':
                return this.ctx.taskService().list(taskListFilters(args));
            case 'sp_workflow_status': {
                const runId = optionalString(args, 'runId');
                return runId === undefined
                    ? this.ctx.workflowService().trace()
                    : this.ctx.workflowService().trace(runId);
            }
            case 'sp_workflow_run':
                return this.ctx.workflowService().run(requiredString(args, 'file'), {
                    vars: stringRecord(args, 'vars'),
                    ...(args.dryRun === true ? { dryRun: true } : {}),
                });
            case 'sp_workflow_continue': {
                const runId =
                    optionalString(args, 'runId') ?? (await this.ctx.workflowService().latestPausedRun())?.runId;
                if (runId === undefined) {
                    throw new Error('no paused workflow run to continue; pass a runId');
                }
                return this.ctx.workflowService().continuePaused(runId, {
                    ...(typeof args.answerText === 'string' ? { answerText: args.answerText } : {}),
                });
            }
            default: {
                const renamed = RENAMED_TOOLS[name];
                if (renamed !== undefined) {
                    throw new Error(`tool "${name}" was renamed to "${renamed}"`);
                }
                const exposed = (await this.exposedWorkflowTools()).find((tool) => tool.tool === name);
                if (exposed !== undefined) return this.callWorkflowTool(exposed, args);
                throw new Error(
                    `unknown tool "${name}"; supported: ${TOOL_DESCRIPTORS.map((tool) => tool.name).join(', ')}`,
                );
            }
        }
    }

    /** Read one `spur://` resource through its owning service; unknown schemes are refused. */
    async readResource(uri: string): Promise<unknown> {
        const startedAt = performance.now();
        try {
            const result = await this.dispatchResource(uri);
            await this.emitEvent('mcp.resource.read', {
                uri,
                durationMs: Math.round(performance.now() - startedAt),
                outcome: 'ok',
            });
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.emitEvent('mcp.resource.read', {
                uri,
                durationMs: Math.round(performance.now() - startedAt),
                outcome: 'error',
                errorCode: message.startsWith('unknown ') ? 'unknown_resource' : 'resource_error',
            });
            throw error;
        }
    }

    /** The resource resolver itself; the wrapper above owns timing and the event (task 1376). */
    private async dispatchResource(uri: string): Promise<unknown> {
        const match = /^spur:\/\/(tasks|features|context)\/([^/]+)$/.exec(uri);
        if (match === null) {
            throw new Error(
                `unknown resource "${uri}"; supported: ${RESOURCE_DESCRIPTORS.map((res) => res.uri).join(', ')}`,
            );
        }
        const [, kind, id] = match;
        // `.`/`..` are single segments too — refuse them so the read never resolves outside the leaf dir.
        if (kind === undefined || id === undefined || id === '.' || id === '..') {
            throw new Error(`unknown resource "${uri}"`);
        }
        if (kind === 'tasks') return this.ctx.taskService().show(id);
        if (kind === 'features') {
            const feature: FeatureShowResult | null = await this.ctx.featureService().show(id);
            if (feature === null) throw new Error(`unknown feature ${id}`);
            return feature;
        }
        // Trust boundary: `id` is a single path segment, so the read is confined to the
        // gitignored indexed-context directory — no traversal out of `.spur/context/`.
        return {
            uri,
            name: id,
            mimeType: 'text/markdown',
            text: await this.ctx.fs.readFile(join(this.ctx.cwd, '.spur', 'context', id)),
        };
    }
}

/** Serve an embedded MCP handler over the injected dispatcher (`createMcpDispatcher`). */
export function createMcpHandler(ctx: ServerContext): (req: Request) => Promise<Response> {
    const dispatcher = new McpDispatcher(ctx);
    return (req: Request) => handleMcpHttpRequest(req, dispatcher);
}

/** `runId`/`wbs` when the call's arguments or its result already carry them (1376 R2). */
function correlation(args: Record<string, unknown>, result: unknown): { runId?: string; wbs?: string } {
    const from = (source: unknown, key: 'runId' | 'wbs'): string | undefined => {
        if (typeof source !== 'object' || source === null) return undefined;
        const value = (source as Record<string, unknown>)[key];
        return typeof value === 'string' && value !== '' ? value : undefined;
    };
    const runId = from(args, 'runId') ?? from(result, 'runId');
    const wbs = from(args, 'wbs') ?? from(result, 'wbs');
    return { ...(runId === undefined ? {} : { runId }), ...(wbs === undefined ? {} : { wbs }) };
}

/** The three catalog error codes, derived at the emit site from the dispatcher's own throws (1376 R2). */
function toolErrorCode(message: string): 'unknown_tool' | 'invalid_arguments' | 'tool_error' {
    // A legacy name that 1379/1380 renamed is not a tool failure — the client sent a name this
    // surface no longer accepts, which is the same signal as an unknown one.
    if (message.startsWith('unknown tool') || message.includes('was renamed to')) return 'unknown_tool';
    // The argument validators are the only throws ending in these two suffixes.
    if (/ is required$| must be a map of strings$/.test(message)) return 'invalid_arguments';
    return 'tool_error';
}

function requiredString(args: Record<string, unknown>, key: string): string {
    const value = optionalString(args, key);
    if (value === undefined) throw new Error(`${key} is required`);
    return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
    const value = args[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function taskListFilters(args: Record<string, unknown>): {
    status?: string;
    featureId?: string;
    parentWbs?: string;
    folder?: string;
} {
    const filters: { status?: string; featureId?: string; parentWbs?: string; folder?: string } = {};
    for (const key of ['status', 'featureId', 'parentWbs', 'folder'] as const) {
        const value = optionalString(args, key);
        if (value !== undefined) filters[key] = value;
    }
    return filters;
}

function stringRecord(args: Record<string, unknown>, key: string): Record<string, string> | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${key} must be a map of strings`);
    }
    const record: Record<string, string> = {};
    for (const [name, entry] of Object.entries(value)) {
        if (typeof entry !== 'string') throw new Error(`${key} must be a map of strings`);
        record[name] = entry;
    }
    return record;
}

/** The listener switch, token variable name (never the value), and optional configured namespace. */
function mcpSettings(ctx: ServerContext): { enabled: boolean; authEnv: string | null; namespace: string | undefined } {
    const mcp = typeof ctx.bootConfig === 'function' ? ctx.bootConfig()?.mcp : undefined;
    return { enabled: mcp?.enabled === true, authEnv: mcp?.authEnv ?? null, namespace: mcp?.namespace ?? undefined };
}

/** The embedded MCP endpoint module: mounts nothing unless `server.mcp.enabled` is on (R1/AC1). */
export const mcpModule: ServerModule = {
    name: 'mcp',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;
        const settings = mcpSettings(ctx);
        // Off by default. No route, no handler, no path — the surface does not exist, and a
        // boot config without the mcp key (tests / CF Workers default) is the same default-off.
        if (!settings.enabled) return;
        // Bearer-only: missing/invalid tokens are 401 with the challenge header (AC1) — the
        // shared guard (task 1375) carries the mcp realm and envelope; this module keeps the
        // mount-time warning and the per-route call.
        const guard = bearerGuard({
            realm: 'spur-mcp',
            authEnv: settings.authEnv,
            env: bearerEnv(ctx),
            unauthenticated: () => ({ error: { code: 'UNAUTHENTICATED', message: 'a bearer token is required' } }),
            unconfigured: () => ({
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'the mcp endpoint has no token configured; set the variable named by server.mcp.authEnv',
                },
            }),
            // 1376 R4: the refusal is observable without the token — surface, structural reason, path only.
            onDenied: ({ reason, path }) => {
                // A partial context (test slice, older embedding) may carry no bus; observability
                // must never turn a 401 into a 500.
                ctx.eventBus?.()?.emit('auth.denied', { surface: 'mcp', reason, path });
            },
        });
        // Enabled with an unreadable token variable is a misconfiguration; mounting a surface
        // that refuses everyone is still better than a 404 the operator cannot tell from "off".
        if (guard.configured === false) {
            ctx.logger.warn('mcp endpoint enabled but its token variable is unset; every request will be refused', {
                variable: settings.authEnv ?? '(server.mcp.authEnv is not configured)',
            });
        }
        const authorize = guard.authorize;

        const handleMcp = createMcpHandler(ctx);
        app.post('/mcp', async (c) => {
            const denied = authorize(c);
            if (denied !== null) return denied;
            return handleMcp(c.req.raw);
        });
    },
};
