---
name: Extract WorkflowService and HistoryService into packages-app
description: Extract WorkflowService and HistoryService into packages-app
status: Backlog
created_at: 2026-06-03T06:12:40.140Z
updated_at: 2026-06-03T06:12:40.140Z
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



### Solution



### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


