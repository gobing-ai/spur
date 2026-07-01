/**
 * @gobing-ai/spur-config/loader — the Node-only loader subpath.
 *
 * This is the SINGLE place that loads `.spur/config.yaml` and derives planning folders.
 * Every Node/Bun surface (CLI, app, server-on-Bun) imports from here; the Cloudflare
 * Workers bundle imports ONLY the core (`@gobing-ai/spur-config`) — never this file
 * (it pulls `yaml` + `node:fs`, which crash miniflare).
 *
 * Exposes:
 * - {@link loadSpurConfig} — the one loader: `loadSpurConfig(cwd) → SpurConfig`
 * - {@link resolveConfigFile} — project→global config path fallback
 * - {@link resolvePlanningFolders} — folder derivation over `loadSpurConfig`
 * - Re-exports of bundled-config / template-renderer (moved here from the core so the
 *   core stays CF-safe — they use `node:fs`).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { createNodeFileSystem, loadStructuredConfig } from '@gobing-ai/ts-runtime';
import { parse as parseYaml } from 'yaml';

import {
    DEFAULT_FEATURES_DIR,
    DEFAULT_TASKS_DIR,
    folderConfigSchema,
    type SpurConfig,
    spurConfigSchema,
    tasksConfigSchema,
} from './index';

// Re-export Node-only concerns that were previously in the core entry.
// They use `node:fs` and must not be importable from the CF-safe core.
export {
    bundledConfigRoot,
    listBundledConfigFiles,
    listBundledTemplateFiles,
    resetBundledConfigCache,
} from './bundled-config';
export { renderTemplate } from './template-renderer';

// ---- Types ----

/** A registered task folder in the snake_case shape services consume. */
export interface TaskFolderEntry {
    base_counter: number;
    label?: string;
}

/** The folders-config shape consumed by TaskService / FeatureService. */
export interface TaskFoldersConfig {
    active_folder: string;
    folders: Record<string, TaskFolderEntry>;
}

/** Fully-resolved planning folders for a project. */
export interface PlanningFolders {
    /** Active task folder (default for new task I/O). Relative to cwd. */
    tasksDir: string;
    /** Feature folder. Relative to cwd. */
    featuresDir: string;
    /** All registered task folders + the active one, in the shape services consume. */
    foldersConfig: TaskFoldersConfig;
}

/** Options for {@link loadSpurConfig}. */
export interface LoadSpurConfigOptions {
    /**
     * When `true`, perform JSON Schema validation via ts-runtime's
     * {@link loadStructuredConfig} (validates the `$schema` declaration). When
     * `false` (the default), parse YAML directly and validate with zod only.
     *
     * The CLI enables this in production (the `$schema` catches structural issues
     * zod doesn't); tests skip it (temp files don't carry `$schema`).
     */
    validateJsonSchema?: boolean;
    /**
     * Embedded JSON Schemas for `bun --compile` support, keyed by subpath under
     * the package root (e.g. `'schemas/spur-config.schema.json'`). When provided,
     * schema refs are served from this map instead of hitting `node_modules`
     * (which doesn't exist in a standalone binary).
     */
    embeddedSchemas?: ReadonlyMap<string, string>;
    /**
     * Manifest specifier the loader resolves embedded schemas against. Defaults to
     * `@gobing-ai/spur/package.json` (the CLI package).
     */
    schemaManifestSpecifier?: string;
}

/** Directory layout constant — the `.spur/` config directory. */
const SPUR_CONFIG_DIR = '.spur';
/** Project config file name. */
const SPUR_CONFIG_FILE = 'config.yaml';
/** Global user config file path (relative to home). */
const GLOBAL_CONFIG_FILE = join(homedir(), '.config', 'spur', 'config.yaml');
const LOADER_DIR = dirname(fileURLToPath(import.meta.url));

