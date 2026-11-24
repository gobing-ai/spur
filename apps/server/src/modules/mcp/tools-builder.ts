/**
 * Builder tools: read-only dependency drift and branch topology reports.
 *
 * Task 1445 R7 split: the descriptors and handlers that used to sit in `index.ts`, moved here
 * verbatim so each domain owns one file.
 */
import { collectBranchTopology } from '@gobing-ai/spur-app/branch-topology';
import { checkDeps } from '@gobing-ai/spur-app/builder';
import { createSpawnRunner } from '@gobing-ai/spur-app/pr-review';
import { bearerEnv } from '../../middleware/bearer-guard';
import type { McpToolDescriptor } from './protocol';
import { READ_TOOL, type ToolHandler } from './tools-shared';

/** Descriptor rows the module entry composes into `TOOL_DESCRIPTORS`. */
export const descriptors: McpToolDescriptor[] = [
    {
        name: 'sp_builder_check_deps',
        annotations: READ_TOOL,
        description: 'Report stale workspace links and installed/locked dependency drift. Writes nothing. Read-only.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'sp_builder_show_branches',
        annotations: READ_TOOL,
        description:
            'Report branch topology against the resolved base ref. Writes no ref, index or worktree. Read-only.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
];

/** One handler per descriptor name; the module entry's dispatcher delegates here. */
export const dispatch: Record<string, ToolHandler> = {
    sp_builder_check_deps: async (ctx, _args) => {
        // `builder.dependencyScope` decides what is checked; an empty scope checks nothing.
        return checkDeps({ cwd: ctx.cwd, scope: ctx.spurConfig?.builder?.dependencyScope ?? [] });
    },
    sp_builder_show_branches: async (ctx, _args) => {
        return collectBranchTopology(createSpawnRunner({ cwd: ctx.cwd, env: bearerEnv(ctx) }), {
            scope: 'all',
            pr: false,
            limit: 30,
        });
    },
};
