---
schema_version: 1
name: "Fix E31 integration friction: orphaned serve daemons defeat worktree removal; corpus gate runs full test suite; R2d replay discards verdicts"
status: done
template: issue
created_at: 2026-08-30T02:21:06.464Z
updated_at: "2026-08-30T03:23:09.711Z"
feature_id: A6
ac_altitude: task-local
---

## 0720. Fix E31 integration friction: orphaned serve daemons defeat worktree removal; corpus gate runs full test suite; R2d replay discards verdicts

### Background

Session 2026-08-29/30 — E31 dev-runall batch (0716, 0717) and bf8c worktree integration onto main. The batch itself was clean (2 PASS, 3 commits, green worktree verification); integration consumed about 2h20m, dominated by avoidable cleanup and evidence-reconciliation work.

Ready-depth premise verification narrowed the original three findings to two implementation gaps. `bun run corpus-check` already exists as the corpus-only validation path and is documented in `AGENTS.md`; R2 is therefore a verified guardrail, not new work. Commit `c25f0c141` added provisional WT-4 and R2d prose, but it did not close either remaining gap: cleanup ignores kill failure and cannot report surviving PID/port details, while R2d still offers mutually incompatible replay-or-report outcomes.

### Requirements

- [x] R1. Before a create-mode `--worktree` batch removes or deregisters its worktree, cleanup must find processes whose CWD is the exact worktree, terminate them with a bounded TERM-to-KILL sequence, and re-query. If any holder remains, the batch must retain the worktree and branch and report every surviving PID plus each discoverable listening port; it must not continue to remove, prune, or delete the branch.
- [x] R2. Reuse the existing `bun run corpus-check` command as the corpus-only post-merge validation path. Do not add `spur-check-corpus` or change `spur-check-new`, which remains the comprehensive validation plus corpus sweep.
- [x] R3. A worktree batch must persist its structured batch report and per-task verdict JSON artifacts under the invoking tree's `.spur/run/` before create-mode cleanup. After a green merge, committed task files are authoritative for lifecycle status and those invoking-tree artifacts are authoritative for batch/verdict evidence; the driver must not replay `task update`, replay `task record`, import `task_run_links`, or create timestamp-only corpus churn.

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

- [x] P1 (R1, R3) Add failing static assertions to `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` for invoking-tree report/verdict persistence, fail-closed holder cleanup, and removal of lifecycle replay instructions.
- [x] P2 (R3) Update Step 5 of `execution-batch.md` to persist the batch report and copy per-task verdict artifacts to the frozen invoking-tree paths before any worktree removal; route persistence failure to WT-5.
- [x] P3 (R1) Replace the WT-4 one-shot kill with exact-path holder enumeration, bounded TERM/wait/KILL/re-query behavior, and PID/port halt reporting before any remove/prune/branch deletion.
- [x] P4 (R3) Rewrite the lifecycle-DB disposition as the selected no-replay contract and remove the contradictory replay/order recovery prose.
- [x] P5 (R2) Verify only: inspect `package.json` and `AGENTS.md`, run `bun run corpus-check`, and confirm no duplicate script or instruction was introduced.
- [x] P6 Run the targeted contract test from `plugins/sp`, then `bun run spur-check`, `bun run corpus-check`, `bun run apps/cli/src/index.ts task check 0720 --json`, and `git diff --check`.

### Root Cause

- R1 (P2, workflow): Orphaned `serve` proof daemons (PPID 1, ports 3000/3005) kept the removed worktree as CWD; `git worktree remove` failed ENOTEMPTY, `rm -rf` failed os error 66, while `git worktree prune` had already deregistered the tree — three confusing partial states before lsof revealed the daemons.
- R2 (P2, workflow): The post-merge gate `bun run spur-check-new` runs the full 6766-test suite (~126s) plus corpus sweep; rerunning it after a baseline-only JSON fix re-runs everything because no split/affected-target surface exists.
- R3 (P3, workflow): R2d lifecycle replay (`task record` after files already merged as done) wrote `updated_at`-only churn and never persisted the copied verdicts as `task_run_links`; verdict JSONs under worktree `.spur/run/` are effectively discarded on worktree removal (only survived because manually copied first).

### Solution

#### Implemented (2026-08-30, stage: implement)

Two files changed, per the Design's WHAT/WHERE items 1–4; R2 verified-only (no change needed).

**1. `plugins/sp/skills/spur-dev/references/execution-batch.md`**

