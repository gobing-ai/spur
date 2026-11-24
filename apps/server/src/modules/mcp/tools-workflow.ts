/**
 * Workflow tools: status/run/continue plus list, show, validate and cancel.
 *
 * Task 1445 R7 split: the descriptors and handlers that used to sit in `index.ts`, moved here
 * verbatim so each domain owns one file.
 */
import { registeredWorkflowPaths, resolveWorkflowDefinition } from '@gobing-ai/spur-app';
import type { McpToolDescriptor } from './protocol';
import { optionalString, READ_TOOL, requiredString, stringRecord, type ToolHandler, WRITE_TOOL } from './tools-shared';

/** Descriptor rows the module entry composes into `TOOL_DESCRIPTORS`. */
export const descriptors: McpToolDescriptor[] = [
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
        name: 'sp_workflow_list',
        annotations: READ_TOOL,
        description: 'List workflow YAML files across the project, registered and shared layers. Read-only.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'sp_workflow_show',
        annotations: READ_TOOL,
        description:
            'Resolve one workflow definition: states, transitions, vars, mcp exposure, plus the resolved layer, path and definition digest. Read-only.',
        inputSchema: {
            type: 'object',
            properties: { file: { type: 'string', description: 'Workflow file or bare name' } },
            required: ['file'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_workflow_validate',
        annotations: READ_TOOL,
        description:
            'Validate one workflow definition (schema, guards, composition) as `spur workflow validate` does. Read-only.',
        inputSchema: {
            type: 'object',
            properties: { file: { type: 'string', description: 'Workflow file or bare name' } },
            required: ['file'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_workflow_cancel',
        annotations: WRITE_TOOL,
        description:
            'Cancel one non-terminal run by id (mark it failed). A terminal run is left untouched; the bulk variant is `spur workflow clean`.',
        inputSchema: {
            type: 'object',
            properties: { runId: { type: 'string', description: 'Run id to cancel' } },
            required: ['runId'],
            additionalProperties: false,
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

/** One handler per descriptor name; the module entry's dispatcher delegates here. */
export const dispatch: Record<string, ToolHandler> = {
    sp_workflow_status: async (ctx, args) => {
        const runId = optionalString(args, 'runId');
        return runId === undefined ? ctx.workflowService().trace() : ctx.workflowService().trace(runId);
    },
    sp_workflow_run: async (ctx, args) => {
        return ctx.workflowService().run(requiredString(args, 'file'), {
            vars: stringRecord(args, 'vars'),
            ...(args.dryRun === true ? { dryRun: true } : {}),
        });
    },
    sp_workflow_list: async (ctx, _args) => ctx.workflowService().list(registeredWorkflowPaths(ctx.spurConfig ?? null)),
    sp_workflow_show: async (ctx, args) => {
        // The same resolver `spur workflow show` renders from: one identity, one digest.
        const resolved = await resolveWorkflowDefinition(ctx.cwd, requiredString(args, 'file'), {
            registered: registeredWorkflowPaths(ctx.spurConfig ?? null),
        });
        const def = resolved.workflow;
        return {
            name: def.name,
            kind: def.kind ?? 'state-machine',
            version: def.version ?? null,
            description: def.description ?? null,
            definitionDigest: resolved.digest,
            source: { layer: resolved.layer, path: resolved.path },
            states: 'states' in def ? def.states : [],
            transitions: 'transitions' in def ? def.transitions : [],
            vars: def.vars ?? {},
            mcp: ('metadata' in def ? def.metadata?.mcp : undefined) ?? null,
        };
    },
    sp_workflow_validate: async (ctx, args) => ctx.workflowService().validate(requiredString(args, 'file')),
    sp_workflow_cancel: async (ctx, args) => {
        const runId = requiredString(args, 'runId');
        const result = await ctx.workflowService().cancel(runId);
        // The CLI reports an unknown run as NOT_FOUND; over MCP it is a tool error, not a value.
        if (result.status === 'not_found') throw new Error(`Run ${runId} not found`);
        return result;
    },
    sp_workflow_continue: async (ctx, args) => {
        const runId = optionalString(args, 'runId') ?? (await ctx.workflowService().latestPausedRun())?.runId;
        if (runId === undefined) {
            throw new Error('no paused workflow run to continue; pass a runId');
        }
        return ctx.workflowService().continuePaused(runId, {
            ...(typeof args.answerText === 'string' ? { answerText: args.answerText } : {}),
        });
    },
};
