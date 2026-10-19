---
schema_version: 1
name: "Harness operational seams: staging, dispatch, cleanup, scheduler and CLI parity"
status: todo
template: issue
created_at: 2026-10-19T02:36:33.290Z
updated_at: "2026-10-19T06:37:50.644Z"

feature_id: D3
priority: P2
ac_altitude: task-local
estimate_hours: 3
dependencies: []
---

## 1259. Harness operational seams: staging, dispatch, cleanup, scheduler and CLI parity

### Background

Confirmed async-registration defect: apps/cli/src/commands/workflow/run.ts:137-158 catches every trace error as temporary absence, unlike existingWorkflowRun at :166-179 which distinguishes Run not found from a store error. The timeout branch at :612-637 labels an unconfirmed registration as a failed spawn and advises a synchronous rerun even though the detached worker can still register and execute. The launch helper discards child output and returns no worker-death proof, so absence of a row at one instant cannot justify replaying actions.

**Refine corrections (2026-10-18)**
- Removed deletion-staging defect: changedSinceBase includes tracked deletions, and modern git add -- <tracked-deletion> stages them. A fresh real-Git fixture passed commitGuardStage with D delete.yaml and M edit.txt; receipt .spur/run/refine-1259-probe.ts. No deletion flag/status redesign.
- Removed feature-derivation defect: a linked blocked task is live scope under the existing status contract. No accepted deferral marker exists; inventing one to ignore blocked work would weaken completion.
- Removed silent worktree-cleanup claim: execution-worktree-landing.md already fail-stops on removal failure, writes retained + mergeCommit, and documents inspection-only partial-removal recovery with operator authorization for recursive deletion. Git leaving a directory after a failed command is not a new CLI defect.
- Removed scheduler-causality claim: workflow --async directly spawns a detached worker; no queue-consumer dependency establishes the proposed saturation cause. No queue diagnostics or lease changes.
- Removed feature verify --json enhancement: absence is real but not a failure of its receipt-owning contract; no operator consent/design exists for that public extension. It is outside this corrective task.
- Retained: distinguish storage/read failures from registration absence and make uncertain-launch diagnostics truthful without automatic replay. Removed timeout-to-sync fallback because it can duplicate side effects. The existing definite spawn-exception path remains outside this task.
- Title still names removed seams; CLI cannot rename it. Estimate unset → 3h; feature D3 preserved; task-local AC.

### Requirements

- [ ] R2. Registration polling retries only genuine Run not found observations. A DB/read/permission error stops polling and surfaces an actionable redacted diagnostic with nonzero launch exit; it never launches a synchronous replacement.
- [ ] R7. Human and JSON timeout diagnostics state that registration was not confirmed within the configured deadline and the worker may still be starting. Preserve nonzero exit, existing JSON status/reason/hint shape and absence of a confirmed runId on failure. Guidance requires inspecting workflow list/trace before a manual rerun; do not recommend immediate replay.
- [ ] R8. Successful registration, including the final allowed observation, retains the existing started response and plan stamp. Failed confirmation performs no second dispatch and creates no second plan/run.
- [ ] R9. Regression fixtures cover eventual registration, never registered, a store-read error and a late worker; assert dispatch count and output contracts in human/JSON modes.

Out of scope: commit-guard changes, feature status/deferral semantics, worktree cleanup, queue diagnostics, feature verify JSON, new verbs/flags/statuses, longer timeout defaults and worker ownership/kill protocols. Gaps in R numbering preserve references to the original issue list.

### Acceptance Criteria

- [ ] AC2 — An unconfirmed async launch reports uncertainty and never automatically replays the workflow (req: R7, R8, R9)
- [ ] AC5 — Genuine store errors surface separately from missing registration while successful starts remain compatible (req: R2, R8, R9)

### Q&A

- Closed: timeout proves only lack of confirmed registration; no synchronous fallback after successful detached spawn request.
- Closed: preserve existing JSON fields and status vocabulary; clarify failed confirmation through reason/hint.
- Closed: remove unapproved public enhancements and false operational premises instead of carrying them as optional implementation work.

### Design