- **Step 5 (R3):** added the `**Evidence persistence (worktree batches — task 0720 R3).**`
  paragraph — the batch report persists to `.spur/run/worktree-<marker-id>-batch-report.md`, each
  task's `.spur/run/<wbs>-verdict.json` is copied to
  `.spur/run/worktree-<marker-id>-verdicts/<wbs>-verdict.json`, report references use the persisted
  invoking-tree paths. Evidence persistence precedes destructive cleanup; persistence failure
  routes to **WT-5** so a green batch can never destroy its own evidence. Reuse mode persists the
  report too.
- **WT-4 (R1):** replaced the one-shot `lsof … | xargs -r kill` with a bounded CWD-holder cleanup:
  resolve the exact absolute worktree path (`WT_PATH="$(cd ../<worktree-dir> && pwd)"`), enumerate
  holders with `lsof -t +D "$WT_PATH"` (tree walk; plain `-t <dir>` matches only the dir),
  `kill -TERM $HOLDERS`, bounded 6×1s wait, `kill -KILL "$SURVIVORS"`, re-query. Only an EMPTY
  holder set proceeds to `git worktree remove` + `git branch -d`; survivors halt
  (`worktree still held by PID(s)`, `exit 1`) and route to WT-5 before any prune/remove/branch
  delete. Listening-port discovery is best-effort (`lsof … -sTCP:LISTEN` over the survivor set)
  and must never hide the PIDs.
- **Guard prose:** merged the zero-commit (0701 R1) and holder (0720 R1) guard paragraphs into one
  WT-5 fall-through statement with the PID-mandatory / port-best-effort contract.
- **R2d:** replaced the replay-or-report paragraph with one no-replay contract ("One contract, no
  alternatives"): committed task files own lifecycle state (the committed task file is
  authoritative — no post-merge `spur task update`/`spur task record` replay; replay is removed,
  not an option), the persisted invoking-tree artifacts own evidence, per-worktree lifecycle DB
  rows intentionally do not travel, and no timestamp-only corpus churn. All replay instructions
  (`Re-sync`, `Record-first ordering`, `task update <wbs>`, `spur task record <wbs>`) are gone
  from the file (grep-verified zero hits).

**2. `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`**

- Appended `describe('execution-batch spec contract (task 0720)')` with four tests:
  Step 5 evidence-persistence pins; WT-4 bounded-cleanup pins (TERM/wait-loop/KILL-survivors/
  re-query/fail-closed empty-set/PID+port halt shape); one-shot-kill absence (`xargs`,
  `lsof+fuser`); R2d no-replay pins plus replay-instruction absence pins. The pre-existing 0701
  describe block is untouched and still green (including its
  `committed task file is authoritative` pin).

**R2 — verify-only, confirmed:** `package.json:89` defines `corpus-check`
(`task check --corpus`), `AGENTS.md:159` documents it; no edit made, `git status` clean for both
files.

