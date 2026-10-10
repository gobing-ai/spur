---
schema_version: 1
name: Worktree batch transitions cannot land their task-lifecycle row when the invoking tree owns the identity
status: done
template: issue
created_at: 2026-10-09T23:39:39.295Z
updated_at: "2026-10-10T00:04:22.510Z"
feature_id: E71

ac_altitude: task-local
ac_numbering: task-local
priority: P1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1149-verdict.json
---

## 1149. Worktree batch transitions cannot land their task-lifecycle row when the invoking tree owns the identity

### Background

**Origin.** Observed 2026-10-09 while landing the `--worktree` batch for `1138` (task 1141's sibling batch was running concurrently).

**What happened.** The batch drove guarded transitions for the task — `spur task update 1138 wip|testing|done`, which is what the `--next` step-chain contract prescribes so the `task-lifecycle.yaml` guards run. Those created a `task-lifecycle` row keyed `(task-lifecycle, task:1138)` in the **worktree** DB, owning 6 `transition_runs`, 6 `workflow_states` and 1 `task_run_link`. `persist-out` then refused and blocked teardown:

```json
{"ok":false,"persisted":0,
 "skipped":[{"id":"run_b6ed0f0e-…","reason":"external-key-conflict"}],
 "error":"… retain the source worktree and reconcile provenance before teardown"}
```

The **invoking tree** already owned that identity: `run_a5d563e7-f9eb-4d1f-96e9-869ebc109823`, `task-lifecycle`, `task:1138`, status `interrupted` — a leftover of the task's own refine step (`started_at 2026-10-09T05:36:13.642Z`), while the task itself was `done`.

**There is no supported exit.** The occupier query has no status predicate and `cancel` does not clear the key, so the documented "stop and reconcile by hand" has no hand available:

- `packages/domain/src/dao/run-transfer.ts:131` — `SELECT id FROM runs WHERE external_key IS NOT NULL AND workflow_name IS ? AND external_key = ?` (no status filter, so a *terminal* occupier still conflicts).
- `packages/domain/src/dao/run-dao.ts:274` `cancelRun` — sets `status='failed'`, `completed_at`, `terminal_reason` only; `external_key` is untouched.
- Verified through the real `transferRunTables` on two temp DBs: occupier `interrupted` → conflict; occupier `failed` (i.e. after `cancel`) → **still conflict**; occupier row deleted → `persistedIds:["wt_row"]` with children landing.
- `spur workflow clean` does not help either: its `--dry-run` reports 0 would-finalize, because it does not target `interrupted`.

**Contract tension (the actual defect).** `config/workflows/task-pipeline.yaml` drives its transitions with `--no-lifecycle` on purpose ("the pipeline run is already a run; a nested one would orphan"), so the *pipeline* path creates no duplicate. But the `--next` step-chain and the driver's own guarded transitions deliberately omit the flag so the FSM guards run. Combining `--next` with `--worktree` therefore manufactures a row that **can never land**, and the exit is a manual `DELETE` against the canonical DB — the only remaining remedy exercised on 2026-10-09.

**Constraint from the existing contract.** Task 1049 R2 forbids overwriting, merging run identities, or backfilling children into another run ("Preserve the domain skip policy and receiving canonical evidence; never overwrite, merge run identities, backfill children into another run, or copy excluded records as if they belong to it"). Any fix must keep the receiving row untouched and must not merge the two runs.

### Requirements

- [x] R1. `transferRunTables` grades a **terminal** source lifecycle row whose `(workflow_name, external_key)` the target already owns as `external-key-conflict-bookkeeping` (non-fatal) instead of `external-key-conflict`. Scope is exactly `workflow_name IN ('task-lifecycle','feature-lifecycle')`. The target row is never read, written, or merged; the source row and its children are simply not copied.
- [x] R2. With R1, `persist-out` exits 0 for a `--worktree` batch that drove guarded transitions, and the automatic teardown (worktree + branch removal) can proceed without any manual row edit. The invoking tree's row stays the sole owner of the identity.
- [x] R3. The batch's terminal outcome still reaches the receiving row: the landing path (or the driver's terminal step) invokes the existing terminal reconcile from task 1047 so an `interrupted` receiving row is finalized rather than left stale. A receiving row that is already terminal is untouched (idempotent).
- [x] R4. Tests: (a) target live × source terminal → non-fatal bookkeeping; (b) target terminal × source terminal → non-fatal bookkeeping; (c) target live × source **non-terminal** → still fail-closed `external-key-conflict`; (d) a non-lifecycle `workflow_name` (e.g. `task-pipeline`) keeps the existing fail-closed grading in every combination; (e) the source row's children never land and the target's row and children are byte-unchanged.
- [x] R5. Docs: `execution-worktree-landing.md` (WT-4a) and `execution-batch-report.md` name the reconcile step and stop presenting a manual `DELETE` as the only exit; the `--next` × `--worktree` tension is stated where the `--next` chain contract is documented.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A terminal lifecycle row no longer blocks the landing (req: R1, R2)
  Given a worktree DB holding a done task-lifecycle row keyed task:1138 with child rows
  And an invoking-tree DB whose live interrupted row owns the same task:1138 identity
  When persist-out runs
  Then it exits 0 with the row reported under skipped as external-key-conflict-bookkeeping
  And the invoking-tree row is byte-unchanged
  And the worktree's child rows were not copied
