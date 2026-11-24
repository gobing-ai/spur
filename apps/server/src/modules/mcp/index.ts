import { join } from 'node:path';
import {
    buildManifestArgv,
    childProcessEnv,
    type ExposedWorkflowTool,
    type FeatureShowResult,
    MANIFEST_MAX_STDOUT_BYTES,
    MANIFEST_STDERR_TAIL_CHARS,
    ManifestInvalidArgumentsError,
    type ManifestTool,
    type McpExposureIssue,
    type McpNamespaceSource,
    manifestToolDescriptor,
    type ResolvedProjectMcpTools,
    resolveMcpNamespace,
    resolveProjectMcpTools,
    type WorkflowRunResult,
    workflowToolDescriptor,
} from '@gobing-ai/spur-app';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
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
        const { workflowTools, manifestTools } = await this.exposedTools();
        const catalog = [
            ...TOOL_DESCRIPTORS,
            ...workflowTools.map(workflowToolDescriptor),
            ...manifestTools.map(manifestToolDescriptor),
        ];
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
                workflowCount: workflowTools.length,
                manifestCount: manifestTools.length,
                ...this.transport(meta),
                durationMs: Math.round(performance.now() - startedAt),
            });
        }
        return catalog;
    }

    /**
     * The catalog `tools/list` serves, plus the namespace provenance and the exposures the resolver
     * refused (1438 R1; manifest tools 1447 R5). One resolver walk answers both, so the status read
     * can never disagree with the protocol — and the issue list reaches a reader.
     */
    async catalog(): Promise<{
        tools: McpToolDescriptor[];
        manifestToolNames: string[];
        resources: McpResourceDescriptor[];
        namespace: string | null;
        namespaceSource: McpNamespaceSource;
        exposureIssues: McpExposureIssue[];
    }> {
        await this.namespaceReady;
        const { workflowTools, manifestTools, issues } = await this.exposedTools();
        return {
            tools: [
                ...TOOL_DESCRIPTORS,
                ...workflowTools.map(workflowToolDescriptor),
                ...manifestTools.map(manifestToolDescriptor),
            ],
            manifestToolNames: manifestTools.map((tool) => tool.tool),
            resources: await this.listResources(),
            namespace: this.resolvedNamespace,
            namespaceSource: this.resolvedNamespaceSource,
            exposureIssues: issues,
        };
    }

    /**
     * Workflows and manifest CLI tools this project exposes (task 1381 R2, task 1447 R5).
     * Recomputed per call: the server is stateless and no cache can go stale.
     */
    private async exposedTools(): Promise<ResolvedProjectMcpTools> {
        // The namespace resolves asynchronously; a `tools/call` can be the very first request,
        // so awaiting here is what stops it reading a not-yet-resolved `null` (task 1381 R3).
        await this.namespaceReady;
        return resolveProjectMcpTools({
            namespace: this.resolvedNamespace,
            cwd: this.ctx.cwd,
            config: this.ctx.spurConfig ?? null,
            fs: this.ctx.fs,
        });
    }

    /** R3 (1381) + R4 (1447): run an exposed workflow through the same service path as `sp_workflow_run`. */
    private async callWorkflowTool(
        tool: ExposedWorkflowTool,
        args: Record<string, unknown>,
    ): Promise<WorkflowRunResult> {
        const vars: Record<string, string> = {};
        if (tool.params !== undefined) {
            const accepted = Object.keys(tool.params);
            for (const [key, value] of Object.entries(args)) {
                if (value === undefined) continue;
                if (!(key in tool.params)) {
                    throw new InvalidArgumentsError(
                        `invalid_arguments: tool "${tool.tool}" accepts only ${accepted.length === 0 ? 'no arguments' : accepted.join(', ')}; got "${key}"`,
                    );
                }
            }
            for (const [key, spec] of Object.entries(tool.params)) {
                const value = args[key];
                if (value === undefined) {
                    if (spec.required === true) {
                        throw new InvalidArgumentsError(
                            `invalid_arguments: tool "${tool.tool}" requires argument "${key}"`,
                        );
                    }
                    continue;
                }
                if (spec.type === 'string' && typeof value !== 'string') {
                    throw new InvalidArgumentsError(
                        `invalid_arguments: tool "${tool.tool}" argument "${key}" must be a string`,
                    );
                }
                if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
                    throw new InvalidArgumentsError(
                        `invalid_arguments: tool "${tool.tool}" argument "${key}" must be a finite number`,
                    );
                }
                if (spec.type === 'boolean' && typeof value !== 'boolean') {
                    throw new InvalidArgumentsError(
                        `invalid_arguments: tool "${tool.tool}" argument "${key}" must be a boolean`,
                    );
                }
                if (spec.enum !== undefined && !spec.enum.includes(value as string | number | boolean)) {
                    throw new InvalidArgumentsError(
                        `invalid_arguments: tool "${tool.tool}" argument "${key}" must be one of ${spec.enum.join(', ')}`,
                    );
                }
                vars[key] = String(value);
            }
            return this.ctx.workflowService().run(tool.file, { vars });
        }

        const accepted = Object.keys(tool.vars);
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

    /** R3 (1447): validate arguments, blank authEnv, and execute one manifest CLI tool without a shell. */
    private async callManifestTool(tool: ManifestTool, args: Record<string, unknown>): Promise<unknown> {
        let argv: string[];
        try {
            argv = buildManifestArgv(tool, args);
        } catch (error) {
            if (error instanceof ManifestInvalidArgumentsError) {
                throw new InvalidArgumentsError(error.message);
            }
            throw error;
        }

        const env = childProcessEnv();
        const authEnv = mcpSettings(this.ctx).authEnv;
        if (authEnv !== null && authEnv !== '') {
            env[authEnv] = '';
        }

        const [command, ...commandArgs] = argv;
        if (command === undefined) {
            throw new InvalidArgumentsError(`invalid_arguments: tool "${tool.tool}" has an empty command`);
        }
        const executor = this.ctx.processExecutor?.() ?? new NodeProcessExecutor();
        const result = await executor.run({
            command,
            args: commandArgs,
            cwd: this.ctx.cwd,
            env,
            timeout: tool.timeoutMs,
        });

        const stderrTail = result.stderr.slice(-MANIFEST_STDERR_TAIL_CHARS);
        if (result.outcome === 'timeout') {
            throw new Error(`manifest tool ${tool.tool} timed out after ${tool.timeoutMs}ms: ${stderrTail}`);
        }
        if (result.exitCode !== 0) {
            throw new Error(`manifest tool ${tool.tool} exited ${result.exitCode ?? 'unknown'}: ${stderrTail}`);
        }
        if (Buffer.byteLength(result.stdout, 'utf8') > MANIFEST_MAX_STDOUT_BYTES) {
            throw new Error(`manifest tool ${tool.tool} stdout exceeded 1 MiB limit: ${stderrTail}`);
        }
        if (tool.output === 'json') {
            try {
                return JSON.parse(result.stdout);
            } catch {
                throw new Error(`manifest tool ${tool.tool} returned invalid JSON: ${stderrTail}`);
            }
        }
        return { stdout: result.stdout };
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
     * R1 (1446) + R5 (1447): what one tool name IS — `built-in` (a `TOOL_DESCRIPTORS` entry),
     * `workflow` (an exposed project workflow), `manifest` (a `plugins/<ns>/mcp-tools.yaml` entry),
     * or `unknown` (the dispatcher refuses it). `access` comes from the matched descriptor's own
     * annotation, so it can never disagree with `tools/list`.
     */
    private async toolIdentity(
        name: string,
    ): Promise<{ origin: 'built-in' | 'workflow' | 'manifest' | 'unknown'; access?: 'read' | 'write' }> {
        const descriptor = TOOL_DESCRIPTORS.find((tool) => tool.name === name);
        if (descriptor !== undefined) {
            if (descriptor.annotations === undefined) return { origin: 'built-in' };
            return { origin: 'built-in', access: descriptor.annotations.readOnlyHint ? 'read' : 'write' };
        }
        const { workflowTools, manifestTools } = await this.exposedTools();
        if (workflowTools.some((tool) => tool.tool === name)) {
            return { origin: 'workflow', access: 'write' };
        }
        const manifest = manifestTools.find((tool) => tool.tool === name);
        if (manifest !== undefined) {
            return { origin: 'manifest', access: manifest.annotations.readOnlyHint ? 'read' : 'write' };
        }
        return { origin: 'unknown' };
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
        const { workflowTools, manifestTools } = await this.exposedTools();
        const exposed = workflowTools.find((tool) => tool.tool === name);
        if (exposed !== undefined) return this.callWorkflowTool(exposed, args);
        const manifest = manifestTools.find((tool) => tool.tool === name);
        if (manifest !== undefined) return this.callManifestTool(manifest, args);
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
    manifestToolNames: string[];
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
