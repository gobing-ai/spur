---
schema_version: 1
name: "Fix E31 integration friction: orphaned serve daemons defeat worktree removal; corpus gate runs full test suite; R2d replay discards verdicts"
status: todo
template: issue
created_at: 2026-08-30T02:21:06.464Z
updated_at: "2026-08-30T02:33:41.836Z"
feature_id: A6
ac_altitude: task-local
---

## 0720. Fix E31 integration friction: orphaned serve daemons defeat worktree removal; corpus gate runs full test suite; R2d replay discards verdicts

### Background
Session 2026-08-29/30 — E31 dev-runall batch (0716, 0717) and bf8c worktree integration onto main. The batch itself was clean (2 PASS, 3 commits, green worktree verification); integration consumed about 2h20m, dominated by avoidable cleanup and evidence-reconciliation work.

Ready-depth premise verification narrowed the original three findings to two implementation gaps. `bun run corpus-check` already exists as the corpus-only validation path and is documented in `AGENTS.md`; R2 is therefore a verified guardrail, not new work. Commit `c25f0c141` added provisional WT-4 and R2d prose, but it did not close either remaining gap: cleanup ignores kill failure and cannot report surviving PID/port details, while R2d still offers mutually incompatible replay-or-report outcomes.
### Requirements
- [ ] R1. Before a create-mode `--worktree` batch removes or deregisters its worktree, cleanup must find processes whose CWD is the exact worktree, terminate them with a bounded TERM-to-KILL sequence, and re-query. If any holder remains, the batch must retain the worktree and branch and report every surviving PID plus each discoverable listening port; it must not continue to remove, prune, or delete the branch.
- [x] R2. Reuse the existing `bun run corpus-check` command as the corpus-only post-merge validation path. Do not add `spur-check-corpus` or change `spur-check-new`, which remains the comprehensive validation plus corpus sweep.
- [ ] R3. A worktree batch must persist its structured batch report and per-task verdict JSON artifacts under the invoking tree's `.spur/run/` before create-mode cleanup. After a green merge, committed task files are authoritative for lifecycle status and those invoking-tree artifacts are authoritative for batch/verdict evidence; the driver must not replay `task update`, replay `task record`, import `task_run_links`, or create timestamp-only corpus churn.

