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
 * - {@link resolveConfigLayers} — both layer paths (project + global, task 0640)
 * - {@link resolveConfigFile} — single-path view (project→global fallback)
 * - {@link resolvePlanningFolders} — folder derivation over `loadSpurConfig`
 * - Re-exports of bundled-config / template-renderer (moved here from the core so the
 *   core stays CF-safe — they use `node:fs`).
 */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { createNodeFileSystem, loadStructuredConfig, validateDeclaredJsonSchema } from '@gobing-ai/ts-runtime';
import { getEnvVar } from '@gobing-ai/ts-utils';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
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
    BUNDLED_GLOBAL_CONFIG,
    bundledConfigRoot,
    listBundledConfigFiles,
    listBundledProjectSeedFiles,
    listBundledTemplateFiles,
    resetBundledConfigCache,
} from './bundled-config';
export * from './projects';
export { renderTemplate } from './template-renderer';

// ---- Types ----

/** A registered task folder. Field names match the zod schema (`folderConfigSchema`). */
export interface TaskFolderEntry {
    baseCounter: number;
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
    /** Optional rule severity overrides map from tasks.severity (R3/R4, task 0321). */
    severityOverrides?: Record<string, 'error' | 'warning' | 'off'>;
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
 * Resolve both config layers following the layered contract (ADR-015 ladder, task 0640).
 *
 * - Project layer: `<cwd>/.spur/config.yaml`.
 * - Global layer: `~/.config/spur/config.yaml` (skipped when `SPUR_SKIP_GLOBAL_CONFIG=true`,
 *   which under layering means *project layer only*).
 * - Project layer: additionally suppressed when `SPUR_SKIP_PROJECT_CONFIG=true` and the
 *   caller did not pass `cwd` (task 0817) — an explicit `cwd` always wins.
 *
 * Both keys are present when both files exist; a missing file leaves the key `undefined`.
 * When neither exists (pre-`spur init`), both are `undefined`.
 */
export interface ResolvedConfigLayers {
    /** `~/.config/spur/config.yaml` when it exists (and the skip env is unset). */
    global?: string;
    /** `<cwd>/.spur/config.yaml` when it exists (and the project-skip env did not fire). */
    project?: string;
}

/**
 * Resolve both config layer paths for a working directory: the project layer
 * (`<cwd>/.spur/config.yaml`) and the global layer (`~/.config/spur/config.yaml`).
 * Each layer is included only when its file exists; `SPUR_SKIP_GLOBAL_CONFIG=true`
 * suppresses the global layer (tests and hermetic environments).
 *
 * `SPUR_SKIP_PROJECT_CONFIG=true` suppresses the project layer, but only when the
 * caller did not pin `cwd` (task 0817): the precedence is explicit `cwd` > env skip
 * > `process.cwd()`. An explicitly-passed `cwd` names the project the caller asked
 * for and is never skipped; an unpinned call would otherwise bind the loader to
 * whatever `process.cwd()` happens to be — including a test harness's repository
 * root and its live `.spur/config.yaml`.
 */
export function resolveConfigLayers(cwd?: string): ResolvedConfigLayers {
    const layers: ResolvedConfigLayers = {};
    const skipProject = cwd === undefined && getEnvVar('SPUR_SKIP_PROJECT_CONFIG') === 'true';
    if (!skipProject) {
        const projectConfig = join(cwd ?? process.cwd(), SPUR_CONFIG_DIR, SPUR_CONFIG_FILE);
        if (existsSync(projectConfig)) layers.project = projectConfig;
    }
    if (getEnvVar('SPUR_SKIP_GLOBAL_CONFIG') !== 'true' && existsSync(GLOBAL_CONFIG_FILE)) {
        layers.global = GLOBAL_CONFIG_FILE;
    }
    return layers;
}

/**
 * Resolve the single config file path following the project→global fallback order.
 *
 * Thin wrapper over {@link resolveConfigLayers}: the project layer's path when it exists,
 * else the global path. Returns `undefined` when neither layer exists. Consumers that
 * need one path keep compiling; layered consumers call {@link resolveConfigLayers}.
 */
export function resolveConfigFile(cwd?: string): string | undefined {
    const { global, project } = resolveConfigLayers(cwd);
    return project ?? global;
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
 * Load and validate the layered Spur configuration (task 0640).
 *
 * THE single loader — every surface calls this instead of rolling its own YAML parse +
 * schema validate. Reads the global (`~/.config/spur/config.yaml`) and project
 * (`<cwd>/.spur/config.yaml`) layers, deep-merges them (project wins; executors merge by
 * `name`, team members by `id ?? executor`, `rules.paths`/`workflows.paths` concatenate),
 * then validates the MERGED object once. Returns a fully-typed {@link SpurConfig}.
 *
 * - Neither layer → returns schema defaults (all-optional config).
 * - `SPUR_SKIP_GLOBAL_CONFIG=true` → project layer only.
 * - `SPUR_SKIP_PROJECT_CONFIG=true` without an explicit `cwd` → global layer only (task 0817).
 * - Invalid YAML / schema → throws (fail loud at startup); errors name the layer
 *   each offending key came from (R7).
 *
 * By default, validation is zod-only (fast). Pass `{ validateJsonSchema: true }` to also
 * validate against the `$schema` JSON Schema declaration via ts-runtime — the CLI uses this
 * in production to catch structural issues zod doesn't. In test mode (`NODE_ENV=test`),
 * JSON Schema validation is skipped by default (temp files lack `$schema`).
 *
 * For `bun --compile` binaries, pass `embeddedSchemas` so schema refs resolve without
 * `node_modules`.
 *
 * @param cwd - Project root directory. When omitted, `process.cwd()` is used unless
 *   `SPUR_SKIP_PROJECT_CONFIG=true` suppresses the project layer for the unpinned
 *   call (task 0817); pass an explicit `cwd` to keep that layer.
 * @param opts - Validation + embedded-schema options.
 */
export async function loadSpurConfig(cwd?: string, opts?: LoadSpurConfigOptions): Promise<SpurConfig> {
    const layers = resolveConfigLayers(cwd);
    const projectRoot = resolve(cwd ?? process.cwd());
    // 0858 R2: checked before the layer short-circuit — a project that still carries
    // the retired `.spur/fleet.json` must fail even when it declares no config at all.
    assertNoLegacyFleetFile(projectRoot, layers.project);
    if (layers.global === undefined && layers.project === undefined) {
        return spurConfigSchema.parse({});
    }

    const validateJsonSchema = opts?.validateJsonSchema ?? getEnvVar('NODE_ENV') !== 'test';
    const mtimeOf = (path?: string): string => (path !== undefined ? String(statSync(path).mtimeMs) : '-');
    // Key on BOTH layers (paths + mtimes, R4): editing either file must invalidate.
    const key = [
        cacheKey(layers.project ?? layers.global ?? '', opts, validateJsonSchema),
        layers.global ?? '-',
        mtimeOf(layers.project),
        mtimeOf(layers.global),
    ].join('\0');
    const cached = spurConfigCache.get(key);
    if (cached !== undefined) return cached;
    const promise = loadMergedConfig(layers, opts, validateJsonSchema);
    spurConfigCache.set(key, promise);
    promise.catch(() => spurConfigCache.delete(key));
    return promise;
}

export type {
    ExecutorUpdateErrorCode,
    SetProjectExecutorDisabledResult,
} from './executor-update';
/**
 * Invalidate the cached {@link SpurConfig} for one config path or the entire cache.
 *
 * {@link loadSpurConfig} keys the cache on both layers' paths + mtimes, so stale entries
 * naturally expire after either file is edited. Call this function when you need to force
 * a reload without waiting for the next file stat (e.g. after a programmatic config
 * update that hasn't yet been flushed to disk).
 *
 * @param configPath - Optional layer path (project or global) to invalidate; clears the
 *   entire cache when omitted.
 */
// Task 0797 / ADR-111: filesystem updater rides the node-only `./loader` subpath.
// (Re-exported here because the package `exports` map points `./loader` at this file;
// the import cycle executor-update → loader is safe — the shared symbols are used
// lazily at call time, never at module init.)
export { ExecutorUpdateError, setProjectExecutorDisabled } from './executor-update';

/** Drop cached loader entries so the next {@link loadSpurConfig} re-reads from disk. */
export function invalidateSpurConfig(configPath?: string): void {
    if (configPath === undefined) {
        spurConfigCache.clear();
        return;
    }
    for (const key of spurConfigCache.keys()) {
        // The path may sit at the key head (primary layer) or in the global slot.
        if (key.startsWith(`${configPath}\0`) || key.includes(`\0${configPath}\0`)) {
            spurConfigCache.delete(key);
        }
    }
}

// ---- Config-shape guards (0857 R2 / 0858 R2) ----

/**
 * Fail the load when a layer still carries the retired team roster block.
 *
 * Zod would silently strip the unknown key, so the guard inspects each layer's
 * PARSED YAML before schema parse — the loud failure is the migration signal, and
 * nothing is ever read from the retired source. `misplacedGlobalKeys` no longer
 * classifies the key (0857), so this is the one place the retirement is enforced.
 *
 * @param options.layerPath - Absolute path of the layer being inspected; named in
 *   the error so the operator knows which file to edit.
 * @param options.replacementFile - The project config the replacement belongs in.
 */
function assertNoRetiredTeamKey(parsed: RawConfig, layerPath: string | undefined, replacementFile: string): void {
    const agent = parsed.agent;
    if (!isPlainObject(agent) || !('team' in agent)) return;
    throw new Error(
        `agent.team is no longer supported (${layerPath ?? 'the merged config'}). ` +
            `Declare the project fleet under agent.fleet in ${replacementFile}.`,
    );
}

/**
 * Fail the load when the GLOBAL layer declares `agent.fleet` (0858 R2).
 *
 * A fleet is one worktree's roster (ADR-116), so a machine-wide default has no
 * meaning: the key is legal at the project layer only. Rejecting rather than
 * merging keeps one declaration authoritative instead of layering a fleet the
 * operator cannot see from the project.
 *
 * @param options.layerPath - Absolute path of the global layer being inspected.
 * @param options.projectFile - The project config the section belongs in.
 */
function assertNoGlobalFleetSection(globalRaw: RawConfig, layerPath: string | undefined, projectFile: string): void {
    const agent = globalRaw.agent;
    if (!isPlainObject(agent) || !('fleet' in agent)) return;
    throw new Error(
        `agent.fleet is not supported in the global config (${layerPath ?? SPUR_CONFIG_FILE}). ` +
            `Declare the project fleet under agent.fleet in ${projectFile} — the flock belongs to a project, not to the machine.`,
    );
}

/**
 * Fail the load when the retired `<project>/.spur/fleet.json` still exists
 * (0858 R2). The file was the 0835/ADR-116 carrier; `agent.fleet` replaces it.
 *
 * Two candidate locations, because the project layer is only resolved when a
 * `.spur/config.yaml` exists: the loaded layer's sibling (the normal case) and the
 * project root being loaded (a project that declares a fleet file and no config at
 * all would otherwise be silently ignored — exactly the silent strip R2 forbids).
 *
 * Checked before the merge rather than at the read that used to consume it, so the
 * error names the file and the two-step fix (move, then delete).
 */
function assertNoLegacyFleetFile(projectRoot: string, projectConfigPath: string | undefined): void {
    const candidates = new Set<string>([join(projectRoot, SPUR_CONFIG_DIR, 'fleet.json')]);
    if (projectConfigPath !== undefined) candidates.add(join(dirname(projectConfigPath), 'fleet.json'));
    for (const legacyFile of candidates) {
        if (!existsSync(legacyFile)) continue;
        throw new Error(
            `The retired fleet declaration ${legacyFile} still exists. Move its members and orchestrator under ` +
                'agent.fleet in the project config, then delete the file.',
        );
    }
}

/** The project config path named as the replacement target, with a generic fallback. */
function projectConfigReplacement(layers: ResolvedConfigLayers): string {
    return layers.project ?? join(SPUR_CONFIG_DIR, SPUR_CONFIG_FILE);
}

// ---- Layered load: raw read -> deep merge -> single validation (task 0640) ----

/** Shared ts-runtime schema-resolution context (embedded schemas, manifest specifier). */
function schemaValidationContext(opts: LoadSpurConfigOptions | undefined) {
    const embeddedSchemas = opts?.embeddedSchemas;
    const manifestSpecifier = opts?.schemaManifestSpecifier ?? '@gobing-ai/spur/package.json';
    const resolve = (specifier: string): string => {
        if (embeddedSchemas !== undefined && specifier === manifestSpecifier) {
            return `${EMBEDDED_PREFIX}/package.json`;
        }
        return resolveSchemaSpecifier(specifier, manifestSpecifier);
    };
    const fileSystem = embeddedSchemas ? { readFile: makeEmbeddedReader(embeddedSchemas) } : undefined;
    return { resolve, ...(fileSystem !== undefined ? { fileSystem } : {}) };
}

/** One parsed layer; raw YAML objects (pre-zod). `{}` for an absent or empty file. */
type RawConfig = Record<string, unknown>;

/** Read and YAML-parse one layer, failing loud with the layer named (R7). */
async function readRawYamlLayer(configPath: string, kind: 'global' | 'project'): Promise<RawConfig> {
    const nodeFs = createNodeFileSystem();
    let text: string;
    try {
        text = await nodeFs.readFile(nodeFs.resolve(configPath));
    } catch (error) {
        throw new Error(`Failed to read ${kind} config ${configPath}: ${(error as Error).message}`);
    }
    try {
        return (parseYaml(text) ?? {}) as RawConfig;
    } catch (error) {
        throw new Error(`Failed to parse ${kind} config ${configPath}: ${(error as Error).message}`);
    }
}

/**
 * Parse a single config YAML string into a plain object (task 0649 R4).
 * The loader owns the `yaml` dependency, so callers (e.g. `spur init` global-config
 * detection) reuse this instead of importing yaml themselves. Throws on unparseable
 * input; returns `{}` for an empty/null document.
 */
export function parseConfigYaml(text: string): Record<string, unknown> {
    return (parseYaml(text) ?? {}) as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is RawConfig {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Executor identity for merge-by-key: the `name` field. */
function executorNameOf(item: unknown): string | undefined {
    return isPlainObject(item) && typeof item.name === 'string' ? item.name : undefined;
}

/** Arrays at these paths concatenate across layers (global first, project second). */
function isConcatPath(segments: (string | number)[]): boolean {
    return (
        (segments.length === 2 && segments[0] === 'rules' && segments[1] === 'paths') ||
        (segments.length === 2 && segments[0] === 'workflows' && segments[1] === 'paths')
    );
}

/** Identity function for arrays that merge by key (`agent.executors`). */
function byKeyIdentityFor(segments: (string | number)[]): ((item: unknown) => string | undefined) | undefined {
    if (segments.length === 2 && segments[0] === 'agent' && segments[1] === 'executors') {
        return executorNameOf;
    }
    return undefined;
}

/** Concatenate with exact-duplicate removal (a project path redeclaring a global one). */
function concatUnique(globalItems: unknown[], projectItems: unknown[]): unknown[] {
    const out = [...globalItems];
    for (const item of projectItems) {
        if (!out.includes(item)) out.push(item);
    }
    return out;
}

function mergeByKeyIdentity(
    globalItems: unknown[],
    projectItems: unknown[],
    identityOf: (item: unknown) => string | undefined,
    segments: (string | number)[],
): unknown[] {
    const merged: unknown[] = [];
    const indexByIdentity = new Map<string, number>();
    for (const item of globalItems) {
        const identity = identityOf(item);
        if (identity !== undefined && !indexByIdentity.has(identity)) indexByIdentity.set(identity, merged.length);
        merged.push(item);
    }
    const matchedProjectIdentities = new Set<string>();
    for (const item of projectItems) {
        const identity = identityOf(item);
        const existing =
            identity === undefined || matchedProjectIdentities.has(identity)
                ? undefined
                : indexByIdentity.get(identity);
        if (existing === undefined) {
            merged.push(item);
            continue;
        }
        if (identity !== undefined) matchedProjectIdentities.add(identity);
        const base = merged[existing];
        // A bare-string member re-declares wholesale; object forms merge per field.
        merged[existing] =
            isPlainObject(base) && isPlainObject(item) ? mergeDeep(base, item, [...segments, existing]) : item;
    }
    return merged;
}

/**
 * Deep-merge two raw layer values per the 0639 strategy table: maps recurse, scalars and
 * plain arrays replace (project wins), by-key arrays merge per item, `*.paths` concats.
 */
/**
 * A raw YAML value from a config layer before zod parsing: an object, array, or
 * scalar. The scalar passthrough (`projectValue`) is cast because the merge
 * inputs are `unknown` (they come from `RawConfig = Record<string, unknown>`).
 */
type RawYamlNode = RawConfig | unknown[] | string | number | boolean | null | undefined;

function mergeDeep(globalValue: unknown, projectValue: unknown, segments: (string | number)[]): RawYamlNode {
    if (isPlainObject(globalValue) && isPlainObject(projectValue)) {
        const out: RawConfig = { ...globalValue };
        for (const [key, projectItem] of Object.entries(projectValue)) {
            out[key] = key in out ? mergeDeep(out[key], projectItem, [...segments, key]) : projectItem;
        }
        return out;
    }
    if (Array.isArray(globalValue) && Array.isArray(projectValue)) {
        if (isConcatPath(segments)) return concatUnique(globalValue, projectValue);
        const identityOf = byKeyIdentityFor(segments);
        if (identityOf !== undefined) return mergeByKeyIdentity(globalValue, projectValue, identityOf, segments);
        return projectValue as RawYamlNode;
    }
    return projectValue as RawYamlNode;
}

/** Merge the two raw layers (project over global). An absent layer contributes `{}`. */
export function mergeSpurConfigLayers(globalRaw: RawConfig, projectRaw: RawConfig): RawConfig {
    return mergeDeep(globalRaw, projectRaw, []) as RawConfig;
}

// ---- Provenance: name the layer a failing key came from (R7) ----

function formatZodPath(path: (string | number)[]): string {
    return path
        .map((segment, index) => (typeof segment === 'number' ? `[${segment}]` : index === 0 ? segment : `.${segment}`))
        .join('');
}

/** Parse a JSON-Schema violation path (`agent.executors[0].agent`) into segments. */
function parseViolationPath(path: string): (string | number)[] {
    const segments: (string | number)[] = [];
    for (const part of path.split('.')) {
        const bracket = part.indexOf('[');
        const key = bracket === -1 ? part : part.slice(0, bracket);
        if (key !== '') segments.push(key);
        if (bracket !== -1) {
            for (const match of part.slice(bracket).matchAll(/\[(\d+)\]/g)) {
                segments.push(Number(match[1]));
            }
        }
    }
    return segments;
}

function findItemByIdentity(
    node: unknown,
    identityOf: (item: unknown) => string | undefined,
    identity: string,
): RawYamlNode {
    return Array.isArray(node) ? node.find((entry) => identityOf(entry) === identity) : undefined;
}

/**
 * Name the layer(s) that contributed the value at `issuePath`, so merged-config
 * validation errors point at the file the offending key came from (R7). Walks both raw
 * layers in parallel; by-key array indices are remapped through the merged item's
 * identity (executor name / member id) so fragment declarations are attributed.
 */
export function describeIssueProvenance(
    issuePath: (string | number)[],
    merged: unknown,
    globalRaw: RawConfig,
    projectRaw: RawConfig,
): string {
    let g: unknown = globalRaw;
    let p: unknown = projectRaw;
    let m: unknown = merged;
    let segments: (string | number)[] = [];
    let parentG: unknown = globalRaw;
    let parentP: unknown = projectRaw;
    let identityPrefix = '';

    for (const segment of issuePath) {
        parentG = g;
        parentP = p;
        segments = [...segments, segment];
        if (typeof segment === 'number') {
            const mergedItem = Array.isArray(m) ? m[segment] : undefined;
            const identityOf = byKeyIdentityFor(segments.slice(0, -1));
            if (identityOf !== undefined && mergedItem !== undefined) {
                const identity = identityOf(mergedItem);
                if (identity !== undefined) {
                    identityPrefix = `executor "${identity}" `;
                    g = findItemByIdentity(g, identityOf, identity);
                    p = findItemByIdentity(p, identityOf, identity);
                }
            } else {
                g = Array.isArray(g) && segment < g.length ? g[segment] : undefined;
                p = Array.isArray(p) && segment < p.length ? p[segment] : undefined;
            }
            m = mergedItem;
            continue;
        }
        g = isPlainObject(g) ? g[segment] : undefined;
        p = isPlainObject(p) ? p[segment] : undefined;
        m = isPlainObject(m) ? m[segment] : undefined;
    }

    let label: string;
    if (g !== undefined && p !== undefined) {
        label = 'set in both layers (project value wins)';
    } else if (g !== undefined) {
        label = 'from global layer';
    } else if (p !== undefined) {
        label = 'from project layer';
    } else if (parentP !== undefined && parentG === undefined) {
        label = 'from project layer (key absent there)';
    } else if (parentG !== undefined && parentP === undefined) {
        label = 'from global layer (key absent there)';
    } else {
        label = 'missing in both layers';
    }
    return `${identityPrefix}${label}`;
}

/** Parse the merged object with zod, enriching failures with per-issue layer provenance. */
export function parseMergedWithProvenance(
    merged: RawConfig,
    globalRaw: RawConfig,
    projectRaw: RawConfig,
    layers: ResolvedConfigLayers,
): SpurConfig {
    try {
        return spurConfigSchema.parse(merged);
    } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        const details = error.issues
            .map((issue) => {
                // zod types issue paths as PropertyKey[]; symbol segments never occur in
                // YAML-derived configs, so drop them for the (string|number) walk.
                const path = issue.path.filter((segment): segment is string | number => typeof segment !== 'symbol');
                return `  ${formatZodPath(path)}: ${issue.message} (${describeIssueProvenance(path, merged, globalRaw, projectRaw)})`;
            })
            .join('\n');
        throw new Error(
            `Spur config validation failed after merging global ${layers.global ?? '(absent)'} with project ${layers.project ?? '(absent)'}:\n${details}`,
        );
    }
}

/** Enrich a JSON-Schema violation error with per-violation layer provenance. */
export function enrichSchemaViolationError(
    error: unknown,
    merged: RawConfig,
    globalRaw: RawConfig,
    projectRaw: RawConfig,
    layers: ResolvedConfigLayers,
): Error {
    const violations = (error as { violations?: unknown }).violations;
    if (!Array.isArray(violations)) return error as Error;
    const details = violations
        .map((violation) => {
            const v = violation as { path?: unknown; message?: unknown };
            const path = typeof v.path === 'string' ? v.path : '(root)';
            const message = typeof v.message === 'string' ? v.message : 'schema violation';
            const label = describeIssueProvenance(parseViolationPath(path), merged, globalRaw, projectRaw);
            return `  ${path}: ${message} (${label})`;
        })
        .join('\n');
    return new Error(
        `Merged Spur config failed JSON Schema validation (global ${layers.global ?? '(absent)'} + project ${layers.project ?? '(absent)'}):\n${details}`,
    );
}

async function loadMergedConfig(
    layers: ResolvedConfigLayers,
    opts: LoadSpurConfigOptions | undefined,
    validateJsonSchema: boolean,
): Promise<SpurConfig> {
    const globalRaw = layers.global !== undefined ? await readRawYamlLayer(layers.global, 'global') : {};
    const projectRaw = layers.project !== undefined ? await readRawYamlLayer(layers.project, 'project') : {};

    // 0857 R2 / 0858 R2: the retired team roster key and both retired fleet
    // carriers fail the load BEFORE merge and BEFORE either schema (zod strips
    // unknown keys silently; the JSON-schema pass would report the key generically).
    const replacementFile = projectConfigReplacement(layers);
    if (layers.global !== undefined) {
        assertNoRetiredTeamKey(globalRaw, layers.global, replacementFile);
        assertNoGlobalFleetSection(globalRaw, layers.global, replacementFile);
    }
    if (layers.project !== undefined) assertNoRetiredTeamKey(projectRaw, layers.project, replacementFile);

    const merged = mergeSpurConfigLayers(globalRaw, projectRaw);

    if (validateJsonSchema) {
        // R2/R3: validate the MERGED object once — per-layer validation would reject
        // legal fragments (an executor whose `agent` comes from the other layer).
        // Relative `$schema` refs resolve against the project layer's directory.
        const source = layers.project ?? layers.global ?? '';
        try {
            await validateDeclaredJsonSchema(merged, source, schemaValidationContext(opts));
        } catch (error) {
            throw enrichSchemaViolationError(error, merged, globalRaw, projectRaw, layers);
        }
    }

    return parseMergedWithProvenance(merged, globalRaw, projectRaw, layers);
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
    const validateJsonSchema = opts?.validateJsonSchema ?? getEnvVar('NODE_ENV') !== 'test';
    if (!validateJsonSchema) {
        const nodeFs = createNodeFileSystem();
        const resolved = nodeFs.resolve(configPath);
        const text = await nodeFs.readFile(resolved);
        return (parseYaml(text) ?? {}) as Record<string, unknown>;
    }
    return (await loadStructuredConfig(configPath, {
        validateSchema: true,
        ...schemaValidationContext(opts),
    })) as Record<string, unknown>;
}

// ---- Folder derivation ----

/** The default folders config when `.spur/config.yaml` has no `tasks:` block. */
function defaultFoldersConfig(): TaskFoldersConfig {
    return {
        active_folder: DEFAULT_TASKS_DIR,
        folders: { [DEFAULT_TASKS_DIR]: { baseCounter: 0 } },
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
            folders[path] = folderConfigSchema.parse(fc);
        }
        const foldersConfig: TaskFoldersConfig = {
            active_folder: tasks.active,
            folders: Object.keys(folders).length > 0 ? folders : defaultFoldersConfig().folders,
        };
        return { tasksDir: tasks.active, featuresDir, foldersConfig, severityOverrides: tasks.severity };
    } catch {
        return defaultPlanningFolders();
    }
}
