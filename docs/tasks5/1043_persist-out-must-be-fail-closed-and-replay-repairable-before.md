---
schema_version: 1
name: Persist-out must be fail-closed and replay-repairable before row transfer
status: todo
template: feature-impl
created_at: 2026-10-01T21:54:16.560Z
updated_at: "2026-10-01T21:57:40.820Z"
feature_id: E71

---

## 1043. Persist-out must be fail-closed and replay-repairable before row transfer

### Background

During the E71 batch finalize (2026-10-01), `persistWorktreeRuns` was invoked from the invoking
tree against a worktree whose durable records dir had not yet been promoted from scratch. The
service inserted run rows into the target DB (`transferRunTables`, inline-run-setup.ts:420) and
then threw fatally inside the record-copy loop (ENOENT read at inline-run-setup.ts:433 for
`inline-1024-233245.md`). Replay returned `{"ok":true,"persisted":0}` with every id `id-exists`
— the copy loop iterates only `persistedIds` (inline-run-setup.ts:428), so replay never re-copies
missing record files. The invoking tree was left permanently torn (rows without files) until a
manual `cp -Rn` repair of 51 durable entries. The safe-id precheck comment (inline-run-setup.ts:413)
advertises "rejection leaves zero partial state", but only the id validation satisfies that; the
record pass does not.

### Requirements

- R1. A fatal error during the persist-out record pass must leave the invoking tree's DB with no
  rows whose record files were not also written (fail-closed parity with the safe-id precheck at
  inline-run-setup.ts:413).
- R2. A replay of persist-out after any earlier partial failure must repair the target: ids that
  already exist as rows must still get their missing `.md`/`.state.json` records copied, instead
  of being skipped as `id-exists`.
- R3. Existing guarantees are preserved: bookkeeping record-less rows stay a reported skip
  (0984 R5), task-pipeline runs keep the fatal green-run evidence guarantee, and diverging target
  files still refuse overwrite (0984 R4).

### Acceptance Criteria

- AC1 [R1]: persist-out with a task-pipeline row whose record file is missing inserts zero rows
  into the target DB and throws before opening the target DB (test-verified).
- AC2 [R2]: replaying persist-out after a simulated torn state copies the missing record files and
  reports them, with `persisted:0` and a repaired record set (test-verified).
- AC3 [R3]: existing persist-worktree-runs tests pass unchanged (bookkeeping skip, 0984 R4
  refusal, byte-identical no-op).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen direction: pre-validate then repair-tolerant replay.
1. Before `transferRunTables` (inline-run-setup.ts:420), read all non-bookkeeping record bytes for
   the rows about to transfer; any non-ENOENT read error or task-pipeline ENOENT aborts before the
   target DB is opened (extends the existing fail-closed pattern).
2. In the record pass, change the skip condition so `id-exists` rows participate in a
   copy-if-missing pass (byte-identical target = no-op; divergent target = refuse, 0984 R4).
   Direct fixes already applied elsewhere: none — the manual `cp -Rn` repair was a session-side
   workaround, not a code change.
Rejected alternative: transactional rollback of inserted rows on copy failure — sqlite DDL/insert
scope here is per-table transfers without an existing rollback seam; pre-validation is smaller and
matches the file at hand.

### Plan

1. Add fail-closed record-byte pre-validation before `transferRunTables` in
   packages/app/src/services/inline-run-setup.ts.
2. Rework the record pass so replay (`persistedIds` empty, `skipped` non-empty) still performs
   copy-if-missing for skipped ids.
3. Extend packages/app/tests/services/persist-worktree-runs.test.ts: (a) fatal ENOENT before any
   row insert (assert target DB unchanged); (b) replay after torn state repairs missing records;
   (c) bookkeeping skip and 0984 R4 divergence refusal unchanged.
4. Run focused test file, then `bun run spur-check` once at the boundary.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-01T21:57:40.820Z backlog → todo (system)

