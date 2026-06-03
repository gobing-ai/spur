// ── Public surface of @gobing-ai/spur-plugin-sdk ─────────────────────
//
// Types, schemas, validators, PluginHost, TrustLevel, and error classes.
// Registry internals (base class, internal entry types) are NOT exported.

// Config
export { mergePluginConfig } from './config';
// Events
export { EventRegistry, SPUR_EVENT_KEYS, type SpurEventMap } from './events';
// Host
export { PluginHost } from './host';
// Core types
export {
    type Capability,
    PluginCollisionError,
    PluginNotDeclaredError,
    type PluginSource,
    PluginTrustError,
    type RegistrationContext,
    type SpurPlugin,
    type TrustLevel,
} from './plugin';
export { type ApiImpl, ApiRegistry } from './registries/api';
// Concrete registries (public — ADR-012 Decision 7)
export { type CommandImpl, CommandRegistry } from './registries/command';
export { type EventImpl, EventRegistry as PluginEventRegistry } from './registries/event';
export { type HarnessImpl, HarnessRegistry } from './registries/harness';
export { type Provider, ProviderRegistry } from './registries/provider';
export { type RuleImpl, RuleRegistry } from './registries/rule';
export { type SkillImpl, SkillRegistry } from './registries/skill';
export { type UiImpl, UiRegistry } from './registries/ui';
export { type WorkerImpl, WorkerRegistry } from './registries/worker';
// Schemas
export {
    AllowSchema,
    type CapabilitiesManifest,
    CapabilitiesSchema,
    type PluginConfig,
    PluginConfigSchema,
    type PluginManifest,
    PluginManifestError,
    PluginManifestSchema,
    TrustLevelSchema,
    validateManifest,
} from './schema';
// Trust
export { TrustEngine } from './trust';