Non-goals: no public CLI surface, no lifecycle database/schema migration, no change to `task record`, no general `serve` process supervisor, and no second corpus-check alias.
### Acceptance Criteria
```gherkin
Scenario: R1 — daemon-holding worktree is removed cleanly
  Given a create-mode worktree batch whose proof step left a process with its CWD inside the worktree
  When WT-4 begins cleanup
  Then the holder receives TERM followed by bounded wait and KILL only if needed
  And the holder set is empty before git worktree remove and branch deletion run
  And a surviving holder routes to WT-5 with the worktree and branch retained and a halt report naming its PID and any discoverable listening port

Scenario: R2 — existing corpus-only validation remains the single fast path
  Given a change limited to the task or feature corpus or config/corpus-baseline.json
  When the operator runs bun run corpus-check
  Then the corpus sweep runs without invoking the root test suite
  And new findings outside the baseline fail the command
  And no duplicate package script or AGENTS.md instruction is added

Scenario: R3 — worktree evidence disposition is deterministic
  Given a green worktree batch with per-task verdict JSON files
  When Step 5 completes and WT-4 prepares to remove the created worktree
  Then the invoking tree contains .spur/run/worktree-<marker-id>-batch-report.md
  And it contains .spur/run/worktree-<marker-id>-verdicts/<wbs>-verdict.json for every attempted task with a verdict artifact
  And the report references those invoking-tree artifact paths
  And no post-merge task update or task record replay changes task timestamps or creates task_run_links rows
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-08-30T02:32:33.269Z

- **Is R2 still missing?** No. Current `package.json` defines `corpus-check` as the source-local corpus sweep, `spur-check-new` composes the comprehensive checks plus `corpus-check`, and `AGENTS.md` documents both roles. The earlier proposal to add `spur-check-corpus` is superseded; implementation must make no R2 code or documentation change.
- **Which R3 option is selected?** Option B: no lifecycle-DB replay or import. Committed task files own lifecycle status. The invoking tree owns a persisted batch report and copied verdict JSON artifacts, so create-mode worktree removal does not discard evidence.
- **Where are the artifacts frozen?** `.spur/run/worktree-<marker-id>-batch-report.md` and `.spur/run/worktree-<marker-id>-verdicts/<wbs>-verdict.json` in the invoking tree. The existing marker ID provides collision-free identity; no new public flag or DTO is needed.
- **What exactly happens during cleanup?** Resolve the exact absolute worktree path, enumerate CWD holders with the existing platform `lsof`, send TERM, wait for a bounded interval, send KILL only to survivors, and re-query. An empty result permits `git worktree remove`; survivors route to WT-5 before any prune/remove/branch deletion. PID is mandatory in the halt report; listening port is best-effort because a CWD holder may own no socket.
- **Dependencies or deferred decisions?** None. The task has no dependency edge. General detached-serve lifecycle ownership remains out of scope; this task hardens the batch boundary that owns worktree removal.
### Design
Implement the two remaining gaps in the existing model-driven batch contract; do not add runtime application code.

**WHAT / WHERE**

1. In `plugins/sp/skills/spur-dev/references/execution-batch.md` Step 5, make report persistence part of the worktree-batch contract. Before any WT-4 removal, copy each attempted task's existing `.spur/run/<wbs>-verdict.json` from the worktree into the invoking tree at `.spur/run/worktree-<marker-id>-verdicts/<wbs>-verdict.json`, write the emitted report to `.spur/run/worktree-<marker-id>-batch-report.md`, and make report links use those surviving paths. Artifact persistence failure routes to WT-5 so evidence is not destroyed.
2. Replace WT-4's one-shot `lsof | xargs kill` line with a bounded cleanup protocol over the exact absolute worktree path: enumerate CWD holders, TERM, wait, KILL survivors, re-query. Only an empty holder set may proceed to `git worktree remove` and `git branch -d`. A non-empty result routes to WT-5 and reports surviving PIDs plus listening ports when `lsof` can discover them.
3. Replace the R2d replay-or-report paragraph with one contract: committed task files own lifecycle state; the persisted invoking-tree report and copied verdict JSON own evidence; per-worktree lifecycle DB rows intentionally do not travel. Remove every post-merge `task update` / `task record` replay instruction.
4. Extend `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` with static contract pins for evidence persistence, bounded holder re-check/fail-closed behavior, and the absence of replay instructions.

**WHY**

`execution-batch.md` is the executable orchestration contract used by the inline batch driver. Keeping the fix there closes the actual failure boundary with two files. Importing `task_run_links` would invent cross-database provenance semantics that the current per-tree design explicitly avoids, while another corpus script would duplicate an existing command.

**Precedence and failure behavior**

- Evidence persistence precedes destructive cleanup.
- Evidence-write failure or surviving CWD holders takes precedence over the green batch verdict and routes to WT-5 retention.
- PID reporting is required; port reporting is best-effort and must not hide a PID with no listening socket.
- Reuse mode retains its operator-owned tree, but still persists the Step 5 report under the invoking tree.

**Anti-patterns**

- Do not call `git worktree prune`, `git worktree remove`, or delete the branch before the holder re-query is empty.
- Do not ignore `kill` failures or rely on one unverified signal.
- Do not repair timestamp churn with `git checkout`.
- Do not replay task lifecycle commands, synthesize/import `task_run_links`, change `task record`, or add a new corpus-check alias.

**Cross-task contract:** 0720 has no dependencies and changes no public API. It leaves lifecycle persistence, `serve`, and `task record` behavior unchanged for later work.
### Plan
- [ ] P1 (R1, R3) Add failing static assertions to `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` for invoking-tree report/verdict persistence, fail-closed holder cleanup, and removal of lifecycle replay instructions.
- [ ] P2 (R3) Update Step 5 of `execution-batch.md` to persist the batch report and copy per-task verdict artifacts to the frozen invoking-tree paths before any worktree removal; route persistence failure to WT-5.
- [ ] P3 (R1) Replace the WT-4 one-shot kill with exact-path holder enumeration, bounded TERM/wait/KILL/re-query behavior, and PID/port halt reporting before any remove/prune/branch deletion.
- [ ] P4 (R3) Rewrite the lifecycle-DB disposition as the selected no-replay contract and remove the contradictory replay/order recovery prose.
- [ ] P5 (R2) Verify only: inspect `package.json` and `AGENTS.md`, run `bun run corpus-check`, and confirm no duplicate script or instruction was introduced.
- [ ] P6 Run the targeted contract test from `plugins/sp`, then `bun run spur-check`, `bun run corpus-check`, `bun run apps/cli/src/index.ts task check 0720 --json`, and `git diff --check`.
### Root Cause
- R1 (P2, workflow): Orphaned `serve` proof daemons (PPID 1, ports 3000/3005) kept the removed worktree as CWD; `git worktree remove` failed ENOTEMPTY, `rm -rf` failed os error 66, while `git worktree prune` had already deregistered the tree — three confusing partial states before lsof revealed the daemons.
- R2 (P2, workflow): The post-merge gate `bun run spur-check-new` runs the full 6766-test suite (~126s) plus corpus sweep; rerunning it after a baseline-only JSON fix re-runs everything because no split/affected-target surface exists.
- R3 (P3, workflow): R2d lifecycle replay (`task record` after files already merged as done) wrote `updated_at`-only churn and never persisted the copied verdicts as `task_run_links`; verdict JSONs under worktree `.spur/run/` are effectively discarded on worktree removal (only survived because manually copied first).
### Solution
#### R1 — kill orphaned daemons in worktree cleanup

**Evidence:** `ps -p 58932,99623` showed two `spur … serve --cwd <worktree> --port 3000/3005` processes, PPID 1, started at batch proof-run times (17:53/18:27). After `kill 58932 99623`, `rm -rf` + `git branch -d` succeeded immediately.

**Fix direction:** In the worktree-removal path (apps/cli batch driver or the skill's WT-4 create-mode block — doc side already updated in c25f0c141), before `git worktree remove`: enumerate PIDs holding the worktree dir (`lsof -t <dir>` or `fuser -k`), kill them, then remove. Prefer failing the removal with a named hint ("worktree in use by PID …") over silent partial deregistration. Consider a `serve` daemon shutdown at proof-run teardown (the process-spawn test helper should reap children). Code side of execution-batch.md:676.

**AC:** A batch whose proof steps spawn `serve` daemons completes `git worktree remove` without manual lsof intervention; a daemon that refuses to die produces a halt report naming the PID/port.

#### R2 — cheap post-merge corpus gate

**Evidence:** `bun run spur-check-new` output: `Ran 6766 tests across 357 files. [125.95s]` then `corpus-check FAILED … 1 new` (A31, other actor's scenario-first commit). After regenerating the baseline (JSON-only change), recheck `task check --corpus` alone took ~36s and passed; full re-run would cost another ~3min for zero new signal.

**Fix direction:** Add a `spur-check-corpus` script (lint + typecheck + `task check --corpus`, no tests) for post-merge corpus acceptance; keep `spur-check-new` as the full pre-push gate. Alternatively a bun `--affected` filter keyed on changed workspaces; split point is package.json:81. Ponytail floor: a 3-line package.json script aliasing the existing commands.

**AC:** After a corpus-only change (baseline regen, task-file edit), a gate path exists that finishes in <60s and catches corpus regressions; documented in AGENTS.md build/verification block.

#### R3 — R2d replay should persist or explicitly discard verdicts

**Evidence:** `task record 0716/0717 --json` returned `{testingWritten: true, reviewWritten: false}` and only bumped `updated_at` (restored via git checkout); `task_run_links` in main DB stayed empty while worktree DB had 4 rows (2 pipeline + 2 lifecycle). The R2d doc offers "replay transitions OR treat batch report as truth" but the replay path silently does neither fully.

**Fix direction:** Decide one contract: (a) `task record --verdict-file` in the invoking tree creates the `task_run_links` rows (import verdict provenance), or (b) R2d drops the replay step entirely — batch report + committed files are the record, delete the replay sentence from execution-batch.md:723. Current middle ground wastes ~10 min per integration and discards evidence.

**AC:** Integration doc states one deterministic disposition; following it leaves no `updated_at` churn and no ambiguity about where verdict evidence lives.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `package.json:80-81,89` — existing `spur-check` / `spur-check-new` composition and the source-local `corpus-check` command.
- `AGENTS.md:150-165` — current build/verification contract documents `bun run corpus-check` and keeps `spur-check-new` comprehensive.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:205-225` — driver loop consumes per-task verdict JSON and emits the batch report.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:387-414` — Step 5 report shape and current non-persistent output contract.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:662-685` — WT-4 create-mode cleanup and the incomplete one-shot holder kill from `c25f0c141`.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:718-729` — contradictory lifecycle replay-or-report disposition.
- `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:16-51` — existing static worktree contract pins to extend.
- Commit `c25f0c1416a5e8426c8c9285d2f23611d7eb1d5e` — provisional daemon-kill and replay-order prose verified in the current history.
### History
