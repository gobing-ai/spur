---
schema_version: 1
name: Order the residual-sweep box check against the record-stage box flip
status: done
template: feature-impl
created_at: 2026-09-27T07:11:28.202Z
updated_at: "2026-10-03T03:20:33.743Z"
feature_id: F96

ac_altitude: task-local
dependencies: ["0958"]
priority: P1
estimate_hours: 4
---

## 0983. Order the residual-sweep box check against the record-stage box flip

### Background

Found during `/sp:dev-run 0967 --auto --next --agent inline --worktree` (run `20445c34-e98e-4928-a30a-a6746f503be3`).

**Symptom.** The `verify` state's residual sweep folded the verdict `PASS` → `PARTIAL` with `blocking=13 deferrable=0`, all 13 items category `unchecked-box`: the task's 5 Requirement boxes, 2 AC boxes and 6 Plan boxes. That downgrade makes the `record → done` guard (`jq -r .verdict … == "PASS"`) unreachable, so the run cannot complete on the normal path.

**Root cause — the fold and the box flip are ordered the wrong way round.**

- `plugins/sp/scripts/residual-scan.ts:318` — `findUncheckedBoxes(taskContent)` scans the **whole** task file; there is no section exemption.
- `plugins/sp/scripts/residual-scan.ts:290` — the deferral exemption deliberately excludes `unchecked-box` (`item.category !== 'unchecked-box'`), so an unchecked box can never be deferred by a `residual-deferrals.json` entry.
- `plugins/sp/scripts/residual-scan.ts:410` — `foldVerdict` downgrades `PASS` → `PARTIAL` whenever `blocking.length > 0`.
- `packages/app/src/services/task-record.ts:189` — `flipVerifiedCheckboxes` (the verdict-driven `[ ]` → `[x]` flip, R2 task 0692) runs inside the **`record`** state.
- `config/workflows/task-pipeline.yaml` — `record` runs after `verify`, and its `record → done` guard requires a `PASS` verdict artifact.

So on the first pass — and on every pass — verify folds `PARTIAL` on a task whose Requirement/AC boxes are still unticked, while the only component that flips them runs afterwards. The verdict artifact already proves those rows (`MET`), so the boxes are *record-owned*, not unresolved work.

**Observed recovery (hand-certification, 4m45s of extra gate time).** Ticked the 13 boxes via `spur task update --section …`, re-captured the proof digest with `inline-run-setup.ts --fingerprint`, re-ran the full gate (`bun run spur-check`, 4m45s), re-ran `residual-scan scan|fold`, then re-bound the verdict with the verify state's `jq` proof block.

**Second-order cost (measured).** The Requirement/AC/Plan boxes are **inside** the proof-input scope: the certified digest moved `sha256:ac78bd41…` → `sha256:d5a73aa2…` purely from box flips, invalidating the gate receipt and forcing the gate to re-run. `## Review` / `## Testing` / `## Solution` writes do *not* move the digest (verified in the same run).

Related prior work: 0949 (scanner modes), 0950 (sweep wired into task-pipeline), 0951 (standalone verify + C6 recovery), 0977 (placeholder review rows).

**Refine corrections (2026-09-27)**

- The verdict can prove Requirement/AC boxes, but the six Plan boxes in the 0967 failure are not record-owned and must remain blockers until completed.
- The scanner runs before record; the corrected design moves the existing scan after record rather than deferring unchecked boxes by section.

### Requirements

- [x] R1. The residual sweep evaluates unchecked boxes after the record stage has applied the verdict-driven Requirement/AC flips. A PASS verdict with all other boxes completed reaches the normal done guard without hand-certification.
- [x] R2. Any box still unchecked after record, including an unproven Requirement/AC box or an unfinished Plan box, remains blocking; none becomes deferrable by section alone.
- [x] R3. The reordered sweep can downgrade the verdict before `record → done`, preserving the fail-closed completion gate and its proof checks.
- [x] R4. A regression test covers both the proven-box pass path and an unproven/Plan-box fail path.
- [x] R5. If the post-record sweep downgrades the verdict, the task's Testing section reflects that final verdict before the run exits.

### Acceptance Criteria

