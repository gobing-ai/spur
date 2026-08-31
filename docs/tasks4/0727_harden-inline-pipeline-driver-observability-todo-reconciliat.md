---
schema_version: 1
name: "Harden inline pipeline driver observability: todo reconciliation, implement-stage timeout, run-log timestamps"
status: todo
template: issue
created_at: 2026-08-31T21:21:06.461Z
updated_at: "2026-08-31T21:21:40.674Z"
feature_id: F91
---

## 0727. Harden inline pipeline driver observability: todo reconciliation, implement-stage timeout, run-log timestamps

### Background

Task 0726 (F91) reached verdict PASS and done, but the session consumed ~4:00 elapsed with three avoidable sinks, and the host-session todo list was left showing 0/11 (precheck/implement stuck in_progress) after completion. Session review (--triage, 2026-08-31) triaged the driver/observability findings into this task. The indent war root cause (.pi-lens.json ignore for config/workflows/**) and the 4 task-attribution.test.ts reds (missing importerVersion ctx under the new assertPiImporterSafe guard) were fixed directly in the same session and are excluded here.

Evidence: run log .spur/run/a33bbfbd-ed97-4325-ab4b-c9f5a4f64c50.log; host todo store (11 stale items reconciled manually).

### Requirements

- R1: The inline pipeline driver must reconcile host-session todo items at every `[stage]` transition (mark completed/in_progress), including the subagent-timeout fallback path — stage state must survive the subagent→host-session handoff, not die with the subagent's todo store.
- R2: The implement stage must not silently burn a fixed 1800000ms subagent timeout and then re-execute everything inline. Propose and implement an execution policy: host-inline by default for implement-scale stages, or a documented per-stage timeout budget (≥ 2× historical implement duration for the task size) with the choice recorded in the run log.
- R3: Run-log timestamps must be normalized to one timezone (ISO-8601 UTC throughout); current log mixes `2026-08-31T17:17:21Z` with local-clock entries (`[implement close-out 12:00]`).

### Acceptance Criteria

- AC1: Given a pipeline run that falls back from subagent to host execution at any stage, when each subsequent stage transition fires, then the host todo item for the finished stage is completed and the next is in_progress (observable in todo list).
- AC2: Given an implement stage exceeding its budget, when the timeout fires, then the run log records the budget decision (mode + timeout rationale) BEFORE execution, and no stage work is executed twice.
- AC3: Every timestamp appended to a run log (`.spur/run/<id>.log`) parses as ISO-8601 UTC; grep for bare local-clock patterns returns 0 on new runs.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
