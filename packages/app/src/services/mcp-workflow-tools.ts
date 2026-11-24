import { join } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { type FileSystem, parseYamlObject } from '@gobing-ai/ts-runtime';
import { z } from 'zod';
import { registeredWorkflowPaths, workflowLayers } from '../workflow/workflow-resolver';
import { MCP_BUILTIN_TOOL_NAMES } from './mcp-builtin-tools';
import { type ManifestTool, resolveManifestTools } from './mcp-manifest-tools';

/** One typed parameter declared under `metadata.mcp.params` on a workflow (task 1447 R4). */
export interface WorkflowMcpParamSpec {
    /** JSON Schema primitive type accepted from MCP callers before stringifying for workflow vars. */
    type: 'string' | 'number' | 'boolean';
    /** Optional parameter description advertised in `tools/list`. */
    description?: string;
    /** Optional closed set of allowed values. */
    enum?: ReadonlyArray<string | number | boolean>;
    /** Whether callers must supply this parameter. */
    required?: boolean;
}

/** One workflow exposed as an MCP tool (task 1381 R2; typed allowlist params in task 1447 R4). */
export interface ExposedWorkflowTool {
    /** The derived tool name, `<namespace>_<workflow name with - and other runs mapped to _>`. */
    tool: string;
    /** Absolute path of the workflow definition the tool runs. */
    file: string;
    /** The workflow's declared `name`. */
    workflow: string;
    /** The workflow's top-level `description`, which becomes the tool description. */
    description?: string;
    /** Declared workflow vars; each becomes an optional string property when `params` is omitted. */
    vars: Record<string, string>;
    /** Optional typed parameter allowlist from `metadata.mcp.params` (task 1447 R4). */
    params?: Record<string, WorkflowMcpParamSpec>;
}

/** Why an exposed workflow or manifest tool cannot become a tool. */
export type McpExposureReason =
    | 'no-namespace'
    | 'builtin-collision'
    | 'duplicate'
    | 'invalid-manifest'
    | 'invalid-params';

/** One refused exposure, carrying the remedy the operator must apply (task 1381 R4). */
export interface McpExposureIssue {
    tool: string;
    file: string;
    reason: McpExposureReason;
    remedy: string;
}

/** Derive the tool name for one workflow: lowercase, runs of non-alphanumerics become `_`. */
export function workflowToolName(namespace: string, workflow: string): string {
    return `${namespace}_${workflow
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')}`;
}

const workflowParamSpecSchema = z
    .object({
        type: z.enum(['string', 'number', 'boolean']),
        description: z.string().min(1).optional(),
        enum: z
            .array(z.union([z.string(), z.number(), z.boolean()]))
            .min(1)
            .optional(),
        required: z.boolean().optional(),
    })
    .strict();

const workflowParamsMapSchema = z.record(z.string().min(1), workflowParamSpecSchema);

/** What the resolver reads from one workflow definition. */
interface RawExposure {
    name: string;
    description?: string;
    vars: Record<string, string>;
    params?: Record<string, WorkflowMcpParamSpec>;
    invalidParamsReason?: string;
}

/** Parse and validate optional `metadata.mcp.params` against the workflow's declared `vars` (R4). */
function parseWorkflowMcpParams(
    rawParams: unknown,
    vars: Record<string, string>,
): { params?: Record<string, WorkflowMcpParamSpec>; error?: string } {
    if (rawParams === undefined) return {};
    const parsed = workflowParamsMapSchema.safeParse(rawParams);
    if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join('; ');
        return { error: `invalid metadata.mcp.params (${detail})` };
    }
    for (const [key, spec] of Object.entries(parsed.data)) {
        if (!(key in vars)) {
            return { error: `metadata.mcp.params declares "${key}" which is not in vars` };
        }
        if (spec.enum !== undefined) {
            for (const item of spec.enum) {
                if (typeof item !== spec.type) {
                    return {
                        error: `metadata.mcp.params.${key} enum value ${JSON.stringify(item)} does not match type "${spec.type}"`,
                    };
                }
            }
        }
    }
    return { params: parsed.data };
}

