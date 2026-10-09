---
schema_version: 1
name: Unblock workflow housekeeping from legacy evidence-migration failures
status: todo
template: issue
created_at: 2026-10-09T06:08:08.615Z
updated_at: "2026-10-09T06:41:22.552Z"

---

## 1139. Unblock workflow housekeeping from legacy evidence-migration failures

### Background

`spur workflow clean` never finalizes stale non-terminal rows on this project's DB, so orphaned
`running` rows accumulate: **62** at the time of filing (41 `task-lifecycle` since 2026-10-01,
14 `feature-lifecycle` since 2026-07-02, 4 `task-pipeline`, 2 `idea-pipeline`, 1
`wrapup-pipeline`).

Cause: the command couples stale-run finalization to a pre-pass that migrates legacy scratch-plane
evidence (`.spur/run/<name>-verdict.json` and their two-file records) into the durable evidence
plane. If ANY legacy file fails that migration, the whole pass reports `housekeeping skipped` and
the stale rows are left untouched. Six files fail today, reproducibly and identically on repeated
runs:

| File | Migrator error |
| --- | --- |
| `.spur/run/0867-verdict.json` | `malformed: proof owner binding` |
| `.spur/run/0875-verdict.json` | `malformed: proof owner binding` |
| `.spur/run/0872-verdict.json` | `malformed: proof owner binding` |
| `.spur/run/1092-verdict.json` | `target-mismatch` |
| `.spur/run/2f720cbc-7e9f-40c2-98cf-af32ed9a01a6-verdict.json` | `malformed: verdict identity or shape` (keys are the check-result shape, not a verdict) |
| `.spur/run/201a166a-3e31-4c3b-a425-3b0d1316a489.md` | `missing-required-item: …201a166a-….state.json` (absent in `.spur/run/`; the `.spur/memory/runs/` copy exists) |

`spur workflow clean --logs` (the scoped variant) succeeds — `Evidence migration: 0 migrated, 82
already present, 0 failed` — which shows the migration itself is healthy for every other file and
that the six offenders are genuinely legacy/malformed strays, not evidence the plane is missing.

This was observed while landing the H1 batch (1127/1129/1128): the stale `feature:H1` lifecycle row
from 2026-07-25 had to be cancelled by hand (`spur workflow cancel <run-id>`) before `persist-out`
could finish, because housekeeping could not do it.

### Requirements

- [ ] R1. Housekeeping must not be blocked by unrelated legacy evidence. `spur workflow clean`
  (stale-run finalization) either (a) runs the evidence migration as a *reported, non-fatal*
  pre-pass — failing files are listed and skipped, the stale-run pass still proceeds — or (b)
  gains an explicit flag to skip the migration for this invocation. Either way, one malformed
  legacy file must not leave every stale row `running` forever.
- [ ] R2. The offenders must be visible where the operator acts: the command's output must name each
  skipped file with its reason and a one-line remedy (repair, re-record, or archive), and the same
  list must appear under `--json` so a caller can act on it without scraping prose.
- [ ] R3. A file that is not a verdict at all (e.g. the `2f720cbc` check-result shape) and a record
  whose companion `.state.json` lives only in `.spur/memory/runs/` must be classified, not treated
  as fatal migration input — say explicitly whether they are ignored, archived by the operator, or
  repaired by a generator.
- [ ] R4. After the fix, running `spur workflow clean` on this repository finalizes the stale rows
  observed on 2026-10-08 (or reports precisely why a specific one is still live), and a second run
  is a no-op.

- [ ] R5. **Divergent foreign evidence must be reported and skipped, not fatal.** `persist-out` refused
  the H1 batch's teardown (2026-10-08) with `durable evidence conflicts: 1090-verdict.json`: a stale
  *staged copy* of another task's evidence, whose invoking-tree counterpart had moved on. Twelve
  further foreign files existed only in the worktree. Reconcile by reporting the divergent foreign set
  (name + which side is newer) and skipping those copies, so a teardown is never blocked by evidence
  the run does not own; the invoking tree's copy is never overwritten.
- [ ] R6. **Unresolvable run-artifact citations are caught where they are written, not at teardown.**
  After R5's class was reconciled, the same pass refused on `.spur/run/bb-base.sha` — a citation in
  task 1129's `### Testing`, naming a path from a verifier's throwaway temp-repo probe. A citation
  naming a `.spur/run/<name>` present in neither tree should fail (or be dropped by) the *record*
  step; teardown must be the last chance, not the first detector.

### Acceptance Criteria

```gherkin
Scenario: AC1 — one malformed legacy file no longer blocks stale-run finalization
  Given a scratch evidence file the migrator rejects
  And at least one non-terminal run past the staleness threshold
  When `spur workflow clean` runs
  Then the stale run is finalized and the rejected file is reported with its reason

Scenario: AC2 — the skip list is machine-readable
  Given the same setup
  When `spur workflow clean --json` runs
  Then the output carries every rejected file with its reason and a remedy hint
  And the stale-run outcome is reported separately from the migration outcome

Scenario: AC3 — this repository's housekeeping converges
  Given the six files listed in Background
  When `spur workflow clean` runs twice
  Then the first run finalizes the stale rows (or names the ones it must leave live, with why)
  And the second run is a no-op with no `housekeeping skipped` line
```

```gherkin
Scenario: AC4 — a stale foreign evidence copy cannot block teardown
  Given a worktree evidence plane holding a foreign task's older copy whose invoking-tree counterpart is newer
  When persist-out runs
  Then the pass completes, reporting that file as skipped and naming which side is newer
  And the invoking-tree copy is never overwritten

Scenario: AC5 — a phantom citation is caught at record time
  Given a task whose Testing section cites a `.spur/run/<name>` that exists in neither tree
  When the record step runs
  Then the citation is reported and repaired there, before any teardown is attempted
```

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