let nextEmbeddedSchemasId = 1;
const embeddedSchemasIds = new WeakMap<ReadonlyMap<string, string>, number>();
const spurConfigCache = new Map<string, Promise<SpurConfig>>();
const planningFoldersCache = new WeakMap<FileSystem, Promise<PlanningFolders>>();

function embeddedSchemasId(embeddedSchemas: ReadonlyMap<string, string> | undefined): string {
    if (embeddedSchemas === undefined) return 'disk';
    let id = embeddedSchemasIds.get(embeddedSchemas);
    if (id === undefined) {
        id = nextEmbeddedSchemasId;
        nextEmbeddedSchemasId += 1;
        embeddedSchemasIds.set(embeddedSchemas, id);
    }
    return `embedded:${id}`;
}

function cacheKey(configPath: string, opts: LoadSpurConfigOptions | undefined, validateJsonSchema: boolean): string {
    return [
        configPath,
        validateJsonSchema ? 'schema' : 'zod',
        opts?.schemaManifestSpecifier ?? '@gobing-ai/spur/package.json',
        embeddedSchemasId(opts?.embeddedSchemas),
    ].join('\0');
}

function resolveSchemaSpecifier(specifier: string, manifestSpecifier: string): string {
    if (specifier === manifestSpecifier) {
        const workspaceManifest = join(LOADER_DIR, '..', '..', '..', 'apps', 'cli', 'package.json');
        if (existsSync(workspaceManifest)) return workspaceManifest;
    }
    try {
        const resolved = import.meta.resolve(specifier);
        return resolved.startsWith('file:') ? fileURLToPath(resolved) : resolved;
    } catch {
        return specifier;
    }
}

/**
 * Resolve the config file path following the project→global fallback order.
 *
 * 1. Project `.spur/config.yaml` (cwd).
 * 2. Fallback to global `~/.config/spur/config.yaml` when the project file is missing.
 *
 * Returns `undefined` when neither file exists (e.g. before `spur init`).
 * Set `SPUR_SKIP_GLOBAL_CONFIG=true` to skip the global fallback.
 */
export function resolveConfigFile(cwd?: string): string | undefined {
    const projectConfig = join(cwd ?? process.cwd(), SPUR_CONFIG_DIR, SPUR_CONFIG_FILE);
    if (existsSync(projectConfig)) return projectConfig;
    if (process.env.SPUR_SKIP_GLOBAL_CONFIG === 'true') return undefined;
    if (existsSync(GLOBAL_CONFIG_FILE)) return GLOBAL_CONFIG_FILE;
    return undefined;
}

// ---- Embedded-schema resolution (bun --compile support) ----

/**
 * Sentinel directory prefix for the binary-embedded Spur CLI package.
 *
 * ts-runtime resolves a bare package schema ref by calling `resolve('<pkg>/package.json')`
 * and then joining `dirname(manifest)` with the schema subpath. Returning this sentinel as
 * the manifest path makes the joined schema path start with the prefix, which the reader
 * recognizes and serves from the embedded copy. The NUL byte guarantees it never collides
 * with a real filesystem path.
 */
const EMBEDDED_PREFIX = '\0embedded-spur';

/**
 * Read a file, serving the embedded schema for any path under the sentinel prefix
 * and delegating everything else (the config file itself) to the real FS.
 */
function makeEmbeddedReader(embeddedSchemas: ReadonlyMap<string, string>) {
    return async function readEmbeddedOrDisk(path: string): Promise<string> {
        if (path.startsWith(EMBEDDED_PREFIX)) {
            const subpath = path.slice(EMBEDDED_PREFIX.length + 1);
            const embedded = embeddedSchemas.get(subpath);
            if (embedded === undefined) {
                throw new Error(`No embedded schema registered for "${subpath}".`);
            }
            return embedded;
        }
        return createNodeFileSystem().readFile(path);
    };
}

