---
template: feature-impl
schema_version: 1
name: "Settle agent-versus-executor naming and add the resource-exhaustion trigger"
description: ""
status: todo
type: task
profile: standard
feature_id: H9
parent_wbs: null
priority: P1
tags: ["sp-plugin", "cli", "stage-registry", "vocabulary"]
dependencies: []
created_at: "2026-08-01T05:22:55.687Z"
updated_at: "2026-08-01T05:30:07.806Z"
---

## 0405. Settle agent-versus-executor naming and add the resource-exhaustion trigger

### Background

The vocabulary task, deliberately first: both later tasks write code against these names, and renaming after they land means touching the same files twice.

Two unsettled naming questions. `--agent` describes the thing dispatched; `--executor` describes the role it plays, and the stage registry and tier vocabulary already say "executor" (`getExecutorTier`, `eligible` executor lists in `agent-service.ts:777-783`). The surface is currently split between the two.

Separately the objective trigger vocabulary (`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted` in `stageModelPolicySchema`) has no member for resource exhaustion — the operator's actual failure mode. Task 0406 cannot detect-and-escalate what the schema cannot express, so the enum extension lands here.

### Requirements
R1. Decide `--agent` vs `--executor` and record the decision with its reasoning where the vocabulary is defined, not only in a commit message.
R2. Apply the chosen spelling consistently across CLI flags, config keys, stage-registry vocabulary, and documentation.
R3. If the superseded spelling is retained as an alias, document it with a removal horizon. If it is not retained, state the migration for existing configs and invocations.
R4. Add a resource-exhaustion member to the objective escalation trigger vocabulary in `stageModelPolicySchema`, covering rate limits, quota, and token-budget failures.
R5. The new trigger is usable in a `fallback[]` entry exactly like the existing four — no special-casing at the schema level.
R6. Existing stage-registry configs continue to validate unchanged; the enum extension is additive.
R7. Do not implement detection or escalation behavior here — that is task 0406. This task establishes the names and the schema they will use.
### Acceptance Criteria
Covers feature scenarios R3 and R8.

```gherkin
Feature: executor vocabulary and trigger schema

  Scenario: The flag name is settled and applied consistently
    Given the decision between --agent and --executor
    When CLI flags, config keys, stage-registry vocabulary and docs are reviewed
    Then all use the chosen spelling
    And any retained alias is documented with its removal horizon

  Scenario: Resource exhaustion is expressible as a trigger
    Given the objective escalation trigger vocabulary
    When a resource exhaustion failure occurs
    Then a trigger member exists that names it

  Scenario: The new trigger is a first-class fallback entry
    Given a stage model policy using the resource exhaustion trigger
    When the policy is validated
    Then it validates exactly as a policy using any existing trigger

  Scenario: Existing configs keep validating
    Given stage-registry configs written before this change
    When they are validated against the extended schema
    Then they validate unchanged
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### The split may be deliberate layering, not drift — check before renaming

Counting occurrences changes the framing. The operator-facing surface says **agent**: the CLI flag
(13 occurrences in `apps/cli/src`), the config key (`agent:` at `.spur/config.yaml:31`, and
`agent: omp` on each stage). The domain surface says **executor**: 55 occurrences across
`packages/app/src` and `packages/domain/src` — `getExecutorTier`, the eligible-executor list at
`agent-service.ts:777-783`, the tier vocabulary.

That is a coherent split, not obvious drift: the operator picks *an agent* (a concrete tool: omp,
claude, codex); the registry reasons about *an executor* (a role filled by whichever agent meets the
tier). Forcing one word across both layers would flatten a distinction that is currently doing work.

**So R1 is a real decision with three outcomes, not two:** rename to `--executor`, keep `--agent`,
or **keep both deliberately** and document the layer boundary — operator vocabulary at the CLI and
config, domain vocabulary inside the registry. Evaluate the third seriously; the evidence above is
the argument for it. Whichever is chosen, R1 requires the reasoning recorded at the vocabulary
definition site, and the third option requires the boundary stated explicitly, or it decays back
into looking like drift.

If the decision is to keep both, R2's "apply consistently" means *consistent within each layer*, and
the task's cost drops to documentation plus the trigger enum work.

#### Trigger enum extension

Additive by construction: `stageModelPolicySchema.fallback[].trigger` is a `z.enum`, so adding a
member cannot invalidate existing configs (R6). The naming should match the observable condition
rather than the cause — the detector in task 0407 will classify from `stderr` and exit codes, and
rate limits, quota exhaustion, and token-budget overruns present differently per agent while meaning
the same thing to the fallback chain. One member covering the class is right; three members split by
vendor spelling would push classification into config.

Name it for what the policy should do about it, in the style of the existing four
(`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted`) — those name conditions, not
error strings.

#### Why this task is first

Both 0406 and 0407 write code against these names. Renaming after they land means touching the same
files twice — the cohesion rule from task 0404, applied forward.
### Plan
- [ ] Inventory every occurrence of both spellings across CLI, config, stage registry and docs.
- [ ] Decide, and write the decision plus reasoning at the vocabulary definition site.
- [ ] Apply the spelling; add the alias with a removal horizon, or the migration note.
- [ ] Extend the trigger enum; confirm additively via existing-config validation tests.
- [ ] Confirm no detection or escalation logic changed.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H9

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
