/**
 * Decision tools: catalog list/show, recorded readiness and a run with inline evidence.
 *
 * Task 1445 R7 split: the descriptors and handlers that used to sit in `index.ts`, moved here
 * verbatim so each domain owns one file.
 */
import {
    confidenceLevel,
    type DecisionStatus,
    getDecisionService,
    readDecisionStatusReadiness,
} from '@gobing-ai/spur-app';
import type { McpToolDescriptor } from './protocol';
import {
    optionalRecord,
    optionalString,
    READ_TOOL,
    requiredString,
    type ToolHandler,
    WRITE_TOOL,
} from './tools-shared';

/** Descriptor rows the module entry composes into `TOOL_DESCRIPTORS`. */
export const descriptors: McpToolDescriptor[] = [
    {
        name: 'sp_decision_list',
        annotations: READ_TOOL,
        description: 'List every served decision with its catalog layer, optionally filtered to one layer. Read-only.',
        inputSchema: {
            type: 'object',
            properties: {
                layer: { type: 'string', enum: ['project', 'registered', 'shared'], description: 'Catalog layer' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'sp_decision_show',
        annotations: READ_TOOL,
        description:
            'Show one decision: type, criteria, parameters, fallback, catalog and layer, plus the effective maker and the source that selected it. Never constructs a maker. Read-only.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Decision id' } },
            required: ['id'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_decision_status',
        annotations: READ_TOOL,
        description:
            'Report decision readiness: the catalog status plus per-decision and per-maker recorded evidence. No live backend probe (that is `spur decision status --probe`). Read-only.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'sp_decision_run',
        annotations: WRITE_TOOL,
        description:
            'Serve one decision once with its effective maker. `evidence` is an inline string that becomes the instructions channel; a file path is never read.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Decision id' },
                params: { type: 'object', description: 'Decision parameter map (inline values)' },
                evidence: { type: 'string', description: 'Evidence text carried as the instructions channel' },
            },
            required: ['id'],
            additionalProperties: false,
        },
    },
];

/** One handler per descriptor name; the module entry's dispatcher delegates here. */
export const dispatch: Record<string, ToolHandler> = {
    sp_decision_list: async (ctx, args) => {
        const layer = optionalString(args, 'layer');
        const service = await getDecisionService(ctx.spurConfig ?? null, ctx.cwd);
        const entries = service.list();
        return layer === undefined ? entries : entries.filter((entry) => entry.layer === layer);
    },
    sp_decision_show: async (ctx, args) => {
        // `describe` throws UnknownDecisionError for an unknown id, as the CLI reports it.
        return (await getDecisionService(ctx.spurConfig ?? null, ctx.cwd)).describe(requiredString(args, 'id'));
    },
    sp_decision_status: async (ctx, _args) => {
        const status: DecisionStatus = (await getDecisionService(ctx.spurConfig ?? null, ctx.cwd)).status();
        // Readiness only: no `probeDecisionMakers` call, so no maker is asked anything.
        const readiness = await readDecisionStatusReadiness(await ctx.systemEventDao(), status);
        return { ...status, perDecision: readiness.perDecision, makers: readiness.makers };
    },
    sp_decision_run: async (ctx, args) => {
        const service = await getDecisionService(ctx.spurConfig ?? null, ctx.cwd);
        const evidence = optionalString(args, 'evidence');
        // Inline values only: `evidence` is the instructions channel, never a file to read.
        const result = await service.decide(requiredString(args, 'id'), {
            ...(optionalRecord(args, 'params') ?? {}),
            ...(evidence === undefined ? {} : { instructions: evidence }),
        });
        return { ...result, confidenceLevel: confidenceLevel(result.confidence) };
    },
};
