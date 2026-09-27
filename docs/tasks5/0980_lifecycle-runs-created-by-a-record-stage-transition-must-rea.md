---
schema_version: 1
name: Lifecycle runs created by a record-stage transition must reach a terminal status
status: backlog
template: feature-impl
created_at: 2026-09-27T07:11:01.671Z
updated_at: "2026-09-27T07:11:49.841Z"
feature_id: D3

ac_numbering: task-local
ac_altitude: task-local
---

## 0980. Lifecycle runs created by a record-stage transition must reach a terminal status

### Background

After the record stage of the 0965 run, the worktree DB held two orphaned lifecycle runs with **zero** child rows (`action_runs`/`phase_runs` 0):

```text
run_a5efe61b-…|task-lifecycle|running
run_3965776f-…|feature-lifecycle|running
```

The task had already moved `todo → wip` (pipeline `command.gate`, `--no-lifecycle`), then `testing` via `spur task record 0965 --solution-from-diff --transition testing`, and finally `done` (`--no-lifecycle`). Nothing closed either lifecycle run, and `task_run_links` was empty. The driver had to finalize both by hand (`--close --status failed --reason interrupted`) before WT-4a provenance persistence could run — the record-less rows also triggered the `persist-out` ENOENT in 0979.

Task 0622 R2 (feature D3) already required "lifecycle workflows reach a terminal state, and stop orphan accumulation recurring"; two fresh orphans in one run is that recurrence. Note `spur task record --transition` exposes no `--no-lifecycle` equivalent, so the FSM's own transition verb is the creator here.

### Requirements

- [ ] R1. A lifecycle run created by a record-stage transition reaches a terminal status (`done`/`failed` with a terminal reason) once that transition completes, or is explicitly `paused` with a recorded reason — never left `running` with no child rows.
- [ ] R2. The mechanism is identified and fixed at its owner (find-or-create lifecycle run finalization), not by a post-hoc sweep.
- [ ] R3. A regression test pins the run-row status after the record transition, so the orphan cannot silently return.

### Acceptance Criteria

- [ ] AC1 — R1 — after `spur task record <wbs> --transition testing` on a scratch task, no lifecycle run for that task remains `running` (test)
- [ ] AC2 — R2 — the fix names the owner surface (lifecycle adapter finalization or the transition port) in Solution, not a cleanup script
- [ ] AC3 — R3 — the regression test fails against the current tree before the fix and passes after (mutation check recorded in Testing)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

- [ ] Reproduce: scratch task + `spur task record <wbs> --solution-from-diff --transition testing`, then read `runs`/`action_runs` in `.spur/spur.db` and record which lifecycle run is left non-terminal and why (created-not-finalized vs paused).
- [ ] Trace find-or-create + finalization for lifecycle runs (`packages/app/src/workflow/lifecycle-adapter.ts`, task-lifecycle/feature-lifecycle definitions) and fix the terminal transition.
- [ ] Add the regression test at the lifecycle/task-service surface; keep `task_run_links` expectations explicit.
- [ ] `bun run spur-check` green; note in Testing whether any pre-existing orphan rows need one-time cleanup.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