```

```gherkin
Scenario: AC2 — A non-terminal duplicate still fails closed (req: R1)
  Given a worktree DB holding a running task-lifecycle row keyed task:1138
  And an invoking-tree DB whose row owns the same identity
  When persist-out runs
  Then it exits non-zero with external-key-conflict
  And the worktree is retained
```

```gherkin
Scenario: AC3 — Non-lifecycle provenance is unaffected (req: R1)
  Given a worktree DB holding a done task-pipeline row whose (workflow_name, external_key) the invoking tree already owns
  When persist-out runs
  Then the grading is unchanged (external-key-conflict) and teardown is blocked
```

```gherkin
Scenario: AC4 — The receiving row is reconciled, not duplicated (req: R3)
  Given a landed batch whose receiving task-lifecycle row is interrupted
  When the landing's reconcile step runs
  Then that row reaches the batch's terminal status with a terminal reason
  And exactly one row still owns the task:1138 identity
  And a second reconcile is a no-op (no churned completed_at)
```

```gherkin
Scenario: AC5 — Each failure mode fails before its fix (req: R4)
  Given the new run-transfer cases F1-F4
  When the widened grading is reverted
  Then the non-terminal-duplicate and non-lifecycle cases fail
  And with the grading in place the refused row contributes zero child rows and the target row is byte-unchanged
```

```gherkin
Scenario: AC6 — The landing contract names the reconcile, not a manual delete (req: R5)
  Given the spur-dev references after this change
  When the execution-batch contract test scans them
  Then execution-worktree-landing.md and execution-batch-report.md name the receiving-row reconcile step
  And neither presents a manual row DELETE as the required exit
  And the --next chain section states the --worktree interaction
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Placement.** `packages/domain/src/dao/run-transfer.ts` — the existing `external-key-conflict` grading, extended by one predicate. No new module, no new flag, no new public `spur` noun/verb.

**The rule.** Today the grading is "does the refused source row own children?":

```ts
let ownsChildren = false;
for (const table of CHILD_TABLES) { … }
skipped.push({ id, reason: ownsChildren ? 'external-key-conflict' : 'external-key-conflict-bookkeeping' });
```

Extend it to: a refusal is bookkeeping (non-fatal) when the source row owns no children **or** when the source row is a *terminal lifecycle* row:

```ts
const LIFECYCLE_WORKFLOWS = new Set(['task-lifecycle', 'feature-lifecycle']);
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const bookkeeping =
    !ownsChildren ||
    (LIFECYCLE_WORKFLOWS.has(String(row.workflow_name)) && TERMINAL.has(String(row.status)));
skipped.push({ id, reason: bookkeeping ? 'external-key-conflict-bookkeeping' : 'external-key-conflict' });
```

**Why terminal-only, and why lifecycle-only.** The identity belongs to the *target's* row either way, so nothing about the source row is needed to describe the entity — that is already true today for the childless case. Asserting the extra condition "the source row is terminal" keeps the fail-closed behaviour for the case that can still change: a **non-terminal** source lifecycle row whose outcome is not yet decided must not be silently dropped. Restricting to the two lifecycle workflow names keeps every other provenance kind (`task-pipeline`, `wrapup-pipeline`, …) strictly fail-closed, because for those the run row *is* the provenance rather than a state mirror of an entity the receiving tree already tracks.

