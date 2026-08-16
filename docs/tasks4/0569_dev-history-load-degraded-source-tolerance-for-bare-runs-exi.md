---
template: feature-impl
schema_version: 1
name: "dev-history-load: degraded-source tolerance for bare runs (exit 2 proceeds with warning)"
description: ""
status: todo
type: task
profile: standard
feature_id: I5
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T16:38:40.715Z"
updated_at: "2026-08-16T17:39:55.116Z"
---

## 0569. dev-history-load: degraded-source tolerance for bare runs (exit 2 proceeds with warning)

### Background
Verify re-audit of 0567 (done, --force, 2026-08-16) surfaced one design-level finding: the command aborts a bare `--source all` run whenever any source is degraded (import exit 2), which is permanent on machines hosting a source with corrupt transcript chunks (agy here: 203 parse errors in Antigravity's own log chunks — unfixable by this project). The operator reviewed the evidence and chose to KEEP the fail-hard behavior for now, with the `--source` workaround documented in the command (dev-history-load.md Usage note). This task is the deferred alternative, to be picked up only if the workaround proves noisy in practice.

House precedent that motivates it: `packages/app/src/services/history-refresh-service.ts:130-136` — the daily pipeline treats a degraded fan-out as non-fatal ("the other sources still import and the failure is reported per source (never an abort)"), emits `history.daily.failed`, and continues to analyze.

Proposed behavior if adopted: import exit 2 (mixed/degraded) proceeds to analyze with a loud per-source degradation warning in human and JSON output (a `warnings` field); exit 1 (all-failed) keeps the R9 abort-with-propagation. Requires: script change in `plugins/sp/scripts/history-load.ts`, command doc update, new unit tests in `plugins/sp/tests/history-load.test.ts` (degraded-proceeds, all-failed-aborts), and a feature scenario amendment for I5 R9 to pin the fatal-vs-degraded split explicitly.
### Requirements
- [ ] R1. In `plugins/sp/scripts/history-load.ts`, split import-failure handling by exit code: exit 1 (all sources failed) keeps the current abort — surface failing sources, skip analyze, propagate the child's exit code. Exit 2 (mixed/degraded) proceeds to analyze, emitting a loud per-source degradation warning on stderr (human mode) and a `warnings` array in the JSON payload naming each degraded/failed source, its parse/validation error counts, and the warning detail from the import JSON.
- [ ] R2. Extend `plugins/sp/tests/history-load.test.ts` with stub coverage for the split: exit 2 with a degraded source proceeds to analyze, exits 0 after a successful analyze, and surfaces the warning in both output modes; exit 1 (all-failed) still aborts before analyze and propagates 1.
- [ ] R3. Update `plugins/sp/commands/dev-history-load.md`: replace the "Fail-hard on a degraded source (deliberate)" Usage note with the tolerate-and-warn contract, and amend feature I5 scenario R9 (Acceptance Criteria) so the fatal-vs-degraded split is pinned explicitly — R9's precondition becomes "the import step reports all sources failed (exit 1)" and a new scenario covers exit 2 proceeding with a warning.
### Acceptance Criteria
```gherkin
Scenario: R1 — A degraded fan-out proceeds to analyze with a loud warning
  Given `spur history import` exits 2 with at least one source degraded but records imported
  When the operator runs `/sp:dev-history-load`
  Then the analyze step still runs
  And stderr (or the JSON `warnings` array) names each degraded source with its error counts
  And the command exits 0 when analyze succeeds

Scenario: R2 — A fully failed import still aborts with propagation
  Given `spur history import` exits 1 with all sources failed
  When the operator runs `/sp:dev-history-load`
  Then the analyze step is not run
  And the command exits 1
  And the output names the failing sources

Scenario: R3 — The command doc and feature scenario R9 pin the split
  Given the tolerance behavior ships
  When a reader checks `dev-history-load.md` and feature I5's Acceptance Criteria
  Then the Usage note describes tolerate-and-warn for exit 2
  And scenario R9's precondition names the fatal (exit 1) case explicitly
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

I5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
