import { homedir } from 'node:os';
import { join } from 'node:path';
import { type PluginHost, type PluginManifest, type SpurPlugin, validateManifest } from '@gobing-ai/spur-plugin-sdk';
import { getLogger, type Logger } from '@gobing-ai/ts-infra';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { parse as parseYaml } from 'yaml';

// ── Types ────────────────────────────────────────────────────────────

/** A discovered plugin directory with its priority source and anchor root. */
export interface PluginCandidate {
    dir: string;
    source: 'bundled' | 'curated' | 'local';
    root: string;
}

/** A validated PluginCandidate whose manifest has passed schema checks. */
export interface ValidatedPlugin extends PluginCandidate {
    manifest: PluginManifest;
}

/** Result of loading a single plugin through the discovery→registration pipeline. */
export interface PluginLoadResult {
    name: string;
    version: string;
    source: string;
    status: 'loaded' | 'skipped' | 'failed';
    error?: string;
    dir: string;
}

// ── PluginLoader ─────────────────────────────────────────────────────

/**
 * Discovers, validates, and registers Spur plugins from ranked roots.
 *
 * Priority (highest → lowest for name-shadowing):
 *   0. SPUR_PLUGIN_PATH env var (colon-separated) → 'local'
 *   1. .spur/plugins/  — project-local → 'local'
 *   2. ~/.spur/plugins/ — user-global → 'curated'
 *   3. <installDir>/plugins/ — bundled → 'bundled'
 */
/** Injectable module loader — defaults to dynamic import(). Mock in tests to avoid worker threads. */
export type ModuleLoader = (id: string) => Promise<Record<string, unknown>>;

/** Discovers, validates, loads, and registers plugins from priority-ordered roots. */
export class PluginLoader {
    private readonly logger: Logger;

    constructor(
        private readonly host: PluginHost,
        private readonly fs: FileSystem,
        logger?: Logger,
        private readonly env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
        private readonly loadModule: ModuleLoader = (id) => import(id),
    ) {
        this.logger = (logger ?? getLogger('plugin-loader')).child({ component: 'PluginLoader' });
    }

    // ── Root resolution ────────────────────────────────────────────

    /**
     * Build the priority-ordered plugin root list, each tagged with its source type.
     *
     * Priority (highest → lowest for name-shadowing):
     *   0. SPUR_PLUGIN_PATH env var (colon-separated) → 'local'
     *   1. .spur/plugins/  — project-local → 'local'
     *   2. ~/.spur/plugins/ — user-global → 'curated'
     *   3. <installDir>/plugins/ — bundled → 'bundled' (lowest priority)
     */
    resolveRoots(
        installDir?: string,
        projectRoot?: string,
    ): Array<{ path: string; source: 'bundled' | 'curated' | 'local' }> {
        const roots: Array<{ path: string; source: 'bundled' | 'curated' | 'local' }> = [];

        // 0. SPUR_PLUGIN_PATH
        const envPath = this.env.SPUR_PLUGIN_PATH;
        if (envPath) {
            for (const segment of envPath.split(':')) {
                const trimmed = segment.trim();
                if (trimmed) roots.push({ path: trimmed, source: 'local' });
            }
        }

        // 1. .spur/plugins/
        const cwd = projectRoot ?? process.cwd();
        roots.push({ path: join(cwd, '.spur', 'plugins'), source: 'local' });

        // 2. ~/.spur/plugins/
        roots.push({ path: join(homedir(), '.spur', 'plugins'), source: 'curated' });

        // 3. <installDir>/plugins/
        if (installDir) {
            roots.push({ path: join(installDir, 'plugins'), source: 'bundled' });
        }

        return roots;
    }

    // ── Discovery ───────────────────────────────────────────────────

    /**
     * Discover plugin candidates by scanning all resolved roots for
     * directories containing a `plugin.yaml` file.
     */
    async discover(
        roots: Array<{ path: string; source: 'bundled' | 'curated' | 'local' }>,
    ): Promise<PluginCandidate[]> {
        const candidates: PluginCandidate[] = [];

        for (const root of roots) {
            const source = root.source;
            try {
                const entries = await this.fs.readDir(root.path);
                for (const entry of entries) {
                    const dir = join(root.path, entry);
                    try {
                        const stat = await this.fs.stat(dir);
                        if (!stat?.isDirectory) continue;

                        // Check for plugin.yaml
                        const yamlPath = join(dir, 'plugin.yaml');
                        if (!(await this.fs.exists(yamlPath))) continue;

                        candidates.push({ dir, source, root: root.path });
                    } catch {}
                }
            } catch {
                // root doesn't exist or can't be read — skip
                this.logger.debug(`Plugin root not accessible: ${root.path}`);
            }
        }

        return candidates;
    }

    // ── Validation ──────────────────────────────────────────────────