/** Read `metadata.mcp.expose === true` and the tool-facing fields from a parsed definition. */
function readExposure(parsed: unknown): RawExposure | null {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const def = parsed as Record<string, unknown>;
    const metadata = def.metadata;
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
    const mcp = (metadata as Record<string, unknown>).mcp;
    if (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)) return null;
    const mcpRecord = mcp as Record<string, unknown>;
    if (mcpRecord.expose !== true) return null;
    if (typeof def.name !== 'string' || def.name === '') return null;
    const vars = declaredVars(def.vars);
    const paramResult = parseWorkflowMcpParams(mcpRecord.params, vars);
    return {
        name: def.name,
        ...(typeof def.description === 'string' && def.description !== '' ? { description: def.description } : {}),
        vars,
        ...(paramResult.params !== undefined ? { params: paramResult.params } : {}),
        ...(paramResult.error !== undefined ? { invalidParamsReason: paramResult.error } : {}),
    };
}

/** Declared workflow vars as `Record<string, string>`; untyped/non-scalar entries are skipped. */
function declaredVars(raw: unknown): Record<string, string> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string') vars[key] = value;
        else if (typeof value === 'number' || typeof value === 'boolean') vars[key] = String(value);
    }
    return vars;
}

/** Collect the definition files under one root (`.yaml`/`.yml`, recursive, dot dirs skipped). */
async function walkWorkflowFiles(fs: FileSystem, dir: string): Promise<string[]> {
    const stat = await fs.stat(dir);
    if (stat === null || !stat.isDirectory()) return [];
    const found: string[] = [];
    for (const entry of await fs.readDir(dir)) {
        if (entry.startsWith('.')) continue;
        const path = join(dir, entry);
        const entryStat = await fs.stat(path);
        if (entryStat === null) continue;
        if (entryStat.isDirectory()) found.push(...(await walkWorkflowFiles(fs, path)));
        else if (entryStat.isFile() && (entry.endsWith('.yaml') || entry.endsWith('.yml'))) found.push(path);
    }
    return found;
}

/**
 * Resolve the workflows a project exposes as MCP tools (task 1381 R2/R4; typed params task 1447 R4).
 *
 * One resolver serves both `tools/list` and `workflow validate`, so a name can never be
 * listed while validate accepts it — or the reverse. Ambiguity is never guessed: without a
 * namespace, on a built-in collision, on invalid `metadata.mcp.params`, or when two workflows
 * derive the same name, the file becomes an issue and no tool.
 */
export async function resolveExposedWorkflowTools(input: {
    namespace: string | null;
    reserved: readonly string[];
    roots: string[];
    /**
     * Roots of Spur-shipped (shared-layer) workflows. Without a namespace their opt-ins are skipped
     * silently — not exposed, but not the operator's misconfiguration either (e.g. `history-anatomy`).
     */
    sharedRoots?: readonly string[];
    fs: FileSystem;
}): Promise<{ tools: ExposedWorkflowTool[]; issues: McpExposureIssue[] }> {
    const exposed: Array<{ tool: string; file: string; raw: RawExposure }> = [];
    const shared = new Set(input.sharedRoots ?? []);
    for (const root of input.roots) {
        for (const file of await walkWorkflowFiles(input.fs, root)) {
            let parsed: unknown;
            try {
                parsed = parseYamlObject(await input.fs.readFile(file));
            } catch {
                continue; // An unparseable definition is `workflow validate`'s finding, not ours.
            }
            const raw = readExposure(parsed);
            if (raw !== null && input.namespace === null && shared.has(root)) continue;
            if (raw !== null) {
                exposed.push({ tool: workflowToolName(input.namespace ?? '<none>', raw.name), file, raw });
            }
        }
    }

    const tools: ExposedWorkflowTool[] = [];
    const issues: McpExposureIssue[] = [];
    const counts = new Map<string, number>();
    for (const entry of exposed) counts.set(entry.tool, (counts.get(entry.tool) ?? 0) + 1);

    for (const entry of exposed.sort((a, b) => a.file.localeCompare(b.file))) {
        if (input.namespace === null) {
            issues.push({
                tool: entry.tool,
                file: entry.file,
                reason: 'no-namespace',
                remedy: `set SPUR_MCP_NAMESPACE (or add exactly one plugins/*/plugin.json) so "${entry.raw.name}" can be exposed as <namespace>_${entry.raw.name}`,
            });
            continue;
        }
        if ((counts.get(entry.tool) ?? 0) > 1) {
            issues.push({
                tool: entry.tool,
                file: entry.file,
                reason: 'duplicate',
                remedy: `rename the workflow "${entry.raw.name}" or the other definition deriving "${entry.tool}" so each exposed workflow has a unique tool name`,
            });
            continue;
        }
        if (input.reserved.includes(entry.tool)) {
            issues.push({
                tool: entry.tool,
                file: entry.file,
                reason: 'builtin-collision',
                remedy: `rename the workflow "${entry.raw.name}" — "${entry.tool}" is a built-in tool name`,
            });
            continue;
        }
        if (entry.raw.invalidParamsReason !== undefined) {
            issues.push({
                tool: entry.tool,
                file: entry.file,
                reason: 'invalid-params',
                remedy: `fix ${entry.raw.invalidParamsReason} in "${entry.raw.name}"`,
            });
            continue;
        }
        tools.push({
            tool: entry.tool,
            file: entry.file,
            workflow: entry.raw.name,
            ...(entry.raw.description !== undefined ? { description: entry.raw.description } : {}),
            vars: entry.raw.vars,
            ...(entry.raw.params !== undefined ? { params: entry.raw.params } : {}),
        });
    }

    return { tools, issues };
}

