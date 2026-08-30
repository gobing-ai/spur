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

/**
 * Always-loaded guide byte ceiling (task 0705 R1): 20 KiB leaves operational headroom below
 * the ~32 KiB platform load limit. Repository contract, not user configuration.
 */
export const PORTABLE_AGENTS_BYTE_BUDGET = 20 * 1024;

/** UTF-8 byte length (task 0705 R2) — encoding-correct, unlike `text.length`. */
export function agentsGuideUtf8Bytes(text: string): number {
    return Buffer.byteLength(text, 'utf8');
}

/**
 * Deterministic guide-budget assertion (task 0705 R1/R3). Pure — no fixture I/O, throws on
 * violation naming the file, actual bytes, the limit, and the one-hop remediation owner.
 */
export function assertAgentsGuideByteBudget(
    label: string,
    text: string,
    limit: number = PORTABLE_AGENTS_BYTE_BUDGET,
): number {
    const bytes = agentsGuideUtf8Bytes(text);
    if (bytes > limit) {
        throw new Error(
            `${label} exceeds the always-loaded guide budget: ${bytes} UTF-8 bytes > ${limit} byte limit. ` +
                'Remediation owner: sp:doc-evolve (docs drift/sync lane).',
        );
    }
    return bytes;
}

/** Stable prose anchors required in both files (task 0242 R3/R4). */
export const PORTABLE_AGENTS_ANCHORS = [
    '**Platform fallback:**',
    '**Long-tail:**',
    '**Outside spur-cli:**',
    '**Conditional contract:**',
    '**Ownership boundary:**',
] as const;
