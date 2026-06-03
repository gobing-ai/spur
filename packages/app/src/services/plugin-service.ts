import type { PluginHost } from '@gobing-ai/spur-plugin-sdk';
import type { Logger } from '@gobing-ai/ts-infra';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { type ModuleLoader, PluginLoader, type PluginLoadResult } from './plugin-loader';

/** Entry returned by {@link PluginService.list} for CLI display and JSON output. */
export interface PluginListEntry {
    name: string;
    version: string;
    source: string;
    status: string;
    dir: string;
}

/** Context required to instantiate {@link PluginService}. */
export interface PluginServiceContext {
    host: PluginHost;
    fs: FileSystem;
    logger?: Logger;
    env?: Record<string, string | undefined>;
    installDir?: string;
    projectRoot?: string;
    /** Optional module loader for tests. Defaults to dynamic import(). */
    loadModule?: ModuleLoader;
}

/** High-level service wrapping {@link PluginLoader} with bootstrap-on-first-use semantics. */
export class PluginService {
    private readonly loader: PluginLoader;
    private results: PluginLoadResult[] = [];
    private bootstrapped = false;

    constructor(private readonly ctx: PluginServiceContext) {
        this.loader = new PluginLoader(ctx.host, ctx.fs, ctx.logger, ctx.env, ctx.loadModule);
    }

    async ensureBootstrapped(): Promise<void> {
        if (this.bootstrapped) return;
        this.results = await this.loader.bootstrap(this.ctx.installDir, this.ctx.projectRoot);
        this.bootstrapped = true;
    }

    async list(): Promise<PluginListEntry[]> {
        await this.ensureBootstrapped();
        return this.results.map((r) => ({
            name: r.name,
            version: r.version,
            source: r.source,
            status: r.status,
            dir: r.dir,
        }));
    }

    async info(name: string): Promise<PluginListEntry | null> {
        await this.ensureBootstrapped();
        return this.results.find((r) => r.name === name) ?? null;
    }
}
