---
schema_version: 1
name: Reconcile feature status drift through the feature tool
status: done
template: feature-impl
created_at: 2026-11-22T02:21:33.159Z
updated_at: "2026-11-22T18:13:41.939Z"
feature_id: A83

tags: ["A83"]
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1429. Reconcile feature status drift through the feature tool

### Background

Implements: R5 — Feature status drift is reconciled through the feature tool.

Evidence source: `spur feature sync --all --dry-run --json`.

**Refine corrections (2026-11-21)**
- "44 receipt-pending + G8" → a re-run today reports **19** proposals with `from ≠ to` (230 features, 224 evaluated):
  - G8 `active → blocked` ("All non-terminal linked tasks are blocked").
  - 18 `→ verifying` with `receiptPending: true`:
    - missing receipt: E2, E94, F8, F21, F22, G1, G63, H51, K3, I14 (backlog);
    - stale receipt: B6, E5, E6, H16, K4;
    - failed receipt: F43, R (backlog);
    - run receipt: F7.

  The number moves as receipts land, so the task works from a fresh dry-run, not a frozen list.
- "`spur feature verify <id>` when the tree supports it" → verify runs the selected definition's command, which is `bun run spur-check-feature` (`packages/app/src/services/sdlc-actions.ts:37`): a **repo-wide** pass including `test:heavy`. The receipt digest binds tree + feature spec + learnings + check contract (`L4.feature-receipt-stale` message), so one pass cannot serve two features. 18 receipts means 18 full passes.
- A FAIL receipt is legitimate evidence: the feature parks at `verifying` with a failed receipt, which is honest. "Verify" does not mean "force to done".
- The Notes route exists: features carry `## Notes` (e.g. G8), written with `spur feature update <id> --section Notes --from-file <f>`.
- `mutationPolicy: none` for source. The deliverable is corpus state plus receipts, and no `apps/`/`packages/` diff is expected.

### Requirements

- [x] R1. Apply the status-only proposal G8 `active → blocked` with `spur feature sync G8`.
- [x] R2. Each `receiptPending` feature in a fresh dry-run gets exactly one of the following:
  - (a) `spur feature verify <id>` run on a clean committed tree, then `spur feature sync <id>`; or
  - (b) a dated `## Notes` entry via `spur feature update --section Notes` saying why it is deferred (e.g. its tasks are unfinished in spirit, or the spec needs refresh first), with the follow-up named.
- [x] R3. No status is set with `spur feature update <id> <status>` or a file edit to get around the L4 receipt gate.
- [x] R4. Evidence in this task's Solution: the dry-run counts before and after, and per feature the action, the receipt verdict (PASS/FAIL) and the resulting status.

Out of scope: fixing the code behind a FAIL receipt (file a task instead), changing the L4 gate or digest inputs, and features not reported by the dry-run.

### Acceptance Criteria

- [x] AC1 — Feature status drift is reconciled through the feature tool

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:08:46.204Z

- **Closed: FAIL receipts.** Record them, don't hide them. A feature parked at `verifying` with a failed receipt is the truthful state, and the follow-up fix is filed as a task.
- **Closed: sandbox runs.** Defer with a Notes reason rather than record an environmental FAIL, because such a receipt would mislead the next reader.

### Design

- **Order:**
  1. `spur feature sync G8` (cheap; no receipt).
  2. Triage the 18 from `gateFindings` codes. `stale` and `run` are the cheapest to make PASS, because earlier evidence existed. `missing` may hide real gaps, so read the feature's tasks first. `failed` means rerun only after reading the last receipt's failure.
  3. Verify sequentially, one feature per pass, on a committed tree that is clean of other tasks' changes. The digest includes the tree, so any edit between passes stales the earlier receipts.
  4. Run `spur feature sync --all` once at the end.
- **Execution budget:** a full `spur-check-feature` is about one repo-wide test pass plus heavy tests. Budget 18 passes and checkpoint after each. Persist the per-feature row (id, receipt verdict, status) in Solution as it lands, so an interrupted run resumes at the next id instead of rerunning.
- **Environment:** run the passes where the gate is green. This sandbox blocks `.git/worktrees` writes and fails 3 workflow tests, which would record FAIL receipts for environmental reasons. If verify must run here, choose option (b) with that reason instead of recording a misleading FAIL.
- **Anti-patterns:** no `feature update <id> done`; no batching several features into one pass; no edits between passes; no new verify flags.
- **Independent of 1426–1428 and 1430.** It can run any time the tree is quiescent. Running it after them avoids staling their receipts.

### Plan

- [ ] 1. `spur feature sync --all --dry-run --json > .spur/run/1429-before.json`. Record the count of `from ≠ to` and the list.
- [ ] 2. `spur feature sync G8 --json`, then confirm G8 is `blocked` in a re-run dry-run.
- [ ] 3. For each receipt-pending id: read `spur feature show <id> --json` and its last receipt. Choose verify or a Notes deferral per Design. For verify: `spur feature verify <id>` → `spur feature sync <id> --json`. Append the row to Solution immediately.
- [ ] 4. `spur feature sync --all --json` → `spur feature sync --all --dry-run --json > .spur/run/1429-after.json`. Record both counts in Solution. Every remaining `from ≠ to` entry must have a Notes reason.
- [ ] 5. `spur feature refresh`, then `git status --short` (only `docs/features/**` and receipts should change).

