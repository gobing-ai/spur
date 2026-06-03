import { type EventBus, getLogger, type Logger } from '@gobing-ai/ts-infra';
import { mergePluginConfig } from './config';
import { EventRegistry, SPUR_EVENT_KEYS, type SpurEventMap } from './events';
import type { RegistrationContext, SpurPlugin } from './plugin';
import { ApiRegistry } from './registries/api';
import { CommandRegistry } from './registries/command';
import { EventRegistry as EventRegSubclass } from './registries/event';
import { HarnessRegistry } from './registries/harness';
import { ProviderRegistry } from './registries/provider';
import { RuleRegistry } from './registries/rule';
import { SkillRegistry } from './registries/skill';
import { UiRegistry } from './registries/ui';
import { WorkerRegistry } from './registries/worker';
import { TrustEngine } from './trust';

// ── PluginHost ───────────────────────────────────────────────────────

/**
 * PluginHost owns the 8 typed capability registries, a namespaced logger,
 * the event registry (glob adapter over EventBus), and config.
 *
 * Built-ins are seeded before any plugin loads via preRegister() on
 * individual registries. Plugins loaded via onLoad() interact with the
 * same registries through the public API.
 */
export class PluginHost {
    public readonly commands: CommandRegistry;
    public readonly api: ApiRegistry;
    public readonly ui: UiRegistry;
    public readonly events: EventRegSubclass;
    public readonly harnesses: HarnessRegistry;
    public readonly providers: ProviderRegistry;
    public readonly rules: RuleRegistry;
    public readonly skills: SkillRegistry;
    public readonly workers: WorkerRegistry;
    public readonly eventRegistry: EventRegistry;
    public readonly logger: Logger;
    public readonly trust: TrustEngine;

    private loadedPlugins = new Map<string, SpurPlugin>();

    constructor(
        private readonly bus: EventBus<SpurEventMap>,
        opts?: { logger?: Logger },
    ) {
        this.logger = (opts?.logger ?? getLogger('plugin-host')).child({ component: 'PluginHost' });
        this.trust = new TrustEngine();

        // Initialize all 8 capability registries
        this.commands = new CommandRegistry(this.trust, this.logger);
        this.api = new ApiRegistry(this.trust, this.logger);
        this.ui = new UiRegistry(this.trust, this.logger);
        this.events = new EventRegSubclass(this.trust, this.logger);
        this.harnesses = new HarnessRegistry(this.trust, this.logger);
        this.providers = new ProviderRegistry(this.trust, this.logger);
        this.rules = new RuleRegistry(this.trust, this.logger);
        this.skills = new SkillRegistry(this.trust, this.logger);
        this.workers = new WorkerRegistry(this.trust, this.logger);

        // Event registry (glob adapter over the bus)
        this.eventRegistry = new EventRegistry(this.bus, SPUR_EVENT_KEYS);
    }

    /**
     * Load a plugin: validate manifest, merge config, invoke onLoad().
     * Returns the merged config (defaults → overrides → env).
     */
    async loadPlugin(
        plugin: SpurPlugin,
        _ctx: RegistrationContext,
        overrides?: Record<string, unknown> | null,
        env?: Record<string, string | undefined>,
    ): Promise<Record<string, unknown>> {
        if (this.loadedPlugins.has(plugin.name)) {
            throw new Error(`Plugin '${plugin.name}' is already loaded`);
        }

        this.loadedPlugins.set(plugin.name, plugin);

        // Merge config
        const config = mergePluginConfig({}, overrides ?? null, env ?? {}, plugin.name);

        // Emit event
        await this.bus.emit('plugin.load', { name: plugin.name, version: plugin.version });

        // Invoke onLoad
        await plugin.onLoad(this);

        return config;
    }

    /**
     * Unload a plugin: invoke onUnload(), remove from loaded set.
     * No-op if not loaded.
     */
    async unloadPlugin(name: string): Promise<void> {
        const plugin = this.loadedPlugins.get(name);
        if (!plugin) return;

        if (plugin.onUnload) {
            await plugin.onUnload(this);
        }

        this.loadedPlugins.delete(name);
        await this.bus.emit('plugin.unload', { name });
    }

    /**
     * Check if a plugin is loaded.
     */
    isLoaded(name: string): boolean {
        return this.loadedPlugins.has(name);
    }

    /**
     * Invoke onServerStart on every loaded plugin that implements it.
     * Called by the server after plugin routes are mounted, before serving.
     * Fail-soft: a throwing hook is logged and skipped so one plugin cannot
     * block the rest (ADR-012 — local/curated never crash the host).
     */
    async startServerHooks(): Promise<void> {
        for (const plugin of this.loadedPlugins.values()) {
            if (!plugin.onServerStart) continue;
            try {
                await plugin.onServerStart(this);
            } catch (err) {
                this.logger.error(`Plugin '${plugin.name}' onServerStart failed`, { err });
            }
        }
    }

    /**
     * Invoke onServerStop on every loaded plugin that implements it.
     * Called by the server on shutdown, before plugins unload. Fail-soft so a
     * throwing hook never skips the remaining plugins' cleanup.
     */
    async stopServerHooks(): Promise<void> {
        for (const plugin of this.loadedPlugins.values()) {
            if (!plugin.onServerStop) continue;
            try {
                await plugin.onServerStop(this);
            } catch (err) {
                this.logger.error(`Plugin '${plugin.name}' onServerStop failed`, { err });
            }
        }
    }
}
