/** Entry returned by {@link PluginService.list} for CLI display and JSON output. */
export interface PluginListEntry {
    name: string;
    version: string;
    source: string;
    status: string;
    dir: string;
}

/**
 * Thin no-op plugin service.
 *
 * Plugin discovery is deferred until a real plugin consumer exists (ADR-012
 * amendment 2026-06-09). When re-enabled, plugins will be discovered via
 * plugin.yaml scan → dynamic import → host.register, targeting the bare
 * ts-infra `Plugin` interface.
 */
export class PluginService {
    constructor() {}

    async ensureBootstrapped(): Promise<void> {
        // No-op: no plugins exist yet.
    }

    async list(): Promise<PluginListEntry[]> {
        return [];
    }

    async info(_name: string): Promise<PluginListEntry | null> {
        return null;
    }
}
