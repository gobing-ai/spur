---
schema_version: 1
name: Add missing persist-out branch tests for non-ENOENT abort and external-key-conflict exclusion
status: wip
template: feature-impl
created_at: 2026-10-01T23:59:13.672Z
updated_at: "2026-10-02T00:24:47.335Z"
feature_id: E71

priority: P2
estimate_hours: 0.5
---

## 1045. Add missing persist-out branch tests for non-ENOENT abort and external-key-conflict exclusion

### Background

Captured from the creation title: "Add missing persist-out branch tests for non-ENOENT abort and external-key-conflict exclusion".

**Refine corrections (2026-10-01):** (1) Create wrote Acceptance Criteria/Design as stray h2 blocks inside the Requirements region; content moved to the owned template sections. (2) R1 anchor tightened: the non-ENOENT rethrow is `inline-run-setup.ts:450`, target open at `:454` (verified post-commit 3e63b4784). (3) R2 conflict semantics corrected: `external-key-conflict` fires for a NEW id whose `(workflow_name IS ?, external_key = ?)` tuple collides with an existing target row (`run-transfer.ts:110-121`) — not same-id-different-key (id collisions short-circuit as `id-exists` first, `:104-108`). (4) AC1 assertion sharpened: on EISDIR the target DB is never opened, so no `runs.db` is created in the to-dir.

### Requirements

- [ ] R1. A source-read error other than ENOENT during persist-out record-byte pre-validation
  (`packages/app/src/services/inline-run-setup.ts:450` `throw error`) aborts persist-out with the
  error propagating BEFORE the target DB is opened (`:454`), leaving the target side untouched.
- [ ] R2. A source run whose id is new but whose `(workflow_name IS ?, external_key = ?)` tuple
  collides with an existing target row is skipped by `transferRunTables` with reason
  `external-key-conflict` (`packages/domain/src/dao/run-transfer.ts:110-121`) and is excluded from
  `recordIds` (`inline-run-setup.ts:459` — only `id-exists` ids are folded in): the record pass
  attempts no copy for it, writes no record for it, and reports no error for it.

### Acceptance Criteria

- AC1. Test: substitute a directory for one source `<id>.md` in `recordsDir` (readFile → EISDIR);
  `persistWorktreeRuns` rejects; assertions: no `runs.db` created in the to-dir
  (`openInlineRunProjectDb` never ran) and no rows anywhere in the target. (test)
- AC2. Test: seed a target run T with (workflow_name W, external_key K); add a source run S with a
  different id and the same (W, K); persist succeeds; assertions: skip reported for S with reason
  `external-key-conflict`; no record file `recordsDir/<S>.md` written; target `runs` still holds
  exactly the seeded row T. (test)
- AC3. Full `packages/app` persist-worktree-runs suite green
  (`(cd packages/app && bun test tests/services/persist-worktree-runs.test.ts)`). (test)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Test-only task; no production change anticipated (both branches implemented and reviewed in 1043;
they lack direct tests — 1043 P2-3).

- Patterns: follow the seeding and assertion helpers in
  `packages/app/tests/services/persist-worktree-runs.test.ts:756-879` (1043's pre-validation and
  replay cases), including filesystem assertions on `recordsDir`.
- AC1 seeding: replace the source record file with a directory of the same name — deterministic
  EISDIR, no chmod/root sensitivity.
- AC2 seeding: insert the conflicting target row T via SQL through the target adapter handle the
  same way the suite seeds replay targets; S must have a different id but the colliding
  (workflow_name, external_key) tuple so `id-exists` does not short-circuit.

### Plan

1. Add a deterministic EISDIR source-record regression and assert that the target DB and record directory remain absent.
2. Add an external-key collision regression with a different source ID and verify zero record copies and exactly the existing target row.
3. Run the focused persist-out suite, review traceability, derive/record a verify verdict and complete the task through the CLI.

### Solution

`packages/app/tests/services/persist-worktree-runs.test.ts:45` adds the non-ENOENT read regression using existing fixture owners. The source record replaced by a directory raises EISDIR and leaves the receiving `.spur/spur.db` and record directory absent (the task's `runs.db` wording refers to this canonical database). `packages/app/tests/services/persist-worktree-runs.test.ts:62` covers a different source run with the same workflow/external-key tuple: it reports only `external-key-conflict`, copies no record pair and leaves exactly the seeded target row. No production behavior changed. Focused suite: 33 pass, 0 fail.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-01T23:59:15.673Z backlog → wip (system)
- 2026-10-01T23:59:22.041Z wip → todo (system)
- 2026-10-02T00:14:52.766Z todo → wip (system)

