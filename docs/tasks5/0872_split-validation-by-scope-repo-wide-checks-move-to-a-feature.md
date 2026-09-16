---
schema_version: 1
name: "Split validation by scope: repo-wide checks move to a feature-scoped verification pass"
status: todo
template: feature-impl
created_at: 2026-09-16T10:45:25.226Z
updated_at: "2026-09-16T11:13:40.742Z"
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

- [ ] R1. Every existing check is classified as task-local (satisfied or violated by one task's diff alone) or repo-wide.
- [ ] R2. Repo-wide checks are not executed by the per-task pipeline.
- [ ] R3. Repo-wide checks are executed by a feature-scoped verification pass that runs once per feature against a settled tree.
- [ ] R4. A feature cannot reach done while that pass is failing.
- [ ] R5. Task-local checks remain on the per-task pipeline and report without consulting the feature-scoped pass.
- [ ] R6. No new check is authored; this task relocates existing ones.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