**Why not supersede or merge (the alternatives considered).**
- *Supersede* (finalize the target's stale row, then insert the source with the key): rejected — 1049 R2 forbids merging run identities, and it would put a worktree-created row in charge of the entity's canonical lifecycle.
- *Demote* (insert the source with `external_key = NULL`): rejected — it would leave two rows for one entity and silently convert an identity-bearing run into an anonymous one, which is exactly the "copy excluded records as if they belong to it" hazard 1049 R2 names.
- *Suppress the row at creation* (drive worktree transitions with `--no-lifecycle`): rejected as the primary fix — it also suppresses the FSM guards that `--next` exists to run (cross-cutting.md: the flag is bookkeeping, not a guard bypass, so guards still run, but the run edge disappears), and it does not help a batch that legitimately created the row before this fix. It stays available as a complementary option.

**Reconcile instead of duplicate (R3).** The receiving row is the entity's lifecycle row, so the batch's terminal outcome must land *on it*. Task 1047 already provides exactly this: `reconcileExistingLifecycleRow` finalizes an existing row (including "a stale in-flight status") without allocating one. Verified on this repository on 2026-10-09 — a terminal `record` replay turned the stale `interrupted` `task:1138` row into `done`/`done` and allocated nothing:

```
spur task record 1138 --verdict-file .spur/memory/evidence/1138-verdict.json --transition done
before: run_a5d563e7-… | interrupted | interrupted | (no completed_at)
after:  run_a5d563e7-… | done        | done        | 2026-10-09T23:38:52.397Z
```

So the landing needs one added step: after a successful persist-out, run the terminal reconcile for each forwarded task whose receiving lifecycle row is non-terminal. The cleanest home is the existing WT-4a persist-out call (the plugin glue already has the task files and the project DB), reusing `reconcileExistingLifecycleRow` rather than re-implementing the finalize write.

**Boundaries.** `plugin`-safe: `packages/domain` change plus a call in `plugins/sp/scripts/inline-run-setup.ts` glue via the app service; no `@gobing-ai/*` value import in bundled plugin surfaces. No change to the conflict *detection* (the key tuple and the `id-exists` path are untouched), so the partial unique index and every existing skip reason keep their meaning.

**Failure inventory (tests first).**
- F1: the widened grading swallows a *non-terminal* duplicate lifecycle row, losing a live run's provenance.
- F2: the widening leaks to non-lifecycle workflow names, un-blocking a real pipeline-provenance loss.
- F3: the source row's children are copied anyway (the refused row must contribute nothing).
- F4: the target row or its children mutate during a refusal.
- F5: the reconcile allocates a second row instead of finalizing the existing one.
- F6: a second landing churns `completed_at` on an already-terminal row.

### Plan

1. Failure modes first, in `packages/domain/tests/dao/run-transfer.test.ts`: F1–F4 above (target live|terminal × source terminal|non-terminal, a non-lifecycle workflow name, and the child/byte invariants). The file's existing cases already build two migrated DBs and call `transferRunTables`, so extend them rather than adding a harness.
2. Implement the widened grading in `run-transfer.ts` and update its module doc (the 1090 grading note) to state the lifecycle-terminal rule and why it stays within 1049 R2.
3. Add the reconcile step to the WT-4a landing (R3): reuse `reconcileExistingLifecycleRow` for each forwarded task whose receiving row is non-terminal; report, never fail, on a reconcile error. F5/F6 in the glue's test.
4. Docs (R5): `execution-worktree-landing.md` WT-4a, `execution-batch-report.md` Step 5, and the `--next` chain section of `cross-cutting.md`.
5. Gates: `bun run test` for `packages/domain` + `plugins/sp`, then `bun run spur-check`; `bun run build:scripts` if the glue changes.
6. Acceptance drill: reproduce the 2026-10-09 case end to end — worktree batch driving guarded transitions, invoking tree holding a stale `interrupted` row — and record that persist-out exits 0, the receiving row reaches `done`, exactly one row owns the identity, and the worktree is removed automatically.

### Root Cause

- `packages/domain/src/dao/run-transfer.ts:131-153`: the conflict predicate has no status term and the grading asks only whether the source owns children, so a **terminal lifecycle** row is graded fatal purely because it carries `transition_runs`/`workflow_states`.
- `packages/domain/src/dao/run-dao.ts:274-286`: `cancelRun` never clears `external_key`, so `spur workflow cancel` cannot free the identity the conflict predicate keys on — the "reconcile by hand" advice in 1049 R3 has no supported hand.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:304`: the `--next` chain prescribes un-suppressed transitions while `config/workflows/task-pipeline.yaml:362,936` uses `--no-lifecycle`; nothing reconciles the two when both are used with `--worktree`.
- No landing step reconciles the receiving lifecycle row, so the batch's terminal outcome has nowhere to land once the duplicate is refused.

### Solution

| Change | Location | Why |
| --- | --- | --- |
| Widened grading for terminal lifecycle duplicate rows | `packages/domain/src/dao/run-transfer.ts:145` | Terminal `task-lifecycle` and `feature-lifecycle` rows are bookkeeping when target owns key (R1) |
| Reconcile receiving row for terminal forwarded tasks at persist-out | `packages/app/src/services/inline-run-setup.ts:1960` | Finalizes any stale in-flight or interrupted receiving lifecycle row without manual SQL (R3) |
| Tests for widened grading & invariants (AC1-AC3) | `packages/domain/tests/dao/run-transfer.test.ts:133` | Covers live/terminal target x terminal/non-terminal source and non-lifecycle workflows (R4) |
| Tests for persist-out non-fatal duplicate & reconcile (AC1, AC4) | `packages/app/tests/services/inline-run-driver.test.ts:603` | Verifies end-to-end persist-out exit 0 and receiving row reconcile (R2, R3) |
| Document worktree interaction with FSM transitions | `plugins/sp/skills/spur-dev/references/cross-cutting.md:312` | Explains how `--next` guarded transitions land cleanly without manual delete (R5) |
| Document receiving row reconcile at landing | `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:94` | WT-4a landing automatically finalizes receiving row (R5) |
| Document non-fatal lifecycle bookkeeping in batch report | `plugins/sp/skills/spur-dev/references/execution-batch-report.md:130` | Details the non-fatal grading contract (R5) |

Tradeoff: Terminal duplicate lifecycle rows are skipped as `external-key-conflict-bookkeeping` rather than failing closed; the entity's canonical lifecycle lives on the receiving row.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/dao/run-transfer.ts:145` grades terminal lifecycle duplicate rows as `external-key-conflict-bookkeeping`. |
| R2 | MET | `packages/app/tests/services/inline-run-driver.test.ts:603` verifies `persist-out` exits 0 on terminal duplicate lifecycle rows. |
| R3 | MET | `packages/app/src/services/inline-run-setup.ts:1960` automatically reconciles receiving lifecycle row during persist-out. |
| R4 | MET | `packages/domain/tests/dao/run-transfer.test.ts:133` tests all target/source combinations and child row isolation. |
| R5 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:312`, `plugins/sp/skills/spur-dev/references/execution-batch-report.md:130`, `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:94` updated. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | unit | `packages/domain/tests/dao/run-transfer.test.ts` AC1 case passes. |
| AC2 | MET | unit | `packages/domain/tests/dao/run-transfer.test.ts` non-terminal duplicate case stays fail-closed. |
| AC3 | MET | unit | `packages/domain/tests/dao/run-transfer.test.ts` non-lifecycle workflow stays fail-closed. |
| AC4 | MET | unit | `packages/app/tests/services/inline-run-driver.test.ts:603` receiving row is reconciled to done. |
| AC5 | MET | unit | run-transfer F1-F4 tests pass and verify invariants. |
| AC6 | MET | unit | Doc references updated to state reconcile step. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No findings (verify verdict PASS) |

Residual risk:
- None identified; the non-fatal grading is strictly scoped to `task-lifecycle` and `feature-lifecycle` in terminal states (`done`/`failed`/`cancelled`). Non-lifecycle workflows remain strictly fail-closed.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-09T23:52:26.467Z todo → wip (system)
- 2026-10-10T00:03:56.073Z wip → testing (system)
- 2026-10-10T00:04:22.497Z testing → done (system)

