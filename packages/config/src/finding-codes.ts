/**
 * Central registry of stable finding codes for task and feature validation checks.
 *
 * Implements R1 & R2 (0321):
 * - Every finding carries a stable machine code.
 * - Codes are defined in this single registry, not ad-hoc string literals.
 */

export const ALL_FINDING_CODES = [
    // L1: Schema & syntax
    'L1.markdown-parse',
    'L1.schema-validation',

    // L2: Section presence & matrix rules
    'L2.missing-required-section',
    'L2.forbidden-section',
    'L2.disallowed-section',
    'L2.heading-level',
    'L2.section-order',

    // L3: Format rules
    'L3.requirements-format',
    'L3.requirements-checkbox',
    'L3.requirements-empty',
    'L3.ac-empty',
    'L3.ac-requirement-coverage',
    'L3.solution-file-line',
    'L3.review-priority-table',
    'L3.testing-coverage',
    'L3.required-section-placeholder',
    'L3.plan-format',
    'L3.unchecked-checklist',
    'L3.ac-checklist-text',
    'L3.ac-bdd-error',
    'L3.ac-bdd-warning',
    'L3.ac-bdd-invalid',
    'L3.scope-delineation',
    'L3.one-active-goal',
    'L3.children-limit',

    // L4: Traceability & integrity
    'L4.design-placeholder',
    'L4.feature-not-found',
    'L4.feature-terminal',
    'L4.missing-feature-id',
    'L4.parent-not-found',
    'L4.dependency-not-found',
    'L4.rollup-subtasks-open',
    'L4.rollup-parent-open',
    'L4.rollup-missing-roster',
    'L4.readiness-blocked',
    'L4.prose-prerequisite-unlisted',
    'L4.prerequisite-cycle',
    'L4.prerequisite-not-done',
    'L4.gate-language',
    'L4.linked-task-parse-failed',
    'L4.orphan-scenarios',
    'L4.uncovered-task-scenario',
    'L4.uncovered-feature-scenario',
    'L4.verifying-incomplete-tasks',
    'L4.dogfood-missing',
    'L4.stale-line-anchor',
    'L4.anchor-subject-mismatch',
    'L4.malformed-verdict-artifact',
    'L4.scenario-unverified',
    'L4.testing-verdict-stub',
    'L4.evidence-not-recoverable',
] as const;

/** Union type of all valid finding codes. */
export type FindingCode = (typeof ALL_FINDING_CODES)[number];

/** Check if a string is a valid registered finding code. */
export function isFindingCode(code: string): code is FindingCode {
    return (ALL_FINDING_CODES as readonly string[]).includes(code);
}

/** Named constants for type-safe code referencing. */
export const FINDING_CODES = {
    // L1
    L1_MARKDOWN_PARSE: 'L1.markdown-parse',
    L1_SCHEMA_VALIDATION: 'L1.schema-validation',

    // L2
    L2_MISSING_REQUIRED_SECTION: 'L2.missing-required-section',
    L2_FORBIDDEN_SECTION: 'L2.forbidden-section',
    L2_DISALLOWED_SECTION: 'L2.disallowed-section',
    L2_HEADING_LEVEL: 'L2.heading-level',
    L2_SECTION_ORDER: 'L2.section-order',

    // L3
    L3_REQUIREMENTS_FORMAT: 'L3.requirements-format',
    L3_REQUIREMENTS_CHECKBOX: 'L3.requirements-checkbox',
    L3_REQUIREMENTS_EMPTY: 'L3.requirements-empty',
    L3_AC_EMPTY: 'L3.ac-empty',
    L3_AC_REQUIREMENT_COVERAGE: 'L3.ac-requirement-coverage',
    L3_SOLUTION_FILE_LINE: 'L3.solution-file-line',
    L3_REVIEW_PRIORITY_TABLE: 'L3.review-priority-table',
    L3_TESTING_COVERAGE: 'L3.testing-coverage',
    L3_REQUIRED_SECTION_PLACEHOLDER: 'L3.required-section-placeholder',
    L3_PLAN_FORMAT: 'L3.plan-format',
    L3_UNCHECKED_CHECKLIST: 'L3.unchecked-checklist',
    L3_AC_CHECKLIST_TEXT: 'L3.ac-checklist-text',
    L3_AC_BDD_ERROR: 'L3.ac-bdd-error',
    L3_AC_BDD_WARNING: 'L3.ac-bdd-warning',
    L3_AC_BDD_INVALID: 'L3.ac-bdd-invalid',
    L3_SCOPE_DELINEATION: 'L3.scope-delineation',
    L3_ONE_ACTIVE_GOAL: 'L3.one-active-goal',
    L3_CHILDREN_LIMIT: 'L3.children-limit',

    // L4
    L4_DESIGN_PLACEHOLDER: 'L4.design-placeholder',
    L4_FEATURE_NOT_FOUND: 'L4.feature-not-found',
    L4_FEATURE_TERMINAL: 'L4.feature-terminal',
    L4_MISSING_FEATURE_ID: 'L4.missing-feature-id',
    L4_PARENT_NOT_FOUND: 'L4.parent-not-found',
    L4_DEPENDENCY_NOT_FOUND: 'L4.dependency-not-found',
    L4_ROLLUP_SUBTASKS_OPEN: 'L4.rollup-subtasks-open',
    L4_ROLLUP_PARENT_OPEN: 'L4.rollup-parent-open',
    L4_ROLLUP_MISSING_ROSTER: 'L4.rollup-missing-roster',
    L4_READINESS_BLOCKED: 'L4.readiness-blocked',
    L4_PROSE_PREREQUISITE_UNLISTED: 'L4.prose-prerequisite-unlisted',
    L4_PREREQUISITE_CYCLE: 'L4.prerequisite-cycle',
    L4_PREREQUISITE_NOT_DONE: 'L4.prerequisite-not-done',
    L4_GATE_LANGUAGE: 'L4.gate-language',
    L4_LINKED_TASK_PARSE_FAILED: 'L4.linked-task-parse-failed',
    L4_ORPHAN_SCENARIOS: 'L4.orphan-scenarios',
    L4_UNCOVERED_TASK_SCENARIO: 'L4.uncovered-task-scenario',
    L4_UNCOVERED_FEATURE_SCENARIO: 'L4.uncovered-feature-scenario',
    L4_DOGFOOD_MISSING: 'L4.dogfood-missing',
    L4_VERIFYING_INCOMPLETE_TASKS: 'L4.verifying-incomplete-tasks',
    L4_STALE_LINE_ANCHOR: 'L4.stale-line-anchor',
    L4_ANCHOR_SUBJECT_MISMATCH: 'L4.anchor-subject-mismatch',
    L4_MALFORMED_VERDICT_ARTIFACT: 'L4.malformed-verdict-artifact',
    L4_SCENARIO_UNVERIFIED: 'L4.scenario-unverified',
    L4_TESTING_VERDICT_STUB: 'L4.testing-verdict-stub',
    L4_EVIDENCE_NOT_RECOVERABLE: 'L4.evidence-not-recoverable',
} as const satisfies Record<string, FindingCode>;
