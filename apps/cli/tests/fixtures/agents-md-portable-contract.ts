/**
 * Portable AGENTS.md harness-contract SSOT (task 0242).
 *
 * Root `AGENTS.md` (dogfood instance) and the bundled AGENTS seed (spur init template)
 * must share these H2 headings and Harness tool routing "Need" keys. Keep this list
 * in sync when editing either file — the alignment test fails on drift.
 */

/** H2 headings required in both root AGENTS.md and the portable template. */
export const PORTABLE_AGENTS_H2 = [
    '## Project',
    '## Harness-first contract',
    '## Documentation',
    '## Design system',
    '## Stack & layout',
    '## Spur CLI surface',
    '## Superskill CLI surface',
    '## Conventions & boundaries',
    '## Indexed context',
] as const;

/**
 * Canonical first-column Need keys under `### Harness tool routing`.
 * Must appear byte-for-byte (after trim) in both AGENTS files.
 */
export const PORTABLE_ROUTING_NEED_KEYS = [
    'Plan a feature (intake → AC → tasks)',
    'Drive one task end-to-end',
    'Batch or parallel task runs',
    'Multi-step corpus CLI (tasks/features/rules/workflows)',
    'Look up `spur` verbs / flags / `--json`',
    'Create/edit/list tasks or features',
    'Verify requirements / AC',
    'Review (SECUA + traceability + architecture)',
    'Tests / coverage',
    'Constraint gate / rule authoring',
    'Workflow author / run',
    'Docs drift / sync / lessons',
    'Wrap completed work',
    'Session index / memory',
    'Install / sync a plugin across coding agents',
    'Capability authoring / quality lifecycle',
] as const;

/** Stable prose anchors required in both files (task 0242 R3/R4). */
export const PORTABLE_AGENTS_ANCHORS = [
    '**Platform fallback:**',
    '**Long-tail:**',
    '**Outside spur-cli:**',
    '**Conditional contract:**',
    '**Ownership boundary:**',
] as const;
