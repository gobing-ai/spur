import { join } from 'node:path';
import { type FileSystem, parseYamlObject } from '@gobing-ai/ts-runtime';
import { z } from 'zod';
import { MCP_BUILTIN_TOOL_NAMES } from './mcp-builtin-tools';
import type { McpExposureIssue } from './mcp-workflow-tools';

/** Maximum byte/character length accepted for any string argument to a manifest tool (R3). */
export const MANIFEST_MAX_STRING_ARG_LENGTH = 1024;

/** Maximum stdout size in bytes before a manifest tool call fails closed (R3: 1 MiB). */
export const MANIFEST_MAX_STDOUT_BYTES = 1024 * 1024;

/** Maximum stderr tail length included in a manifest tool error message (R3). */
export const MANIFEST_STDERR_TAIL_CHARS = 2000;

/** Marks invalid arguments supplied to a manifest tool before any subprocess spawns (R3). */
export class ManifestInvalidArgumentsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ManifestInvalidArgumentsError';
    }
}

/** Tool name grammar for entries in `plugins/<namespace>/mcp-tools.yaml` (R1). */
export const MANIFEST_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;

/** Schema for one parameter declared in a manifest tool entry (R1). */
export const manifestParamSchema = z
    .object({
        type: z.enum(['string', 'number', 'boolean']),
        description: z.string().min(1).optional(),
        enum: z
            .array(z.union([z.string(), z.number(), z.boolean()]))
            .min(1)
            .optional(),
        default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        required: z.boolean().optional(),
    })
    .strict();

/** Inferred parameter specification for a manifest tool. */
export type ManifestToolParam = z.infer<typeof manifestParamSchema>;

/** Schema for the three required MCP behavior annotations on a manifest tool (R1). */
export const manifestAnnotationsSchema = z
    .object({
        readOnlyHint: z.boolean(),
        destructiveHint: z.boolean(),
        idempotentHint: z.boolean(),
    })
    .strict();

/** Inferred annotations block for a manifest tool. */
export type ManifestToolAnnotations = z.infer<typeof manifestAnnotationsSchema>;

/** Schema for one tool entry in `plugins/<namespace>/mcp-tools.yaml` (R1). */
export const manifestToolEntrySchema = z
    .object({
        name: z.string().regex(MANIFEST_TOOL_NAME_PATTERN, 'must match ^[a-z][a-z0-9_]{0,47}$'),
        description: z.string().min(1),
        annotations: manifestAnnotationsSchema,
        params: z.record(z.string().min(1), manifestParamSchema).optional(),
        command: z.array(z.string().min(1)).min(1),
        args: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)).optional(),
        output: z.enum(['json', 'text']).default('text'),
        timeoutMs: z.number().int().min(1000).max(120000).default(30000),
    })
    .strict();

/** Top-level Zod schema for `plugins/<namespace>/mcp-tools.yaml` (R1). */
export const manifestSchema = z
    .object({
        schema_version: z.literal(1),
        tools: z.array(manifestToolEntrySchema),
    })
    .strict();

/** Envelope-only schema so a single invalid tool entry does not discard valid siblings in the same file. */
const manifestEnvelopeSchema = z
    .object({
        schema_version: z.literal(1),
        tools: z.array(z.unknown()),
    })
    .strict();

/** One validated manifest tool ready for discovery and execution (R1/R2). */
export interface ManifestTool {
    /** Exposed MCP tool name (`<namespace>_<name>`). */
    tool: string;
    /** Local tool name inside the manifest. */
    name: string;
    /** Absolute path to the `mcp-tools.yaml` manifest. */
    file: string;
    /** Human-readable tool summary. */
    description: string;
    /** Required MCP behavior hints. */
    annotations: ManifestToolAnnotations;
    /** Declared parameter map (empty when omitted). */
    params: Record<string, ManifestToolParam>;
    /** Fixed command argv with no placeholders. */
    command: string[];
    /** Per-parameter argv fragments. */
    args: Record<string, string[]>;
    /** Output decoding mode (`json` or `text`). */
    output: 'json' | 'text';
    /** Execution timeout in milliseconds (1000–120000). */
    timeoutMs: number;
}

/** Input for {@link resolveManifestTools}. */
export interface ResolveManifestToolsInput {
    /** Resolved project namespace; `null` yields no tools and no issues. */
    namespace: string | null;
    /** Project root containing `plugins/<namespace>/mcp-tools.yaml`. */
    projectRoot: string;
    /** Filesystem abstraction. */
    fs: FileSystem;
    /** Built-in tool names that produce `builtin-collision`. Defaults to {@link MCP_BUILTIN_TOOL_NAMES}. */
    reserved?: readonly string[];
    /** Exposed workflow tool names that win collisions and produce `duplicate`. */
    workflowTools?: readonly string[];
}

