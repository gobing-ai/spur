---
schema_version: 1
name: Add missing persist-out branch tests for non-ENOENT abort and external-key-conflict exclusion
status: done
template: feature-impl
created_at: 2026-10-01T23:59:13.672Z
updated_at: "2026-10-02T01:06:59.375Z"
feature_id: E71

priority: P2
estimate_hours: 0.5
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-run-1045-b5fe/.spur/memory/evidence/1045-verdict.json
---

## 1045. Add missing persist-out branch tests for non-ENOENT abort and external-key-conflict exclusion

### Background

Captured from the creation title: "Add missing persist-out branch tests for non-ENOENT abort and external-key-conflict exclusion".

**Refine corrections (2026-10-01):** (1) Create wrote Acceptance Criteria/Design as stray h2 blocks inside the Requirements region; content moved to the owned template sections. (2) R1 anchor tightened: the non-ENOENT rethrow is `inline-run-setup.ts:450`, target open at `:454` (verified post-commit 3e63b4784). (3) R2 conflict semantics corrected: `external-key-conflict` fires for a NEW id whose `(workflow_name IS ?, external_key = ?)` tuple collides with an existing target row (`run-transfer.ts:110-121`) — not same-id-different-key (id collisions short-circuit as `id-exists` first, `:104-108`). (4) AC1 assertion sharpened: on EISDIR the target DB is never opened, so no `runs.db` is created in the to-dir.

### Requirements

- R1. A source-read error other than ENOENT during persist-out record-byte pre-validation
  (`packages/app/src/services/inline-run-setup.ts:450` `throw error`) aborts persist-out with the
  error propagating BEFORE the target DB is opened (`:454`), leaving the target side untouched.
- R2. A source run whose id is new but whose `(workflow_name IS ?, external_key = ?)` tuple
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

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Added two regression tests to `packages/app/tests/services/persist-worktree-runs.test.ts:881-963` in a new `task 1045` describe block, mirroring the task-1043 fail-closed/replay patterns:

- **R1/AC1 (non-ENOENT abort)** — seeds a healthy worktree run, then substitutes a directory for its source record `run_1045ok.md` in the records dir, so `readFile` throws EISDIR (not ENOENT) inside the record-byte pre-validation loop at `packages/app/src/services/inline-run-setup.ts:441-453`, hitting the bare re-throw branch. Asserts `persistWorktreeRuns` rejects with `/EISDIR/`, that the target tree has **no `.spur/spur.db`** (the target DB at `packages/app/src/services/inline-run-setup.ts:454` was never opened) and no records dir, and that a post-hoc target open shows zero transferred rows.
- **R2/AC2 (external-key-conflict exclusion)** — seeds target row `run_1045t` with `external_key='k1045'`, then a source row `run_1045s` with a different id but the same `(workflow_name, external_key)` tuple — the partial-unique-index collision seam at `packages/domain/src/dao/run-transfer.ts:110-121`, not an id collision. Asserts the transfer succeeds with `persisted: 0`, reports the `external-key-conflict` skip, that `run_1045s` is excluded from `recordIds` (no `.md`/`.state.json` land in the invoking tree, per the `recordIds` construction at `packages/app/src/services/inline-run-setup.ts:459`), and that the target keeps exactly its seeded row.

Verification: `bun test tests/services/persist-worktree-runs.test.ts -t "task 1045"` → 2 pass; full file → **31 pass, 0 fail** (AC3); `bun run --filter @gobing-ai/spur-app typecheck` → exit 0. No production source changed — test-only diff against `packages/app/tests/services/persist-worktree-runs.test.ts`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/services/persist-worktree-runs.test.ts:883-921` — directory substitutes `run_1045ok.md`; `persistWorktreeRuns` rejects `/EISDIR/` (pre-validation re-throw, `packages/app/src/services/inline-run-setup.ts:441-453`); `existsSync(join(to.dir,'.spur','spur.db'))` false proves the target open at `:454` never happened; records dir absent; post-hoc DB open counts 0 rows |
| R2 | MET | `packages/app/tests/services/persist-worktree-runs.test.ts:923-963` — seeded `(workflow_name, external_key)` tuple conflict (`packages/domain/src/dao/run-transfer.ts:110-121` skip); skip reason entry asserted; S absent from record copy; target row count exactly 1 with id `run_1045t` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | rejects /EISDIR/; zero target artifacts (spur.db + records dir absent) — `bun test tests/services/persist-worktree-runs.test.ts -t "task 1045"` 2/2 pass |
| AC2 | MET | test | conflict skip logged; zero S record files; target keeps exactly T — same suite, 2/2 pass |
| AC3 | MET | test | full file suite 31 pass / 0 fail re-run during this verify pass; repo gate `bun run spur-check` PASS attempt 1 (`.spur/run/1045-test-gate.log`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS — no P1/P2 findings** (three-dimensional review: functional traceability + SECUA + architecture depth; diff = `packages/app/tests/services/persist-worktree-runs.test.ts` +84, task corpus only besides).

## Functional traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | New test drives the directory-substituted source record (`run_1045ok.md`) into the pre-validation loop re-throw at `packages/app/src/services/inline-run-setup.ts:452`; asserts reject `/EISDIR/`, **no `.spur/spur.db`** in the target tree (target DB open at `packages/app/src/services/inline-run-setup.ts:454` never reached), no records dir, zero rows post-hoc |
| R2 | MET | New test seeds the same `(workflow_name, external_key)` tuple under different ids; asserts the `external-key-conflict` skip from `packages/domain/src/dao/run-transfer.ts:110-121`, S excluded from the record set (`recordIds` at `packages/app/src/services/inline-run-setup.ts:459`), and target keeps exactly seeded `run_1045t` |
| AC1 / AC2 | MET | Covered one-to-one by the two new tests (2/2 pass, `-t "task 1045"`) |
| AC3 | MET | Full file suite **31 pass / 0 fail**; repo gate `bun run spur-check` PASS (attempt 1) |

## SECUA
No P1–P3 findings across Security / Efficiency / Correctness / Usability / Architecture. Correctness seams verified against source (target DB path matches `openInlineRunProjectDb`; EISDIR deterministic — `.md` precedes `.state.json` in the per-row read order, single seeded row).

## Architecture depth
Test-only diff; pins the documented invariants of the 1043 seam pair; reuses existing fixtures (`seedWorktree`/`makeDir`/`RUN_INSERT`), no new abstraction, no follow-up warranted.

**SECU findings** (three-dimensional review — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | Correctness | packages/app/tests/services/persist-worktree-runs.test.ts:917 | Post-hoc target open for row-count proof runs after the existsSync assertions — deliberate ordering, commented in-test |
| P4 | Efficiency | packages/app/tests/services/persist-worktree-runs.test.ts:941 | external_key patched via UPDATE after seedWorktree instead of a second INSERT constant — smallest-diff choice |
| P4 | Usability | packages/app/tests/services/persist-worktree-runs.test.ts:903 | /EISDIR/ matches message text rather than error.code — stable for libuv-originated errors, matches file-suite style |

Review executed inline in `session-2026-10-02-1738` (below dispatch floor: estimate_hours 0.5 ≤ 1); fresh-session policy honored by grounding the review in the persisted spec, the recorded diff, and run artifacts.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-01T23:59:15.673Z backlog → wip (system)
- 2026-10-01T23:59:22.041Z wip → todo (system)
- 2026-10-02T00:49:20.641Z todo → wip (system)
- 2026-10-02T01:05:09.073Z wip → testing (system)
- 2026-10-02T01:06:59.371Z testing → done (system)

