---
schema_version: 1
name: Lifecycle runs created by a record-stage transition must reach a terminal status
status: todo
template: feature-impl
created_at: 2026-09-27T07:11:01.671Z
updated_at: "2026-09-27T16:45:11.215Z"
feature_id: D3

ac_numbering: task-local
ac_altitude: task-local
priority: P1
estimate_hours: 3
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

**Refine corrections (2026-09-27)**

- A lifecycle row running while its task is at testing is expected; the defect is a row left running after the pipeline's later done transition bypasses lifecycle bookkeeping.
- The observed feature-lifecycle row may legitimately remain running while its feature is nonterminal; this task addresses the task-lifecycle row created by record.

### Requirements

- [ ] R1. The task pipeline does not create a second task-lifecycle run when its record stage moves the task to testing. It still performs the target-aware testing gate.
- [ ] R2. Standalone `spur task record --transition testing` retains its lifecycle behavior. A pipeline run that later marks the task done with `--no-lifecycle` leaves no new record-less lifecycle run behind.
- [ ] R3. A regression test covers the pipeline's record and done commands and checks both task status and lifecycle-run rows.

### Acceptance Criteria

- [ ] AC1 — A pipeline record transition reaches testing without creating a task-lifecycle row (req: R1)
- [ ] AC2 — Standalone record transitions retain lifecycle behavior (req: R2)
- [ ] AC3 — The pipeline reaches done without a new running lifecycle orphan (req: R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The pipeline's `task record --transition testing` currently constructs a lifecycle adapter, while its later `task update done --no-lifecycle` bypasses that adapter. A lifecycle row created by the former therefore remains `running` after the pipeline finishes. A `running` lifecycle row while a task is genuinely at `testing` is expected; the defect is the completed pipeline's orphan.

Add `--no-lifecycle` to the existing `task record` verb and pass it to the existing `makeService(context, folder, noLifecycle)` seam. Use the flag only in `config/workflows/task-pipeline.yaml`'s record command. The task service still runs its target-aware check when no lifecycle adapter is present. Keep standalone record's default unchanged. Check feature-lifecycle rows separately: the record-stage feature sync can create them, but this task only changes the task transition it owns.

### Plan

- [ ] Reproduce the pipeline sequence: `task record --transition testing` followed by `task update done --no-lifecycle`; confirm the task-lifecycle row is `running` after done.
- [ ] Add `--no-lifecycle` to `task record` and the pipeline's record command, using the existing `makeService` flag.
- [ ] Test the pipeline path and the unchanged standalone path, including target-aware guard denial.
- [ ] Run focused task-service/CLI tests and `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T16:45:11.215Z backlog → todo (system)

