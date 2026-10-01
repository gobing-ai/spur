---
schema_version: 1
name: "Persist-out: make the 64-file evidence cap row-aware for multi-task batches"
status: backlog
template: feature-impl
created_at: 2026-10-01T00:47:12.647Z
updated_at: "2026-10-01T00:47:41.805Z"
feature_id: A9

---

## 1034. Persist-out: make the 64-file evidence cap row-aware for multi-task batches

### Background

Captured from the creation title: "Persist-out: make the 64-file evidence cap row-aware for multi-task batches".

### Requirements

- Background: batch runall-A9-485e (6 run rows: 5 tasks + wrap) failed persist-out with the 64-file citation cap throw (`packages/app/src/services/inline-run-setup.ts:297`/`:336`). `MAX_CITED_RUN_FILES = 64` (:208, sized by 0984 R3 for citations alone) is checked against the UNION of cited + owned files (1012 R1); owned enumeration collects `<wbs>-*` and `<runId>-*` for EVERY run row — 6 rows alone produced 68 runId-owned files, structurally impossible for batches of ~3+ tasks. Failure is zero-writes and aborts WT-4a.
- Session remedy (workaround, not fix): non-cited owned files moved to a hidden `.spur/run/.evidence-archive-485e` subdir (owned enumeration skips directories), cited set (3 files) rode the mechanical path, archive hand-copied to the invoking tree (157 files). Recorded in `.spur/run/worktree-runall-A9-485e.json` persistOut block.
- Adjacent, do not duplicate: foreign task 1025 (persist task/feature evidence outside run scratch) owns the broader evidence-location redesign; foreign task 1024 owns run-storage audit/cleanup.
- Fix direction: make the cap row-aware (scale by run-row count) or scope it to citations-only and bound owned transfer separately; preserve the zero-writes abort contract.
- AC:
  1. Persist-out succeeds mechanically for a simulated 6-run-row batch with no manual archive step.
  2. All cited files still resolve in the invoking tree after transfer.
  3. Run rows + record files transfer unchanged (no loss, record-conflict skip intact).
  4. Regression test added in `packages/app/tests/services/persist-worktree-runs.test.ts` covering a multi-run-row batch against the cap.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Do not leave placeholder AC here. -->

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

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
