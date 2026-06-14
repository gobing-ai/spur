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
    // Rule presets (ADR-015 — project-local rules stay at .spur/rules/)
    { source: 'rules/recommended-pre-check.yaml', target: 'rules/recommended-pre-check.yaml' },
    { source: 'rules/recommended-post-check.yaml', target: 'rules/recommended-post-check.yaml' },
    // Workflows — lifecycle + pipeline definitions under .spur/config/workflows/
    { source: 'workflows/basic.yaml', target: 'config/workflows/basic.yaml' },
    { source: 'workflows/task-lifecycle.yaml', target: 'config/workflows/task-lifecycle.yaml' },
    { source: 'workflows/feature-lifecycle.yaml', target: 'config/workflows/feature-lifecycle.yaml' },
    { source: 'workflows/feature-dev.yaml', target: 'config/workflows/feature-dev.yaml' },
    { source: 'workflows/task-pipeline.yaml', target: 'config/workflows/task-pipeline.yaml' },
    // Section matrix under .spur/config/tasks/
    { source: 'tasks/section-matrix.yaml', target: 'config/tasks/section-matrix.yaml' },
    // Task templates under .spur/config/templates/task/
    { source: 'templates/task/default.md', target: 'config/templates/task/default.md' },
    { source: 'templates/task/feature-impl.md', target: 'config/templates/task/feature-impl.md' },
    { source: 'templates/task/issue.md', target: 'config/templates/task/issue.md' },
    { source: 'templates/task/review.md', target: 'config/templates/task/review.md' },
    { source: 'templates/task/meta.md', target: 'config/templates/task/meta.md' },
    // Feature templates under .spur/config/templates/feature/
    { source: 'templates/feature/default.md', target: 'config/templates/feature/default.md' },
    // BDD snippets under .spur/config/templates/bdd/
    { source: 'templates/bdd/gherkin.md', target: 'config/templates/bdd/gherkin.md' },
    { source: 'templates/bdd/checklist.md', target: 'config/templates/bdd/checklist.md' },
] as const;
