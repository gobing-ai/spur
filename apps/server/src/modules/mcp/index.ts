import { join } from 'node:path';
import type {
    FeatureShowResult,
    TaskShowResult,
    TaskSummary,
    WorkflowRunResult,
    WorkflowTraceListResult,
    WorkflowTraceTimeline,
} from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
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

/** The harness tools the embedded server advertises (frozen names, task 1372 R2). */
const TOOL_DESCRIPTORS: McpToolDescriptor[] = [
    {
        name: 'task_show',
        description: 'Show one Spur task: metadata plus the full markdown content.',
        inputSchema: {
            type: 'object',
            properties: { wbs: { type: 'string', description: 'Task WBS (e.g. "1372")' } },
            required: ['wbs'],
        },
    },
    {
        name: 'task_list',
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
        name: 'workflow_status',
        description: 'Inspect a workflow run (per-run timeline), or list recent runs without a runId.',
        inputSchema: {
            type: 'object',
            properties: { runId: { type: 'string' } },
        },
    },
    {
        name: 'workflow_run',
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
        name: 'workflow_continue',
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
    constructor(private readonly ctx: ServerContext) {}

    async listTools(): Promise<McpToolDescriptor[]> {
        return TOOL_DESCRIPTORS;
    }

    async listResources(): Promise<McpResourceDescriptor[]> {
        return RESOURCE_DESCRIPTORS;
    }

    /** Route one harness tool to its `@gobing-ai/spur-app` service; unknown names are refused. */
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
        switch (name) {
            case 'task_show':
                return this.ctx.taskService().show(requiredString(args, 'wbs'));
            case 'task_list':
                return this.ctx.taskService().list(taskListFilters(args));
            case 'workflow_status': {
                const runId = optionalString(args, 'runId');
                return runId === undefined
                    ? this.ctx.workflowService().trace()
                    : this.ctx.workflowService().trace(runId);
            }
            case 'workflow_run':
                return this.ctx.workflowService().run(requiredString(args, 'file'), {
                    vars: stringRecord(args, 'vars'),
                    ...(args.dryRun === true ? { dryRun: true } : {}),
                });
            case 'workflow_continue': {
                const runId =
                    optionalString(args, 'runId') ?? (await this.ctx.workflowService().latestPausedRun())?.runId;
                if (runId === undefined) {
                    throw new Error('no paused workflow run to continue; pass a runId');
                }
                return this.ctx.workflowService().continuePaused(runId, {
                    ...(typeof args.answerText === 'string' ? { answerText: args.answerText } : {}),
                });
            }
            default:
                throw new Error(
                    `unknown tool "${name}"; supported: ${TOOL_DESCRIPTORS.map((tool) => tool.name).join(', ')}`,
                );
        }
    }

    /** Read one `spur://` resource through its owning service; unknown schemes are refused. */
    async readResource(uri: string): Promise<unknown> {
        const match = /^spur:\/\/(tasks|features|context)\/([^/]+)$/.exec(uri);
        if (match === null) {
            throw new Error(
                `unknown resource "${uri}"; supported: ${RESOURCE_DESCRIPTORS.map((res) => res.uri).join(', ')}`,
            );
        }
        const [, kind, id] = match;
        if (kind === undefined || id === undefined) throw new Error(`unknown resource "${uri}"`);
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

/** The listener switch and the NAME of the variable holding its token (never the value). */
function mcpSettings(ctx: ServerContext): { enabled: boolean; authEnv: string | null } {
    const mcp = typeof ctx.bootConfig === 'function' ? ctx.bootConfig()?.mcp : undefined;
    return { enabled: mcp?.enabled === true, authEnv: mcp?.authEnv ?? null };
}

/** The bearer token this surface accepts, from the variable `server.mcp.authEnv` names. */
function requiredToken(authEnv: string | null, env: Record<string, string | undefined>): string | null {
    if (authEnv === null) return null;
    // The token value reaches this process only through the configured variable; it is never
    // written to the corpus, a receipt or a log (same contract as the a2a listener).
    const value = env[authEnv];
    return value === undefined || value === '' ? null : value;
}

/** Constant-time-ish comparison: never short-circuit on the first differing byte. */
function sameToken(provided: string | undefined, expected: string): boolean {
    if (provided === undefined) return false;
    const a = new TextEncoder().encode(provided);
    const b = new TextEncoder().encode(expected);
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    return diff === 0;
}

/** The environment the token variable is read from: an injected map, else the sanctioned funnel. */
function envOver(ctx: ServerContext): Record<string, string | undefined> {
    const injected = (ctx as unknown as { env?: Record<string, string | undefined> }).env;
    return injected ?? getEnvVars();
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
        const token = requiredToken(settings.authEnv, envOver(ctx));
        // Enabled with an unreadable token variable is a misconfiguration; mounting a surface
        // that refuses everyone is still better than a 404 the operator cannot tell from "off".
        if (token === null) {
            ctx.logger.warn('mcp endpoint enabled but its token variable is unset; every request will be refused', {
                variable: settings.authEnv ?? '(server.mcp.authEnv is not configured)',
            });
        }

        /** Bearer-only: missing/invalid tokens are 401 with the challenge header (AC1). */
        const authorize = (c: { req: { header: (name: string) => string | undefined } }): Response | null => {
            if (token === null) {
                return Response.json(
                    {
                        error: {
                            code: 'INTERNAL_ERROR',
                            message:
                                'the mcp endpoint has no token configured; set the variable named by server.mcp.authEnv',
                        },
                    },
                    { status: 500 },
                );
            }
            const header = c.req.header('Authorization') ?? '';
            const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
            if (sameToken(provided, token)) return null;
            return Response.json(
                { error: { code: 'UNAUTHENTICATED', message: 'a bearer token is required' } },
                { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="spur-mcp"' } },
            );
        };

        const handleMcp = createMcpHandler(ctx);
        app.post('/mcp', async (c) => {
            const denied = authorize(c);
            if (denied !== null) return denied;
            return handleMcp(c.req.raw);
        });
    },
};
