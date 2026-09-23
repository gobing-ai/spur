---
schema_version: 1
name: Continue and inspect legacy workflow runs with stable identity
status: todo
template: feature-impl
created_at: 2026-09-23T05:09:42.307Z
updated_at: "2026-09-23T05:19:48.672Z"
feature_id: E7
priority: P2
tags:
  - run-record
  - recovery
estimate_hours: 8

dependencies: ["0925"]
---

## 0926. Continue and inspect legacy workflow runs with stable identity

### Background

Covers E7 R3 and R6. Existing `workflow continue`, `workflow trace --output`, `--no-log`, and `--trace-file` callers must retain their documented behavior as the record format changes. Depends on the two-file writer task; it inherits that task's D63 gate. Rubric: E8 D1 L2 C1 R2 = 14; split because replay and backwards compatibility need an independent safety review.

### Requirements

- [ ] R1. Continue a paused/interrupted run under its existing run ID; append only new log sections and atomically update state after the authoritative trace outcome.
- [ ] R2. Preserve the recorded disposition of external effects and operator decisions on replay; record inspection cannot by itself authorize re-execution or completion.
- [ ] R3. Let follow/output and supported continue paths read old `.log` records without bulk migration; handle missing new state explicitly.
- [ ] R4. Preserve explicit `--no-log` and `--trace-file` behavior and source/bundled parity.

### Acceptance Criteria

- [ ] AC1 — Continue and replay retain run identity and state (req: R1)
  Given a paused or interrupted run with a pair and a recorded external effect or human decision
  When the supported continue path resumes it
  Then it keeps the run ID, appends only new markdown sections, and atomically updates state to agree with the DB trace
  And record recovery does not repeat the prior effect or decision
  Verify through workflow-service and CLI resume tests with persisted artifacts and an observable side-effect counter.

- [ ] AC2 — Existing run surfaces retain compatibility (req: R3)
  Given a legacy `.log` run, a run started with `--no-log`, and a run with `--trace-file`
  When a supported follow, inspect, or continue path accesses each run
  Then legacy output is readable without bulk migration, `--no-log` creates no pair, and trace-file output remains independent
  And a missing pair state is reported as missing rather than success
  Verify in `apps/cli/tests/commands/workflow.test.ts` for both source and bundled command paths.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Dependency: 0925 supplies the pair writer and private state format. Recheck its shipped fields after completion; do not redefine or fork the schema. D63 task 0921 is inherited through 0925.
- Read precedence: for a run with a valid pair, use the pair for record output/state; for a historical `.log`-only run, retain the legacy log path. Treat a missing or invalid state file as an explicit incomplete/unavailable record, not as success and not as permission to synthesize state from markdown. Keep the existing DB trace as lifecycle authority.
- Continue: `WorkflowAppService.continuePaused()` and the `workflow continue` command retain the original run ID and authoritative resume claim. A supported resume appends new sections and replaces state after the trace advances. Existing external-effect and operator-decision receipts govern replay; reading a record must not re-execute actions.
- CLI compatibility: adapt `followRunLog()` and `workflow trace --follow --output` to prefer the pair while preserving `.log` fallback. Preserve `--no-log`, `--trace-file`, and source/bundled parity. No new public CLI verb or flag.
- Primary targets: `packages/app/src/services/workflow-service.ts`, `apps/cli/src/commands/workflow.ts`, their focused tests, and the shared application reader introduced by 0925. Leave task-pipeline plugin YAML/scripts to 0927.
- Anti-patterns: no bulk migration of legacy logs, status inference from markdown, duplicate side-effect replay, or fallback that hides corrupt new state as a successful old run.

### Plan

1. Identify current CLI follow, continue, and trace read paths after D63.
2. Add format detection and bounded legacy reads behind the existing workflow service.
3. Bind continuation to authoritative trace/state identity and append-only record behavior.
4. Verify interrupted/paused/terminal, legacy, `--no-log`, and trace-file cases through focused service and CLI checks.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- [E7 feature](../features/E7_two-file-run-record-history-orpc-and-tool-using-source-migration.md) and [current run-record contract](../design/run-record-contract.md).
- Depends on [0925](0925_persist-redacted-two-file-workflow-records-for-new-runs.md); provides the reader/compatibility seam to [0927](0927_preserve-task-pipeline-proof-while-moving-its-run-state-to-t.md) and [0929](0929_inspect-a-bounded-run-record-from-the-existing-board.md).
- D63 is active in a separate worktree at refinement time. Recheck the merged 0921 execution contract and the completed 0925 state schema before implementation.

### History
