---
schema_version: 1
name: Reuse check receipts across task-pipeline stages as a measured candidate
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.004Z
updated_at: "2026-09-26T00:58:55.218Z"
feature_id: D64
priority: P2
tags:
  - workflow
  - checks
  - promotion

dependencies: ["0938", "0939"]
estimate_hours: 4
---

## 0940. Reuse check receipts across task-pipeline stages as a measured candidate

### Background

Implements: R7 — The comprehensive check runs once at the quality boundary; R4 — Workflow shape changes are accepted only on measured benefit. docs/design/workflow-catalogue-refactor.md §4 and §7 (check dedup candidate).

**Refine corrections (2026-09-23)**

1. *verify and record do not re-run the gate.* The claim was that `test-recheck`, `verify` and `record` re-run the quality gate. In `config/workflows/task-pipeline.yaml`, `verify` (line 470) and `record` (line 540) only read `<wbs>-test-gate.status` and `<wbs>-verdict.json` (lines 538, 661–728). The gate executes only at `test` (line 341) and `test-recheck` (line 416).
2. *precheck is already structural.* `precheck` already runs only size/evidence status plus `spur task check`. The original R2 is already true: it becomes a regression assertion, not a change.
3. *Recheck is already partly de-duplicated.* `test-recheck` already runs probe-then-full (0587 R3). A red `gateProbeCmd` skips the full gate. `/sp:dev-fixall --gate-log` already skips its own confirming gate (`dev-operations.md` around line 540).
4. *Where the duplication actually is:*
   - Model stages re-run tests by checklist instruction: `plugins/sp/skills/spur-dev/references/gate-checklists.md:93` ("Tests pass (`bun run test`)") and `plugins/sp/skills/code-verification/references/secu-review.md:85` ("All tests pass (`bun run test` exits 0)"). The review `agent.run` executes these on an unchanged tree.
   - `test-recheck` runs a full gate even when the fix pass produced no tracked-source change, meaning the recaptured `proofDigest` equals the digest of the last FAIL.

### Requirements

- [x] R1. `gate-checklists.md` (review gate) and `secu-review.md` replace "run `bun run test`/`bun run lint`" with "confirm `.spur/run/<wbs>-check-receipt.json` via `quality-gate.ts status` reports `reuse: true` for the current digest; run `bun run spur-check` only when it reports stale or missing". A model stage never re-runs the full chain on a reusable receipt.
- [x] R2. At `test-recheck`, when the recaptured `proofDigest` equals the `inputDigest` of a `status: FAIL` full receipt, the gate is skipped. The stage writes `FAIL` to `-test-gate.status` with a `no-progress` line in the gate log and routes through the existing FAIL transitions. Attempts still count, so the existing cap still bounds the loop.
- [x] R3. Every reuse or skip emits a `check.reused` or `check.skipped-no-progress` line in the gate log and the action result `data`, identically on inline and subprocess surfaces, because both run the same `quality-gate.ts`.
- [x] R4. Regression assertion: `precheck` executes no `qualityGateCmd`, and `verify`/`record` execute no gate command. A composition-baseline or YAML test fails if one is added.
- [x] R5. A `config/workflow-candidates.json` record `check-dedup-task-pipeline` with:
  - `canonical: task-pipeline`;
  - `delta.baselineAgentRunCount` from the 0938 baseline;
  - a deadline 60 days out.

  Its verdict cites 0938 wall-time deltas for `test-recheck` and `review`. If it does not beat the baseline, it is reverted (ADR-076).

### Acceptance Criteria

- [x] AC1 — The comprehensive check runs once at the quality boundary
- [x] AC2 — Workflow shape changes are accepted only on measured benefit

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:57.032Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:26:33.814Z

**Refine decisions — 2026-09-23 (ready depth)**

- **Dedup targets are model-stage checklists and no-progress rechecks.** verify, record and precheck never ran the gate. That was a premise error in the original task.
- **No new YAML states.** The recheck skip lives in `quality-gate.ts`, which both surfaces already share.
- **Depends on 0938 (baseline) and 0939 (receipt).** 0937 is transitive.
- **Estimate: 4h** (plus shadow-run wall time).

### Design

**Approach.**
- *Recheck skip.* Add a pure check in `quality-gate.ts` recheck mode, before the probe: read the receipt, and if `status == FAIL && inputDigest == env.proofDigest`, do the no-progress FAIL write. It uses 0939's `readReceiptStatus` helper and needs no YAML change: the state already passes `proofDigest`.
- *Model-stage dedup.* Edit only the two reference docs. Review keeps its full-gate-before-review invariant because the `test → review` and `test-recheck → review` guards still read a PASS that only the full gate writes.

