---
schema_version: 1
name: "Split validation by scope: repo-wide checks move to a feature-scoped verification pass"
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.226Z
updated_at: "2026-09-16T22:50:32.109Z"
feature_id: D62
priority: P1
tags:
  - workflow
  - gates
  - adr-119

dependencies: ["0866"]
---

## 0872. Split validation by scope: repo-wide checks move to a feature-scoped verification pass

### Background

A repo-wide invariant checked once per task is checked N times per feature and can fail on a sibling task's work, charging the current task's model budget for another task's defect. The direct saving is modest and honest — gate-shaped shell nodes in task-pipeline cost ~55 s per task (test 19.1 s, test-recheck 35.3 s, precheck 0.5 s) against implement's 594 s. The load-bearing saving is the cross-scope model rework those failures trigger: resolve-scope fails 43%, doc-sync 35%, verify 21%.

A worked instance found on 2026-09-16 while gating this feature's own planning output: `apps/cli/tests/adr-supersession.test.ts` (0850/0854 R2) diffs `docs/00_ADR.md` against HEAD and rejects any added line outside a hard-coded ADR allowlist `[42, 52, 57, 86, 116]`. It fires on the *working tree*, so appending ADR-117/118/119 — an unrelated, legitimate addition — turns `bun run spur-check` red for every task in the tree until the ADR change is committed. Its removal assertion (no historical status line disappears) is the durable guard and passed; the addition allowlist is the scope defect. Classify it under R1 and record which side of the split it belongs on.

### Requirements