**Probe:** `cd plugins/sp && bun test tests/dogfood-testing/execution-batch-contract.test.ts` —
11 pass / 0 fail (7 pre-existing 0701 pins + 4 new 0720 pins), 38 expect() calls.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — bounded CWD-holder cleanup before worktree removal; retain + report on survivors | MET | execution-batch.md:695-736: exact-path resolve (`WT_PATH="$(cd ../<worktree-dir> && pwd)"` :697), holder enumeration `lsof -t +D "$WT_PATH"` :706, `kill -TERM $HOLDERS` :708 (unquoted, word-splits PID list), bounded 6x1s wait loop :709-712, `kill -KILL $SURVIVORS` :715 (unquoted — review P2-1 fixed), fail-closed FINAL re-query :719 gates `git worktree remove` :727 / `git branch -d` :728; survivors -> halt report `worktree still held by PID(s): $FINAL ... listening: $PORTS` :724 + `exit 1` -> WT-5 :725-726; retention prose with PID-mandatory/port-best-effort :731-736. Review P3-2 comment fix applied :698-705 (open-fd scope, iterations-not-wall-clock). |
| R2 — reuse existing `bun run corpus-check`; no new alias, no change to `spur-check-new` | MET | package.json:89 `"corpus-check": "bun run apps/cli/src/index.ts task check --corpus"` (corpus sweep only — no root test suite); package.json:81 `spur-check-new` composes it after the comprehensive checks, unchanged; AGENTS.md:159 documents it. `git status --porcelain -- package.json AGENTS.md` -> empty (zero-diff = pass condition). `grep spur-check-corpus` -> 0 hits in package.json/AGENTS.md/plugins/sp/package.json. Probe: `bun run corpus-check` ran the sweep without the test suite and failed closed on new findings (all pre-existing, task 0719 — see note). |
| R3 — persist batch report + verdict JSON to invoking tree before create-mode cleanup; no post-merge lifecycle replay | MET | execution-batch.md:424-440 Step 5 evidence-persistence contract (report -> `.spur/run/worktree-<marker-id>-batch-report.md` :429; verdicts -> `.spur/run/worktree-<marker-id>-verdicts/<wbs>-verdict.json` :430-431; report references persisted paths :432-433; persistence failure -> WT-5 :436-438; reuse-mode persistence :439-440); WT-4a ordering comment :689-691; R2d no-replay contract :769-786 ("One contract, no alternatives" :771; committed files own state :773-777; persisted artifacts own evidence :778-781; DB rows intentionally do not travel / no task_run_links import :782-783; no timestamp churn / no `git checkout` repair :784-786). Replay instructions absent: grep `xargs |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — daemon-holding worktree removed cleanly (TERM -> bounded wait -> KILL; empty set before remove; survivor -> WT-5 with PID/port) | MET | test | TERM/wait/KILL/re-query sequence pinned at test:62-75 (`kill -TERM $HOLDERS`, `for _ in 1 2 3 4 5 6`, `kill -KILL $SURVIVORS`); fail-closed gate (`only an EMPTY holder set may proceed`, `worktree still held by PID(s)`) pinned test:71-73 and present execution-batch.md:720-726 before remove/branch-delete :727-728; PID-mandatory/port-best-effort prose :735-736. Probe: `cd plugins/sp && bun test tests/dogfood-testing/execution-batch-contract.test.ts` -> 11 pass / 0 fail, 38 expect() calls. |
| R2 — corpus-only fast path stays the single path (no root suite; new findings fail; no duplicate script/instruction) | MET | command | `bun run corpus-check` executed the corpus sweep (no test suite invoked) and exited 1 on new findings — fail-closed behavior demonstrated. Zero-diff on package.json/AGENTS.md; no `spur-check-corpus` anywhere. |
| R3 — deterministic evidence disposition (invoking-tree report + verdicts; referenced paths; no replay/timestamp churn/task_run_links) | MET | test | Persistence pins test:54-60 (paths + WT-5 routing + "can never destroy its own evidence"); no-replay pins test:82-91 including negative pins (`not.toContain('Re-sync')`, `not.toContain('task update <wbs>')`, `not.toContain('spur task record <wbs>')`, `not.toContain('Record-first ordering')`); spec grep confirms zero replay instructions remain. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Stage:** review (code-verification: functional traceability + SECUA + architecture), 2026-08-29.
**Scope:** uncommitted diff — task 0720 corpus file, `plugins/sp/skills/spur-dev/references/execution-batch.md`, `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`.
**Verification run:** `cd plugins/sp && bun test tests/dogfood-testing/execution-batch-contract.test.ts` → 11 pass / 0 fail (38 expects); whole dogfood dir 87 pass / 0 fail; `task check 0720 --json` → PASS, zero findings.

#### Functional traceability

- **R1 (holder cleanup)** — Traceable, one defect: WT-4b enumerates holders, TERM-first, bounded wait, KILL survivors, halt-report (execution-batch.md:695-722). Darwin probe: `lsof -t +D` matches CWD holders (core mechanism works); TERM line unquoted and correct. Defect P2-1 below: the KILL line cannot fire for multi-PID survivor sets — the canonical E31 case (two daemons).
- **R2 (corpus gate)** — Verified as intentional no-change: `package.json` corpus-check composition untouched (git status clean); `AGENTS.md:150-165` already documents `bun run corpus-check`. Correct to leave alone.
- **R3 (evidence persistence + R2d)** — Traceable: Step 5 paragraph (execution-batch.md:424-440) persists the batch report under the invoking tree before any WT-4 removal and explicitly covers reuse mode; WT-4a inline comment references it; R2d rewrite (764-784) removes the replay alternative, leaving merge-only propagation. Contract test pins the persistence callout and replay-prose absence — 11/11 pass.
- **AC scenarios** — halt-report names PIDs (720-722); persistence-before-removal pinned; R2d single disposition pinned by negative tests.


#### Findings table

| Priority | Finding | Location | Status |
|----------|---------|----------|--------|
| P2 | `kill -KILL "$SURVIVORS"` passes multi-PID list as one arg; KILL never fires for ≥2 survivors (canonical E31 case) | execution-batch.md:711 | Fixed — unquoted, pin updated (test:66) |
| P3 | Holder-scope comment mislabels `lsof +D` as CWD-only; "~6s" bounds iterations, not wall-clock | execution-batch.md:698-708 | Fixed — comment rewritten (698-705) |
| P3 | References anchor `:718-729` drifted off the R2d paragraph after insertions | task file References | Fixed — repointed to `:769-789` |

#### Findings (detail)

**P2-1 — `kill -KILL "$SURVIVORS"` passes a multi-PID list as one argument (execution-batch.md:711)**
Quoted expansion of a newline-separated PID list hands bash a single `PID1\nPID2` argument. Repro: `SURV=$'99999\n99998'; kill -KILL "$SURV"` → `kill: 99999 99998: arguments must be process or job IDs` (rc=1, nothing signaled). For any survivor set with ≥2 PIDs — exactly the E31 canonical case — KILL never lands, the re-query stays non-empty, and the block halts into WT-5. Degradation is fail-closed (worktree retained, no data loss), but the R1 AC "TERM → bounded wait → KILL only if needed" is unimplementable as written: the KILL step is dead code for multi-holder sets. Fix: unquote, mirroring the correct TERM line at 704 — `kill -KILL $SURVIVORS 2>/dev/null`.

**P3-2 — holder-scope comment mislabels `lsof +D` as CWD-only; wait is bounded per-iteration, not per-second (execution-batch.md:698-701, 705-708)**
`+D` reports any process with an open file/fd under the tree, not only CWD holders — darwin probe: plain `+D` matched 3 PIDs where the cwd-only variant (`lsof -t -a -d cwd +D`) matched 2. Over-match errs toward removal success (fail-safe) but the comment's "Holders = processes whose CWD is inside the worktree" does not describe the enumeration it sits on. Also: `+D` is a full-tree walk — with WT-2-installed node_modules present, each call walks the whole tree and the block issues up to 9 calls (initial + ≤6 wait ticks + survivors + final), so "bounded wait (~6s)" bounds iterations, not wall-clock. Behavior stays correct and terminating; fix is comment wording + dropping or qualifying the "~6s".

**P3-3 — References anchor `execution-batch.md:718-729` now points at the wrong subject (task file References)**
This patch's insertions shifted the spec: the R2d replay-or-report paragraph the anchor cited now lives at 764-784; `718-729` now lands inside the new WT-4b KILL/halt block. `:662-685` (WT-4 cleanup) drifted ~11 lines but still lands on its cited subject. `task check 0720` passes today, yet the spec's own gate-preflight note requires repointing shifted anchors in the same commit via `spur task update --section`; repoint before commit.

#### Residual risk

- PID-reuse TOCTOU between lsof enumeration and KILL (1s window) — pre-existing class, below proportionate-rigor bar for a spec contract.
- Negative global pins (`not.toContain('xargs')`, `not.toContain('Re-sync')`) can false-trip on future unrelated prose; accepted per Design item 4 (absence pins mandated).
- Reuse-mode code block carries no inline WT-4a persistence callout; the Step 5 paragraph is SSOT and explicitly covers reuse mode — acceptable.

#### Architecture

Sound: evidence-before-destruction ordering (WT-4a persists before WT-4b removes), single ownership rule (the flag removes only what it created), marker-id namespacing reuses WT-3's scheme, R2d collapses the replay-or-report fork into one deterministic contract. Consumers clean: super-planner.md delegates to execution-batch.md as SSOT; cross-cutting.md:496-499 carve-out and flag-glossary §--worktree remain accurate.

#### Disposition

**fix-needed.** One P2 (unquote `$SURVIVORS` at execution-batch.md:711 — one-word fix for the implementer) plus two same-commit touch-ups (holder-scope comment wording; References anchor repoint). No test currently pins the KILL quoting; adding one while fixing is optional, not blocking.

### References

- `package.json:80-81,89` — existing `spur-check` / `spur-check-new` composition and the source-local `corpus-check` command.
- `AGENTS.md:150-165` — current build/verification contract documents `bun run corpus-check` and keeps `spur-check-new` comprehensive.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:205-225` — driver loop consumes per-task verdict JSON and emits the batch report.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:387-414` — Step 5 report shape and current non-persistent output contract.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:662-685` — WT-4 create-mode cleanup and the incomplete one-shot holder kill from `c25f0c141`.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:769-789` — contradictory lifecycle replay-or-report disposition.
- `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:16-51` — existing static worktree contract pins to extend.
- Commit `c25f0c1416a5e8426c8c9285d2f23611d7eb1d5e` — provisional daemon-kill and replay-order prose verified in the current history.

### History

- 2026-08-30T02:53:43.341Z todo → wip (system)
- 2026-08-30T03:23:02.346Z wip → testing (system)
- 2026-08-30T03:23:09.711Z testing → done (system)
