/**
 * Explicit manifest of default config files `spur init` scaffolds into `.spur/`.
 *
 * Each entry maps a bundled config source (relative to {@link bundledConfigRoot})
 * to a local target (relative to the project `.spur/` directory). Adding a future
 * default requires a one-line edit here — no control-flow changes in `init.ts`.
 *
 * The manifest is read-only data; all resolution and I/O live in `init.ts`.
 */

/** One entry in the scaffold manifest: source relative path → target relative path. */
export interface ScaffoldEntry {
    /** Path relative to the bundled config root (e.g. `rules/recommended-pre-check.yaml`). */
    source: string;
    /** Path relative to the project `.spur/` directory (e.g. `rules/recommended-pre-check.yaml`). */
    target: string;
}

/**
 * Ordered list of files `spur init` writes under `.spur/` (unless `--minimal`).
 * The order determines the scaffold sequence; target directories are ensured
 * automatically by `init.ts` before each write.
 */
export const SCAFFOLD_MANIFEST: readonly ScaffoldEntry[] = [
    { source: 'rules/recommended-pre-check.yaml', target: 'rules/recommended-pre-check.yaml' },
    { source: 'rules/recommended-post-check.yaml', target: 'rules/recommended-post-check.yaml' },
    { source: 'workflows/basic.yaml', target: 'workflows/basic.yaml' },
] as const;