/** Validate entry-level semantic invariants that go beyond structural Zod parsing (R1/R2). */
function validateEntrySemantics(entry: z.infer<typeof manifestToolEntrySchema>): string | null {
    for (const part of entry.command) {
        if (part.includes('{value}')) {
            return 'command must be a fixed argv with no "{value}" placeholder';
        }
    }

    const params = entry.params ?? {};
    const args = entry.args ?? {};
    const argKeys = Object.keys(args);

    for (const key of argKeys) {
        if (!(key in params)) {
            return `args declares "${key}" which is not in params`;
        }
    }

    for (const [key, param] of Object.entries(params)) {
        const fragment = args[key];
        if (fragment === undefined) {
            return `param "${key}" has no matching args fragment`;
        }
        if (param.enum !== undefined) {
            for (const item of param.enum) {
                if (typeof item !== param.type) {
                    return `param "${key}" enum value ${JSON.stringify(item)} does not match type "${param.type}"`;
                }
            }
        }
        if (param.default !== undefined && typeof param.default !== param.type) {
            return `param "${key}" default does not match type "${param.type}"`;
        }

        if (param.type === 'boolean') {
            if (fragment.some((el) => el.includes('{value}'))) {
                return `boolean param "${key}" args fragment must not contain "{value}"`;
            }
        } else {
            let exactCount = 0;
            for (const el of fragment) {
                if (el === '{value}') {
                    exactCount += 1;
                } else if (el.includes('{value}')) {
                    return `param "${key}" args fragment "${el}" must not interpolate "{value}" inside another token`;
                }
            }
            if (exactCount !== 1) {
                return `param "${key}" args fragment must contain exactly one "{value}" element`;
            }
        }
    }

    return null;
}

/**
 * Resolve manifest-declared MCP tools from `plugins/<namespace>/mcp-tools.yaml` (task 1447 R2).
 *
 * A missing manifest returns empty tools and no issues. Parse/schema failures, invalid fragments,
 * built-in collisions, workflow collisions, and internal duplicates are recorded as
 * {@link McpExposureIssue} entries and refused — never thrown and never listed.
 */
