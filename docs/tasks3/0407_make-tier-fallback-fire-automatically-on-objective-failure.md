---
template: feature-impl
schema_version: 1
name: "Make tier fallback fire automatically on objective failure"
description: ""
status: todo
type: task
profile: standard
feature_id: H9
parent_wbs: null
priority: P1
tags: ["sp-plugin", "executor", "stage-registry", "reliability"]
dependencies: ["0405"]
created_at: "2026-08-01T05:22:55.719Z"
updated_at: "2026-08-01T05:31:02.212Z"
---

## 0407. Make tier fallback fire automatically on objective failure

### Background

The defect that motivated the feature. The fallback mechanism is fully specified and half-wired: `stageModelPolicySchema` defines `min_tier` and an ordered `fallback[]`; `TIER_RANK`, `isTierEligible` and `getNextFallback` exist; `agent-service.ts:743-783` consumes them and re-selects an eligible executor.

But escalation fires only when an operator passes `--signal` (`agent-service.ts:756`, `stringFlag(flags, 'signal', '')`), and nothing in the codebase detects a failure and supplies one — a grep for rate-limit, quota, and exhaustion handling across `packages/app/src`, `packages/domain/src` and `apps/cli/src` returns no such detection. Meanwhile `resolveModelPolicyFallback` and `pickStartingTier` have zero non-test consumers.

So the ladder exists, the rungs are numbered, and nothing ever steps on it. A run dies when an executor exhausts its budget, exactly as the operator reported.

### Requirements
R1. Detect objective failures at the point of failure and convert them into the corresponding escalation signal, without operator involvement. Resource exhaustion is the minimum bar; cover the other existing triggers where the failure is detectable.
R2. Feed detected signals into the existing `getNextFallback` path so the next eligible tier is selected and the step retried.
R3. Escalation is observable: report which executor failed, why, and which tier was selected next.
R4. Exhausting the chain is reported honestly — name the tiers attempted rather than surfacing a bare failure. A silent give-up is the current behavior and is what made this defect hard to see.
R5. Resolve the dead selection helpers: `resolveModelPolicyFallback` and `pickStartingTier` either become part of the selection path or are deleted. Specified-but-unused machinery is what produced false confidence that fallback worked.
R6. Bound the escalation loop so a repeatedly-failing chain cannot retry indefinitely, and state the bound.
R7. Prove it by test, not by wiring: start on one tier, inject an exhaustion failure, assert the next tier is selected. The test must fail if the escalation path is disconnected — verify that by mutation, since a test that passes with the path severed is what allowed this defect to ship.
R8. Use the trigger vocabulary and naming from task 0405.
### Acceptance Criteria
Covers feature scenarios R4, R5, R6, R7 and R9.

```gherkin
Feature: automatic tier escalation

  Scenario: Exhaustion escalates to the next tier without operator involvement
    Given a stage running on its starting tier
    When the executor fails with a resource exhaustion error
    Then the failure is detected at the point of failure
    And the next tier in the fallback chain is selected
    And no operator-supplied signal was required

  Scenario: Escalation is observable
    Given an automatic tier escalation
    When it occurs
    Then the operator is told which executor failed, why, and which tier was selected next

  Scenario: The chain is exhausted honestly
    Given a fallback chain whose entries have all been tried
    When the last tier also fails
    Then the run reports the chain was exhausted
    And it names the tiers attempted

  Scenario: The escalation loop is bounded
    Given a chain that keeps failing
    When escalation retries
    Then it stops at the stated bound
    And reports that the bound was reached

  Scenario: No specified-but-unused selection machinery remains
    Given the stage registry selection helpers
    When their consumers are enumerated
    Then every exported helper is either used on the selection path or removed

  Scenario: Fallback is proven by test rather than by wiring
    Given a stage with a multi-entry fallback chain
    When an exhaustion failure is injected on the starting tier
    Then a test asserts the next tier was selected
    And severing the escalation path makes that test fail
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Detect in `executeRun`, not in its callers

Failure classification is currently duplicated. `run` (`agent-service.ts:324-330`) maps non-zero to
exit 3 after checking `signal`; `runTraced` (`:353`) maps non-zero to 3 with no inspection at all.
Neither looks at `stderr`, though it is captured and deliberately forwarded — the R2b comment at
`:354-356` notes `AiRunner` already computes these diagnostics and that discarding them was the
earlier bug.

Both callers funnel through `executeRun`, so that is the single insertion point. Putting detection
in the callers adds a third copy of classification logic to a site that already has two, which is
how the current inconsistency arose.

#### Classification is heuristic — treat it as such

Exhaustion has no standard shape. Each agent reports rate limits, quota, and token-budget overruns
differently, across `stderr` text and exit codes, and the vocabulary shifts with provider releases.
The classifier will be a pattern match and will be wrong sometimes.

Design for both error directions:

- **False negative** (exhaustion not recognised): current behavior — the run fails without
  escalating. Acceptable, and no worse than today.
- **False positive** (a genuine defect misread as exhaustion): escalates to a more capable tier,
  which retries and likely fails again, burning the more expensive executor before reporting. This is
  the costly direction, and it is why R6's bound matters more than it looks.

Bias the patterns toward precision over recall, and record what the classifier does *not* catch, so
the next person extends it instead of assuming coverage.

#### Escalate the step, not the run

`getNextFallback` returns the next tier; the retry has to re-enter with the new executor while
preserving the step's inputs — prompt, cwd, correlation. Correlation especially: the run id must stay
stable across escalation or the observability trail fragments precisely where it is most needed.

#### Wire-or-delete (R5) — expect delete

`resolveModelPolicyFallback` and `pickStartingTier` have zero non-test consumers. `agent-service`
already calls `getNextFallback` directly and does its own eligible-executor filtering
(`:777-783`). The honest outcome is probably deletion rather than contrived adoption: exported
helpers with tests and no callers are what created the impression the fallback mechanism worked.
Whichever way it goes, R5 requires a decision, not a third state where they survive untouched.

#### The mutation check is the deliverable (R7)

The predecessor to this defect is instructive: the machinery was wired, consumed, covered by tests,
and green — while the only thing that could trigger it was an operator flag passed after the failure
was already known. Tests asserted the pieces, never the path.

So R7's test must fail when the escalation path is severed, verified by actually severing it. Assert
on the observable outcome — a second attempt occurred on a higher tier — not on the classifier
having been called, which would pass with the escalation disconnected.
### Plan
- [ ] Map the failure sites where an executor error surfaces, and classify which map to which trigger.
- [ ] Implement detection and signal conversion at those sites.
- [ ] Route detected signals into getNextFallback; retry on the selected tier.
- [ ] Add escalation and chain-exhaustion reporting.
- [ ] Decide wire-or-delete for resolveModelPolicyFallback and pickStartingTier; act on it.
- [ ] Add the retry bound.
- [ ] Write the escalation test, then mutation-check it by severing the path and confirming failure.
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
