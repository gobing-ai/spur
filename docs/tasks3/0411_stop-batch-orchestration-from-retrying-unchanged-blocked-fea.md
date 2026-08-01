---
template: issue
schema_version: 1
name: "Stop batch orchestration from retrying unchanged blocked feature sync"
description: ""
status: todo
type: issue
profile: standard
feature_id: H
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-01T22:50:42.255Z"
updated_at: "2026-08-01T22:57:50.573Z"
---

## 0411. Stop batch orchestration from retrying unchanged blocked feature sync

### Background
During the H9 batch, the orchestrator attempted the same blocked `feature sync H9` transition four times without any intervening change to task, verdict, or feature inputs. `feature sync --json` already evaluates the L4 gate before applying a transition, so a separate mandatory dry run would only duplicate the same work.

The defect is retry policy: an unchanged structured blocked result must be surfaced once and treated as terminal until relevant inputs change.
### Requirements
R1. Batch and wrap orchestration consume the structured `feature sync <id> --json` result once per unchanged input state.

R2. A result reporting `gateBlocked`, `applied: false` with actionable findings, or an equivalent blocked proposal stops/defer the feature-transition hop and reports the findings.

R3. The orchestrator must not retry the same blocked proposal until a relevant task, verdict artifact, or feature input changes.

R4. Do not add a mandatory `--dry-run` call before the real sync and do not parse human-readable output prefixes with `grep`.

R5. Successful and no-op sync results retain their current behavior.

R6. Regression tests cover blocked, unchanged retry, changed-input retry, success, and no-op paths.
### Acceptance Criteria
```gherkin
Feature: bounded feature-sync orchestration

  Scenario: A blocked feature sync is reported once
    Given feature sync returns structured gate findings for a blocked proposal
    When batch orchestration handles the result
    Then it reports the actionable findings
    And it does not immediately invoke feature sync again

  Scenario: An unchanged blocked proposal is not retried
    Given a feature-sync proposal was blocked
    And no linked task, verdict artifact, or feature input has changed
    When orchestration resumes
    Then the previous blocked result remains terminal
    And no duplicate sync invocation is made

  Scenario: Changed inputs permit a new sync attempt
    Given a feature-sync proposal was blocked
    And a relevant task, verdict artifact, or feature input changes
    When orchestration resumes
    Then feature sync may be evaluated once against the new input state

  Scenario: Successful and no-op sync behavior is preserved
    Given feature sync returns an applied or no-op result
    When orchestration handles the result
    Then the current success path continues
    And no mandatory dry-run invocation is added
```
### Q&A
**Q: Why not run `feature sync --dry-run` first?**  
A: The real sync already computes and gates the proposal before applying it. A mandatory dry run duplicates that evaluation and does not prevent an agent from retrying.

**Q: Why require structured output?**  
A: `--json` provides stable machine fields; human prefixes are presentation and must not become orchestration protocol.

**Q: When is retry allowed?**  
A: Only after relevant inputs change, or after an explicit operator action that changes the decision context.
### Design
Keep the fix at the orchestration seam that consumes `feature sync --json`. Classify the result as applied, no-op, or blocked. Persist or carry enough proposal/input identity to suppress an identical blocked attempt during the same batch/resume chain; invalidate that suppression when relevant inputs change.

Primary instruction surfaces are `plugins/sp/skills/spur-dev/references/execution-batch.md` and the feature-transition handling used by `.spur/workflows/task-pipeline.yaml` / `.spur/workflows/wrapup-pipeline.yaml`. Reuse existing workflow/checkpoint state where available; do not add a new cache or general retry framework.
### Plan
- [ ] Trace every feature-sync invocation in batch, task-record, and wrap flows.
- [ ] Define the structured applied/no-op/blocked result handling and unchanged-input identity.
- [ ] Implement bounded retry suppression at the shared orchestration seam.
- [ ] Add focused regression tests for blocked, resumed, changed-input, success, and no-op cases.
- [ ] Run focused tests and the repository verification gate.
### Root Cause
`FeatureService` already evaluates the L4 gate before proposing or applying a transition. The H9 loop was caused by orchestration repeatedly invoking sync after the same structured blocked result, not by absence of a dry-run capability.

Evidence: `.spur/workflows/task-pipeline.yaml:193` and `.spur/workflows/wrapup-pipeline.yaml:126` invoke `feature sync --json`; `packages/app/src/services/feature-service.ts:394` evaluates the L4 gate before transition.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `.spur/workflows/task-pipeline.yaml:193`
- `.spur/workflows/wrapup-pipeline.yaml:126`
- `packages/app/src/services/feature-service.ts:394`
- `apps/cli/src/commands/feature.ts:366`
- `docs/dogfood/2026-08-01-sp-dev-runall-H9-dogfood.md`
### History
- 2026-08-01T22:55:55.196Z backlog → todo (system)
