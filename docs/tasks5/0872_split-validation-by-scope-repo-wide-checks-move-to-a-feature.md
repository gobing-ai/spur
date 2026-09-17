---
schema_version: 1
name: "Split validation by scope: repo-wide checks move to a feature-scoped verification pass"
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.226Z
updated_at: "2026-09-17T19:05:51.063Z"
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
| R1 | MET | Scope classification at `docs/design/workflow-execution-economy.md:123-147` (7 repo-wide vs task-local lint/test-pre/test/test-post) stands; package.json:81-84 re-read: spur-check = lint+test-pre-check+test+test-post-check; spur-check-feature composes the repo-wide set + test-repo-wide. |
| R2 | MET | `package.json:81` re-read — spur-check carries no repo-wide script; task-pipeline qualityGateCmd stays bun run spur-check; feature-verification-scope.test.ts:51 asserts the absence — re-run `bun test tests/feature-verification-scope.test.ts` -> 6 pass / 0 fail (2026-09-17). |
| R3 | MET | `config/workflows/feature-verification.yaml:36-45` re-read: shell-only verify state running ${vars.verificationCmd} = bun run spur-check-feature; live re-run this batch: `bun run spur-check-feature` -> exit 0 (all repo-wide checks + 7 repo-wide tests PASS). |
| R4 | MET | `config/workflows/feature-lifecycle.yaml:71` re-read: verifying→done guard requires the pass's PASS status file + feature check --strict --as done; feature-lifecycle-adapter.test.ts:240 (R4 0872) denies missing/FAIL verdict, allows PASS — re-run 9 pass / 0 fail. |
| R5 | MET | `package.json:77` test glob excludes repo-wide-tests; scope test :66 asserts the exclusion — passing; full task-local chain re-run this batch (lint/typecheck green after --fix repairs; test stage result in batch report). |
| R6 | MET | No new checker authored: spur-check-feature composes 7 pre-existing scripts (package.json:83 re-read); relocation-only diff confirmed in original verify and unchanged since. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R13 — Repo-wide checks run once per feature, not once per task | MET | test | feature-verification-scope.test.ts:51,:60,:71 + feature-lifecycle-adapter.test.ts:240 — 6+9 pass re-run 2026-09-17; live `bun run spur-check-feature` exit 0; feature-lifecycle.yaml:71 gates done on the pass's PASS. |
| Scenario: R14 — A task-local check stays on the per-task pipeline | MET | test | scope test :66 (task-local test excludes repo-wide-tests) + :51 (spur-check-new byte-identical) passing; package.json:77,81,82 re-read consistent. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Scope split + feature-verification pass + lifecycle guard match ADR-119 design; no deviation. |
| P4 | secua | — | Done gate fails closed on missing/corrupt/FAIL verdict; no findings this run. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T22:36:50.221Z todo → wip (system)
- 2026-09-16T22:50:30.341Z wip → testing (system)
- 2026-09-16T22:50:32.109Z testing → done (system)