- [x] R1. Every existing check is classified as task-local (satisfied or violated by one task's diff alone) or repo-wide.
- [x] R2. Repo-wide checks are not executed by the per-task pipeline.
- [x] R3. Repo-wide checks are executed by a feature-scoped verification pass that runs once per feature against a settled tree.
- [x] R4. A feature cannot reach done while that pass is failing.
- [x] R5. Task-local checks remain on the per-task pipeline and report without consulting the feature-scoped pass.
- [x] R6. No new check is authored; this task relocates existing ones.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R13 — Repo-wide checks run once per feature, not once per task
    Given a validation check whose invariant spans the repository rather than a single task's diff
    When the per-task pipeline runs
    Then that check is not executed by the per-task pipeline
    And it is executed by the feature-scoped verification pass
    And the feature cannot reach "done" while that pass is failing

  @core
  Scenario: R14 — A task-local check stays on the per-task pipeline
    Given a validation check whose invariant is satisfied or violated by a single task's diff alone
    When the scope split is applied
    Then the check remains in the per-task pipeline
    And the per-task pipeline reports it without consulting the feature-scoped pass
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Classification is the deliverable and the risky part — a check moved to the wrong scope either stops protecting its invariant or reintroduces the coupling. Produce the classification table first, with the invariant each check protects stated explicitly, and let the relocation follow from it. The feature-scoped pass owns a lifecycle boundary no existing pipeline owns, so it is a new canonical definition under ADR-072 rather than a duplicate of task-pipeline.

### Plan

1. Enumerate every check the per-task pipeline runs and state the invariant each protects.
2. Classify each as task-local or repo-wide; record the table with reasons.
3. Author the feature-scoped verification definition owning the repo-wide set.
4. Remove the relocated checks from the per-task pipeline.
5. Gate feature done on the pass; verify a task run no longer fails on a sibling's defect.
6. Measure per-task wall clock before and after from run history.

### Solution

| Change | What / why |
| --- | --- |
| `config/workflows/feature-verification.yaml:36-70` | **NEW** feature-scoped verification pass (ADR-119). Shell-only `verify → done or failed` FSM: runs `${vars.verificationCmd}` (`bun run spur-check-feature`) once per feature, writes `.spur/run/<featureId>-feature-verification.status`, always exits 0; the `verify→done` guard reads the status so a missing/corrupt/FAIL verdict fails closed (R3). No `agent.run` nodes. |
| `package.json:81-84` | `spur-check` narrowed to the task-local set (`lint`, `test-pre-check`, `test`, `test-post-check`); new `spur-check-feature` carries the seven repo-wide checks plus `test-repo-wide` (`./repo-wide-tests`), and `spur-check-new` stays byte-identical to `spur-check` (R2/R5). |
| `config/workflows/feature-lifecycle.yaml:71` | `verifying→done` guard now requires `test "$(cat .spur/run/$featureId-feature-verification.status)" = PASS` before the strict `feature check --strict --as done`, so a feature cannot reach done while the repo-wide pass is failing (R4). |
| `apps/cli/tests/adr-supersession.test.ts` → `repo-wide-tests/adr-supersession.test.ts:15` | Relocated the repo-wide ADR-supersession test out of the per-task `test` glob into `repo-wide-tests/`, fixing its repo-root anchor (`repo-wide-tests → repo`). Run by `test-repo-wide`, never the per-task gate (R1/R2/R6 — relocated, not authored). |
| `docs/design/workflow-execution-economy.md:123-147` | §4.1 classification record (R1): every check with its invariant and scope — the seven repo-wide checks vs `lint`/`test-pre-check`/`test`/`test-post-check` task-local, including the `adr-supersession` working-tree defect called out. |
| `docs/design/workflow-composition-contract.md:24` | Records `feature-verification.yaml` as the added ADR-119 definition and its no-model-query shape. |
| `plugins/sp/tests/inline-pipeline-parity-check.test.ts:18-24` | Census baseline 8→9 workflows (feature-verification added after 0866's retirements). |
| `scripts/commands/real-run-cost.ts:26` | Cohort comment 8→9 workflows for the in-scope default. |
| `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:41-113,240,265-309` | Extracted the fixture builders + `makeFixtureAdapter`; the 0418 recovery hop now records a PASS status first; new R4 (0872) regression asserts `verifying→done` is denied while the pass verdict is missing/FAIL and allowed only after PASS. |
| `plugins/sp/tests/feature-verification-scope.test.ts:43-99` | **NEW** regression for the R2/R5 split (spur-check runs no repo-wide check; spur-check-feature owns them all; task-local `test` excludes `repo-wide-tests`) and the R3/R4 wiring (shell-only pass, no `agent.run`, verifying→done guard reads the status). |
| `scripts/commands/importer-schema-check.ts:20`, `scripts/commands/dependency-drift-check.ts:83` | Comment accuracy: both now name `spur-check-feature` as their chain after the relocation. |
| `AGENTS.md:154-165` | Build section documents the new task-local `spur-check` vs feature-scoped `spur-check-feature` split for readers. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/design/workflow-execution-economy.md:123-147` §4.1 classifies every per-task-pipeline check with an explicit invariant and scope: 7 repo-wide (`link-check`, `transition-shim-check`, `script-contract-check`, `inline-pipeline-parity-check`, `dependency-drift-check`, `importer-schema-check`, `history-surface-freeze-check`) vs task-local (`lint`, `test-pre-check`, `test`, `test-post-check`); the `adr-supersession` working-tree defect is called out under `test`. |
| R2 | MET | `package.json:81` `spur-check` runs only `lint && test-pre-check && test && test-post-check` — none of the 7 repo-wide scripts; `config/workflows/task-pipeline.yaml:127` `qualityGateCmd` stays `bun run spur-check`; test `plugins/sp/tests/feature-verification-scope.test.ts:51` asserts spur-check contains no repo-wide check and no `test-repo-wide`/`spur-check-feature` (passing). |
| R3 | MET | `config/workflows/feature-verification.yaml:36-70` is the new shell-only pass running `${vars.verificationCmd}` (`bun run spur-check-feature`) once per feature; `package.json:83` `spur-check-feature` composes all 7 repo-wide checks + `test-repo-wide`; command this run `bun run spur-check-feature` → all 7 checks PASS + 7 repo-wide tests pass; test `plugins/sp/tests/feature-verification-scope.test.ts:60,71` passes. |
| R4 | MET | `config/workflows/feature-lifecycle.yaml:71` `verifying→done` guard is `test "$(cat .spur/run/$featureId-feature-verification.status)" = PASS && $spurBin feature check $featureId --strict --as done` (fails closed on missing/corrupt/FAIL); test `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:240` (R4 0872) denies the hop with a missing verdict and with a `FAIL` verdict, allows only after `PASS` (9/9 passing). |
| R5 | MET | `package.json:77` task-local `test` glob is `./apps/cli ./apps/server ./apps/web ./packages ./plugins ./scripts` (excludes `repo-wide-tests`); test `plugins/sp/tests/feature-verification-scope.test.ts:66` asserts `test` excludes and `test-repo-wide` includes the relocated tree; command `bun run spur-check` → 8355 tests pass, 0 fail, lint + pre/post rules clean with no feature-pass consultation. |
| R6 | MET | No check authored: `git show HEAD:apps/cli/tests/adr-supersession.test.ts` diff vs `repo-wide-tests/adr-supersession.test.ts` = only the 2-line repo-root anchor (`apps/cli/tests → repo` → `repo-wide-tests → repo`); `spur-check-feature` (`package.json:83`) composes the 7 pre-existing scripts, no new checker body added. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R13 — Repo-wide checks run once per feature, not once per task | MET | test | test `plugins/sp/tests/feature-verification-scope.test.ts:51` (spur-check runs no repo-wide check) + `:60` (spur-check-feature owns every repo-wide check) + `:71` (shell-only pass, no `agent.run`) and `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:240` (verifying→done denied until PASS); command `bun run spur-check-feature` → all 7 repo-wide checks + 7 repo-wide tests PASS, and `config/workflows/feature-lifecycle.yaml:71` gates done on that PASS. |
| Scenario: R14 — A task-local check stays on the per-task pipeline | MET | test | test `plugins/sp/tests/feature-verification-scope.test.ts:66` (task-local `test` excludes `repo-wide-tests`; `test-repo-wide` owns it) + `:51` (spur-check-new byte-identical to spur-check); command `bun run spur-check` → 8355 tests pass, 0 fail, lint + `test-pre-check`/`test-post-check` rules clean, no repo-wide script or feature-pass file consulted. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Every §Solution change map row is present in the diff and matches its claim (feature-verification.yaml NEW, package.json split, feature-lifecycle guard, relocated test, docs, census 8→9, comments). |
| P4 | scope-creep | — | All 12 modified + 3 new paths map to R1–R6, the AC scenarios, or the §Solution doc/test/comment updates; no drive-by edits. |
| P4 | evidence-rule-pass | — | Both behavior-bearing AC rows carry executable `test + command` evidence. |
| P4 | cli-golden-path-present | — | Fresh `bun run spur-check-feature` and `bun run spur-check` golden-path commands captured this run (both exit 0). |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:6b99a450131951deffe2fd4287b54e54975830fe4b895b2c8458c3a80e8896b9 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T22:36:50.221Z todo → wip (system)
- 2026-09-16T22:50:30.341Z wip → testing (system)
- 2026-09-16T22:50:32.109Z testing → done (system)

