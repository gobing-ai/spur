/**
 * Self tools: status, project search and SDLC action resolution (nothing is executed).
 *
 * Task 1445 R7 split: the descriptors and handlers that used to sit in `index.ts`, moved here
 * verbatim so each domain owns one file.
 */
import { collectSelfStatus, gitContext } from '@gobing-ai/spur-app';
import { listActions, resolveAction } from '@gobing-ai/spur-app/sdlc-actions';
import { searchProject, searchStatus } from '@gobing-ai/spur-app/search';
import { bearerEnv } from '../../middleware/bearer-guard';
import { InvalidArgumentsError, type McpToolDescriptor } from './protocol';
import { optionalString, READ_TOOL, stringArray, type ToolHandler } from './tools-shared';

/** Descriptor rows the module entry composes into `TOOL_DESCRIPTORS`. */
export const descriptors: McpToolDescriptor[] = [
    {
        name: 'sp_self_status',
        annotations: READ_TOOL,
        description:
            'Report consolidated readiness (project, package, agents, git, decision maker, tools, ledger). No gateway-daemon probe and no schema write. Read-only.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'sp_self_search',
        annotations: READ_TOOL,
        description:
            'Search docs and code through the hybrid backend, or report backend readiness with status. Never runs an install or index command. Read-only.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query (optional only with status)' },
                mode: { type: 'string', enum: ['exact', 'fuzzy', 'auto'], description: 'Search route' },
                scope: { type: 'string', enum: ['docs', 'code', 'all'], description: 'Search scope' },
                glob: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Extra backend globs (prefix ! negates)',
                },
                limit: { type: 'number', description: 'Maximum hits per group (1-100)' },
                regex: { type: 'boolean', description: 'Treat the query as a regular expression (exact route)' },
                status: { type: 'boolean', description: 'Report backend readiness instead of results' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'sp_self_actions',
        annotations: READ_TOOL,
        description:
            'List the resolved SDLC actions, or resolve one by name and return its command. Never runs it. Read-only.',
        inputSchema: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Action name to resolve' } },
            additionalProperties: false,
        },
    },
];

/** One handler per descriptor name; the module entry's dispatcher delegates here. */
export const dispatch: Record<string, ToolHandler> = {
    sp_self_status: async (ctx, _args) => {
        // `collectSelfStatus` only: the gateway-daemon probe is CLI-local (Q&A closed).
        return collectSelfStatus({
            cwd: ctx.cwd,
            env: bearerEnv(ctx),
            config: ctx.spurConfig ?? null,
            git: await gitContext(ctx.cwd),
        });
    },
    sp_self_search: async (ctx, args) => {
        if (args.status === true) return searchStatus(ctx.cwd);
        const query = optionalString(args, 'query');
        if (query === undefined) {
            throw new InvalidArgumentsError('sp_self_search requires query (or status: true)');
        }
        const globs = stringArray(args, 'glob');
        return searchProject(
            {
                query,
                ...(optionalString(args, 'mode') !== undefined ? { mode: optionalString(args, 'mode') as string } : {}),
                ...(optionalString(args, 'scope') !== undefined
                    ? { scope: optionalString(args, 'scope') as string }
                    : {}),
                ...(globs !== undefined ? { globs } : {}),
                ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
                ...(args.regex === true ? { regex: true } : {}),
            },
            ctx.cwd,
        );
    },
    sp_self_actions: async (ctx, args) => {
        const name = optionalString(args, 'name');
        // Resolution only: the resolved command is returned, never executed.
        return name === undefined ? listActions(ctx.spurConfig?.builder) : resolveAction(ctx.spurConfig?.builder, name);
    },
};
