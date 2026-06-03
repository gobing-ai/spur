import type { PluginHost } from './host';
import type { PluginManifest } from './schema';

// ── Public types ─────────────────────────────────────────────────────

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

export type PluginSource = 'builtin' | 'bundled' | 'curated' | 'local' | 'untrusted';

export type TrustLevel = PluginManifest['trust'];

// ── Registration context ─────────────────────────────────────────────

export interface RegistrationContext {
    source: PluginSource;
    pluginName: string;
    trustLevel: TrustLevel;
}

// ── SpurPlugin interface ─────────────────────────────────────────────

export interface SpurPlugin {
    readonly name: string;
    readonly version: string;
    readonly trust: TrustLevel;
    onLoad(host: PluginHost): void | Promise<void>;
    onUnload?(host: PluginHost): void | Promise<void>;
}

// ── Error classes ────────────────────────────────────────────────────

export class PluginCollisionError extends Error {
    constructor(capability: Capability, name: string, existingPlugin: string) {
        super(`Plugin collision: '${name}' already registered for '${capability}' by '${existingPlugin}'`);
        this.name = 'PluginCollisionError';
    }
}

export class PluginTrustError extends Error {
    constructor(pluginName: string, capability: Capability, level: TrustLevel, reason: string) {
        super(`Trust error for '${pluginName}': ${capability} denied at trust level '${level}' — ${reason}`);
        this.name = 'PluginTrustError';
    }
}

export class PluginNotDeclaredError extends Error {
    constructor(pluginName: string, capability: Capability, name: string) {
        super(`Plugin '${pluginName}' did not declare capability '${capability}:${name}' in its manifest`);
        this.name = 'PluginNotDeclaredError';
    }
}