**Frozen names:**
- candidate id `check-dedup-task-pipeline`;
- log markers `check.reused`, `check.skipped-no-progress`.

**Invariants:**
- `review` is entered only after a full PASS for the current digest.
- The attempt cap is unchanged.
- The soft-fail exit-0 contract holds.

**Rejected alternatives:**
- Removing `test-recheck`, which loses protection after fix edits.
- Adding new YAML states, which gains nothing because the decision lives in the gate script.
- Having verify/record read receipts, which they don't need because they don't run the gate.

**Anti-patterns:**
- Reusing a `light` receipt for review.
- Comparing against a digest captured before `test-fix`.

**Target.** Measured `test-recheck` wall time on no-progress loops drops to about the probe cost. Review `agent.run` duration is non-increasing versus the 0938 baseline.

### Plan

1. Recheck no-progress branch in `quality-gate.ts`, with a test in `plugins/sp/tests/quality-gate-receipt.test.ts` covering: FAIL receipt with the same digest → skip; different digest → normal; PASS receipt → normal recheck.
2. Edit `gate-checklists.md:93` and `secu-review.md:85` to use the receipt. Run `bun run plugin-smoke`.
3. R4 regression test in `packages/app/tests/workflow/` (a resolved-facts or YAML scan of the `precheck`, `verify` and `record` states for `qualityGateCmd`/`quality-gate.ts`).
4. Candidate record, then run `bun scripts/spur-dev.ts promotion` validation.
5. After shadow runs, evaluate using the 0938 report and record the verdict.
6. Run `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:317` |
| `packages/app/src/index.ts:321` |
| `packages/app/src/index.ts:733` |
| `packages/app/src/index.ts:764` |
| `packages/app/src/index.ts:918` |
| `packages/app/src/services/inline-run-setup.ts:311` |
| `packages/app/src/services/inline-run-setup.ts:33` |
| `packages/app/src/services/inline-run-setup.ts:43` |
| `packages/app/src/services/workflow-service.ts:1913` |
| `packages/app/src/services/workflow-service.ts:1949` |
| `packages/app/src/services/workflow-service.ts:2201` |
| `packages/app/src/services/workflow-service.ts:2746` |
| `packages/app/src/services/workflow-service.ts:3` |
| `packages/app/src/services/workflow-service.ts:51` |
| `packages/app/src/services/workflow-service.ts:65` |
| `packages/app/src/services/workflow-service.ts:69` |
| `packages/app/src/services/workflow-service.ts:699` |
| `packages/app/src/services/workflow-service.ts:78` |
| `packages/app/src/services/workflow-service.ts:802` |
| `packages/app/src/services/workflow-service.ts:81` |
| `packages/app/src/services/workflow-service.ts:963` |
| `packages/app/src/services/workflow-service.ts:971` |
| `packages/app/src/workflow/action-trace.ts:178` |
| `packages/app/src/workflow/action-trace.ts:188` |
| `packages/app/src/workflow/action-trace.ts:284` |
| `packages/app/src/workflow/action-trace.ts:294` |
| `packages/app/src/workflow/action-trace.ts:41` |
| `packages/app/src/workflow/actions/agent-run.ts:1292` |
| `packages/app/src/workflow/actions/agent-run.ts:195` |
| `packages/app/src/workflow/actions/agent-run.ts:206` |
| `packages/app/src/workflow/actions/agent-run.ts:241` |
| `packages/app/src/workflow/actions/agent-run.ts:246` |
| `packages/app/src/workflow/actions/agent-run.ts:257` |
| `packages/app/src/workflow/actions/agent-run.ts:30` |
| `packages/app/src/workflow/actions/agent-run.ts:407` |
| `packages/app/src/workflow/actions/agent-run.ts:645` |
| `packages/app/src/workflow/builtins.ts:104` |
| `packages/app/src/workflow/builtins.ts:14` |
| `packages/app/src/workflow/builtins.ts:2` |
| `packages/app/src/workflow/builtins.ts:29` |
| `packages/app/src/workflow/builtins.ts:57` |
| `packages/app/src/workflow/builtins.ts:74` |
| `packages/app/src/workflow/decision-hitl-responder.ts:228` |
| `packages/app/src/workflow/lifecycle-adapter.ts:243` |
| `packages/app/src/workflow/observability.ts:26` |
| `packages/app/src/workflow/observability.ts:472` |
| `packages/app/tests/services/inline-run-setup.test.ts:15` |
| `packages/app/tests/services/inline-run-setup.test.ts:3` |
| `packages/app/tests/services/inline-run-setup.test.ts:649` |
| `packages/app/tests/workflow/builtins.test.ts:34` |
| `packages/config/src/index.ts:771` |
| `packages/config/src/loader.ts:299` |
| `packages/config/tests/loader.test.ts:1112` |
| `packages/config/tests/loader.test.ts:30` |
| `packages/domain/src/dao/run-dao.ts:121` |
| `packages/domain/src/dao/run-dao.ts:127` |
| `packages/domain/src/migrations.ts:1540` |
| `packages/domain/src/migrations.ts:1778` |
| `packages/domain/src/migrations.ts:1844` |
| `packages/domain/src/migrations.ts:310` |
| `packages/domain/tests/dao/migrations.test.ts:12` |
| `packages/domain/tests/dao/migrations.test.ts:129` |
| `packages/domain/tests/dao/migrations.test.ts:225` |
| `packages/domain/tests/dao/migrations.test.ts:331` |
| `packages/domain/tests/dao/migrations.test.ts:385` |
| `packages/domain/tests/dao/migrations.test.ts:598` |
| `packages/domain/tests/dao/migrations.test.ts:657` |
| `packages/domain/tests/dao/migrations.test.ts:660` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:53` |
| `plugins/sp/scripts/inline-run-setup.ts:103` |
| `plugins/sp/scripts/inline-run-setup.ts:318` |
| `plugins/sp/scripts/inline-run-setup.ts:34` |
| `plugins/sp/scripts/inline-run-setup.ts:347` |
| `plugins/sp/scripts/inline-run-setup.ts:36` |
| `plugins/sp/scripts/inline-run-setup.ts:430` |
| `plugins/sp/scripts/inline-run-setup.ts:465` |
| `plugins/sp/scripts/inline-run-setup.ts:48` |
| `plugins/sp/scripts/inline-run-setup.ts:557` |
| `plugins/sp/scripts/inline-run-setup.ts:562` |
| `plugins/sp/scripts/inline-run-setup.ts:575` |
| `plugins/sp/scripts/inline-run-setup.ts:580` |
| `plugins/sp/scripts/inline-run-setup.ts:596` |
| `plugins/sp/scripts/inline-run-setup.ts:612` |
| `plugins/sp/scripts/inline-run-setup.ts:629` |
| `plugins/sp/scripts/quality-gate.ts:107` |
| `plugins/sp/scripts/quality-gate.ts:16` |
| `plugins/sp/scripts/quality-gate.ts:185` |
| `plugins/sp/scripts/quality-gate.ts:29` |
| `plugins/sp/scripts/quality-gate.ts:547` |
| `plugins/sp/scripts/quality-gate.ts:552` |
| `plugins/sp/scripts/quality-gate.ts:568` |
| `plugins/sp/scripts/quality-gate.ts:625` |
| `plugins/sp/scripts/quality-gate.ts:656` |
| `plugins/sp/scripts/quality-gate.ts:658` |
| `plugins/sp/scripts/quality-gate.ts:660` |
| `plugins/sp/scripts/quality-gate.ts:668` |
| `plugins/sp/scripts/quality-gate.ts:90` |
| `plugins/sp/tests/inline-run-setup.test.ts:399` |
| `plugins/sp/tests/quality-gate.test.ts:324` |
| `scripts/commands/bundle-plugin-lib.ts:129` |
| `scripts/commands/bundle-plugin-lib.ts:176` |
| `scripts/commands/real-run-cost.test.ts:104` |
| `scripts/commands/real-run-cost.test.ts:19` |
| `scripts/commands/real-run-cost.test.ts:22` |
| `scripts/commands/real-run-cost.test.ts:236` |
| `scripts/commands/real-run-cost.test.ts:25` |
| `scripts/commands/real-run-cost.test.ts:32` |
| `scripts/commands/real-run-cost.test.ts:41` |
| `scripts/commands/real-run-cost.test.ts:44` |
| `scripts/commands/real-run-cost.test.ts:54` |
| `scripts/commands/real-run-cost.test.ts:57` |
| `scripts/commands/real-run-cost.test.ts:6` |
| `scripts/commands/real-run-cost.test.ts:83` |
| `scripts/commands/real-run-cost.ts:118` |
| `scripts/commands/real-run-cost.ts:128` |
| `scripts/commands/real-run-cost.ts:172` |
| `scripts/commands/real-run-cost.ts:178` |
| `scripts/commands/real-run-cost.ts:182` |
| `scripts/commands/real-run-cost.ts:195` |
| `scripts/commands/real-run-cost.ts:213` |
| `scripts/commands/real-run-cost.ts:244` |
| `scripts/commands/real-run-cost.ts:255` |
| `scripts/commands/real-run-cost.ts:273` |
| `scripts/commands/real-run-cost.ts:292` |
| `scripts/commands/real-run-cost.ts:318` |
| `scripts/commands/real-run-cost.ts:329` |
| `scripts/commands/real-run-cost.ts:34` |
| `scripts/commands/real-run-cost.ts:41` |
| `scripts/commands/real-run-cost.ts:5` |
| `scripts/commands/real-run-cost.ts:500` |
| `scripts/commands/real-run-cost.ts:505` |
| `scripts/commands/real-run-cost.ts:515` |
| `scripts/commands/real-run-cost.ts:531` |
| `scripts/commands/real-run-cost.ts:533` |
| `scripts/commands/real-run-cost.ts:56` |
| `scripts/commands/real-run-cost.ts:89` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | gate-checklists.md:92-94 + secu-review.md:85-87 replace lint/test re-runs with quality-gate.ts status reuse:true confirmation, spur-check only on stale/missing; full-gate-before-review invariant intact (task-pipeline.yaml:141-142, quality-gate.ts:630 only run-mode writes receipt; light writes only -light-gate.log :430) |
| R2 | MET | quality-gate.ts:557-565 noProgressSkip evaluated before probe (probe block :568-575 guarded); receiptFailsAtDigest :248-263 requires tier full + status FAIL + inputDigest equality; skip writes FAIL to -test-gate.status :621 + check.skipped-no-progress teed stdout+log :561-564; attempt counter untouched (:546 run-only reset; test quality-gate-receipt.test.ts:468-470) |
| R3 | MET | check.reused at status-mode reuse (quality-gate.ts:672-680) and light accumulation (:459-464); check.skipped-no-progress (:561-564); all teed stdout+gate log; single main() dispatch :660-685 no surface branch, both YAML resolutions same script (task-pipeline.yaml:428,511) |
| R4 | MET | task-pipeline-check-dedup.test.ts:24-34 negative (precheck/verify/record free of qualityGateCmd/quality-gate.ts) + positive (test/test-recheck keep gate); verify reads only status file via jq proof-stamp (:643 observe-only) |
| R5 | MET | config/workflow-candidates.json check-dedup-task-pipeline: canonical task-pipeline; delta.baselineAgentRunCount=0 matches 0938 baseline agentRunCountMedian 0 (wall median 7983000ms); deadline 2026-11-24 = +60d; verdict null honestly pending promotion evaluate post-shadow-run (ADR-076 revert) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The comprehensive check runs once at the quality boundary | MET | test | Check runs once at boundary: recheck no-progress skip (quality-gate.ts:557-575), receipt confirmation at model stages (gate-checklists.md:92-94, secu-review.md:85-87), light accumulation skip at same digest (:452-464), precheck/verify/record gate-free (R4 test); 23/23 receipt tests + 2/2 dedup tests + gate attempt-2 PASS 9127/523 |
| [non-behavior] AC2 — Workflow shape changes are accepted only on measured benefit | MET | static-ref | Candidate bound to 0938 baseline with 60-day evaluate-or-revert deadline (ADR-076); measured confirmation sequenced post-shadow-run per Plan step 5; no unmeasured promotion |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS (full review run 431a772b; F2 fixed driver-side post-review, targeted suites re-run 23/23, gate attempt-2 PASS before verify).

| Finding | Priority | Disposition |
| --- | --- | --- |
| F1: task doc Solution/Testing/Review placeholders + unchecked boxes at review time (record-state bookkeeping, pipeline-enforced before done) | P3 | DEFER — resolved by this closing chain; not a code defect |
| F2: readReceiptStatus contract doc sat above readReceipt with receiptFailsAtDigest wedged between (quality-gate.ts:244-252) | P4 | FIXED — comment moved above subject; twin regenerated from repo root (byte-identical); 23/23 receipt tests re-run |
| F3: R1 edit dropped the no-.skip/xfail clause from the old tests-pass line (gate-checklists.md:92-94) | P4 | ACCEPTED — still enforced at cross-cutting.md:507 and dev-operations.md:542 |
| F4: R5 candidate verdict null until promotion evaluate post-shadow-run (workflow-candidates.json:9-23) | P4 | ACCEPTED — schema mandates null pre-evaluation; deadline 2026-11-24 forces evaluate-or-revert (ADR-076) |
| F5: no-progress FAIL writes empty -test-gate.findings (no file:line anchors) | P4 | ACCEPTED — by design: nothing tracked changed; bounded loop + log tail carry context |

Residual risk: worker deviations (a) stale 0939 twin refreshed by regen — reviewer-verified byte-identical, plugin-standalone holds; (b) captureStdout helper reorder — new 0940 test code only, no existing assertions modified (reviewer-verified).

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T17:06:45.261Z todo → wip (system)
- 2026-09-25T18:01:18.764Z wip → testing (system)
- 2026-09-25T18:01:29.143Z testing → done (system)

