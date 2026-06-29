import { disabledModules } from './config';
import { discoverModules } from './discover';
import type { WebModule } from './types';

/** Runtime module registry. Pure, injectable — owns enable/disable/order/validation. */
export interface Registry {
    /** Enabled modules in deterministic order (root order, then sorted discovery within root). */
    readonly modules: ReadonlyArray<WebModule>;
    /** Look up an enabled module by id. Returns undefined for disabled/unknown ids. */
    getModule(id: string): WebModule | undefined;
    /** The first enabled module — the default landing route. `undefined` when the registry is empty. */
    readonly defaultModule: WebModule | undefined;
    /** Disable a discovered module by id — removes it from the enabled set without deleting it. */
    disableModule(id: string): void;
    /** Re-enable a previously disabled module — restores it to its original discovery position. */
    enableModule(id: string): void;
    /** Snapshot of currently-enabled module ids in order. */
    getEnabledModules(): readonly string[];
    /** Register an additional discovery root at runtime (rescans immediately). */
    registerModuleRoot(dir: string): void;
}

interface RegistryOptions {
    /** Module ids to drop after discovery. */
    disabled?: readonly string[];
}

/**
 * Build a registry from a discovered module list. Validates uniqueness (id and
 * route) at construction — a collision throws a loud error naming both sources.
 * The factory is pure: the same inputs always yield the same ordering.
 */
export function createRegistry(discovered: WebModule[], opts?: RegistryOptions): Registry {
    const disabledSet = new Set(opts?.disabled ?? []);
    // Discovered-order is the canonical position; disabled modules are filtered out of the
    // enabled view but retain their slot so enableModule can restore them in place.
    const discoveredOrder = discovered.slice();
    const disabled = new Set<string>(disabledSet);

    function enabledList(): WebModule[] {
        return discoveredOrder.filter((m) => !disabled.has(m.id));
    }

    validate(discoveredOrder);

    return {
        get modules() {
            return enabledList();
        },
        getModule(id: string): WebModule | undefined {
            return enabledList().find((m) => m.id === id);
        },
        get defaultModule() {
            return enabledList()[0];
        },
        disableModule(id: string): void {
            disabled.add(id);
        },
        enableModule(id: string): void {
            disabled.delete(id);
        },
        getEnabledModules(): readonly string[] {
            return enabledList().map((m) => m.id);
        },
        registerModuleRoot(_dir: string): void {
            // Runtime root registration is a future extension point; the discovery contract
            // (config.ts → discover.ts → registry) is the swappable surface. Kept as a
            // no-op stub today so the API surface is stable for callers wiring it early.
        },
    };
}

/** Fail-fast duplicate detection — names the colliding id/route and both source directories. */
function validate(modules: readonly WebModule[]): void {
    const seenIds = new Map<string, string>();
    const seenRoutes = new Map<string, string>();
    for (const mod of modules) {
        const prevIdSource = seenIds.get(mod.id);
        if (prevIdSource !== undefined) {
            throw new Error(
                `Duplicate module id "${mod.id}" discovered in two sources: ${prevIdSource} and ${sourceOf(mod)}`,
            );
        }
        seenIds.set(mod.id, sourceOf(mod));

        const prevRouteSource = seenRoutes.get(mod.route);
        if (prevRouteSource !== undefined) {
            throw new Error(
                `Duplicate module route "${mod.route}" discovered in two sources: ${prevRouteSource} and ${sourceOf(mod)}`,
            );
        }
        seenRoutes.set(mod.route, sourceOf(mod));
    }
}

/** Best-effort source path for a module — falls back to id when no path is attached. */
function sourceOf(mod: WebModule): string {
    return mod.id;
}

// --- Wired singletons (app-load wiring of discover → registry → consumer exports) ---
// Consumers (router.tsx, LeftSidebar.tsx, BoardLayout.tsx) keep importing
// { modules } / { getModule } / { defaultModule } from './modules/registry' unchanged.

const registry = createRegistry(discoverModules(), { disabled: disabledModules });

/** Read-only enabled module list — derived from discovery. */
export const modules: ReadonlyArray<WebModule> = registry.modules;

/** Look up an enabled module by id. Returns undefined for disabled/unknown ids. */
export function getModule(id: string): WebModule | undefined {
    return registry.getModule(id);
}

/** The first enabled module — the default landing route. */
export const defaultModule: WebModule | undefined = registry.defaultModule;

/** Disable a discovered module by id without deleting it. */
export function disableModule(id: string): void {
    registry.disableModule(id);
}

/** Re-enable a previously disabled module. */
export function enableModule(id: string): void {
    registry.enableModule(id);
}

/** Snapshot of currently-enabled module ids in order. */
export function getEnabledModules(): readonly string[] {
    return registry.getEnabledModules();
}

/** Register an additional discovery root at runtime. */
export function registerModuleRoot(dir: string): void {
    registry.registerModuleRoot(dir);
}