/** Resolve the same project workflow inventory for discovery, dispatch and validation. */
export function resolveProjectWorkflowTools(input: {
    cwd: string;
    config: SpurConfig | null;
    namespace: string | null;
    fs: FileSystem;
}): ReturnType<typeof resolveExposedWorkflowTools> {
    const layers = workflowLayers({ cwd: input.cwd, registered: registeredWorkflowPaths(input.config) });
    return resolveExposedWorkflowTools({
        namespace: input.namespace,
        reserved: MCP_BUILTIN_TOOL_NAMES,
        roots: layers.map(({ path }) => path),
        sharedRoots: layers.filter(({ id }) => id === 'shared').map(({ path }) => path),
        fs: input.fs,
    });
}

/** Combined project MCP tool inventory across exposed workflows and `plugins/<ns>/mcp-tools.yaml` (task 1447 R5). */
export interface ResolvedProjectMcpTools {
    /** Opted-in workflow tools for this project. */
    workflowTools: ExposedWorkflowTool[];
    /** Manifest-declared CLI tools for this project. */
    manifestTools: ManifestTool[];
    /** Refused workflow and manifest exposures with operator remedies. */
    issues: McpExposureIssue[];
}

/**
 * Resolve all project-owned MCP tools — exposed workflows first, then `plugins/<namespace>/mcp-tools.yaml`
 * with built-in names and resolved workflow names reserved so existing workflow tools win collisions (R5).
 */
export async function resolveProjectMcpTools(input: {
    cwd: string;
    config: SpurConfig | null;
    namespace: string | null;
    fs: FileSystem;
}): Promise<ResolvedProjectMcpTools> {
    const workflow = await resolveProjectWorkflowTools(input);
    const manifest = await resolveManifestTools({
        namespace: input.namespace,
        projectRoot: input.cwd,
        fs: input.fs,
        reserved: MCP_BUILTIN_TOOL_NAMES,
        workflowTools: workflow.tools.map((tool) => tool.tool),
    });
    return {
        workflowTools: workflow.tools,
        manifestTools: manifest.tools,
        issues: [...workflow.issues, ...manifest.issues],
    };
}

/** Describe a workflow with the defaults and argument constraints its dispatcher enforces. */
export function workflowToolDescriptor(tool: ExposedWorkflowTool) {
    if (tool.params !== undefined) {
        const properties: Record<string, Record<string, unknown>> = {};
        const required: string[] = [];
        for (const [name, spec] of Object.entries(tool.params)) {
            const prop: Record<string, unknown> = { type: spec.type };
            if (spec.description !== undefined) prop.description = spec.description;
            if (spec.enum !== undefined) prop.enum = [...spec.enum];
            properties[name] = prop;
            if (spec.required === true) required.push(name);
        }
        return {
            name: tool.tool,
            description: tool.description ?? `Run the "${tool.workflow}" workflow.`,
            inputSchema: {
                type: 'object',
                properties,
                ...(required.length > 0 ? { required } : {}),
                additionalProperties: false,
            },
            // 1421 R2: a workflow tool starts work, so it is a write and not idempotent — frozen.
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        };
    }

    return {
        name: tool.tool,
        description: tool.description ?? `Run the "${tool.workflow}" workflow.`,
        inputSchema: {
            type: 'object',
            properties: Object.fromEntries(
                Object.entries(tool.vars).map(([name, value]) => [name, { type: 'string', default: value }]),
            ),
            additionalProperties: false,
        },
        // 1421 R2: a workflow tool starts work, so it is a write and not idempotent — the same
        // frozen values every write-shaped tool carries.
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    };
}
