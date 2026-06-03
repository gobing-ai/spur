---
name: Extract RuleService from rule command into packages-app
description: Extract RuleService from rule command into packages-app
status: Backlog
created_at: 2026-06-03T06:12:16.722Z
updated_at: 2026-06-03T06:12:16.722Z
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



### Solution



### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


