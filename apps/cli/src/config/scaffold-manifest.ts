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
    /**
     * Path relative to the scaffold root. Defaults to the project `.spur/` directory; when
     * {@link ScaffoldEntry.root} is `true`, resolves against the project root instead (e.g.
     * `docs/` scaffolds). This lets the manifest carry both `.spur/` and project-root targets.
     */
    target: string;
    /**
     * When `true`, resolve {@link target} against the project root (not `.spur/`). Used for
     * docs scaffolds that belong at `<cwd>/docs/` rather than `<cwd>/.spur/`.
     */
    root?: boolean;
    /**
     * When `true`, the target is never overwritten — not even with `--force`. Use for
     * user-customizable content (e.g. `docs/`) that must survive a re-init. `writeIfNew`
     * is called with `force=false` for this entry regardless of the CLI flag.
     */
    preserve?: boolean;
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
    // Workflows — lifecycle + pipeline definitions under .spur/workflows/ (where the runtime reads them)
    { source: 'workflows/basic.yaml', target: 'workflows/basic.yaml' },
    { source: 'workflows/task-lifecycle.yaml', target: 'workflows/task-lifecycle.yaml' },
    { source: 'workflows/feature-lifecycle.yaml', target: 'workflows/feature-lifecycle.yaml' },
    { source: 'workflows/feature-dev.yaml', target: 'workflows/feature-dev.yaml' },
    { source: 'workflows/task-pipeline.yaml', target: 'workflows/task-pipeline.yaml' },
    // Planning pipeline — front-half (task 0088); companions the sp:spur-plan skill
    { source: 'workflows/planning-pipeline.yaml', target: 'workflows/planning-pipeline.yaml' },
    // Section matrix under .spur/tasks/
    { source: 'tasks/section-matrix.yaml', target: 'tasks/section-matrix.yaml' },
    // Task templates under .spur/tasks/templates/
    { source: 'templates/task/standard.md', target: 'tasks/templates/standard.md' },
    { source: 'templates/task/feature-impl.md', target: 'tasks/templates/feature-impl.md' },
    { source: 'templates/task/issue.md', target: 'tasks/templates/issue.md' },
    { source: 'templates/task/review.md', target: 'tasks/templates/review.md' },
    { source: 'templates/task/meta.md', target: 'tasks/templates/meta.md' },
    // Feature templates under .spur/templates/feature/
    { source: 'templates/feature/default.md', target: 'templates/feature/default.md' },
    // BDD snippets under .spur/templates/bdd/
    { source: 'templates/bdd/gherkin.md', target: 'templates/bdd/gherkin.md' },
    { source: 'templates/bdd/checklist.md', target: 'templates/bdd/checklist.md' },
    // Docs scaffolds at the project root (R1 — task 0088): constitution + numbered doc stubs.
    // Idempotent / never-overwrite (preserve) — a customized live doc is never clobbered, even
    // by `spur init --force`. Only `docs/` copies are preserved; the `.spur/templates/docs/`
    // copies below are regular templates and follow the normal --force behavior.
    {
        source: 'templates/docs/99_PROJECT_CONSTITUTION.md',
        target: 'docs/99_PROJECT_CONSTITUTION.md',
        root: true,
        preserve: true,
    },
    { source: 'templates/docs/00_ADR.md', target: 'docs/00_ADR.md', root: true, preserve: true },
    { source: 'templates/docs/01_PRD.md', target: 'docs/01_PRD.md', root: true, preserve: true },
    { source: 'templates/docs/02_ROADMAP.md', target: 'docs/02_ROADMAP.md', root: true, preserve: true },
    { source: 'templates/docs/03_ARCHITECTURE.md', target: 'docs/03_ARCHITECTURE.md', root: true, preserve: true },
    { source: 'templates/docs/04_DESIGN.md', target: 'docs/04_DESIGN.md', root: true, preserve: true },
    { source: 'templates/docs/05_FEATURES.md', target: 'docs/05_FEATURES.md', root: true, preserve: true },
    // Doc templates under .spur/templates/docs/ (referenced by sp:doc-evolve and sp:spur-init)
    { source: 'templates/docs/99_PROJECT_CONSTITUTION.md', target: 'templates/docs/99_PROJECT_CONSTITUTION.md' },
    { source: 'templates/docs/00_ADR.md', target: 'templates/docs/00_ADR.md' },
    { source: 'templates/docs/01_PRD.md', target: 'templates/docs/01_PRD.md' },
    { source: 'templates/docs/02_ROADMAP.md', target: 'templates/docs/02_ROADMAP.md' },
    { source: 'templates/docs/03_ARCHITECTURE.md', target: 'templates/docs/03_ARCHITECTURE.md' },
    { source: 'templates/docs/04_DESIGN.md', target: 'templates/docs/04_DESIGN.md' },
    { source: 'templates/docs/05_FEATURES.md', target: 'templates/docs/05_FEATURES.md' },
] as const;
