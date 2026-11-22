import { join } from 'node:path';
import {
    type ExposedWorkflowTool,
    type FeatureShowResult,
    resolveMcpNamespace,
    resolveProjectWorkflowTools,
    type WorkflowRunResult,
    workflowToolDescriptor,
} from '@gobing-ai/spur-app';
import { normalizeTaskStatus } from '@gobing-ai/spur-domain';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import { bearerEnv, bearerGuard } from '../../middleware/bearer-guard';
import type { ServerModule } from '../types';
import {
    handleMcpHttpRequest,
    InvalidArgumentsError,
    type McpHandlerRegistry,
    type McpResourceDescriptor,
    type McpToolAnnotations,
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

/**
 * Frozen annotation pair (1421 R2): reads are idempotent, writes are neither read-only nor
 * idempotent (create, transition and workflow_run are not), and no Spur tool deletes.
 */
const READ_TOOL: McpToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const WRITE_TOOL: McpToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

/** The harness tools the embedded server advertises (built-ins live in the `sp` namespace, task 1379 R1). */
export const TOOL_DESCRIPTORS: McpToolDescriptor[] = [
    {
        name: 'sp_task_show',
        annotations: READ_TOOL,
        description: 'Show one Spur task: metadata plus the full markdown content.',
        inputSchema: {
            type: 'object',
            properties: { wbs: { type: 'string', description: 'Task WBS (e.g. "1372")' } },
            required: ['wbs'],
        },
    },
    {
        name: 'sp_task_create',
        annotations: WRITE_TOOL,
        description:
            'Create one task from a title (optionally linked to a feature and parent). Never runs model-backed ready-prep; refine the task explicitly afterwards.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Task title' },
                featureId: { type: 'string', description: 'Owning feature id (e.g. "K41")' },
                parentWbs: { type: 'string', description: 'Parent task WBS for a child task' },
                template: { type: 'string', description: 'Task template name (feature-impl, feature-verify, ...)' },
                requirements: { type: 'string', description: 'Requirements section body' },
                plan: { type: 'string', description: 'Plan section body' },
            },
            required: ['title'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_update',
        annotations: WRITE_TOOL,
        description:
            'Update one task: exactly one of a section body, a frontmatter field, or a tag add/remove. Status is refused — use sp_task_transition, which runs the guards.',
        inputSchema: {
            type: 'object',
            properties: {
                wbs: { type: 'string', description: 'Task WBS' },
                section: { type: 'string', description: 'Section name to write' },
                content: { type: 'string', description: 'Section body (inline, never a file path)' },
                field: {
                    type: 'string',
                    description: 'Frontmatter field to set (status is refused)',
                    enum: ['priority', 'feature_id', 'ac_numbering', 'ac_altitude'],
                },
                value: { type: 'string', description: 'Field value' },
                addTags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
                removeTags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
            },
            required: ['wbs'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_transition',
        annotations: WRITE_TOOL,
        description:
            'Move one task to another status through the guarded transition seam (verdict and structural gates apply exactly as in the CLI).',
        inputSchema: {
            type: 'object',
            properties: {
                wbs: { type: 'string', description: 'Task WBS' },
                to: { type: 'string', description: 'Target status (todo, wip, verifying, done, blocked, ...)' },
            },
            required: ['wbs', 'to'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_feature_check',
        annotations: READ_TOOL,
        description: 'Run the feature structure/acceptance check. Read-only.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Feature id (e.g. "J94")' },
                as: {
                    type: 'string',
                    enum: ['backlog', 'active', 'verifying', 'done'],
                    description: 'Target lifecycle state',
                },
                strict: { type: 'boolean', description: 'Fail on any finding rather than advisory ones only' },
            },
            required: ['id'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_rule_run',
        annotations: READ_TOOL,
        description:
            'Evaluate a rule preset (default recommended-pre-check) over the project. Presets and rule ids only: no arbitrary file, no source-writing fix mode.',
        inputSchema: {
            type: 'object',
            properties: {
                preset: { type: 'string', description: 'Preset name (default recommended-pre-check)' },
                rule: { type: 'string', description: 'Single rule id to evaluate' },
                failOn: {
                    type: 'string',
                    enum: ['error', 'warning', 'info'],
                    description: 'Severity that fails the run',
                },
                fixMode: {
                    type: 'string',
                    enum: ['none', 'suggest'],
                    description: 'Fix collection: none, or suggest (never apply)',
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_list',
        annotations: READ_TOOL,
        description: 'List Spur tasks, optionally filtered.',
        inputSchema: {
            type: 'object',
            properties: {
                status: { type: 'string' },
                featureId: { type: 'string' },
                parentWbs: { type: 'string' },
                folder: { type: 'string' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'sp_workflow_status',
        annotations: READ_TOOL,
        description: 'Inspect a workflow run (per-run timeline), or list recent runs without a runId.',
        inputSchema: {
            type: 'object',
            properties: { runId: { type: 'string' } },
        },
    },
    {
        name: 'sp_workflow_run',
        annotations: WRITE_TOOL,
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
        annotations: WRITE_TOOL,
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
        const { tools } = await resolveProjectWorkflowTools({
            namespace: this.resolvedNamespace,
            cwd: this.ctx.cwd,
            config: this.ctx.spurConfig ?? null,
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
                errorCode: toolErrorCode(error),
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
        // 1392 R2/R5: the advertised schema IS the contract, so an undeclared argument never
        // reaches a service (no status write, no rule file, no fix-applying mode). The throw
        // travels through the caller's catch, which records it as `invalid_arguments` (1376 R2).
        const descriptor = TOOL_DESCRIPTORS.find((tool) => tool.name === name);
        const violation = descriptor === undefined ? null : validateToolArguments(descriptor, args);
        if (violation !== null) throw new InvalidArgumentsError(violation);
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
            case 'sp_task_create': {
                const result = await this.ctx.taskService().create({
                    title: requiredString(args, 'title'),
                    ...(optionalString(args, 'featureId') !== undefined
                        ? { featureId: optionalString(args, 'featureId') as string }
                        : {}),
                    ...(optionalString(args, 'parentWbs') !== undefined
                        ? { parentWbs: optionalString(args, 'parentWbs') as string }
                        : {}),
                    ...(optionalString(args, 'template') !== undefined
                        ? { template: optionalString(args, 'template') as string }
                        : {}),
                    ...(optionalString(args, 'requirements') !== undefined
                        ? { requirements: optionalString(args, 'requirements') as string }
                        : {}),
                    ...(optionalString(args, 'plan') !== undefined
                        ? { plan: optionalString(args, 'plan') as string }
                        : {}),
                });
                // 1392 R1: no ready-prep dispatch from a server tool — the agent refines explicitly.
                return {
                    wbs: result.ref.id,
                    // `WriteResult` carries the path on `ref` (1392 R1 asks for `filePath`).
                    filePath: result.ref.filePath,
                    warnings: (result as { warnings?: string[] }).warnings ?? [],
                    readiness: 'skipped',
                };
            }
            case 'sp_task_update': {
                const wbs = requiredString(args, 'wbs');
                const section = optionalString(args, 'section');
                const field = optionalString(args, 'field');
                const addTags = stringArray(args, 'addTags');
                const removeTags = stringArray(args, 'removeTags');
                const chosen = [
                    section !== undefined,
                    field !== undefined,
                    addTags !== undefined || removeTags !== undefined,
                ].filter(Boolean).length;
                if (chosen !== 1) {
                    throw new InvalidArgumentsError(
                        'sp_task_update takes exactly one of section+content, field+value, or addTags/removeTags',
                    );
                }
                if (field === 'status') {
                    // R5: a status write must go through the guarded transition seam, never here.
                    throw new InvalidArgumentsError(
                        'sp_task_update refuses field "status": use sp_task_transition so the guards run',
                    );
                }
                if (section !== undefined) {
                    const content = requiredString(args, 'content');
                    // The service's section writer reads a source file (that is how the CLI's
                    // `--section --from-file` works), so inline content lands in a scoped temp file
                    // first and is removed afterwards either way.
                    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
                    const { tmpdir } = await import('node:os');
                    const { join } = await import('node:path');
                    const dir = mkdtempSync(join(tmpdir(), 'spur-mcp-section-'));
                    const sourceFile = join(dir, `${section}.md`);
                    try {
                        writeFileSync(sourceFile, content);
                        const written = await this.ctx.taskService().updateSection(wbs, section, sourceFile, false);
                        return { wbs, section, ...summarizeWrite(written) };
                    } finally {
                        rmSync(dir, { recursive: true, force: true });
                    }
                }
                if (field !== undefined) {
                    try {
                        const written = await this.ctx
                            .taskService()
                            .updateField(wbs, field, requiredString(args, 'value'));
                        return { wbs, field, ...summarizeWrite(written) };
                    } catch (error) {
                        throw withServiceCode(error);
                    }
                }
                const tagged = await this.ctx.taskService().updateTags(wbs, addTags ?? [], removeTags ?? []);
                return { wbs, tags: tagged.tags, ...summarizeWrite(tagged) };
            }
            case 'sp_task_transition': {
                const wbs = requiredString(args, 'wbs');
                const rawTarget = requiredString(args, 'to');
                let to: string;
                try {
                    to = normalizeTaskStatus(rawTarget);
                } catch (error) {
                    throw new InvalidArgumentsError(error instanceof Error ? error.message : String(error));
                }
                try {
                    const transitioned = await this.ctx.transitionTask({ wbs, toStatus: to });
                    return { ...transitioned };
                } catch (error) {
                    // 1392 R4: the guard's code and message travel together, exactly as the CLI
                    // reports them, so an agent can branch on GUARD_DENIED instead of prose.
                    throw withServiceCode(error);
                }
            }
            case 'sp_feature_check': {
                const id = requiredString(args, 'id');
                const as = optionalString(args, 'as');
                const strict = args.strict === true;
                const folders = this.ctx.planningFolders();
                const feature = await this.ctx.featureService().show(id);
                if (feature === null) throw new Error(`Feature ${id} not found`);
                const { FeatureCheckService } = await import('@gobing-ai/spur-app/feature-check');
                const checked = await new FeatureCheckService(this.ctx.fs).check(feature.filePath, id, {
                    featuresDir: folders.featuresDir,
                    tasksDir: folders.tasksDir,
                    ...(as !== undefined ? { as } : {}),
                    ...(strict ? { strict: true } : {}),
                });
                return Array.isArray(checked) ? [...checked] : { ...checked };
            }
            case 'sp_rule_run': {
                const result = await this.ctx.ruleService().evaluate({
                    preset: optionalString(args, 'preset') ?? 'recommended-pre-check',
                    ...(optionalString(args, 'rule') !== undefined
                        ? { rule: optionalString(args, 'rule') as string }
                        : {}),
                    failOn: (optionalString(args, 'failOn') ?? 'error') as 'error' | 'warning' | 'info',
                    fixMode: (optionalString(args, 'fixMode') ?? 'none') as 'none' | 'suggest',
                    json: false,
                    verbose: false,
                    color: {
                        enabled: false,
                        dim: (text: string) => text,
                        red: (text: string) => text,
                        green: (text: string) => text,
                        yellow: (text: string) => text,
                        cyan: (text: string) => text,
                    },
                    // 1392 R3: a programmatic caller wants the result, not stdout.
                    emit: false,
                });
                return {
                    findings: result.findings,
                    fixes: result.fixes,
                    exitCode: result.exitCode,
                    ruleCount: result.ruleCount,
                };
            }
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

/**
 * The catalog `tools/list` and `resources/list` serve, for readers that report it rather than
 * serve it (the Integrations status contract, 1423 R3). One dispatcher, one resolver: the Board can
 * never advertise a tool the protocol refuses.
 */
export async function readMcpCatalog(ctx: ServerContext): Promise<{
    tools: McpToolDescriptor[];
    resources: McpResourceDescriptor[];
}> {
    const dispatcher = new McpDispatcher(ctx);
    return { tools: await dispatcher.listTools(), resources: await dispatcher.listResources() };
}

/** Serve an embedded MCP handler over the injected dispatcher (`createMcpDispatcher`). */
export function createMcpHandler(ctx: ServerContext): (req: Request) => Promise<Response> {
    const dispatcher = new McpDispatcher(ctx);
    return (req: Request) => handleMcpHttpRequest(req, dispatcher);
}

/** `runId`/`wbs` when the call's arguments or its result already carry them (1376 R2). */
/**
 * The JSON-Schema subset the descriptors use: `required`, `type`, `enum`, `additionalProperties`.
 * Returns a message naming the offending argument (mapped to `invalid_arguments` by the emit site).
 */
function validateToolArguments(tool: McpToolDescriptor, args: Record<string, unknown>): string | null {
    const schema = (tool.inputSchema ?? {}) as {
        properties?: Record<string, unknown>;
        required?: unknown;
        additionalProperties?: unknown;
    };
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(schema.required)
        ? schema.required.filter((key): key is string => typeof key === 'string')
        : [];
    for (const key of required) {
        if (args[key] === undefined) return `${key} is required`;
    }
    if (schema.additionalProperties === false) {
        for (const key of Object.keys(args)) {
            if (args[key] === undefined) continue;
            if (!(key in properties)) {
                const accepted = Object.keys(properties);
                return accepted.length > 0
                    ? `unknown argument "${key}"; accepted: ${accepted.join(', ')}`
                    : `unknown argument "${key}"`;
            }
        }
    }
    for (const [key, value] of Object.entries(args)) {
        if (value === undefined) continue;
        const spec = properties[key];
        if (typeof spec !== 'object' || spec === null) continue;
        const rules = spec as { enum?: unknown; type?: unknown };
        if (Array.isArray(rules.enum) && !rules.enum.includes(value)) {
            return `${key} must be one of ${rules.enum.join(', ')}`;
        }
        const expected = typeof rules.type === 'string' ? rules.type : undefined;
        if (expected === 'string' && typeof value !== 'string') return `${key} must be a string`;
        if (expected === 'boolean' && typeof value !== 'boolean') return `${key} must be a boolean`;
        if (expected === 'array' && !Array.isArray(value)) return `${key} must be an array`;
    }
    return null;
}

/**
 * Keep a service error's machine code on the way out (1392 R4): `GuardDeniedError` and the write
 * services carry `code`, and an MCP caller must see the same `CODE: message` the CLI reports.
 */
function withServiceCode(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    // The services signal a refusal through the error CLASS (`GuardDeniedError`), not a `code`
    // field, so the class name is the machine code the CLI's JSON also reports.
    const name = error instanceof Error ? error.name : '';
    if (name === 'GuardDeniedError') return new Error(`GUARD_DENIED: ${message}`);
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && code !== '' ? new Error(`${code}: ${message}`) : new Error(message);
}

/** A string list from an already-schema-validated argument; absent stays undefined. */
function stringArray(args: Record<string, unknown>, key: string): string[] | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new InvalidArgumentsError(`${key} must be an array of strings`);
    return value.map((entry) => {
        if (typeof entry !== 'string') throw new InvalidArgumentsError(`${key} must be an array of strings`);
        return entry;
    });
}

/** The small, stable part of a write result an MCP caller needs (never the whole service object). */
function summarizeWrite(result: { eventName?: string; warnings?: string[] }): Record<string, unknown> {
    return {
        eventName: result.eventName ?? null,
        warnings: result.warnings ?? [],
    };
}

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
function toolErrorCode(error: unknown): 'unknown_tool' | 'invalid_arguments' | 'tool_error' {
    // 1421 R1: argument validation is a CLASS, not a message shape — every validator site throws
    // `InvalidArgumentsError`, so a new message can never be misfiled as a service failure.
    if (error instanceof InvalidArgumentsError) return 'invalid_arguments';
    const message = error instanceof Error ? error.message : String(error);
    // A legacy name that 1379/1380 renamed is not a tool failure — the client sent a name this
    // surface no longer accepts, which is the same signal as an unknown one.
    if (message.startsWith('unknown tool') || message.includes('was renamed to')) return 'unknown_tool';
    return 'tool_error';
}

function requiredString(args: Record<string, unknown>, key: string): string {
    const value = optionalString(args, key);
    if (value === undefined) throw new InvalidArgumentsError(`${key} is required`);
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
        throw new InvalidArgumentsError(`${key} must be a map of strings`);
    }
    const record: Record<string, string> = {};
    for (const [name, entry] of Object.entries(value)) {
        if (typeof entry !== 'string') throw new InvalidArgumentsError(`${key} must be a map of strings`);
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
