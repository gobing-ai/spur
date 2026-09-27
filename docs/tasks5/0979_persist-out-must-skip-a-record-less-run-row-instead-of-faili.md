---
schema_version: 1
name: Persist-out must skip a record-less run row instead of failing the transfer
status: cancelled
template: feature-impl
created_at: 2026-09-27T07:10:45.437Z
updated_at: "2026-09-27T16:29:33.182Z"
feature_id: D63

ac_numbering: task-local
ac_altitude: task-local
---

## 0979. Persist-out must skip a record-less run row instead of failing the transfer

### Background

During the 0965 worktree run (`--worktree --auto`, pipeline run `ee1b845b-fd27-480e-bf70-25fac1691d48`), the WT-4a provenance step failed **after** the branch had already landed on the base ref:

```text
{"ok":false,"error":"ENOENT: no such file or directory, open '<worktree>/.spur/run/run_3965776f-674d-4b56-a3b6-7bc8b559796e.md'"}
```

Per the worktree contract, "any persistence failure routes to WT-5 — the worktree is retained", so a **green, fully certified run** could not complete its own cleanup: the operator had to delete two hand-closed lifecycle rows from the worktree DB before a retry succeeded (`{"ok":true,"persisted":0,"skipped":[{"id":"ee1b845b…","reason":"id-exists"}]}`).

The worktree DB held two runs with **zero** child rows and no record files — `run_a5efe61b…` (`task-lifecycle`) and `run_3965776f…` (`feature-lifecycle`), created by the record stage's transitions. `persistWorktreeRuns` copies `<id>.md` + `<id>.state.json` for every persisted run id with a bare `readFile`, so a missing record aborts the whole transfer — while task 0975's own design says lifecycle rows "are skipped and reported rather than re-parented". The skip path exists for id collisions (`record-conflict:<file>`) but not for an absent record.

### Requirements

- [x] R1. Superseded by task 0984; no independent work remains.

### Acceptance Criteria

- [x] AC1 — Superseded by task 0984 (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

- [x] Superseded by task 0984.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Merged into task 0984: the same persist-out service owns the record-less row case and the worktree evidence copy.

### History

- 2026-09-27T16:25:44.206Z backlog → cancelled (system)

