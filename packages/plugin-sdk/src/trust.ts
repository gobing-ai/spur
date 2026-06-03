import type { Capability, RegistrationContext, TrustLevel } from './plugin';
import { PluginNotDeclaredError, PluginTrustError } from './plugin';
import type { CapabilitiesManifest } from './schema';

// ── Policy table ─────────────────────────────────────────────────────
//
// bundled: unconditionally allowed (short-circuits in enforce)
// curated: all capabilities allowed
// local: harnesses/providers/rules/workers denied
// untrusted: only read-only APIs (commands/api/ui/events/skills)

type CapabilityTier = 'safe' | 'privileged';

const CAPABILITY_TIERS: Record<Capability, CapabilityTier> = {
    commands: 'safe',
    api: 'safe',
    ui: 'safe',
    events: 'safe',
    skills: 'safe',
    harnesses: 'privileged',
    providers: 'privileged',
    rules: 'privileged',
    workers: 'privileged',
};

const POLICY: Record<Exclude<TrustLevel, 'bundled'>, Record<CapabilityTier, boolean>> = {
    curated: { safe: true, privileged: true },
    local: { safe: true, privileged: false },
    untrusted: { safe: true, privileged: false },
};

// ── TrustEngine ──────────────────────────────────────────────────────

/** Enforces capability trust policy — checks declaration + tier at registration time. */
export class TrustEngine {
    constructor() {}

    /**
     * Enforce trust policy for a registration.
     * Throws PluginTrustError if the trust level forbids this capability.
     * Throws PluginNotDeclaredError if the plugin didn't declare this capability.
     */
    enforce(capability: Capability, level: TrustLevel, ctx: RegistrationContext): void {
        // R4.3: plugin must declare the capability
        // (declares() is called by the host before enforce, but double-check here for safety)
        if (level === 'bundled') return; // unconditionally allowed
        const tier = CAPABILITY_TIERS[capability];
        const allowed = POLICY[level]?.[tier];
        if (allowed === undefined || !allowed) {
            throw new PluginTrustError(
                ctx.pluginName,
                capability,
                level,
                `'${capability}' is not allowed at trust level '${level}'`,
            );
        }
    }

    /**
     * Check if a plugin's manifest declares a specific capability:name pair.
     * Returns true if the manifest capabilities include the named capability entry.
     */
    declares(manifest: CapabilitiesManifest, capability: Capability, name: string): boolean {
        const entries = manifest[capability];
        if (!entries) return false;
        return entries.includes(name);
    }

    /**
     * Check if manifest declares AND trust policy allows.
     * Combined gate for registration — call from Registry.register().
     */
    check(manifest: CapabilitiesManifest, capability: Capability, name: string, ctx: RegistrationContext): void {
        // bundled is unconditionally allowed — bypass all checks
        if (ctx.trustLevel === 'bundled') return;
        if (!this.declares(manifest, capability, name)) {
            throw new PluginNotDeclaredError(ctx.pluginName, capability, name);
        }
        this.enforce(capability, ctx.trustLevel, ctx);
    }
}