/**
 * Load and validate `.spur/config.yaml` from a project directory.
 *
 * THE single loader — every surface calls this instead of rolling its own YAML parse +
 * schema validate. Returns a fully-typed, validated {@link SpurConfig} covering all
 * sections (tasks, features, agent, rules, workflows, redaction).
 *
 * - Missing file → returns schema defaults (all-optional config).
 * - Invalid YAML / schema → throws (fail loud at startup).
 *
 * By default, validation is zod-only (fast). Pass `{ validateJsonSchema: true }` to also
 * validate against the `$schema` JSON Schema declaration via ts-runtime — the CLI uses this
 * in production to catch structural issues zod doesn't. In test mode (`NODE_ENV=test`),
 * JSON Schema validation is skipped by default (temp files lack `$schema`).
 *
 * For `bun --compile` binaries, pass `embeddedSchemas` so schema refs resolve without
 * `node_modules`.
 *
 * @param cwd - Project root directory (defaults to `process.cwd()`).
 * @param opts - Validation + embedded-schema options.
 */
export async function loadSpurConfig(cwd: string = process.cwd(), opts?: LoadSpurConfigOptions): Promise<SpurConfig> {
    const configPath = resolveConfigFile(cwd);
    if (configPath === undefined) {
        return spurConfigSchema.parse({});
    }

    const validateJsonSchema = opts?.validateJsonSchema ?? process.env.NODE_ENV !== 'test';
    const key = cacheKey(configPath, opts, validateJsonSchema);
    const cached = spurConfigCache.get(key);
    if (cached !== undefined) return cached;

    const promise = loadSpurConfigFile(configPath, opts, validateJsonSchema);
    spurConfigCache.set(key, promise);
    promise.catch(() => spurConfigCache.delete(key));
    return promise;
}

async function loadSpurConfigFile(
    configPath: string,
    opts: LoadSpurConfigOptions | undefined,
    validateJsonSchema: boolean,
): Promise<SpurConfig> {
    let raw: unknown;

    if (validateJsonSchema) {
        const embeddedSchemas = opts?.embeddedSchemas;
        const manifestSpecifier = opts?.schemaManifestSpecifier ?? '@gobing-ai/spur/package.json';

        const resolveFn = (specifier: string): string => {
            if (embeddedSchemas !== undefined && specifier === manifestSpecifier) {
                return `${EMBEDDED_PREFIX}/package.json`;
            }
            return resolveSchemaSpecifier(specifier, manifestSpecifier);
        };

        const fileSystem = embeddedSchemas ? { readFile: makeEmbeddedReader(embeddedSchemas) } : undefined;

        raw = await loadStructuredConfig(configPath, {
            validateSchema: true,
            resolve: resolveFn,
            ...(fileSystem !== undefined ? { fileSystem } : {}),
        });
    } else {
        const nodeFs = createNodeFileSystem();
        const resolved = nodeFs.resolve(configPath);
        const text = await nodeFs.readFile(resolved);
        raw = parseYaml(text) ?? {};
    }

    return spurConfigSchema.parse(raw);
}

/**
 * Load an arbitrary Spur structured-config file (e.g. `section-matrix.yaml`) from an
 * explicit path with JSON Schema validation via ts-runtime.
 *
 * Unlike {@link loadSpurConfig} (which is cwd-bound to `.spur/config.yaml` and returns a
 * typed {@link SpurConfig}), this is a low-level loader for other Spur-bundled config files
 * that declare `$schema: "@gobing-ai/spur/schemas/..."`. Returns the raw parsed object.
 *
 * For `bun --compile` binaries, pass `embeddedSchemas` so schema refs resolve without
 * `node_modules` (same mechanism as {@link loadSpurConfig}).
 *
 * @param configPath - Absolute path to the structured-config file.
 * @param opts - Validation + embedded-schema options.
 */
