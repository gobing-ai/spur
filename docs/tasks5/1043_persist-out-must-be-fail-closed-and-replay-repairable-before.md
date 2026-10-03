---
schema_version: 1
name: Persist-out must be fail-closed and replay-repairable before row transfer
status: done
template: feature-impl
created_at: 2026-10-01T21:54:16.560Z
updated_at: "2026-10-03T02:03:35.137Z"
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

- [x] R1. A fatal error during the persist-out record pass must leave the invoking tree's DB with no
  rows whose record files were not also written (fail-closed parity with the safe-id precheck at
  inline-run-setup.ts:413).
- [x] R2. A replay of persist-out after any earlier partial failure must repair the target: ids that
  already exist as rows must still get their missing `.md`/`.state.json` records copied, instead
  of being skipped as `id-exists`.
- [x] R3. Existing guarantees are preserved: bookkeeping record-less rows stay a reported skip
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

- `packages/app/src/services/inline-run-setup.ts:425-455` — Plan step 1 (R1): fail-closed record-byte pre-validation before the target DB opens. After the safe-id loop, every run row's `<id>.md`/`<id>.state.json` bytes are read from the worktree durable plane into `recordBytes`; a task-pipeline ENOENT throws a named fatal (green-run evidence guarantee, 0984 R5), any non-ENOENT read error propagates, and only a bookkeeping lifecycle row's ENOENT is tolerated — all BEFORE `openInlineRunProjectDb(toDir)`, so `transferRunTables` can no longer insert rows whose record pass later dies (the E71 torn-tree failure mode). Caching the validated bytes also closes the validate-vs-copy window: the record pass writes exactly what was pre-read.
- `packages/app/src/services/inline-run-setup.ts:458-461` — Plan step 2 (R2): replay repair. `recordIds` = `persistedIds` + transfer skips with reason `id-exists`, and the record-pass gate now keys off `recordIds` instead of `persistedIds`, so a replay of a torn persist (all rows `id-exists`, `persisted:0`) still runs copy-if-missing for every skipped id. `external-key-conflict` ids stay excluded — their identity is another target row, and R2 names only ids that exist as rows.
- `packages/app/src/services/inline-run-setup.ts:465-475` — record pass consumes the pre-validated cache; an un-cached file is by construction a bookkeeping-missing record (0984 R5 skip), and the byte-identical no-op / `record-conflict` refuse-overwrite semantics (0984 R4) are unchanged. `workflowNameById` was dropped — the bookkeeping distinction moved to pre-validation.
- `packages/app/src/services/inline-run-setup.ts:504-506` — the durable per-run-dir carry (1026 R7) iterates `recordIds`, so a replay also repairs missing durable-dir content under the same conflict=skip semantics.
- `packages/app/src/services/inline-run-setup.ts:282-287` — function doc gains the fail-closed (1043 R1) and replay-repair (1043 R2) contract paragraphs.
- `packages/app/tests/services/persist-worktree-runs.test.ts:757-879` — new `task 1043` block: (a) a healthy row plus a task-pipeline row with a missing record rejects with zero rows/actions in the target DB and no record dirs created (AC1); (b) replay over a torn target (rows seeded, records absent) repairs the pair with `persisted:0`, `id-exists` + `record-missing` skips, and no duplicate rows — bookkeeping skip unchanged on the replay path (AC2); (c) replay-time divergence still refuses overwrite (conflict skip, target bytes stand, missing sibling repaired; pair-pass entries asserted by containment because the 1026 R7 carry re-reports the conflict under its composite id — pre-existing behavior, AC3).
Rejected: transactional rollback of inserted rows (per Design — no rollback seam; pre-validation is smaller). Generated plugin twins (`plugins/sp/lib/inline-run.generated.mjs`) are build artifacts regenerated by `build:bundle`; no export surface changed, so the twin export-parity test is unaffected.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | inline-run-setup.ts:432-452 recordBytes pre-read before target DB open; ENOENT named fatal, non-ENOENT rethrow; bookkeeping ENOENT tolerated only (persist-worktree-runs.test.ts:758-792) |
| R2 | MET | inline-run-setup.ts:457-506 recordIds gate + copy-if-missing wx writes + durable carry; id-once in run-transfer.ts:103-116 (persist-worktree-runs.test.ts:794-847) |
| R3 | MET | bookkeeping skip preserved (terminal-reason.ts:34-36); divergence refusal and byte-identical no-op intact; test diff purely additive (persist-worktree-runs.test.ts:849-879) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | persist-worktree-runs.test.ts:758-792 rejects missing record pre-read; COUNT(runs)=0, COUNT(action_runs)=0; no recordsDir in invoking tree |
| AC2 | MET | test | persist-worktree-runs.test.ts:794-847 torn-target replay repairs byte-checkable records; COUNT(runs)=2 no duplicates |
| AC3 | MET | test | persist-worktree-runs.test.ts:849-879 replay divergence refused (record-conflict, target bytes stand, sibling repaired) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Scope:** working-tree diff vs `c3885afa6` — 4 files, +186/−32 (service + tests + regenerated plugin bundle + task doc). Reviewed by fresh-session reviewer agent (run f61c65ad); full quality gate PASS (9630/0, 564 files).

