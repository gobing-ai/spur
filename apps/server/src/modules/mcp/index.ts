import { join } from 'node:path';
import {
    type ExposedWorkflowTool,
    type FeatureShowResult,
    type McpExposureIssue,
    type McpNamespaceSource,
    resolveMcpNamespace,
    resolveProjectWorkflowTools,
    type WorkflowRunResult,
    workflowToolDescriptor,
} from '@gobing-ai/spur-app';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import { bearerEnv, bearerGuard } from '../../middleware/bearer-guard';
import type { ServerModule } from '../types';
import {
    handleMcpHttpRequest,
    InvalidArgumentsError,
    type McpHandlerRegistry,
    type McpRequestMeta,
    type McpResourceDescriptor,
    type McpToolDescriptor,
} from './protocol';
import { dispatch as builderDispatch, descriptors as builderTools } from './tools-builder';
import { dispatch as coordinationDispatch, descriptors as coordinationTools } from './tools-coordination';
import { dispatch as decisionDispatch, descriptors as decisionTools } from './tools-decision';
import { dispatch as featureDispatch, descriptors as featureTools } from './tools-feature';
import { dispatch as ruleDispatch, descriptors as ruleTools } from './tools-rule';
import { dispatch as selfDispatch, descriptors as selfTools } from './tools-self';
import { correlation, type ToolHandler, toolErrorCode, validateToolArguments } from './tools-shared';
import { dispatch as taskDispatch, descriptors as taskTools } from './tools-task';
import { dispatch as workflowDispatch, descriptors as workflowTools } from './tools-workflow';

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
    ...taskTools,
    ...featureTools,
    ...workflowTools,
    ...ruleTools,
    ...decisionTools,
    ...coordinationTools,
    ...builderTools,
    ...selfTools,
];

/** One handler per descriptor name, composed from the same domain modules as `TOOL_DESCRIPTORS`. */
const TOOL_HANDLERS: Readonly<Record<string, ToolHandler>> = {
    ...taskDispatch,
    ...featureDispatch,
    ...workflowDispatch,
    ...ruleDispatch,
    ...decisionDispatch,
    ...coordinationDispatch,
    ...builderDispatch,
    ...selfDispatch,
};

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

/** The `spur://` resources the embedded server advertises (frozen URIs, task 1372 R3). */
export const RESOURCE_DESCRIPTORS: McpResourceDescriptor[] = [
    { uri: 'spur://tasks/{wbs}', name: 'Task by WBS', mimeType: 'text/markdown' },
    { uri: 'spur://features/{id}', name: 'Feature by id', mimeType: 'text/markdown' },
    { uri: 'spur://context/{name}', name: 'Indexed context file', mimeType: 'text/markdown' },
];

/** One service result the dispatcher serializes verbatim as the tool-call value. */
/**
 * What one tool call resolves to. The read tools have precise types; the write tools (1392) return
 * small result objects, and the protocol serializes any of them verbatim, so the dispatcher's
 * contract is "a JSON-serializable value", not a closed union.
 */
type McpToolResult = unknown;

