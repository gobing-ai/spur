---
schema_version: 1
id: "H9"
name: "Executor selection: inline default, agent/executor naming, and working tier-based fallback"
status: backlog
priority: P1
tags: []
created_at: "2026-08-01T05:21:06.210Z"
updated_at: "2026-08-01T05:21:52.944Z"
---

# H9: Executor selection: inline default, agent/executor naming, and working tier-based fallback

## Goal
Make executor selection reliable and make the common case cheap.

Three problems, one surface:

1. **No way to run in the current agent.** Every dispatch goes through `spur agent run`, spawning a
   subprocess even when the operator is already sitting in a capable coding agent. Adding `--inline`
   — and making it the default — removes a process hop from the most common path. Steps that
   genuinely need `agent.run` keep it.

2. **Tier-based fallback is specified but not wired.** `stageModelPolicySchema` defines `min_tier`
   plus an ordered `fallback[]`; `TIER_RANK`, `isTierEligible` and `getNextFallback` all exist and
   `agent-service.ts:743-783` consumes them. But escalation fires **only** when an operator passes
   `--signal` (`agent-service.ts:756`), and nothing in the codebase detects a failure and supplies
   one. `resolveModelPolicyFallback` and `pickStartingTier` have zero non-test consumers — dead code.
   The trigger vocabulary (`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted`) has no
   member for resource exhaustion at all, which is the operator's actual failure mode: a run dies
   when an executor runs out of tokens and nothing escalates to the next tier.

3. **The flag's name is unsettled** — `--agent` describes the thing dispatched, `--executor` the
   role it plays. Tier vocabulary and the stage registry already say "executor". Unresolved.

Split out of H8, which owns the command-surface markdown. This is runtime TypeScript against
`agent-service` and the stage registry, with a different risk profile: H8 changes what documents
say, H9 changes what runs.
## Scope
### In scope

- **`--inline` execution mode, as the new default.** Run the prompt or slash command directly in the
  current coding agent instead of shelling out to `spur agent run`. Existing `agent.run` steps and
  explicit `spur agent run` invocations keep working unchanged.
- **Automatic escalation signals.** Detect the objective failures the fallback chain already claims
  to handle — at minimum resource exhaustion (rate limit, quota, token budget) — at the point of
  failure, and feed them into `getNextFallback` without operator involvement.
- **Extend the trigger vocabulary** with a resource-exhaustion member. The current four
  (`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted`) cannot express the failure
  that motivated this work.
- **Wire or delete the dead paths.** `resolveModelPolicyFallback` and `pickStartingTier` have no
  non-test consumers. Either they become the selection path or they go; leaving specified-but-unused
  machinery is what produced the false confidence that fallback worked.
- **Decide `--agent` vs `--executor`** and apply the decision consistently across CLI flags, config
  keys, stage-registry vocabulary, and docs — including whether the old spelling stays as an alias.
- **Evidence that fallback works**, not just that it is wired: a test that starts on one tier, injects
  an exhaustion failure, and asserts the next tier is selected.

### Out of scope

- The `/sp:dev-*` command-surface markdown, `--next` semantics, and `--json`/`--auto` normalization —
  feature H8.
- Adding or changing capability tiers. The five (`cheap`, `standard`, `capable-1/2/3`) stand; this
  feature makes the existing ladder work rather than redesigning it.
- Model or provider selection policy — which concrete model sits in which tier is configuration.
- `task-pipeline.yaml` step definitions, beyond whatever `--inline` defaulting requires.
## Acceptance Criteria
```gherkin
Feature: reliable executor selection

  Scenario: R1 — Inline is the default execution mode
    Given an operator running a dev command from within a coding agent
    When no execution mode is specified
    Then the prompt runs directly in the current agent
    And no spur agent run subprocess is spawned

  Scenario: R2 — Explicit subprocess dispatch still works
    Given a step that requires a named external executor
    When it dispatches via agent.run or spur agent run
    Then the subprocess path behaves as it did before this feature

  Scenario: R3 — Resource exhaustion is expressible as a trigger
    Given the objective escalation trigger vocabulary
    When a resource exhaustion failure occurs
    Then a trigger member exists that names it

  Scenario: R4 — Exhaustion escalates to the next tier without operator involvement
    Given a stage running on its starting tier
    When the executor fails with a resource exhaustion error
    Then the failure is detected at the point of failure
    And the next tier in the fallback chain is selected
    And no operator-supplied signal was required

  Scenario: R5 — Escalation is observable
    Given an automatic tier escalation
    When it occurs
    Then the operator is told which executor failed, why, and which tier was selected next

  Scenario: R6 — The chain is exhausted honestly
    Given a fallback chain whose entries have all been tried
    When the last tier also fails
    Then the run reports the chain was exhausted
    And it names the tiers attempted rather than reporting a bare failure

  Scenario: R7 — No specified-but-unused selection machinery remains
    Given the stage registry selection helpers
    When their consumers are enumerated
    Then every exported helper is either used on the selection path or removed

  Scenario: R8 — The flag name is settled and applied consistently
    Given the decision between --agent and --executor
    When CLI flags, config keys, stage-registry vocabulary and docs are reviewed
    Then all use the chosen spelling
    And any retained alias is documented with its removal horizon

  Scenario: R9 — Fallback is proven by test, not by wiring
    Given a stage with a multi-entry fallback chain
    When an exhaustion failure is injected on the starting tier
    Then a test asserts the next tier was selected
    And the test fails if the escalation path is disconnected

  Scenario: R10 — The repository stays green
    Given the full verification gate
    When lint, test and build are run
    Then all three pass with no skipped tests introduced to reach green
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0405 | Settle agent-versus-executor naming and add the resource-exhaustion trigger | todo |
| 0406 | Add inline execution mode and make it the default | todo |
| 0407 | Make tier fallback fire automatically on objective failure | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