#### Functional traceability
- **R1 fail-closed record pass: PASS.** All run rows' `<id>.md`/`<id>.state.json` bytes are read and validated from the durable plane into `recordBytes` before `openInlineRunProjectDb(toDir)` (`packages/app/src/services/inline-run-setup.ts:425-452`); task-pipeline ENOENT raises the named fatal (`:441-446`), other read errors propagate (`:448`). Cached bytes close the validate-vs-copy window (`:467`). AC1: `packages/app/tests/services/persist-worktree-runs.test.ts:758-792` (reject + zero rows + no target records dir).
- **R2 replay repair: PASS.** `recordIds = persistedIds + id-exists skips` (`:458`), record gate keyed off `recordIds` (`:460`); `transferRunTables` emits each id once (`packages/domain/src/dao/run-transfer.ts:103-133`). Byte-identical no-op and `record-conflict` refusal preserved (`:473-480`); durable carry iterates `recordIds` (`:504`). AC2: `:794-847` (torn-target replay, `persisted:0`, exact skip set). Coherent boundary: missing *source* record on replay still fails closed (R1) — R2 repairs target-side gaps with a healthy source.
- **R3 preserved guarantees: PASS.** 0984 R5 bookkeeping skip intact (`terminal-reason.ts:34-36`, `:467-472`); divergence refusal unchanged and now replay-covered (`:849-879`); test diff purely additive (+124/−0).

#### SECUA
No new dependencies, no shell exec, no secrets; display-only interpolation of DB-sourced strings. Path safety: ids pre-validated by `SAFE_RUN_ID_RE` (`:421-423`); target writes `wx` (no clobber); non-regular target files refused (`:236-243`). `recordBytes` buffering bounded by per-worktree run count (note only).

#### Architecture
Layering per ADR-021: raw SQL in domain, fail-closed/repair policy in app service; public doc updated in-change (`:282-287`); plugin twin regenerated in-diff and twin sync verified (distinctive strings present in `plugins/sp/lib/inline-run.generated.mjs`). Implements E71 R2's invariant at the persist-out seam.

#### Findings

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P2 | Target-side fatals after `transferRunTables` (target `wx` write failure, non-regular target, `mkdirSync`, `copyFile`) can still leave inserted rows without records — residual window, pre-existing, strictly narrowed by this diff; row rollback rejected by Design (no seam) | inline-run-setup.ts:485, :240, :461-462, :846 | RESOLVED — accepted residual risk: design rejects row rollback (no seam); window pre-existing and strictly narrowed by this diff |
| P2 | Deliberate behavior change: pre-validation reads records for all rows, so a re-persist fails closed if a non-bookkeeping source record was deleted after first persist (teardown destroys the record; WT-5 retains the worktree) | inline-run-setup.ts:432-452 | RESOLVED — accepted by design: fail-closed on deleted source records is intended; WT-5 retains the worktree for reconciliation |
| P2 | Minor test gap: no direct test for the non-ENOENT source-read abort or `external-key-conflict` exclusion from `recordIds` | inline-run-setup.ts:448, :458 | RESOLVED — report-only adjudication held; coverage confirmed by adjacent suites: non-ENOENT source-read abort = EISDIR rejection (persist-worktree-runs.test.ts:993), external-key-conflict end-to-end (inline-run-driver.test.ts:468-523), id-once exclusion (run-transfer.test.ts) |

**Verdict: FINDINGS (P0: 0 / P1: 0 / P2: 3, report-only). Merge: OK with notes.** Reviewer unverified items: base-sha identity attested (no git access in read-only reviewer), gate PASS attested from log (not re-run), bundle twin attested by distinctive-string grep (deterministic regen check executed by supervisor during test-fix: anchor 16/16).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-01T21:57:40.820Z backlog → todo (system)
- 2026-10-01T22:31:21.387Z todo → wip (system)
- 2026-10-01T23:45:45.067Z wip → testing (system)
- 2026-10-01T23:46:54.114Z testing → done (system)

