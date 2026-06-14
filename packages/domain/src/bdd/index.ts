/**
 * BDD validator module — Gherkin-subset parser, structural validation,
 * checklist parsing, and AC coverage checking.
 *
 * Promotion path: this module has zero Spur-internal imports and is
 * movable to `@gobing-ai/ts-bdd` as a pure move (design §3.3, §9).
 */

export type { ChecklistItem } from './checklist';
// Checklist — Tier-2 AC format (- [ ] / - [x])
export { parseChecklist } from './checklist';
export type { CoverageResult } from './coverage';
// Coverage — DD-09 normalized-title coverage matching
export { checkAcCoverage, normalizeTitle } from './coverage';
export type { ParsedFeature, ParsedScenario, ParsedStep } from './parser';
// Parser — Gherkin-subset AST
export { parseFeature } from './parser';
export type { ValidationIssue, ValidationResult } from './validate';
// Validation — structural validation keeping the legacy result contract
export { validateAcceptanceCriteria } from './validate';