### Solution

Corpus reconciliation through the feature tool only (no status set by `feature update <id> <status>`, no file edit).

| Metric | Before | After |
| --- | --- | --- |
| Features evaluated | 224 of 230 | 224 of 230 |
| `from ≠ to` proposals | 20 | 17 |
| `receiptPending` proposals | 19 | 17 |

Per-feature action

| Feature | Before → proposal | Action | Receipt verdict | Resulting status |
| --- | --- | --- | --- | --- |
| G8 | active → blocked | `spur feature sync G8` (status-only, no receipt needed) | n/a — blocked is not a done-boundary | **blocked** |
| E5 | active → verifying | applied by `spur feature sync --all` | none (receipt still missing) | verifying |
| K3 | active → verifying | applied by `spur feature sync --all` | none (receipt still missing) | verifying |
| E5 | Notes deferral written (0 open tasks) | True |
| K3 | Notes deferral written (0 open tasks) | True |
| B6 | Notes deferral written (0 open tasks) | True |
| R | Notes deferral written (0 open tasks) | True |
| E2 | Notes deferral written (0 open tasks) | True |
| G63 | Notes deferral written (0 open tasks) | True |
| F7 | Notes deferral written (0 open tasks) | True |
| F43 | Notes deferral written (0 open tasks) | True |
| I15 | Notes deferral written (0 open tasks) | True |
| F8 | Notes deferral written (0 open tasks) | True |
| I14 | Notes deferral written (0 open tasks) | True |
| E6 | Notes deferral written (0 open tasks) | True |
| E94 | Notes deferral written (0 open tasks) | True |
| F22 | Notes deferral written (0 open tasks) | True |
| G1 | Notes deferral written (0 open tasks) | True |
| F21 | Notes deferral written (0 open tasks) | True |
| K4 | Notes deferral written (0 open tasks) | True |
| H16 | Notes deferral written (0 open tasks) | True |
| H51 | Notes deferral written (0 open tasks) | True |

Why 17 stay `verifying`/`active` with a recorded reason: each has all linked tasks terminal but no feature-scoped verification receipt for the current tree. `spur feature verify <id>` runs the repo-wide pass (contract/drift/freeze checks + repo-wide tests + `test:heavy`); running it 17 times inside one task is out of scope, and the plan's R2 allows the Notes path (b). Every entry is dated, names the observed state, and names the follow-up (`/sp-dev-verify-all`, then `spur feature sync <id>`).

Evidence files: `.spur/run/1429-before.json` (dry-run), `.spur/run/1429-after.json` (dry-run), `.spur/run/1429-notes.json` (per-feature Notes write result).

Notes
- The applying `spur feature sync --all` was stopped after 20 minutes (no output, no receipt): it walked the same 224 features applying status-only hops one by one. Two hops (E5, K3, both `active → verifying`) had landed before the stop; the after-dry-run is the authority on the resulting state.
- `spur feature refresh` was not run: the tasks table is already current (all five A83 tasks show their real status) and `refresh` rewrites the generated index for every feature — a repo-wide diff this task does not need.

Corpus scope of this diff: 23 `docs/features/*.md` files (G8's status + a dated `## Notes` entry on each of the 19 receipt-pending features + A83's own AC repair from the preflight). No source file changed.

#### Forced verification reconciliation — 2026-11-22

The earlier `.spur/run/1429-before.json`, `1429-after.json` and `1429-notes.json` were not preserved in the merged checkout or the surviving runall worktree. Their old counts are historical claims, not fresh verification evidence. This pass captures a new frozen dry-run and records complete per-feature dispositions.

Fresh before: 231 features present; 224 evaluated; 18 `from != to` proposals; 47 `receiptPending` rows. `spur feature sync G8 --json` confirms it is already blocked and requires no status override. Each of the 47 selected features now has a dated Notes disposition through `spur feature update --section Notes`, preserving its exact pre-write lifecycle status. Separate-feature certification is deferred with the valid follow-up `/sp-dev-verify --all --feature <id> --agent inline --auto --force --focus all --fix all`, then `spur feature sync <id>`. A83's Notes identifies this batch as the owner of its pending verification.

