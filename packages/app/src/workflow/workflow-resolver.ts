import { basename, isAbsolute, join, resolve } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
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
 * The ordered workflow-layer vocabulary (ADR-113 / task 0819): `project`
 * (`<cwd>/.spur/workflows`), `registered` (each extra `workflows.paths` folder)
 * and `shared` (the installed package's shared root from `bundledConfigRoot()`).
 * Rule layers keep their own vocabulary — `bundled` stays there.
 */
export type WorkflowLayerId = 'project' | 'registered' | 'shared';

/** One ordered workflow layer: `id` names the tier, `path` the absolute folder. */
export interface WorkflowLayer {
    id: WorkflowLayerId;
    path: string;
}

/** Prefix marking a `workflows.paths` entry as relative to the installed package's config root. */
export const BUNDLED_PATH_PREFIX = 'bundled:';

/**
 * `workflows.paths` entries as registered-layer candidates (ADR-113): `bundled:`-prefixed
 * entries expand against the installed package's config root at read time (no bundled
 * root under `bun build --compile` — the entry is skipped); other entries are returned
 * as configured and resolved against cwd by {@link workflowLayers}. Sync & pure: the
 * merged config is threaded from the composition root (A5 / ADR-082).
 */
export function registeredWorkflowPaths(config: SpurConfig | null): string[] {
    const paths = config?.workflows?.paths ?? ['.spur/workflows/'];
    const bundledRoot = bundledConfigRoot();
    const expanded: string[] = [];
    for (const path of paths) {
        if (path.startsWith(BUNDLED_PATH_PREFIX)) {
            if (bundledRoot !== null) expanded.push(join(bundledRoot, path.slice(BUNDLED_PATH_PREFIX.length)));
        } else {
            expanded.push(path);
        }
    }
    return expanded;
}

/** Normalize a layer folder for dedupe: absolute, resolved, no trailing slash (ADR-113 §1). */
function normalizeLayerPath(cwd: string, path: string): string {
    return resolve(cwd, path);
}

/** Options for {@link workflowLayers}. */
export interface WorkflowLayersOptions {
    cwd: string;
    /** Registered extra folders (`workflows.paths`, expanded) in config order. */
    registered: readonly string[];
    /**
     * Shared-layer root override. Defaults to `bundledConfigRoot()` (the
     * installed package's shared root); `null` models the compiled-binary case
     * where the package tree does not resolve and the shared layer is absent.
     */
    sharedRoot?: string | null;
}

/**
 * The one ordered layer list backing both `WorkflowService.list` and bare-name
 * resolution (ADR-113 / task 0819), so the catalog shown is exactly what a name
 * can resolve from:
 *
 * 1. `project` — `<cwd>/.spur/workflows`, always listed even when the folder is
 *    missing or empty.
 * 2. `registered` — each extra `workflows.paths` entry as an absolute path, in
 *    config order, deduped by normalized absolute path against earlier layers
 *    (legacy entries like `.spur/workflows/` or `bundled:workflows` collapse into
 *    the project or shared layer, so existing configs keep working).
 * 3. `shared` — the installed package's shared root (`bundledConfigRoot()`);
 *    absent only when the package tree does not resolve (compiled binary).
 */
export function workflowLayers(opts: WorkflowLayersOptions): WorkflowLayer[] {
    const sharedRoot = opts.sharedRoot !== undefined ? opts.sharedRoot : bundledConfigRoot();
    const sharedPath = sharedRoot !== null ? normalizeLayerPath(opts.cwd, join(sharedRoot, 'workflows')) : null;
    const layers: WorkflowLayer[] = [];
    const seen = new Set<string>();
    const add = (id: WorkflowLayerId, path: string): void => {
        if (seen.has(path)) return;
        seen.add(path);
        layers.push({ id, path });
    };

    add('project', normalizeLayerPath(opts.cwd, join(opts.cwd, '.spur', 'workflows')));
    for (const entry of opts.registered) {
        // A registered entry equal to the package workflows folder collapses into the
        // shared layer — the folder keeps its `shared` id (legacy `bundled:workflows`).
        if (sharedPath !== null && normalizeLayerPath(opts.cwd, entry) === sharedPath) continue;
        add('registered', normalizeLayerPath(opts.cwd, entry));
    }
    if (sharedPath !== null) add('shared', sharedPath);

    return layers;
}

/**
 * Result of {@link resolveWorkflowFile}: either a resolved path with its source
 * layer, or a not-found pair of probed absolute paths. `probed[1]` is `null` when
 * `bundledConfigRoot()` returned `null` (the compiled-binary case).
 */
export type ResolveWorkflowFileResult =
    | { path: string; source: WorkflowLayerId }
    | { path: null; probed: [string, string | null] };

/**
 * Resolved and loaded workflow definition with its digest and source layer.
 */
export interface ResolvedWorkflowDefinition {
    path: string;
    workflow: WorkflowDef;
    digest: string;
    layer: WorkflowLayerId;
}

/** Options configuring workflow definition resolution and schema validation. */
export interface ResolveWorkflowDefinitionOptions {
    validateSchema?: boolean;
    embeddedSchemas?: ReadonlyMap<string, string>;
    /**
     * Registered extra folders (`workflows.paths`, expanded) probed by bare-name
     * resolution between the project and shared layers. Explicit file paths never
     * consult them; `list` passes the same value so it shows exactly the folders
     * a name can resolve from (ADR-113).
     */
    registered?: readonly string[];
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
    registered: readonly string[],
): Promise<{ path: string; source: WorkflowLayerId } | null> {
    const fs = createNodeFileSystem();

    // Probe the ordered layer list in precedence order (ADR-113): the first folder
    // holding a definition with this name wins, so resolution and `list` agree.
    for (const layer of workflowLayers({ cwd, registered })) {
        try {
            const files = (await fs.readDir(layer.path)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
            for (const f of files) {
                const abs = join(layer.path, f);
                const wfName = await readWorkflowNameFast(fs, abs);
                if (wfName === name) {
                    return { path: abs, source: layer.id };
                }
            }
        } catch {
            // Missing or unreadable layer folder — keep probing.
        }
    }

    return null;
}

/**
 * Resolve a workflow file path across the workflow layers (task 0752 / ADR-113).
 *
 * Precedence keeps explicit file paths first, labeled `project`:
 * 1. Explicit path (cwd-relative or absolute).
 * 2. Project layer candidates: `.spur/workflows/<file>.yaml`, `<file>.yaml`, etc.
 * 3. Shared layer: the installed package's `workflows/<file>.yaml`.
 *
 * Bare-name resolution that must also see registered folders probes
 * {@link workflowLayers} via {@link resolveWorkflowDefinition} instead.
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
        const sharedName = isYaml ? base : `${base}.yaml`;
        const sharedPath = join(bundledRoot, 'workflows', sharedName);
        if (fs.exists(sharedPath)) {
            return { path: sharedPath, source: 'shared' };
        }
        if (!isYaml) {
            const sharedPipeline = join(bundledRoot, 'workflows', `${base}-pipeline.yaml`);
            if (fs.exists(sharedPipeline)) {
                return { path: sharedPipeline, source: 'shared' };
            }
            const sharedLiteral = join(bundledRoot, 'workflows', base);
            if (fs.exists(sharedLiteral)) {
                return { path: sharedLiteral, source: 'shared' };
            }
        }
        return { path: null, probed: [projectPath, sharedPath] };
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
    const registered = options.registered ?? [];
    let resolved = resolveWorkflowFile(cwd, fileOrName);
    if (resolved.path === null) {
        const scanned = await scanWorkflowByName(cwd, fileOrName, registered);
        if (scanned !== null) {
            resolved = scanned;
        } else {
            const [probedProject, probedShared] = resolved.probed;
            throw new Error(
                `Workflow not found: ${probedProject}${probedShared !== null ? ` (shared: ${probedShared})` : ''}`,
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
