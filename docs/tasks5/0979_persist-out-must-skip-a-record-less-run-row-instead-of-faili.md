---
schema_version: 1
name: Persist-out must skip a record-less run row instead of failing the transfer
status: backlog
template: feature-impl
created_at: 2026-09-27T07:10:45.437Z
updated_at: "2026-09-27T07:11:49.273Z"
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

- [ ] R1. A persisted run id whose `.spur/run/<id>.md` or `<id>.state.json` record is absent is reported as a skip (same shape as the existing `record-conflict:<file>`, e.g. `record-missing:<file>`) and does **not** abort the transfer; every run that does have records is still copied.
- [ ] R2. The existing fail-closed cases are unchanged: an unreadable source DB, an unsafe run id (charset guard), and an unwritable target still throw so the caller routes to WT-5.
- [ ] R3. The return contract stays `{ok, persisted, skipped}`; `persisted` counts only rows actually inserted, and a record-skip for an already-persisted id does not inflate it.

### Acceptance Criteria

- [ ] AC1 — R1 — a worktree DB containing one record-less run row and one normal run persists the normal run and reports the record-less id in `skipped` with a `record-missing:` reason (test)
- [ ] AC2 — R2 — the missing/unreadable-DB and unsafe-id paths still throw (existing behaviour asserted by test)
- [ ] AC3 — R3 — `ok`/`persisted`/`skipped` semantics pinned by the same test

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

- [ ] Reproduce against the record-copy loop in `persistWorktreeRuns` (`packages/app/src/services/inline-run-setup.ts`, the `for (const id of persistedIds)` block that reads `${id}.md` / `${id}.state.json`) with a synthetic worktree DB: one run row with both records, one with neither.
- [ ] Turn the record read into a tolerated skip (catch the missing-file case only; keep every other error fatal), mirroring the `record-conflict:<file>` reason format.
- [ ] Extend the existing persist-out test surface (`packages/app/tests/services/` — the 0975 suite that covers `persistWorktreeRuns`) with the two-run case plus a keep-failing case for an unreadable source DB.
- [ ] Run the suite in its workspace, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