export async function resolveManifestTools(
    input: ResolveManifestToolsInput,
): Promise<{ tools: ManifestTool[]; issues: McpExposureIssue[] }> {
    if (input.namespace === null) return { tools: [], issues: [] };
    const file = join(input.projectRoot, 'plugins', input.namespace, 'mcp-tools.yaml');
    const stat = await input.fs.stat(file);
    if (stat === null || !stat.isFile()) return { tools: [], issues: [] };

    let parsed: unknown;
    try {
        parsed = parseYamlObject(await input.fs.readFile(file));
    } catch (error) {
        return {
            tools: [],
            issues: [
                {
                    tool: `${input.namespace}_*`,
                    file,
                    reason: 'invalid-manifest',
                    remedy: `fix YAML syntax in ${file}: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }

    const envelope = manifestEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
        const detail = envelope.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
        return {
            tools: [],
            issues: [
                {
                    tool: `${input.namespace}_*`,
                    file,
                    reason: 'invalid-manifest',
                    remedy: `fix top-level schema in ${file} (${detail})`,
                },
            ],
        };
    }

    const issues: McpExposureIssue[] = [];
    const candidates: ManifestTool[] = [];

    for (let idx = 0; idx < envelope.data.tools.length; idx++) {
        const rawEntry = envelope.data.tools[idx];
        const rawName =
            typeof rawEntry === 'object' &&
            rawEntry !== null &&
            typeof (rawEntry as Record<string, unknown>).name === 'string'
                ? ((rawEntry as Record<string, unknown>).name as string)
                : `tools[${idx}]`;
        const derivedTool = `${input.namespace}_${rawName}`;

        const parsedEntry = manifestToolEntrySchema.safeParse(rawEntry);
        if (!parsedEntry.success) {
            const detail = parsedEntry.error.issues
                .map((i) => `${i.path.join('.') || '<entry>'}: ${i.message}`)
                .join('; ');
            issues.push({
                tool: derivedTool,
                file,
                reason: 'invalid-manifest',
                remedy: `fix manifest tool "${rawName}" in ${file} (${detail})`,
            });
            continue;
        }

        const semanticError = validateEntrySemantics(parsedEntry.data);
        if (semanticError !== null) {
            issues.push({
                tool: `${input.namespace}_${parsedEntry.data.name}`,
                file,
                reason: 'invalid-manifest',
                remedy: `fix manifest tool "${parsedEntry.data.name}" in ${file}: ${semanticError}`,
            });
            continue;
        }

        candidates.push({
            tool: `${input.namespace}_${parsedEntry.data.name}`,
            name: parsedEntry.data.name,
            file,
            description: parsedEntry.data.description,
            annotations: parsedEntry.data.annotations,
            params: parsedEntry.data.params ?? {},
            command: parsedEntry.data.command,
            args: parsedEntry.data.args ?? {},
            output: parsedEntry.data.output,
            timeoutMs: parsedEntry.data.timeoutMs,
        });
    }

    const builtins = new Set(input.reserved ?? MCP_BUILTIN_TOOL_NAMES);
    const workflows = new Set(input.workflowTools ?? []);
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
        counts.set(candidate.tool, (counts.get(candidate.tool) ?? 0) + 1);
    }

    const tools: ManifestTool[] = [];
    for (const candidate of candidates) {
        if (builtins.has(candidate.tool)) {
            issues.push({
                tool: candidate.tool,
                file,
                reason: 'builtin-collision',
                remedy: `rename manifest tool "${candidate.name}" — "${candidate.tool}" is a built-in tool name`,
            });
            continue;
        }
        if (workflows.has(candidate.tool)) {
            issues.push({
                tool: candidate.tool,
                file,
                reason: 'duplicate',
                remedy: `rename manifest tool "${candidate.name}" — "${candidate.tool}" is already exposed by a workflow`,
            });
            continue;
        }
        if ((counts.get(candidate.tool) ?? 0) > 1) {
            issues.push({
                tool: candidate.tool,
                file,
                reason: 'duplicate',
                remedy: `remove or rename duplicate manifest tool "${candidate.name}" in ${file}`,
            });
            continue;
        }
        tools.push(candidate);
    }

    return { tools, issues };
}

/** Build the MCP `tools/list` descriptor for one validated manifest tool (R1/R5). */
export function manifestToolDescriptor(tool: ManifestTool) {
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];

    for (const [key, spec] of Object.entries(tool.params)) {
        const prop: Record<string, unknown> = { type: spec.type };
        if (spec.description !== undefined) prop.description = spec.description;
        if (spec.enum !== undefined) prop.enum = [...spec.enum];
        if (spec.default !== undefined) prop.default = spec.default;
        properties[key] = prop;
        if (spec.required === true) required.push(key);
    }

    return {
        name: tool.tool,
        description: tool.description,
        inputSchema: {
            type: 'object',
            properties,
            ...(required.length > 0 ? { required } : {}),
            additionalProperties: false,
        },
        annotations: tool.annotations,
    };
}

/**
 * Validate caller arguments against a manifest tool's schema and build the discrete argv array
 * without shell interpolation (task 1447 R3).
 */
export function buildManifestArgv(tool: ManifestTool, args: Record<string, unknown>): string[] {
    const accepted = Object.keys(tool.params);
    for (const [key, value] of Object.entries(args)) {
        if (value === undefined) continue;
        if (!(key in tool.params)) {
            throw new ManifestInvalidArgumentsError(
                `invalid_arguments: tool "${tool.tool}" accepts only ${accepted.length === 0 ? 'no arguments' : accepted.join(', ')}; got "${key}"`,
            );
        }
    }

    const argv: string[] = [...tool.command];

    for (const [key, spec] of Object.entries(tool.params)) {
        const supplied = args[key];
        const value = supplied !== undefined ? supplied : spec.default;
        if (value === undefined) {
            if (spec.required === true) {
                throw new ManifestInvalidArgumentsError(
                    `invalid_arguments: tool "${tool.tool}" requires argument "${key}"`,
                );
            }
            continue;
        }

        if (spec.type === 'string') {
            if (typeof value !== 'string') {
                throw new ManifestInvalidArgumentsError(
                    `invalid_arguments: tool "${tool.tool}" argument "${key}" must be a string`,
                );
            }
            if (value.length > MANIFEST_MAX_STRING_ARG_LENGTH) {
                throw new ManifestInvalidArgumentsError(
                    `invalid_arguments: tool "${tool.tool}" argument "${key}" exceeds ${MANIFEST_MAX_STRING_ARG_LENGTH} characters`,
                );
            }
            if (spec.enum === undefined && value.startsWith('-')) {
                throw new ManifestInvalidArgumentsError(
                    `invalid_arguments: tool "${tool.tool}" argument "${key}" must not start with "-"`,
                );
            }
        } else if (spec.type === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                throw new ManifestInvalidArgumentsError(
                    `invalid_arguments: tool "${tool.tool}" argument "${key}" must be a finite number`,
                );
            }
        } else if (spec.type === 'boolean') {
            if (typeof value !== 'boolean') {
                throw new ManifestInvalidArgumentsError(
                    `invalid_arguments: tool "${tool.tool}" argument "${key}" must be a boolean`,
                );
            }
        }

        if (spec.enum !== undefined && !spec.enum.includes(value as string | number | boolean)) {
            throw new ManifestInvalidArgumentsError(
                `invalid_arguments: tool "${tool.tool}" argument "${key}" must be one of ${spec.enum.join(', ')}`,
            );
        }

        const fragment = tool.args[key] ?? [];
        if (spec.type === 'boolean') {
            if (value === true) argv.push(...fragment);
        } else {
            for (const element of fragment) {
                argv.push(element === '{value}' ? String(value) : element);
            }
        }
    }

    return argv;
}