/** The narrow context slice the dispatcher reads; tests stub these accessors. */
class McpDispatcher implements McpHandlerRegistry {
    private resolvedNamespace: string | null = null;
    private resolvedNamespaceSource: McpNamespaceSource = 'none';
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
                this.resolvedNamespaceSource = resolved.source;
            })
            .catch(() => {
                this.resolvedNamespace = null;
                this.resolvedNamespaceSource = 'none';
            });
    }

    namespace(): string | null {
        return this.resolvedNamespace;
    }

    async listTools(meta?: McpRequestMeta): Promise<McpToolDescriptor[]> {
        const startedAt = performance.now();
        await this.namespaceReady;
        const { tools } = await this.exposedWorkflowTools();
        const catalog = [...TOOL_DESCRIPTORS, ...tools.map(workflowToolDescriptor)];
        // R2: keyed on the method the client sent. `server/discover` lists tools AND resources, so
        // emitting from the list methods alone would record two events for one request.
        if (meta?.method === 'server/discover') {
            await this.emitEvent('mcp.server.discovered', {
                ...this.transport(meta),
                durationMs: Math.round(performance.now() - startedAt),
            });
        } else if (meta?.method === 'tools/list') {
            await this.emitEvent('mcp.tools.listed', {
                toolCount: catalog.length,
                builtinCount: TOOL_DESCRIPTORS.length,
                workflowCount: tools.length,
                ...this.transport(meta),
                durationMs: Math.round(performance.now() - startedAt),
            });
        }
        return catalog;
    }

    /**
     * The catalog `tools/list` serves, plus the namespace provenance and the exposures the resolver
     * refused (1438 R1). One resolver walk answers both, so the status read can never disagree with
     * the protocol — and the issue list the dispatcher used to discard reaches a reader.
     */
    async catalog(): Promise<{
        tools: McpToolDescriptor[];
        resources: McpResourceDescriptor[];
        namespace: string | null;
        namespaceSource: McpNamespaceSource;
        exposureIssues: McpExposureIssue[];
    }> {
        await this.namespaceReady;
        const { tools, issues } = await this.exposedWorkflowTools();
        return {
            tools: [...TOOL_DESCRIPTORS, ...tools.map(workflowToolDescriptor)],
            resources: await this.listResources(),
            namespace: this.resolvedNamespace,
            namespaceSource: this.resolvedNamespaceSource,
            exposureIssues: issues,
        };
    }

    /**
     * Workflows this project exposes as tools (task 1381 R2). Recomputed per call: the server is
     * stateless and the resolver is one directory walk, so a cache would only add staleness.
     */
    private async exposedWorkflowTools(): Promise<{ tools: ExposedWorkflowTool[]; issues: McpExposureIssue[] }> {
        // The namespace resolves asynchronously; a `tools/call` can be the very first request,
        // so awaiting here is what stops it reading a not-yet-resolved `null` (task 1381 R3).
        await this.namespaceReady;
        return resolveProjectWorkflowTools({
            namespace: this.resolvedNamespace,
            cwd: this.ctx.cwd,
            config: this.ctx.spurConfig ?? null,
            fs: this.ctx.fs,
        });
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
                throw new InvalidArgumentsError(
                    `invalid_arguments: tool "${tool.tool}" accepts only ${accepted.length === 0 ? 'no arguments' : accepted.join(', ')}; got "${key}"`,
                );
            }
            if (typeof value !== 'string') {
                throw new InvalidArgumentsError(
                    `invalid_arguments: tool "${tool.tool}" argument "${key}" must be a string`,
                );
            }
            vars[key] = value;
        }
        return this.ctx.workflowService().run(tool.file, { vars });
    }

    async listResources(meta?: McpRequestMeta): Promise<McpResourceDescriptor[]> {
        const startedAt = performance.now();
        await this.namespaceReady;
        if (meta?.method === 'resources/list') {
            await this.emitEvent('mcp.resources.listed', {
                resourceCount: RESOURCE_DESCRIPTORS.length,
                ...this.transport(meta),
                durationMs: Math.round(performance.now() - startedAt),
            });
        }
        return RESOURCE_DESCRIPTORS;
    }

    /** Resolved namespace plus the request's transport facts; a status read (no meta) is `direct`. */
    private transport(meta: McpRequestMeta | undefined): Record<string, unknown> {
        return {
            ...(this.resolvedNamespace !== null ? { namespace: this.resolvedNamespace } : {}),
            via: meta?.via ?? 'direct',
            ...(meta?.actor != null ? { actor: meta.actor } : {}),
        };
    }

    /**
     * R1: what one tool name IS — `built-in` (a `TOOL_DESCRIPTORS` entry), `workflow` (an exposed
     * project workflow), or `unknown` (the dispatcher refuses it). `access` comes from the matched
     * descriptor's own annotation, so it can never disagree with `tools/list`.
     */
    private async toolIdentity(
        name: string,
    ): Promise<{ origin: 'built-in' | 'workflow' | 'unknown'; access?: 'read' | 'write' }> {
        const descriptor = TOOL_DESCRIPTORS.find((tool) => tool.name === name);
        if (descriptor !== undefined) {
            if (descriptor.annotations === undefined) return { origin: 'built-in' };
            return { origin: 'built-in', access: descriptor.annotations.readOnlyHint ? 'read' : 'write' };
        }
        const exposed = (await this.exposedWorkflowTools()).tools.some((tool) => tool.tool === name);
        return exposed ? { origin: 'workflow', access: 'write' } : { origin: 'unknown' };
    }

    /** Route one harness tool to its `@gobing-ai/spur-app` service; unknown names are refused. */
    async callTool(name: string, args: Record<string, unknown>, meta?: McpRequestMeta): Promise<McpToolResult> {
        const startedAt = performance.now();
        const argKeys = Object.keys(args).sort();
        // `origin`/`access`/`via` describe the call itself; the actor is the only header value kept,
        // and it stays omitted while unknown so the ledger's own actor column stays null (R1).
        const { origin, access } = await this.toolIdentity(name);
        const identity = {
            origin,
            ...(access !== undefined ? { access } : {}),
            via: meta?.via ?? 'direct',
            ...(meta?.actor != null ? { actor: meta.actor } : {}),
        };
        try {
            const result = await this.dispatchTool(name, args);
            await this.emitEvent('mcp.tool.called', {
                tool: name,
                argKeys,
                durationMs: Math.round(performance.now() - startedAt),
                outcome: 'ok',
                ...identity,
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
                errorCode: toolErrorCode(error),
                // `redacted` payload policy: the message quotes the dispatcher, never an argument value.
                error: message,
                ...identity,
                ...correlation(args, undefined),
            });
            throw error;
        }
    }

    /**
     * Observability must never fail the call it describes: a bus handler that throws is logged,
     * not surfaced as a tool error (1376). Awaited so the ledger row exists before the response.
     * A partial context (test slice, older embedding) may carry no bus at all.
     */
    private async emitEvent(name: string, payload: Record<string, unknown>): Promise<void> {
        try {
            await this.ctx.eventBus?.()?.emit(name, payload);
        } catch (error) {
            this.ctx.logger.warn('mcp event emit failed', {
                name,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /** The tool dispatch itself; the wrapper above owns timing and the event (task 1376). */
    private async dispatchTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
        // 1392 R2/R5: the advertised schema IS the contract, so an undeclared argument never
        // reaches a service (no status write, no rule file, no fix-applying mode). The throw
        // travels through the caller's catch, which records it as `invalid_arguments` (1376 R2).
        const descriptor = TOOL_DESCRIPTORS.find((tool) => tool.name === name);
        const violation = descriptor === undefined ? null : validateToolArguments(descriptor, args);
        if (violation !== null) throw new InvalidArgumentsError(violation);
        const handler = TOOL_HANDLERS[name];
        if (handler !== undefined) return handler(this.ctx, args);
        const renamed = RENAMED_TOOLS[name];
        if (renamed !== undefined) {
            throw new Error(`tool "${name}" was renamed to "${renamed}"`);
        }
        const exposed = (await this.exposedWorkflowTools()).tools.find((tool) => tool.tool === name);
        if (exposed !== undefined) return this.callWorkflowTool(exposed, args);
        throw new Error(`unknown tool "${name}"; supported: ${TOOL_DESCRIPTORS.map((tool) => tool.name).join(', ')}`);
    }

    /** Read one `spur://` resource through its owning service; unknown schemes are refused. */
    async readResource(uri: string, _meta?: McpRequestMeta): Promise<unknown> {
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

/**
 * The catalog `tools/list` and `resources/list` serve, for readers that report it rather than
 * serve it (the Integrations status contract, 1423 R3). One dispatcher, one resolver: the Board can
 * never advertise a tool the protocol refuses.
 */
export async function readMcpCatalog(ctx: ServerContext): Promise<{
    tools: McpToolDescriptor[];
    resources: McpResourceDescriptor[];
    namespace: string | null;
    namespaceSource: McpNamespaceSource;
    exposureIssues: McpExposureIssue[];
}> {
    return new McpDispatcher(ctx).catalog();
}

/** Serve an embedded MCP handler over the injected dispatcher (`createMcpDispatcher`). */
export function createMcpHandler(ctx: ServerContext): (req: Request) => Promise<Response> {
    const dispatcher = new McpDispatcher(ctx);
    return (req: Request) => handleMcpHttpRequest(req, dispatcher);
}

/** The listener switch, token variable name (never the value), and optional configured namespace. */
function mcpSettings(ctx: ServerContext): {
    enabled: boolean;
    authEnv: string | null;
    allowUnauthenticated: boolean;
    namespace: string | undefined;
} {
    const mcp = typeof ctx.bootConfig === 'function' ? ctx.bootConfig()?.mcp : undefined;
    return {
        enabled: mcp?.enabled === true,
        authEnv: mcp?.authEnv ?? null,
        allowUnauthenticated: mcp?.allowUnauthenticated === true,
        namespace: mcp?.namespace ?? undefined,
    };
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
            allowUnauthenticated: settings.allowUnauthenticated,
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