Chosen: reuse existingWorkflowRun's Run not found predicate inside waitForRunRegistration, retaining the current boolean success/deadline API; other errors propagate to a bounded caller catch and existing error-output conventions. No new API. Repair only registration-observation handling and failure text in apps/cli/src/commands/workflow/run.ts. Keep the existing finite timeout config and poll interval; do not add an extra timeout or synchronous path after a successfully requested detached launch.

Human output distinguishes a registration deadline from a spawn exception. JSON retains status failed for failed launch confirmation, reason and hint; do not imply the workflow row itself is terminal failed. No unconfirmed runId success handle. Tell the operator to inspect workflow list, then trace an existing/explicitly supplied id before deciding to rerun. Redact read errors using existing CLI conventions; never dump database/config contents or raw credentials.

Targets: apps/cli/src/commands/workflow/run.ts, apps/cli/tests/commands/workflow/run.test.ts, apps/cli/tests/commands/workflow-run-registration.test.ts; owning docs/design/cli-contracts.md workflow async contract. Inspect plugins/sp/skills/spur-cli/references/workflows.md and update only conflicting guidance. Reuse current fake detached launcher and actual CLI command fixtures; helper-only assertions cannot establish dispatch count or JSON behavior.

Dependencies: none. Source-local Git probe disproved deletion scope; 1258 owns retention and 1256 owns terminal reason classification. No new schema, process supervisor, queue queries, generated adapter edits or dependencies. Budget 3h.

### Plan

- [ ] 1. Add failing cases for non-not-found trace error and timeout wording; assert no second dispatch and unchanged absence of runId on failure (R2, R7, R9).
- [ ] 2. Reuse the existing missing-run distinction in polling; catch other errors at the command boundary with nonzero redacted output (R2).
- [ ] 3. Correct timeout text and recovery guidance without adding retry/fallback behavior or changing successful response fields (R7, R8).
- [ ] 4. Drive delayed/never/error/late registration through human and JSON command fixtures; confirm one dispatch and compatible started/plan behavior (R8, R9).
- [ ] 5. Run the focused CLI tests inside apps/cli, link/rebuild CLI bundle, update owning async guidance and run task-local gate. Save invocation/output plus dispatch-count evidence before review/verify.

### Root Cause

waitForRunRegistration treats all thrown trace errors as Run not found and erases their cause. The caller then overstates a deadline observation as worker failure, despite no worker-exit ownership evidence. Existing existingWorkflowRun already implements the correct absence-versus-read-error predicate and can be reused.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Refinement audit: 2026-10-18, source-local CLI, tasks 1254–1260 processed sequentially.

Evidence: real Git deletion probe passes; run.ts registration catch-all versus existingWorkflowRun; existing WT-4 failure/recovery contract.

Concurrency snapshot: git worktree list shows main only; task list --status wip returns []; one writer per tree. Recheck both before implementation. The tracked tree advanced to release 0.4.15 during the audit; preserve those external commits. Inspect installed versions/bundle at task start, then regenerate only artifacts affected by implementation.

Implement-ready checklist (specification, not an implementation PASS):

```json
[
  {
    "id": "requirements",
    "pass": true,
    "evidence": "Requirements contain bounded observable outcomes, scope exclusions and named current seams."
  },
  {
    "id": "design",
    "pass": true,
    "evidence": "Design freezes reused contracts, algorithm/precedence, files, negative cases and no-new-surface constraints."
  },
  {
    "id": "plan",
    "pass": true,
    "evidence": "Ordered Plan starts with failing fixtures, then minimal fix and named workspace/gate evidence."
  },
  {
    "id": "ac",
    "pass": true,
    "evidence": "Task-local checkbox ACs map every retained requirement to test-observable outcomes; implementation remains unchecked."
  },
  {
    "id": "decisions",
    "pass": true,
    "evidence": "Q&A closes original design choices; false premises and speculative APIs removed."
  },
  {
    "id": "dependencies",
    "pass": true,
    "evidence": "No unmet design prerequisites; boundaries to adjacent tasks explicit."
  },
  {
    "id": "premises",
    "pass": true,
    "evidence": "real Git deletion probe passes; run.ts registration catch-all versus existingWorkflowRun; existing WT-4 failure/recovery contract"
  }
]
```

### History