    /**
     * Read plugin.yaml, parse it with YAML, and validate against the SDK schema.
     * For bundled source: throws on schema failure (fail-fast).
     * For curated/local: returns result with error field (fail-soft).
     */
    async validate(
        candidate: PluginCandidate,
    ): Promise<{ ok: true; plugin: ValidatedPlugin } | { ok: false; error: string }> {
        const yamlPath = join(candidate.dir, 'plugin.yaml');
        const raw = await this.fs.readFile(yamlPath);
        const parsed = parseYaml(raw);

        try {
            const manifest = validateManifest(parsed);
            return { ok: true, plugin: { ...candidate, manifest } };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (candidate.source === 'bundled') {
                throw new Error(`Bundled plugin at ${candidate.dir} has invalid plugin.yaml: ${message}`);
            }
            this.logger.warn(`Skipping plugin at ${candidate.dir}: invalid plugin.yaml — ${message}`);
            return { ok: false, error: message };
        }
    }

    // ── Loading ─────────────────────────────────────────────────────

    async load(plugin: ValidatedPlugin): Promise<SpurPlugin> {
        const indexPath = join(plugin.dir, 'index.ts');
        const imported = await this.loadModule(indexPath);
        const pluginInstance = (imported as { default?: unknown }).default ?? imported;

        if (
            !pluginInstance ||
            typeof (pluginInstance as Record<string, unknown>).name !== 'string' ||
            typeof (pluginInstance as Record<string, unknown>).version !== 'string' ||
            typeof (pluginInstance as Record<string, unknown>).onLoad !== 'function'
        ) {
            throw new Error(
                `Plugin at ${plugin.dir} does not export a valid SpurPlugin (missing name, version, or onLoad)`,
            );
        }

        return pluginInstance as SpurPlugin;
    }

    /**
     * Register all validated plugins using two-class loading:
     *   Phase 1: BUNDLED plugins — fail-fast (throw on any failure)
     *   Phase 2: LOCAL/CURATED plugins — fail-soft (log + skip)
     *
     * Name-shadowing: PluginCollisionError means a higher-priority plugin
     * already claimed the name. The lower-priority one is skipped.
     */
    async registerAll(plugins: ValidatedPlugin[]): Promise<PluginLoadResult[]> {
        const results: PluginLoadResult[] = [];

        // Split
        const bundled = plugins.filter((p) => p.source === 'bundled');
        const others = plugins.filter((p) => p.source !== 'bundled');

        // Phase 1: Bundled — fail-fast
        for (const candidate of bundled) {
            try {
                const plugin = await this.load(candidate);
                await this.host.loadPlugin(plugin, {
                    source: candidate.source,
                    pluginName: candidate.manifest.name,
                    trustLevel: candidate.manifest.trust,
                });
                results.push({
                    name: candidate.manifest.name,
                    version: candidate.manifest.version,
                    source: candidate.source,
                    status: 'loaded',
                    dir: candidate.dir,
                });
                this.logger.info(`Loaded bundled plugin: ${candidate.manifest.name}@${candidate.manifest.version}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new Error(`FATAL: Bundled plugin at ${candidate.dir} failed to load: ${message}`);
            }
        }

        // Phase 2: Local/curated — fail-soft
        for (const candidate of others) {
            try {
                const plugin = await this.load(candidate);
                await this.host.loadPlugin(plugin, {
                    source: candidate.source,
                    pluginName: candidate.manifest.name,
                    trustLevel: candidate.manifest.trust,
                });
                results.push({
                    name: candidate.manifest.name,
                    version: candidate.manifest.version,
                    source: candidate.source,
                    status: 'loaded',
                    dir: candidate.dir,
                });
                this.logger.info(`Loaded plugin: ${candidate.manifest.name}@${candidate.manifest.version}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                // PluginCollisionError → name shadowing (higher-priority already registered)
                if (
                    message.includes('Plugin collision') ||
                    message.includes('already registered') ||
                    message.includes('already loaded')
                ) {
                    this.logger.warn(
                        `Skipping plugin ${candidate.manifest.name}: name already registered by higher-priority plugin`,
                    );
                    results.push({
                        name: candidate.manifest.name,
                        version: candidate.manifest.version,
                        source: candidate.source,
                        status: 'skipped',
                        error: message,
                        dir: candidate.dir,
                    });
                } else {
                    this.logger.warn(`Failed to load plugin at ${candidate.dir}: ${message}`);
                    results.push({
                        name: candidate.manifest.name,
                        version: candidate.manifest.version,
                        source: candidate.source,
                        status: 'failed',
                        error: message,
                        dir: candidate.dir,
                    });
                }
            }
        }

        return results;
    }

    // ── Full bootstrap pipeline ─────────────────────────────────────

    /**
     * Run the full plugin discovery → validation → registration pipeline.
     * Returns load results for all plugins.
     */
    async bootstrap(installDir?: string, projectRoot?: string): Promise<PluginLoadResult[]> {
        const roots = this.resolveRoots(installDir, projectRoot);
        const candidates = await this.discover(roots);

        const validated: ValidatedPlugin[] = [];
        for (const candidate of candidates) {
            const result = await this.validate(candidate);
            if (result.ok) {
                validated.push(result.plugin);
            }
        }

        return this.registerAll(validated);
    }
}
