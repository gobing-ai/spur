import { join } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { type FileSystem, parseYamlObject } from '@gobing-ai/ts-runtime';
import { registeredWorkflowPaths, workflowLayers } from '../workflow/workflow-resolver';
import { MCP_BUILTIN_TOOL_NAMES } from './mcp-builtin-tools';

/** One workflow exposed as an MCP tool (task 1381 R2). */
export interface ExposedWorkflowTool {
    /** The derived tool name, `<namespace>_<workflow name with - and other runs mapped to _>`. */
    tool: string;
    /** Absolute path of the workflow definition the tool runs. */
    file: string;
    /** The workflow's declared `name`. */
    workflow: string;
    /** The workflow's top-level `description`, which becomes the tool description. */
    description?: string;
    /** Declared workflow vars; each becomes an optional string property in the tool schema. */
    vars: Record<string, string>;
}

/** Why an exposed workflow cannot become a tool. */
export type McpExposureReason = 'no-namespace' | 'builtin-collision' | 'duplicate';

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

/** What the resolver reads from one workflow definition. */
interface RawExposure {
    name: string;
    description?: string;
    vars: Record<string, string>;
}

/** Read `metadata.mcp.expose === true` and the tool-facing fields from a parsed definition. */
function readExposure(parsed: unknown): RawExposure | null {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const def = parsed as Record<string, unknown>;
    const metadata = def.metadata;
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
    const mcp = (metadata as Record<string, unknown>).mcp;
    if (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)) return null;
    if ((mcp as Record<string, unknown>).expose !== true) return null;
    if (typeof def.name !== 'string' || def.name === '') return null;
    return {
        name: def.name,
        ...(typeof def.description === 'string' && def.description !== '' ? { description: def.description } : {}),
        vars: declaredVars(def.vars),
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
 * Resolve the workflows a project exposes as MCP tools (task 1381 R2/R4).
 *
 * One resolver serves both `tools/list` and `workflow validate`, so a name can never be
 * listed while validate accepts it — or the reverse. Ambiguity is never guessed: without a
 * namespace, on a built-in collision, or when two workflows derive the same name, the file
 * becomes an issue and no tool.
 */
export async function resolveExposedWorkflowTools(input: {
    namespace: string | null;
    reserved: readonly string[];
    roots: string[];
    fs: FileSystem;
}): Promise<{ tools: ExposedWorkflowTool[]; issues: McpExposureIssue[] }> {
    const exposed: Array<{ tool: string; file: string; raw: RawExposure }> = [];
    for (const root of input.roots) {
        for (const file of await walkWorkflowFiles(input.fs, root)) {
            let parsed: unknown;
            try {
                parsed = parseYamlObject(await input.fs.readFile(file));
            } catch {
                continue; // An unparseable definition is `workflow validate`'s finding, not ours.
            }
            const raw = readExposure(parsed);
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
        tools.push({
            tool: entry.tool,
            file: entry.file,
            workflow: entry.raw.name,
            ...(entry.raw.description !== undefined ? { description: entry.raw.description } : {}),
            vars: entry.raw.vars,
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
    return resolveExposedWorkflowTools({
        namespace: input.namespace,
        reserved: MCP_BUILTIN_TOOL_NAMES,
        roots: workflowLayers({
            cwd: input.cwd,
            registered: registeredWorkflowPaths(input.config),
        }).map(({ path }) => path),
        fs: input.fs,
    });
}

/** Describe a workflow with the defaults and argument constraints its dispatcher enforces. */
export function workflowToolDescriptor(tool: ExposedWorkflowTool) {
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
