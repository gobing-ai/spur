import type { PluginHost } from './host';
import type { PluginManifest } from './schema';

// ── Public types ─────────────────────────────────────────────────────

/** Registry capability kind — one of the nine plugin extension points. */
export type Capability =
    | 'commands'
    | 'api'
    | 'ui'
    | 'events'
    | 'harnesses'
    | 'providers'
    | 'rules'
    | 'skills'
    | 'workers';

/** Provenance tier for a plugin — from builtin (trusted) to untrusted. */
export type PluginSource = 'builtin' | 'bundled' | 'curated' | 'local' | 'untrusted';

/** Trust level from the plugin manifest. */
export type TrustLevel = PluginManifest['trust'];

// ── Registration context ─────────────────────────────────────────────

/** Context passed into every registry .register() call. */
export interface RegistrationContext {
    source: PluginSource;
    pluginName: string;
    trustLevel: TrustLevel;
}

// ── SpurPlugin interface ─────────────────────────────────────────────

/** Contract every Spur plugin module must implement. */
export interface SpurPlugin {
    readonly name: string;
    readonly version: string;
    readonly trust: TrustLevel;
    onLoad(host: PluginHost): void | Promise<void>;
    onUnload?(host: PluginHost): void | Promise<void>;
}

// ── Error classes ────────────────────────────────────────────────────

/** Thrown when two plugins try to register the same capability:name pair. */
export class PluginCollisionError extends Error {
    constructor(capability: Capability, name: string, existingPlugin: string) {
        super(`Plugin collision: '${name}' already registered for '${capability}' by '${existingPlugin}'`);
        this.name = 'PluginCollisionError';
    }
}

/** Thrown when a trust level forbids a capability registration. */
export class PluginTrustError extends Error {
    constructor(pluginName: string, capability: Capability, level: TrustLevel, reason: string) {
        super(`Trust error for '${pluginName}': ${capability} denied at trust level '${level}' — ${reason}`);
        this.name = 'PluginTrustError';
    }
}

/** Thrown when a plugin did not declare a capability:name in its manifest. */
export class PluginNotDeclaredError extends Error {
    constructor(pluginName: string, capability: Capability, name: string) {
        super(`Plugin '${pluginName}' did not declare capability '${capability}:${name}' in its manifest`);
        this.name = 'PluginNotDeclaredError';
    }
}
