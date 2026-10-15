import type { CheckFindings } from './planning-check-base';

/**
 * Error thrown by `mutateDependencies` for any validation failure (R2).
 * The `code` field is a stable identifier the CLI maps to an exit code:
 *
 * - `usage`     — wrong arg shape (op vs. values count) → exit 2
 * - `format`    — value is not a 4-digit WBS → exit 3
 * - `not-found` — no task file for a referenced WBS → exit 3
 * - `self-edge` — task references itself → exit 3
 * - `duplicate` — duplicate WBS in the resulting array → exit 3
 * - `cycle`     — the resulting graph has a cycle → exit 3
 */
export class DependencyMutationError extends Error {
    readonly code: 'usage' | 'format' | 'not-found' | 'self-edge' | 'duplicate' | 'cycle' | 'deprecated';
    constructor(code: DependencyMutationError['code'], message: string) {
        super(message);
        this.name = 'DependencyMutationError';
        this.code = code;
    }
}

/**
 * Error thrown by `mutateSections` for any validation failure (R2).
 * The `code` field is a stable identifier the CLI maps to an exit code:
 *
 * - `usage`          — wrong arg shape (op vs. section name) → exit 2
 * - `no-matrix`      — no section-matrix entry for variant/status → exit 3
 * - `unknown-section`— section name not in `TASK_CANONICAL_SECTIONS` → exit 3
 * - `forbidden`      — section is forbidden for the task's current status → exit 3
 * - `invalid-solution` — explicit Solution update lacks a `file:line` citation → exit 3
 */
export class SectionMutationError extends Error {
    readonly code: 'usage' | 'no-matrix' | 'unknown-section' | 'forbidden' | 'invalid-solution';
    constructor(code: SectionMutationError['code'], message: string) {
        super(message);
        this.name = 'SectionMutationError';
        this.code = code;
    }
}

/**
 * Error thrown by `create()` when the dedup guard (task 0341 R4) detects an
 * existing task under the same feature with an identical name created within
 * the dedupe window. The CLI maps this to a stable exit code and surfaces the
 * existing WBS so the operator can reuse the prior task instead of duplicating.
 */
export class DuplicateFollowUpError extends Error {
    readonly existingWbs: string;
    readonly existingName: string;
    readonly attemptedName: string;
    constructor(existingWbs: string, existingName: string, attemptedName: string) {
        super(
            `duplicate-follow-up: task ${existingWbs} ("${existingName}") already exists under this feature ` +
                `with an identical name. Reuse ${existingWbs} or pass --allow-duplicate-name to override.`,
        );
        this.name = 'DuplicateFollowUpError';
        this.existingWbs = existingWbs;
        this.existingName = existingName;
        this.attemptedName = attemptedName;
    }
}

/**
 * Error thrown by the WBS allocation guard (task 0416 R1) when a file with the
 * allocated WBS prefix already exists in any configured folder. The allocation
 * scan returned a stale maximum (e.g. a file was created after the scan but
 * before the write, or the scan missed a non-conventional filename). The guard
 * refuses to write rather than silently overwriting the existing file.
 *
 * The CLI maps this to a non-zero exit and surfaces both paths so the operator
 * can see what would have been overwritten.
 */
export class WbsCollisionError extends Error {
    readonly wbs: string;
    readonly existingPath: string;
    readonly attemptedPath: string;
    constructor(wbs: string, existingPath: string, attemptedPath: string) {
        super(
            `wbs-collision: WBS ${wbs} already exists at "${existingPath}". ` +
                `Refusing to overwrite with "${attemptedPath}". ` +
                `Re-run create; if the collision persists, inspect the corpus with: spur task check.`,
        );
        this.name = 'WbsCollisionError';
        this.wbs = wbs;
        this.existingPath = existingPath;
        this.attemptedPath = attemptedPath;
    }
}

/**
 * Error thrown by `create`/`batchCreate` (F21 task 0787 R2/R4) when a candidate
 * task fails the SAME content policy `spur task check` enforces (L1 schema + L2
 * matrix + L3 format), BEFORE any WBS allocation or file write. The
 * machine-readable `findings` ride on the error so the CLI can emit one
 * parseable result under `--json`.
 */
export class TaskCandidateInvalidError extends Error {
    readonly findings: CheckFindings[];
    constructor(title: string, findings: CheckFindings[], context?: string) {
        const where = context !== undefined ? ` (${context})` : '';
        const detail = findings
            .filter((f) => f.severity === 'error')
            .map((f) => `${f.layer}${f.section !== '' ? `/${f.section}` : ''}: ${f.message}`)
            .join('; ');
        super(
            `candidate task "${title}"${where} rejected before persistence — it would fail \`spur task check\`: ${detail}`,
        );
        this.name = 'TaskCandidateInvalidError';
        this.findings = findings;
    }
}

/**
 * 1132 R2: a task cannot link to a terminal parent feature. Carries the offending
 * status and up to three `active` siblings in the same ID group so the CLI/agent can
 * re-point the link without a second lookup.
 */
export class ParentFeatureStatusError extends Error {
    readonly featureId: string;
    readonly status: string;
    readonly activeSiblings: string[];
    constructor(featureId: string, status: string, activeSiblings: string[]) {
        // 1180 R1: `deprecated` is frozen, not terminal — the message names the removal
        // path and the un-deprecate command rather than a reopen/re-parent hint.
        if (status === 'deprecated') {
            super(
                `parent-feature-status: feature ${featureId} is deprecated (frozen); new tasks cannot link to it. ` +
                    `Run removal work under its own feature, or un-deprecate: spur feature update ${featureId} active`,
            );
        } else {
            const group = featureId[0] ?? '';
            const hint =
                activeSiblings.length > 0
                    ? `active siblings in group ${group}: ${activeSiblings.join(', ')}`
                    : `no active sibling features in group ${group} — reopen ${featureId} to active first`;
            super(
                `parent-feature-status: feature ${featureId} is ${status}; new tasks cannot link to a ` +
                    `done/cancelled parent. ${hint}`,
            );
        }
        this.name = 'ParentFeatureStatusError';
        this.featureId = featureId;
        this.status = status;
        this.activeSiblings = activeSiblings;
    }
}
