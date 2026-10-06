import { join, resolve } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import { type DecisionCatalog, loadDecisionCatalog } from '@gobing-ai/ts-ai-decision';

/**
 * The ordered decision-catalog layer vocabulary, mirroring the workflow layers
 * (ADR-113 / task 0819): `project` (`<cwd>/.spur/decisions`), `registered`
 * (each extra `decisions.paths` folder) and `shared` (the installed package's
 * `decisions/` under `bundledConfigRoot()`).
 */
export type DecisionLayerId = 'project' | 'registered' | 'shared';

/** Prefix marking a `decisions.paths` entry as relative to the installed package's config root. */
export const BUNDLED_DECISIONS_PREFIX = 'bundled:';

/** One ordered decision-catalog layer: `id` names the tier, `path` the absolute folder. */
export interface DecisionLayer {
    id: DecisionLayerId;
    path: string;
}

/**
 * `decisions.paths` entries as registered-layer candidates. `bundled:`-prefixed
 * entries expand against the installed package's config root at read time (no
 * bundled root under `bun build --compile` — the entry is skipped); other
 * entries are returned as configured and resolved against cwd by
 * {@link decisionLayers}. Sync & pure: the merged config is threaded from the
 * composition root (A5 / ADR-082).
 */
export function registeredDecisionPaths(config: SpurConfig | null): string[] {
    const paths = config?.decisions?.paths ?? [];
    const bundledRoot = bundledConfigRoot();
    const expanded: string[] = [];
    for (const path of paths) {
        if (path.startsWith(BUNDLED_DECISIONS_PREFIX)) {
            if (bundledRoot !== null) expanded.push(join(bundledRoot, path.slice(BUNDLED_DECISIONS_PREFIX.length)));
        } else {
            expanded.push(path);
        }
    }
    return expanded;
}

/** Options for {@link decisionLayers} / {@link resolveDecisionCatalogs}. */
export interface DecisionResolveOptions {
    cwd: string;
    /** Registered extra folders (`decisions.paths`, expanded) in config order. */
    registered: readonly string[];
    /**
     * Shared-layer root override. Defaults to `bundledConfigRoot()`; `null`
     * models the compiled-binary case where the shared layer is absent.
     */
    sharedRoot?: string | null;
}

/**
 * The one ordered layer list backing decision resolution, mirroring
 * {@link ../workflow/workflow-resolver.ts!workflowLayers} (ADR-113 semantics):
 * project first, then registered entries in config order (deduped by absolute
 * path, legacy duplicates of the project/shared folders collapse), then the
 * shared root's `decisions/` folder when the package tree resolves.
 */
export function decisionLayers(opts: DecisionResolveOptions): DecisionLayer[] {
    const sharedRoot = opts.sharedRoot !== undefined ? opts.sharedRoot : bundledConfigRoot();
    const sharedPath = sharedRoot !== null ? resolve(opts.cwd, join(sharedRoot, 'decisions')) : null;
    const layers: DecisionLayer[] = [];
    const seen = new Set<string>();
    const add = (id: DecisionLayerId, path: string): void => {
        if (seen.has(path)) return;
        seen.add(path);
        layers.push({ id, path });
    };

    add('project', resolve(opts.cwd, join(opts.cwd, '.spur', 'decisions')));
    for (const entry of opts.registered) {
        // A registered entry equal to the shared decisions folder collapses into
        // the shared layer — the folder keeps its `shared` id (legacy `bundled:decisions`).
        if (sharedPath !== null && resolve(opts.cwd, entry) === sharedPath) continue;
        add('registered', resolve(opts.cwd, entry));
    }
    if (sharedPath !== null) add('shared', sharedPath);

    return layers;
}

/** One winning catalog file, loaded, with the layer it came from. */
export interface LoadedDecisionFile {
    layer: DecisionLayerId;
    path: string;
    basename: string;
    catalog: DecisionCatalog;
}

/** One per-file load failure: reported, never thrown (design §3.2). */
export interface DecisionLoadError {
    layer: DecisionLayerId;
    path: string;
    message: string;
}

/** One decision id declared by two or more different winning files (design §3.2). */
export interface DuplicateDecisionId {
    id: string;
    sources: string[];
}

/** Result of {@link resolveDecisionCatalogs}: winners, per-file load errors, cross-file duplicate ids. */
export interface DecisionResolution {
    layers: DecisionLayer[];
    files: LoadedDecisionFile[];
    loadErrors: DecisionLoadError[];
    duplicateIds: DuplicateDecisionId[];
}

/**
 * Resolve the catalog layers, pick the winning file per basename (first layer
 * wins — this happens before any hub load, because the upstream hub throws on
 * duplicate ids), then load each winner with per-file error isolation. The
 * same decision id in two different winning files is reported as a duplicate;
 * the service fails `run`/`decide` of that id closed.
 */
export async function resolveDecisionCatalogs(opts: DecisionResolveOptions): Promise<DecisionResolution> {
    const layers = decisionLayers(opts);

    // Winner selection per basename across layers, in layer order.
    const winners = new Map<string, { layer: DecisionLayerId; path: string }>();
    for (const layer of layers) {
        let names: string[] = [];
        try {
            names = await Array.fromAsync(new Bun.Glob('*.yaml').scan({ cwd: layer.path }));
        } catch {
            continue; // Missing or unreadable folder: the layer simply contributes nothing.
        }
        for (const name of names.sort()) {
            if (!winners.has(name)) winners.set(name, { layer: layer.id, path: join(layer.path, name) });
        }
    }

    const files: LoadedDecisionFile[] = [];
    const loadErrors: DecisionLoadError[] = [];
    for (const [name, winner] of winners) {
        try {
            const catalog = await loadDecisionCatalog(winner.path);
            files.push({ layer: winner.layer, path: winner.path, basename: name, catalog });
        } catch (error) {
            loadErrors.push({
                layer: winner.layer,
                path: winner.path,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    files.sort((a, b) => layerRank(a.layer) - layerRank(b.layer) || a.basename.localeCompare(b.basename));

    // Duplicate ids across different winning files (same file cannot have them —
    // the upstream catalog is a record keyed by id).
    const seen = new Map<string, string>();
    const duplicateIds: DuplicateDecisionId[] = [];
    for (const file of files) {
        for (const id of Object.keys(file.catalog.decisions)) {
            const first = seen.get(id);
            if (first === undefined) {
                seen.set(id, file.path);
            } else {
                const entry = duplicateIds.find((d) => d.id === id);
                if (entry) {
                    if (!entry.sources.includes(file.path)) entry.sources.push(file.path);
                } else {
                    duplicateIds.push({ id, sources: [first, file.path] });
                }
            }
        }
    }

    return { layers, files, loadErrors, duplicateIds };
}

const LAYER_RANK: Record<DecisionLayerId, number> = { project: 0, registered: 1, shared: 2 };
const layerRank = (id: DecisionLayerId): number => LAYER_RANK[id];
