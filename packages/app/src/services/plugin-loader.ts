/** Injectable module loader — defaults to dynamic import(). Mock in tests. */
export type ModuleLoader = (id: string) => Promise<Record<string, unknown>>;

/** Deferred — no plugins exist yet (ADR-012 amendment 2026-06-09). */
export interface PluginCandidate {
    dir: string;
    source: 'bundled' | 'curated' | 'local';
    root: string;
}

/** Deferred — no plugins exist yet (ADR-012 amendment 2026-06-09). */
export interface ValidatedPlugin extends PluginCandidate {
    manifest: Record<string, unknown>;
}

/** Deferred — no plugins exist yet (ADR-012 amendment 2026-06-09). */
export interface PluginLoadResult {
    name: string;
    version: string;
    source: string;
    status: 'loaded' | 'skipped' | 'failed';
    error?: string;
    dir: string;
}
