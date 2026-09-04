import { basename, isAbsolute, join, resolve } from 'node:path';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import { loadWorkflowDef, type WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { parse as yamlParse } from 'yaml';
import { computeDefinitionDigest } from './composition-baseline';

/** Sentinel manifest prefix for embedded-schema resolution. */
export const EMBEDDED_SCHEMA_PREFIX = '\0embedded-spur';

/** The package whose `$schema` package-specifier refs resolve to the embedded map. */
export const SPUR_SCHEMA_MANIFEST = '@gobing-ai/spur/package.json';

/**
 * Result of {@link resolveWorkflowFile}: either a resolved path with its source
 * layer, or a not-found pair of probed absolute paths. `probed[1]` is `null` when
 * `bundledConfigRoot()` returned `null` (the compiled-binary case).
 */
export type ResolveWorkflowFileResult =
    | { path: string; source: 'project' | 'bundled' }
    | { path: null; probed: [string, string | null] };

/**
 * Resolved and loaded workflow definition with its digest and source layer.
 */
export interface ResolvedWorkflowDefinition {
    path: string;
    workflow: WorkflowDef;
    digest: string;
    layer: 'project' | 'bundled';
}

/** Options configuring workflow definition resolution and schema validation. */
export interface ResolveWorkflowDefinitionOptions {
    validateSchema?: boolean;
    embeddedSchemas?: ReadonlyMap<string, string>;
}

/**
 * Build fileSystem option for loadWorkflowDef from an embedded schemas map.
 */
export function createEmbeddedSchemaOptions(embedded?: ReadonlyMap<string, string>):
    | {
          resolve: (specifier: string) => string;
          fileSystem: { readFile(p: string): Promise<string> };
      }
    | undefined {
    if (embedded === undefined || embedded.size === 0) return undefined;
    const nodeFs = createNodeFileSystem();
    return {
        resolve: (specifier: string) =>
            specifier === SPUR_SCHEMA_MANIFEST ? `${EMBEDDED_SCHEMA_PREFIX}/package.json` : specifier,
        fileSystem: {
            readFile: async (path: string) => {
                if (!path.startsWith(EMBEDDED_SCHEMA_PREFIX)) return nodeFs.readFile(path);
                const subpath = path.slice(EMBEDDED_SCHEMA_PREFIX.length + 1);
                const text = embedded.get(subpath);
                if (text === undefined) throw new Error(`No embedded schema registered for "${subpath}".`);
                return text;
            },
        },
    };
}

async function readWorkflowNameFast(fs: FileSystem, filePath: string): Promise<string | null> {
    try {
        const text = await fs.readFile(filePath);
        const parsed = yamlParse(text);
        return typeof parsed?.name === 'string' ? parsed.name : null;
    } catch {
        return null;
    }
}

async function scanWorkflowByName(
    cwd: string,
    name: string,
): Promise<{ path: string; source: 'project' | 'bundled' } | null> {
    const fs = createNodeFileSystem();

    // 1. Scan project files by workflow name
    const projectSpurDir = resolve(cwd, '.spur', 'workflows');
    if (fs.exists(projectSpurDir)) {
        try {
            const files = (await fs.readDir(projectSpurDir)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
            for (const f of files) {
                const abs = join(projectSpurDir, f);
                const wfName = await readWorkflowNameFast(fs, abs);
                if (wfName === name) {
                    return { path: abs, source: 'project' };
                }
            }
        } catch {
            // ignore readdir errors
        }
    }

    // 2. Scan bundled files by workflow name
    const bundledRoot = bundledConfigRoot();
    if (bundledRoot !== null) {
        const bundledWorkflowsDir = join(bundledRoot, 'workflows');
        if (fs.exists(bundledWorkflowsDir)) {
            try {
                const files = (await fs.readDir(bundledWorkflowsDir)).filter(
                    (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
                );
                for (const f of files) {
                    const abs = join(bundledWorkflowsDir, f);
                    const wfName = await readWorkflowNameFast(fs, abs);
                    if (wfName === name) {
                        return { path: abs, source: 'bundled' };
                    }
                }
            } catch {
                // ignore readdir errors
            }
        }
    }

    return null;
}

/**
 * Resolve a workflow path across project and bundled tiers (task 0752 / ADR-099).
 *
 * Precedence is project-first on every surface (R4):
 * 1. Project exact path (cwd-relative or absolute).
 * 2. Project `.spur/workflows/<file>.yaml`, `<file>.yaml`, etc.
 * 3. Bundled config root `workflows/<file>.yaml`.
 *
 * Returns `{ path, source }` or a not-found probe pair.
 */
export function resolveWorkflowFile(cwd: string, file: string): ResolveWorkflowFileResult {
    const fs = createNodeFileSystem();
    const projectPath = resolve(cwd, file);
    if (fs.exists(projectPath)) {
        return { path: projectPath, source: 'project' };
    }

    const isYaml = file.endsWith('.yaml') || file.endsWith('.yml');
    const base = basename(file);

    if (!isAbsolute(file)) {
        const withYaml = isYaml ? file : `${file}.yaml`;
        const projectSpur = resolve(cwd, '.spur', 'workflows', withYaml);
        if (fs.exists(projectSpur)) {
            return { path: projectSpur, source: 'project' };
        }
        if (!isYaml) {
            const projectDirect = resolve(cwd, `${file}.yaml`);
            if (fs.exists(projectDirect)) {
                return { path: projectDirect, source: 'project' };
            }
            const projectSpurPipeline = resolve(cwd, '.spur', 'workflows', `${file}-pipeline.yaml`);
            if (fs.exists(projectSpurPipeline)) {
                return { path: projectSpurPipeline, source: 'project' };
            }
            const projectDirectPipeline = resolve(cwd, `${file}-pipeline.yaml`);
            if (fs.exists(projectDirectPipeline)) {
                return { path: projectDirectPipeline, source: 'project' };
            }
        }
    }

    const bundledRoot = bundledConfigRoot();
    if (bundledRoot !== null) {
        const bundledName = isYaml ? base : `${base}.yaml`;
        const bundledPath = join(bundledRoot, 'workflows', bundledName);
        if (fs.exists(bundledPath)) {
            return { path: bundledPath, source: 'bundled' };
        }
        if (!isYaml) {
            const bundledPipeline = join(bundledRoot, 'workflows', `${base}-pipeline.yaml`);
            if (fs.exists(bundledPipeline)) {
                return { path: bundledPipeline, source: 'bundled' };
            }
            const bundledLiteral = join(bundledRoot, 'workflows', base);
            if (fs.exists(bundledLiteral)) {
                return { path: bundledLiteral, source: 'bundled' };
            }
        }
        return { path: null, probed: [projectPath, bundledPath] };
    }
    return { path: null, probed: [projectPath, null] };
}

/**
 * Unified resolve and preflight seam serving run, continue, and validate (task 0752 / R1).
 *
 * Resolves the file project-first, loads the definition under the single schema-validation
 * posture (validateSchema: true by default), computes the canonical definition digest, and
 * returns { path, workflow, digest, layer }.
 */
export async function resolveWorkflowDefinition(
    cwd: string,
    fileOrName: string,
    options: ResolveWorkflowDefinitionOptions = {},
): Promise<ResolvedWorkflowDefinition> {
    let resolved = resolveWorkflowFile(cwd, fileOrName);
    if (resolved.path === null) {
        const scanned = await scanWorkflowByName(cwd, fileOrName);
        if (scanned !== null) {
            resolved = scanned;
        } else {
            const [probedProject, probedBundled] = resolved.probed;
            throw new Error(
                `Workflow not found: ${probedProject}${probedBundled !== null ? ` (bundled: ${probedBundled})` : ''}`,
            );
        }
    }
    const embedded = createEmbeddedSchemaOptions(options.embeddedSchemas);
    const workflow = await loadWorkflowDef(resolved.path, {
        validateSchema: options.validateSchema !== false,
        ...(embedded !== undefined ? embedded : {}),
    });
    // R1 (0756): the dialect JSON schemas declare the root `version` as `minLength: 1`, but the
    // load path validates against the engine's Zod schema (`version: z.string().optional()`, no
    // minimum), so `version: ""` reached the digest silently and `classifyVersion` in
    // `apps/cli/src/commands/workflow.ts:173` reported it as `unversioned` — a meaningless literal
    // wearing the absent field's label. Enforced at this seam because run, continue, and validate
    // all route through it (0752 R1); a per-surface guard would leave the others open. Drop this
    // once `@gobing-ai/ts-dual-workflow-engine` ships `z.string().min(1)` on the root version.
    if (workflow.version === '') {
        throw new Error(
            `Invalid workflow definition ${resolved.path}: root "version" is an empty string. ` +
                'Omit the field for an unversioned definition, or give it a non-empty literal.',
        );
    }
    const digest = computeDefinitionDigest(workflow);
    return {
        path: resolved.path,
        workflow,
        digest,
        layer: resolved.source,
    };
}