- [x] AC1 — Verdict-proven Requirement/AC boxes are flipped before the sweep and do not block (req: R1)
- [x] AC2 — Unproven Requirement/AC and unfinished Plan boxes still block the done hop (req: R2, R3)
- [x] AC3 — Pipeline order and both outcomes have regression coverage (req: R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Move the existing `residual-scan scan|fold` action from verify to record, immediately after `task record` flips verdict-proven Requirement/AC boxes and before `record → done` evaluates the verdict. Keep `findUncheckedBoxes` and its blocking classification unchanged: the scan reads the actual post-record task file, so it needs no duplicate proof matcher or section-wide exemption. The `record → done` guard already requires PASS and `task check --as done`, and the existing failed edge handles a downgraded verdict.

This task depends on 0958's checkbox-canonical proof fingerprint: record-time flips must not invalidate the registered proof. Plan boxes are not flipped by `task record`; they must be completed before verification or remain a valid blocker. The 0967 run's six unchecked Plan boxes were a separate unfinished-work condition. Update the residual-sweep design satellite as the rule owner.
If the fold changes PASS to PARTIAL, re-record the task's Testing section from the final artifact before taking the failed edge; a failed task must not retain a stale PASS Testing narrative.

### Plan

- [x] Confirm the current verify and record action order and the existing record-to-done guard.
- [x] Move the scanner's scan/fold action after `task record` in the record state; leave its classification unchanged.
- [x] Cover a PASS verdict with proven R/AC boxes and already-complete Plan, plus unproven R/AC and open Plan cases; assert a downgraded verdict is re-recorded in Testing.
- [x] Update the residual-sweep design satellite, run focused tests and `bun run spur-check`.

### Solution

Moved the residual sweep from verify to record so it reads the post-record task file; classification unchanged (scan/fold only re-ordered).

- `config/workflows/task-pipeline.yaml:17-19` — removed the verify scan+fold action; verify now binds the verdict straight to the proof digest (0967 root cause: a pre-record fold folded unticked-but-verdict-proven boxes the `record` stage had not flipped yet).
- `config/workflows/task-pipeline.yaml:804` — record gains the scan+fold hard action after `task record` (box flips) and feature sync, before `record → done`; any box still unchecked post-record (unproven R/AC, open Plan) stays blocking and fails the done guard closed (R1–R3).
- `config/workflows/task-pipeline.yaml:820` — R5 soft step: on a folded non-PASS verdict, re-runs `task record` from the final artifact so Testing carries the downgraded verdict (idempotent; no-op on PASS; soft exit 0 so the failed state still renders the recovery report — a hard failure would bypass it).
- `plugins/sp/tests/task-pipeline-resilience.test.ts:334` — reordered-sweep coverage: verify no longer sweeps (R1), record orders fold after the flips and before the PASS+proof done guard (R3), behavioral pass/fail paths through the real scanner (R2), and the R5 re-record no-op/act split.
- `docs/design/task-residual-sweep.md` — rule-owner update: sweep runs in record, downgrade fails at the done hop (no remediation hop for record-owned boxes), Testing re-record rule, pipeline-flow diagram, terminal-path table (failed sweep leaves the task `testing`).
- `plugins/sp/skills/next-router/references/routing-table.md:116` + `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md:246` — C6 row and the help section reworded for the record-stage sweep.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:17` ('record scans and folds residuals AFTER task record flips the verdict-proven') and `:751` ('scan moved here from verify: it must read the task file AFTER task record'); verdict-proven flips via `packages/app/src/services/task-record.ts:375` flipVerifiedCheckboxes (anchor shifted from record-time :209, function present). Re-read this run. |
| R2 | MET | Classification unchanged by the reorder: unchecked boxes remain blocking (plugins/sp/lib/residual-scan.generated.mjs classify, core of former residual-scan.ts:279); no section-based deferral. Behavioral proof: resilience test open-box downgrade path (test :411 expects residual-sweep fail) — 33 pass / 0 fail this turn. |
| R3 | MET | Fold runs in the record state before the record→done guard (PASS + proof digest + task check), pinned by plugins/sp/tests/task-pipeline-resilience.test.ts:373 (fold located in record shell) — 33/0 fresh this turn. |
| R4 | MET | Both paths through the real scanner covered: proven-box pass (test :395 residual-sweep pass) and unproven-box fail (test :411 residual-sweep fail); task-pipeline-resilience.test.ts 33 pass / 0 fail fresh this turn. |
| R5 | MET | `config/workflows/task-pipeline.yaml:761-772` '(e) F96 R5 (0983): a sweep downgrade must reach the task record — re-record' shell: non-PASS verdict → `task record <wbs> --solution-from-diff --transition testing --no-lifecycle`, failure prints re-run command. Re-read this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | task-pipeline-resilience.test.ts proven-box pass path (33 pass / 0 fail fresh this turn; suite grew 25→33 since record, all green). |
| AC2 | MET | test | Same fresh run: open-box fail path (:411) + fold-before-guard pin (:373). |
| AC3 | MET | test | Order + both-outcome regression coverage: task-pipeline-resilience.test.ts 33/0 fresh; packages/domain lifecycle-drift.test.ts 25 pass / 0 fail (179 expects) fresh this turn. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0983

**Scope:** working-tree diff of task 0983 (7 files: `config/workflows/task-pipeline.yaml`, `docs/design/task-residual-sweep.md`, `plugins/sp/tests/task-pipeline-resilience.test.ts`, `packages/domain/tests/planning/lifecycle-drift.test.ts`, `plugins/sp/skills/next-router/references/routing-table.md`, `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md`, task file)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

Re-review (disposition pass). Functional traceability remains PASS (R1–R5 all MET, fresh evidence below), and the prior pass's sole blocker (P2: standalone verify folds before record) is now dispositioned via the option that finding itself offered — follow-up 0987 is filed (backlog; R1 `/sp:dev-verify`, R2 `/sp:dev-verifyall`, R3 rule-owner doc, R4 standalone ordering regression pin; citations verified this run: `plugins/sp/commands/dev-verify.md:43-46`, `plugins/sp/commands/dev-verifyall.md:75-78`), and the rule-owner doc no longer blesses the pre-record order (`docs/design/task-residual-sweep.md:66` — "tracked by follow-up 0987, not blessed here"). The defect stays live on the standalone surface until 0987 lands (residual risk below); it no longer blocks this task's pipeline-scope gate. No diff drift since the prior pass: anchors re-confirmed at `config/workflows/task-pipeline.yaml:800` (sweep), `:809` (R5 soft re-record), `:1161-1177` (done guard).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Disposition | Location |
|---|----------|-----------|---------|-------------|----------|
| 1 | P4 (advisory, dispositioned) | correctness | Standalone verify/verifyall: standalone verify/verifyall still run `residual-scan scan`+`fold` BEFORE `spur task record`, so a clean task with unticked-but-verdict-proven R/AC boxes folds PASS→PARTIAL pre-flip (the 0967 root cause surviving on the standalone surface) and `foldVerdict` never restores PARTIAL→PASS. Disposition: follow-up 0987 filed with rationale (R1–R4 cover both surfaces, the rule-owner doc, and the ordering pin); `docs/design/task-residual-sweep.md:66` explicitly unblesses the order. Non-blocking for 0983; fixed by 0987. | Resolved (F96 0987) — post-record sweep shipped on both standalone surfaces (`plugins/sp/commands/dev-verify.md:43-52`, `dev-verifyall.md:75-79`) with ordering pins `plugins/sp/tests/task-pipeline-resilience.test.ts:688-700` (33/0 re-run during the F96 verifyall audit, 2026-10-02). | `plugins/sp/commands/dev-verify.md:43-46` |
| 2 | P4 (advisory) | correctness | R5 step reads `jq -r .verdict`; a valid-JSON artifact missing the field yields literal `null`, which passes `-n` and `!= PASS`, triggering a spurious re-record. Harmless (record is idempotent, soft exit 0); every real artifact carries `.verdict` (verify-answer-lint enforces). | Open (accepted P4 — harmless by construction; every real artifact carries `.verdict`). | `config/workflows/task-pipeline.yaml:809` |
| 3 | P4 (advisory) | architecture | The fold-after-flip invariant is asserted only for the pipeline surface (`plugins/sp/tests/task-pipeline-resilience.test.ts:348-364`, `packages/domain/tests/planning/lifecycle-drift.test.ts:169-181`); the standalone ordering tripwire is owned by 0987 R4 ("a regression test or scripted check pins the standalone ordering for both surfaces") and lands with it. | Resolved (F96 0987) — the standalone ordering tripwire landed as the 0987 R4 pins (`plugins/sp/tests/task-pipeline-resilience.test.ts:688-700`, incl. the record < scan < fold < re-record order), green in the audit re-run. | `plugins/sp/tests/task-pipeline-resilience.test.ts:339-347` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:790-800` — scan+fold is a record onEnter action ordered after the `task record` `command.gate` (id `:767`; flips via `flipVerifiedCheckboxes` `packages/app/src/services/task-record.ts:201`) and feature sync (`:785-789`); verify no longer sweeps (`:719-735`); ordering asserted at `plugins/sp/tests/task-pipeline-resilience.test.ts:348-359` and pass reachability proven behaviorally at `:366-396` |
| R2 | MET | Classification untouched (scanner not in this diff; re-verified this run): `plugins/sp/scripts/residual-scan.ts:290` (deferral exemption excludes `unchecked-box`), `:221` (`findUncheckedBoxes` over the whole file), `:387` (`foldVerdict`); open Plan box → PARTIAL with `residual-sweep: fail` at `plugins/sp/tests/task-pipeline-resilience.test.ts:377-413` |
| R3 | MET | `config/workflows/task-pipeline.yaml:1161-1177` — record→done guard re-asserts `task check --as done` + `.verdict == PASS` + `.proof.digest == $proofDigest` (`:1177`); record→failed names the post-record downgrade (`:1178-1181`); guard contents asserted at `plugins/sp/tests/task-pipeline-resilience.test.ts:355-364` |
| R4 | MET | `plugins/sp/tests/task-pipeline-resilience.test.ts:366-413` — proven-box pass path + open-box fail path through the real scanner; fresh run: 25 pass / 0 fail |
| R5 | MET | `config/workflows/task-pipeline.yaml:802-809` — soft re-record from the post-fold artifact; flags legal (`apps/cli/src/commands/task.ts:1184` `--solution-from-diff`) and `--transition testing` is an idempotent no-op when already `testing` (`packages/app/src/services/task-service.ts:1500-1504`); no-op/act split tested via spurBin canary at `plugins/sp/tests/task-pipeline-resilience.test.ts:415-438` |
| AC1 | MET | R1/R2 pass-path evidence: flipped task keeps `verdict: PASS` + `residual-sweep: pass` (`plugins/sp/tests/task-pipeline-resilience.test.ts:385-396`) |
| AC2 | MET | R2 fail path + guard: open Plan box → PARTIAL (`:398-413`) and the PASS-only done guard (`config/workflows/task-pipeline.yaml:1170-1177`) |
| AC3 | MET | R4/R5 tests + lifecycle drift guard at 5 record actions with certification FIRST (`packages/domain/tests/planning/lifecycle-drift.test.ts:169-181`); 25 pass / 0 fail fresh |

Design conformance: 4/4 design claims DONE (post-record move, unchanged classification, satellite update, R5 re-record) — no deviations, no scope creep.

Fresh verification evidence (this run): `bun test plugins/sp/tests/task-pipeline-resilience.test.ts` → 25 pass / 0 fail (172 expects); `bun test packages/domain/tests/planning/lifecycle-drift.test.ts` → 25 pass / 0 fail (183 expects); `bun test packages/app/tests/workflow/wayfinder-resolution.test.ts packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` → 38 pass / 0 fail (242 expects).

Residual risk: until 0987 ships, standalone `/sp:dev-verify` / `/sp:dev-verifyall --next` of a clean task with unticked-but-verdict-proven R/AC boxes still downgrades PASS→PARTIAL; recovery is the router C6 HITL STOP (deterministic, self-evidenced residue), not silent corruption.

**Next:** No blocker on 0983 — implement 0987 to clear finding 1; findings 2–3 advisory.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T07:12:01.260Z backlog → todo (system)
- 2026-09-27T19:55:45.594Z todo → wip (system)
- 2026-09-27T23:25:44.684Z wip → testing (system)
- 2026-09-27T23:28:39.431Z testing → done (system)