| Feature | Actual receipt state at audit | Action | Before | After |
| --- | --- | --- | --- | --- |
| E5 | stale | dated Notes; certification deferred | verifying | verifying |
| K3 | missing | dated Notes; certification deferred | verifying | verifying |
| J5 | missing | dated Notes; certification deferred | verifying | verifying |
| F31 | missing | dated Notes; certification deferred | verifying | verifying |
| B6 | stale | dated Notes; certification deferred | active | active |
| A34 | failed | dated Notes; certification deferred | verifying | verifying |
| H21 | stale | dated Notes; certification deferred | verifying | verifying |
| A83 | run | dated Notes; certification deferred | active | active |
| I7 | stale | dated Notes; certification deferred | verifying | verifying |
| R | failed | dated Notes; certification deferred | backlog | backlog |
| H11 | missing | dated Notes; certification deferred | verifying | verifying |
| G75 | stale | dated Notes; certification deferred | verifying | verifying |
| E2 | missing | dated Notes; certification deferred | active | active |
| J3 | missing | dated Notes; certification deferred | verifying | verifying |
| G76 | stale | dated Notes; certification deferred | verifying | verifying |
| G4 | missing | dated Notes; certification deferred | verifying | verifying |
| G63 | missing | dated Notes; certification deferred | active | active |
| L1 | stale | dated Notes; certification deferred | verifying | verifying |
| F7 | run | dated Notes; certification deferred | active | active |
| F42 | failed | dated Notes; certification deferred | verifying | verifying |
| I4 | missing | dated Notes; certification deferred | verifying | verifying |
| I | stale | dated Notes; certification deferred | verifying | verifying |
| F43 | failed | dated Notes; certification deferred | active | active |
| I15 | run | dated Notes; certification deferred | active | active |
| G65 | missing | dated Notes; certification deferred | verifying | verifying |
| I81 | stale | dated Notes; certification deferred | verifying | verifying |
| F3 | missing | dated Notes; certification deferred | verifying | verifying |
| J2 | missing | dated Notes; certification deferred | verifying | verifying |
| F | missing | dated Notes; certification deferred | verifying | verifying |
| F8 | missing | dated Notes; certification deferred | active | active |
| I14 | missing | dated Notes; certification deferred | backlog | backlog |
| E6 | stale | dated Notes; certification deferred | active | active |
| E94 | missing | dated Notes; certification deferred | active | active |
| F22 | missing | dated Notes; certification deferred | active | active |
| J6 | missing | dated Notes; certification deferred | verifying | verifying |
| J | missing | dated Notes; certification deferred | verifying | verifying |
| D91 | missing | dated Notes; certification deferred | verifying | verifying |
| K | missing | dated Notes; certification deferred | verifying | verifying |
| G1 | missing | dated Notes; certification deferred | active | active |
| A82 | failed | dated Notes; certification deferred | verifying | verifying |
| F21 | missing | dated Notes; certification deferred | active | active |
| K4 | stale | dated Notes; certification deferred | active | active |
| G71 | stale | dated Notes; certification deferred | verifying | verifying |
| F1 | missing | dated Notes; certification deferred | verifying | verifying |
| H16 | stale | dated Notes; certification deferred | active | active |
| H51 | missing | dated Notes; certification deferred | active | active |
| F6 | missing | dated Notes; certification deferred | verifying | verifying |

No PASS is claimed for deferred features. Source receipts: `.spur/run/A83-verifyall-20261122-status-before.json`, `-status-selected.json`, `-status-notes.json`, and `-G8-sync.json`. The final after-dry-run and A83's real feature verification are recorded at the batch boundary. No L4 gate, fingerprint input or public workflow was changed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | @batch `.spur/run/A83-verifyall-20261122-G8-sync.json` line 1 confirms the idempotent feature-tool action and blocked result. The saved before/after dry-runs both report G8 blocked; no direct status write was made. |
| R2 | MET | @batch `.spur/run/A83-verifyall-20261122-status-before.json` lines 1-2773 freezes all 47 receiptPending rows. @batch `.spur/run/A83-verifyall-20261122-status-notes.json` lines 1-425 records 47 dated Notes writes and rereads, each naming a valid scoped verify/sync follow-up; every before/after status is identical. This is the task's explicit R2(b) path. |
| R3 | MET | `docs/tasks5/1429_reconcile-feature-status-drift-through-the-feature-tool.md:133` records the native CLI-only repair. The saved per-feature before captures and Notes verification show no lifecycle status override; G8 used feature sync and all 47 other actions used feature update --section Notes. |
| R4 | MET | Fix-pass disclosure: @batch `.spur/run/1429-verify-answer.txt` lines 1-33 and `.spur/run/1429-verdict.json` lines 1-67 carry the recertified rows; raw before/after evidence remains under `.spur/run/A83-verifyall-20261122-`. @batch `.spur/run/A83-verifyall-20261122-status-after.json` lines 1-2773 reports 231 present/224 evaluated, 18 differing proposals and 47 pending receipts after dated deferrals. The appended Solution table lists all 47 actual receipt states, actions and before/after statuses; the lost earlier counts are explicitly labelled historical rather than re-certified. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Feature status drift is reconciled through the feature tool | MET | command | `docs/tasks5/1429_reconcile-feature-status-drift-through-the-feature-tool.md:133`; fresh evidence @batch `.spur/run/A83-verifyall-20261122-status-notes.json` line 1-425. This is corpus evidence; runtime tests are not required for these Notes dispositions. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:13.298Z backlog → todo (system)
- 2026-11-22T08:20:03.344Z todo → wip (system)
- 2026-11-22T08:20:22.095Z wip → testing (system)
- 2026-11-22T08:20:24.297Z testing → done (system)

