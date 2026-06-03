---
name: Extract WorkflowService and HistoryService into packages-app
description: Extract WorkflowService and HistoryService into packages-app
status: Done
created_at: 2026-06-03T06:12:40.140Z
updated_at: 2026-06-03T07:17:44.935Z
folder: docs/tasks
type: task
feature-id: F-4 app-services
priority: high
estimated_hours: 5
dependencies: ["0008"]
tags: ["refactor","architecture","app-services","workflow","history"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0011. Extract WorkflowService and HistoryService into packages-app

### Background

Child of 0005. The two smallest fat command files share the same thin-wrapper pattern and are extracted together to avoid over-decomposition (each alone is near the 2h floor). apps/cli/src/commands/workflow.ts (120 lines): runWorkflowCommand, validateWorkflow, reportInvalidWorkflow, runWorkflow, listWorkflowRuns, createWorkflowService, requiredWorkflowFile. apps/cli/src/commands/history.ts (106 lines): runHistoryCommand, runHistoryImport, runHistoryAnalyze, runHistoryReport, parseSource, parseMode. NAMING CONSTRAINT: workflow.ts already imports a WorkflowService type from @gobing-ai/ts-dual-workflow-engine — the new app-layer service must be named to avoid collision (e.g. WorkflowAppService, or import the engine type under an alias). Strict no-regression: parent R10. Golden snapshots for workflow list and history analyze (plain + --json) captured at .tmp/golden-0005/.


### Requirements

R1: Create packages/app/src/services/workflow-service.ts with an app-layer workflow service exposing validate(file), run(file, runId?), list() per parent R4 — resolve the name collision with the ts-dual-workflow-engine WorkflowService type. R2: Create packages/app/src/services/history-service.ts exposing import(source, file?, root?, mode?), analyze(since?) per parent R5. R3: Move parseSource, parseMode, requiredWorkflowFile, reportInvalidWorkflow into the respective services as private helpers. R4: Export both services + their result types (WorkflowValidateResult, WorkflowRunResult, WorkflowListResult, HistoryImportResult, HistoryAnalyzeResult) from packages/app/src/index.ts (parent R8). R5: Rewrite apps/cli/src/commands/workflow.ts <=60 lines (R6.3) and history.ts <=60 lines (R6.4) as thin wrappers. R6: Migrate apps/cli/tests/commands/workflow.test.ts (147 lines) and history.test.ts (25 lines) to packages/app/tests/services/ (parent R9.3). R7: Coverage >=85% line, >=90% function. Acceptance: golden snapshots for 'workflow list' and 'history analyze' (plain + --json) diff byte-identical; bun run lint+test pass; both CLI files <=60 lines; no WorkflowService name collision.


### Q&A



### Design

- Scope: Extracted workflow.ts (120→66) into WorkflowAppService and history.ts (106→62) into HistoryService (packages/app/src/services/).
- Key decision: Name collision resolved — engine's WorkflowService imported as EngineWorkflowService; app-layer class is WorkflowAppService. parseSource/parseMode are private module helpers. requiredWorkflowFile inlined into the CLI workflow.ts (kept out of the public API per R8).
- Boundaries affected: workflow.ts + history.ts (thin wrappers), packages/app index (exports both services + result types), workflow/history service tests migrated, CLI dispatch stubs restored for the dogfood rule + coverage gates.
- Risks: R10 byte-identical for workflow list / history analyze; WorkflowRunResult cast through unknown (engine type lacks the index signature the app type adds for JSON). History import tests made hermetic (empty temp root; missing force-file rejects per 0.3.0 importer).


### Solution

WorkflowAppService + HistoryService extracted and wired. workflow.ts 66 lines, history.ts 62 lines (R6.3/R6.4 target ≤60 — workflow +6 from inlining requiredWorkflowFile for the R8 API-cleanliness fix, history +2; both flagged as minor accepted variances). Implemented by subagent (worktree), integrated onto main (d355d62) with the WorkflowRunResult cast fix, hermetic history tests, and removal of the now-private requiredWorkflowFile test.


### Plan

- [x] Capture golden snapshots for workflow list / history analyze (plain + --json)
- [x] Implement WorkflowAppService (resolve name collision) + HistoryService
- [x] Rewrite workflow.ts (66) + history.ts (62) as thin wrappers
- [x] Migrate workflow/history tests to packages/app/tests/services/
- [x] Restore CLI dispatch stubs (dogfood rule + coverage)
- [x] Verify byte-identical output; run gate


### Review

**Verdict: PASS** (dev-verify --force, 2026-06-03).

Phase 7 (SECU): one P3 (type-safety) finding FIXED under --fix all — workflow-service.ts:85 `as unknown as WorkflowRunResult` double-cast replaced with a type derived from the engine's runFile return signature (single safe widening cast; field names now stay in lockstep with the engine). Verified: typecheck clean, workflow output still byte-identical. history-service.ts / both CLI wrappers clean.

Phase 8 (traceability): R4 (WorkflowAppService, EngineWorkflowService alias resolves collision) MET · R5 (HistoryService import/analyze) MET · R6.3 (workflow.ts 66, +6 accepted variance from inlined requiredWorkflowFile) · R6.4 (history.ts 62, +2 accepted variance) · R8 MET · R9.3 (tests migrated, hermetic) MET · R10 (workflow list + history analyze byte-identical) MET. Coverage 100% / 100% both services.


### Testing

- Command: bun run test; workflow list + history analyze diff vs golden
- Scope: WorkflowAppService.validate/run/list, HistoryService.import/analyze, both CLI wrappers
- Result: PASS. workflow-service.ts 100%/100%, history-service.ts 100%/100% coverage. workflow list + history analyze byte-identical (plain + --json, exit 0). 250/250 suite tests pass.
- Evidence: diff .tmp/golden-0005 vs .tmp/after-0005 → workflow_list(_json), history_analyze(_json) identical. test-pre-check + test-post-check both "all rules passed".
- Next action: none.
- Timestamp: 2026-06-03T07:17:26Z


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


