/**
 * Rule tools: evaluate a preset, list rules and validate one project rule file.
 *
 * Task 1445 R7 split: the descriptors and handlers that used to sit in `index.ts`, moved here
 * verbatim so each domain owns one file.
 */
import type { McpToolDescriptor } from './protocol';
import { optionalString, projectFile, READ_TOOL, type ToolHandler } from './tools-shared';

/** Descriptor rows the module entry composes into `TOOL_DESCRIPTORS`. */
export const descriptors: McpToolDescriptor[] = [
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
        name: 'sp_rule_list',
        annotations: READ_TOOL,
        description: 'List the discovered rule files in every layer, or the rules one preset resolves to. Read-only.',
        inputSchema: {
            type: 'object',
            properties: { preset: { type: 'string', description: 'Preset name to list rules for' } },
            additionalProperties: false,
        },
    },
    {
        name: 'sp_rule_validate',
        annotations: READ_TOOL,
        description:
            'Validate a rule preset (default recommended-pre-check) or one rule file inside the project, without evaluating anything. Read-only.',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: 'Rule file inside the project (project-relative path)' },
            },
            additionalProperties: false,
        },
    },
];

/** One handler per descriptor name; the module entry's dispatcher delegates here. */
export const dispatch: Record<string, ToolHandler> = {
    sp_rule_run: async (ctx, args) => {
        const result = await ctx.ruleService().evaluate({
            preset: optionalString(args, 'preset') ?? 'recommended-pre-check',
            ...(optionalString(args, 'rule') !== undefined ? { rule: optionalString(args, 'rule') as string } : {}),
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
    },
    sp_rule_list: async (ctx, args) => ctx.ruleService().list(optionalString(args, 'preset')),
    sp_rule_validate: async (ctx, args) => {
        const file = optionalString(args, 'file');
        // A rule file argument is project-confined: no arbitrary path is read from disk.
        return ctx.ruleService().validate({
            source:
                file === undefined
                    ? { kind: 'preset', value: 'recommended-pre-check' }
                    : { kind: 'file', value: projectFile(ctx.cwd, file) },
            json: false,
        });
    },
};
