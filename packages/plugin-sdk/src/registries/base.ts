import type { Logger } from '@gobing-ai/ts-infra';
import type { Capability, PluginSource, RegistrationContext } from '../plugin';
import { PluginCollisionError } from '../plugin';
import type { TrustEngine } from '../trust';

// ── Registry entry ───────────────────────────────────────────────────

/** A single registered entry pairing an implementation with its source plugin. */
export interface RegistryEntry<T> {
    name: string;
    impl: T;
    source: PluginSource;
}

// ── Registry<TImpl> ──────────────────────────────────────────────────
//
// The SemVer-significant public contract (ADR-012 Decision 7).
// Each concrete registry subclasses this with a typed TImpl.
// Built-ins are seeded via preRegister() and resolved through the
// same get() path — enabling the 5f migration-as-move.

/** Abstract typed registry — validates collisions + trust, resolves by name. */
export abstract class Registry<TImpl> {
    private readonly entries = new Map<string, RegistryEntry<TImpl>>();

    constructor(
        protected readonly capability: Capability,
        protected readonly trust: TrustEngine,
        protected readonly logger: Logger,
    ) {}

    // ── Public API ────────────────────────────────────────────────

    /**
     * Register an implementation. Validates collision + trust, then stores.
     * Throws PluginCollisionError on name collision.
     * First-registered wins — built-ins occupy their names before plugins load.
     */
    register(name: string, impl: TImpl, ctx: RegistrationContext): void {
        const existing = this.entries.get(name);
        if (existing !== undefined) {
            throw new PluginCollisionError(this.capability, name, existing.source);
        }
        this.trust.enforce(this.capability, ctx.trustLevel, ctx);
        this.entries.set(name, { name, impl, source: ctx.source });
    }

    /**
     * Remove a registration by name. No-op if not found.
     */
    unregister(name: string): void {
        this.entries.delete(name);
    }

    /**
     * Resolve a named implementation. Single overlay lookup — no branching
     * between built-in and plugin entries.
     */
    get(name: string): TImpl | undefined {
        return this.entries.get(name)?.impl;
    }

    /**
     * List all registered entries with name and source.
     */
    list(): { name: string; source: PluginSource }[] {
        return [...this.entries.values()].map((e) => ({
            name: e.name,
            source: e.source,
        }));
    }

    // ── Built-in seeding ──────────────────────────────────────────

    /**
     * Pre-register a built-in implementation. No trust check (bundled
     * is unconditionally allowed). The entry is resolved through the
     * same get() as plugin entries.
     */
    protected preRegister(name: string, impl: TImpl): void {
        const existing = this.entries.get(name);
        if (existing !== undefined) {
            throw new PluginCollisionError(this.capability, name, existing.source);
        }
        this.entries.set(name, { name, impl, source: 'builtin' });
    }
}