export async function loadStructuredSpurConfig(
    configPath: string,
    opts?: LoadSpurConfigOptions,
): Promise<Record<string, unknown>> {
    const validateJsonSchema = opts?.validateJsonSchema ?? process.env.NODE_ENV !== 'test';
    if (!validateJsonSchema) {
        const nodeFs = createNodeFileSystem();
        const resolved = nodeFs.resolve(configPath);
        const text = await nodeFs.readFile(resolved);
        return (parseYaml(text) ?? {}) as Record<string, unknown>;
    }
    const embeddedSchemas = opts?.embeddedSchemas;
    const manifestSpecifier = opts?.schemaManifestSpecifier ?? '@gobing-ai/spur/package.json';
    const resolveFn = (specifier: string): string => {
        if (embeddedSchemas !== undefined && specifier === manifestSpecifier) {
            return `${EMBEDDED_PREFIX}/package.json`;
        }
        return resolveSchemaSpecifier(specifier, manifestSpecifier);
    };
    const fileSystem = embeddedSchemas ? { readFile: makeEmbeddedReader(embeddedSchemas) } : undefined;
    return (await loadStructuredConfig(configPath, {
        validateSchema: true,
        resolve: resolveFn,
        ...(fileSystem !== undefined ? { fileSystem } : {}),
    })) as Record<string, unknown>;
}

// ---- Folder derivation ----

/** The default folders config when `.spur/config.yaml` has no `tasks:` block. */
function defaultFoldersConfig(): TaskFoldersConfig {
    return {
        active_folder: DEFAULT_TASKS_DIR,
        folders: { [DEFAULT_TASKS_DIR]: { base_counter: 0 } },
    };
}

/** The all-defaults planning-folders result. */
function defaultPlanningFolders(): PlanningFolders {
    return {
        tasksDir: DEFAULT_TASKS_DIR,
        featuresDir: DEFAULT_FEATURES_DIR,
        foldersConfig: defaultFoldersConfig(),
    };
}

/**
 * Resolve planning folders from `.spur/config.yaml` via the injected `fs` port.
 *
 * Derives task/feature folders from the loaded {@link SpurConfig} — never re-parses
 * YAML independently (that was the old divergence). `fs` is cwd-rooted, so a relative
 * `.spur/config.yaml` resolves correctly on both Node and Workers.
 *
 * Returns schema defaults when the config is absent, the block is missing, or the
 * config is malformed — never throws (a broken config must not wedge folder resolution).
 *
 * @param fs - The {@link FileSystem} port (injected so this works on any runtime).
 */
export async function resolvePlanningFolders(fs: FileSystem): Promise<PlanningFolders> {
    const cached = planningFoldersCache.get(fs);
    if (cached !== undefined) return cached;

    const promise = resolvePlanningFoldersUncached(fs);
    planningFoldersCache.set(fs, promise);
    return promise;
}

async function resolvePlanningFoldersUncached(fs: FileSystem): Promise<PlanningFolders> {
    const configPath = fs.resolve(join(SPUR_CONFIG_DIR, SPUR_CONFIG_FILE));
    if (!(await fs.exists(configPath))) return defaultPlanningFolders();

    try {
        const text = await fs.readFile(configPath);
        const raw = parseYaml(text) ?? {};
        const parsed = spurConfigSchema.parse(raw);

        const featuresDir = parsed.features?.dir ?? DEFAULT_FEATURES_DIR;

        if (!parsed.tasks) {
            return {
                tasksDir: DEFAULT_TASKS_DIR,
                featuresDir,
                foldersConfig: defaultFoldersConfig(),
            };
        }

        const tasks = tasksConfigSchema.parse(parsed.tasks);
        const folders: TaskFoldersConfig['folders'] = {};
        for (const [path, fc] of Object.entries(tasks.folders)) {
            const validated = folderConfigSchema.parse(fc);
            folders[path] = { base_counter: validated.baseCounter, label: validated.label };
        }
        const foldersConfig: TaskFoldersConfig = {
            active_folder: tasks.active,
            folders: Object.keys(folders).length > 0 ? folders : defaultFoldersConfig().folders,
        };
        return { tasksDir: tasks.active, featuresDir, foldersConfig };
    } catch {
        return defaultPlanningFolders();
    }
}
