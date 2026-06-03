---
name: Extract RuleService from rule command into packages-app
description: Extract RuleService from rule command into packages-app
status: Done
created_at: 2026-06-03T06:12:16.722Z
updated_at: 2026-06-03T07:17:44.766Z
folder: docs/tasks
type: task
feature-id: F-4 app-services
priority: high
estimated_hours: 6
dependencies: ["0008"]
tags: ["refactor","architecture","app-services","rule"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0009. Extract RuleService from rule command into packages-app

### Background

Child of 0005. apps/cli/src/commands/rule.ts is 448 lines — the worst-case fat command file. Only the ~15-line runRuleCommand dispatch belongs in a CLI file; the rest is application logic with no home: ruleRoots, runRuleEvaluation, evaluateVerbose, verboseOutcome/verboseFindingLines/verboseSummary/findingLocation/severityTint, emptyResultMessage, runRuleValidate, collectValidationErrors, presetFileExists, runRuleList, ruleSource, listPresetRules, listLocalRules, listRuleFiles, compareRuleEntries, parseFailOn, plus FailOnSeverity type. This task relocates all of it into a RuleService class in packages/app and reduces rule.ts to a thin wrapper. Strict no-regression: parent R10 requires byte-identical stdout/stderr/exit/--json. Golden snapshots for rule run/list (plain + --json) are captured at .tmp/golden-0005/ as the no-regression baseline.


### Requirements

R1: Create packages/app/src/services/rule-service.ts with a RuleService class. Constructor takes RuleServiceContext (cwd, env, fs, output) per parent R2.1. R2: Public methods evaluate(opts), validate(source, validateSchema?), list(preset?) returning structured results (RuleEvaluationResult, RuleValidateResult, RuleListResult) per parent R2.2-R2.4. R3: ruleRoots, presetFileExists, listLocalRules, listRuleFiles, and all formatting helpers (verboseOutcome, verboseFindingLines, verboseSummary, emptyResultMessage) become private methods or move to a rule-formatting module within the package per R2.5-R2.6. R4: Export RuleService + result types from packages/app/src/index.ts; no internal helpers re-exported (parent R8). R5: Rewrite apps/cli/src/commands/rule.ts as a thin wrapper, target <=100 lines (parent R6.1). R6: Migrate apps/cli/tests/commands/rule.test.ts (323 lines) to packages/app/tests/services/rule-service.test.ts, adapting mocks for the service API (parent R9.1). R7: Coverage >=85% line, >=90% function. Acceptance: golden snapshots for 'rule run --preset recommended' and 'rule list' (plain + --json) diff byte-identical before/after; bun run lint+test pass; rule.ts <=100 lines.


### Q&A



### Design

- Scope: Extracted all application logic from apps/cli/src/commands/rule.ts (448→70 lines) into RuleService (packages/app/src/services/rule-service.ts, ~499 lines incl. tests-facing types).
- Key decision: RuleService takes the structural CliContext (cwd, env, fs, output); CLI passes makeColorize(...) which satisfies the Colorize structural type. evaluate/validate/list return structured results carrying exitCode + formatted text so the wrapper only dispatches and writes.
- Boundaries affected: rule.ts (thin wrapper), packages/app index (exports RuleService + result types), rule-service.test.ts (migrated from cli, 439 lines), apps/cli/tests/commands/rule.test.ts (dispatch stub restored for the dogfood require-corresponding-test + coverage-gate rules).
- Risks: R10 byte-identical output for rule run/list. Verified via golden snapshots.


### Solution

RuleService extracted and wired. CLI rule.ts is a 70-line dispatcher (≤100 target met). All former top-level helpers (ruleRoots, presetFileExists, listLocalRules, listRuleFiles, verbose* formatters, emptyResultMessage, collectValidationErrors) are now private to the service. Public API exports RuleService + result/option types only (no internal helpers), per R8. Implemented by subagent in an isolated worktree, then integrated onto main (commit d355d62) with import-order + dispatch-stub fixes.


### Plan

- [x] Capture golden snapshots for rule run/list (plain + --json)
- [x] Implement RuleService with private orchestration/formatting helpers
- [x] Rewrite rule.ts as thin wrapper (70 lines)
- [x] Migrate rule tests to packages/app/tests/services/rule-service.test.ts
- [x] Restore apps/cli/tests/commands/rule.test.ts dispatch stub (dogfood rule + coverage)
- [x] Verify byte-identical output; run gate


### Review

**Verdict: PASS** (dev-verify --force, 2026-06-03).

Phase 7 (SECU): no findings. No secrets, no bare `any`, no unsafe casts, no empty catch, no blocking sync I/O in rule-service.ts or rule.ts.

Phase 8 (traceability): R2 (RuleService.evaluate/validate/list) MET · R6.1 (rule.ts 70 ≤100) MET · R8 (index exports service + types only, no internal helpers) MET · R9.1 (tests migrated to packages/app) MET · R10 (rule run + rule list byte-identical, plain + --json) MET. Coverage 97.56% line / 99.63% function.

`--fix all`: 0 actionable findings.


### Testing

- Command: bun run test (full suite), bun run apps/cli/src/index.ts rule run/list diff vs golden
- Scope: RuleService.evaluate/validate/list + rule.ts dispatch
- Result: PASS. rule-service.ts coverage 97.56% line / 99.63% function (≥85/90 target). 250/250 suite tests pass. rule run + rule list byte-identical to pre-refactor baseline.
- Evidence: diff .tmp/golden-0005 vs .tmp/after-0005 → rule_run_recommended, rule_run_json, rule_list, rule_list_json all identical (exit 0). Dogfood test-pre-check: "All 10 rules passed".
- Next action: none.
- Timestamp: 2026-06-03T07:17:26Z


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


