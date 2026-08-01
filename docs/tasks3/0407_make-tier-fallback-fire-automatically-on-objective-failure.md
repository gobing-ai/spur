---
template: feature-impl
schema_version: 1
name: "Make tier fallback fire automatically on objective failure"
description: ""
status: done
type: task
profile: standard
feature_id: H9
parent_wbs: null
priority: P1
tags: ["sp-plugin", "executor", "stage-registry", "reliability"]
dependencies: ["0405"]
created_at: "2026-08-01T05:22:55.719Z"
updated_at: "2026-08-01T22:10:10.984Z"
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
Covers feature scenarios R4, R5, R6, R7, R9, and R10.

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

  Scenario: Fallback is proven by test, not by wiring
    Given a stage with a multi-entry fallback chain
    When an exhaustion failure is injected on the starting tier
    Then a test asserts the next tier was selected
    And severing the escalation path makes that test fail

  Scenario: The repository stays green
    Given the full test suite
    When all tests run
    Then typecheck passes with zero errors
    And the full app and domain test suite passes
    And lint is clean on changed files
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
Escalation loop added to `executeRun`; detection is heuristic pattern-matching on agent output; the dead helper `pickStartingTier` is deleted.

**Change map**

| Change | Location |
| --- | --- |
| Added `resource-exhaustion` fallback entries to all stages with existing chains; deleted `pickStartingTier` | `packages/domain/src/stage-registry/schema.ts:425` |
| `StageEscalationContext` interface bundled onto `AgentResolveResult.ok.stage` | `packages/app/src/services/agent-service.ts:92` |
| `resolveStageModelPolicy` populates `stage` context on ok return | `packages/app/src/services/agent-service.ts:817` |
| `classifyObjectiveFailure` classifier (timeout via signal; resource-exhaustion via regex) | `packages/app/src/services/agent-service.ts:1290` |
| `executeRun` escalation loop: bound, dispatch, classify, re-resolve, report | `packages/app/src/services/agent-service.ts:543` |
| `maxEscalations` + `attemptedExecutors` bound (R6) | `packages/app/src/services/agent-service.ts:543` |
| Escalation signal fed into `getNextFallback` (R2) | `packages/app/src/services/agent-service.ts:875` |
| Chain-exhaustion report naming executors (R4) | `packages/app/src/services/agent-service.ts:718` |
| R7 escalation-success test + R4/R6 chain-exhaustion test | `packages/app/tests/services/agent-service.test.ts:1990` |

Removed `pickStartingTier` test from `packages/domain/src/stage-registry/schema.test.ts`; updated fallback-count assertions to include the new `resource-exhaustion` entries.

**Design decisions**

- **Single insertion point.** Both callers (`run`, `runTraced`) funnel through `executeRun` (`packages/app/src/services/agent-service.ts:535`), so detection lives there — no third copy of classification logic.
- **Bias to precision.** The classifier records what it does *not* catch; extending it is an additive change, not a re-design. A false-positive toward a pricier tier is the costly error direction.
- **Bound = `policy.fallback.length` + `attemptedExecutors`.** A chain cannot retry indefinitely; the dup-check fires first when executors are fewer than fallback slots (the common case — two executors, three fallback entries).
- **`runFlags` is a shallow copy** made before the loop; `signal` and `from-executor` are injected on it per escalation so the re-resolve sees the failure context without mutating the caller's flags.
- **Shim build failure during escalation**: first attempt is a hard return; later attempts push to `output.error` and break the loop — no silent swallow.
- **JSON output suppression**: escalation reports are gated on `!jsonOutput`. The `resolveStageModelPolicy` "Stage escalation:" message is always emitted when `fromExecutor` is set.
### Testing
**Verification verdict: PASS**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `classifyObjectiveFailure` at `packages/app/src/services/agent-service.ts:1291` detects timeout and precise resource-exhaustion signals. |
| R2 | MET | `packages/app/src/services/agent-service.ts:701-734` feeds the signal into stage resolution and retries on the selected tier. |
| R3 | MET | `packages/app/src/services/agent-service.ts:725` reports failed executor/tier, reason, and selected executor/tier; tests assert it. |
| R4 | MET | `packages/app/src/services/agent-service.ts:715` reports chain exhaustion and attempted executors; tests assert both names. |
| R5 | MET | `resolveModelPolicyFallback` and `pickStartingTier` are absent; `getNextFallback` has a live consumer. |
| R6 | MET | `packages/app/src/services/agent-service.ts:543` bounds by fallback length; the attempted-executor set prevents revisits. |
| R7 | MET | `packages/app/tests/services/agent-service.test.ts:2005` proves a 429 causes `pi` → `claude`; a new regression check covers escalated dispatch errors. |
| R8 | MET | Classifier and policy share the 0405 `ObjectiveEscalationSignal` vocabulary. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R4 — Exhaustion escalates to the next tier without operator involvement | MET | test | 429 is injected without `--signal`; dispatches are `pi`, then `claude`. |
| R5 — Escalation is observable | MET | test | Diagnostics test asserts failed executor, reason, and retry executor. |
| R6 — The chain is exhausted honestly | MET | test | Exhaustion test asserts non-zero exit, exactly two dispatches, and both executor names. |
| The escalation loop is bounded | MET | test | Two configured executors produce exactly two dispatches. |
| R7 — No specified-but-unused selection machinery remains | MET | command | `rg` finds neither dead helper; `getNextFallback` has live/test consumers. |
| R9 — Fallback is proven by test, not by wiring | MET | test | Observable second higher-tier dispatch and success are asserted. |
| R10 — The repository stays green | MET | command | `bun run spur-check`, `bun run test-cf`, and `bun run build` all exited 0. |

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Detection is centralized in `executeRun`; retry input/correlation are preserved; loop is bounded. |
| trace-result-pairing | pass | Fix pass assigns an invocation only after its dispatch returns; regression test prevents prior-result/next-invocation mismatches. |
| SECUA | pass | One major correctness defect was repaired and covered; no blocker or unresolved major remains. |
| repository | pass | `bun run spur-check`: 4318 pass, 0 fail; 99.32% functions / 99.28% lines. `bun run test-cf`: 1 passed. `bun run build`: exit 0. |

Fix-pass artifact: `.spur/run/0407-verdict.json:1-31` (fresh evidence plus trace/result-pairing remediation).
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | agent-service tests (escalation + existing) | — | 95 pass / 0 fail (238 expect calls) — includes 2 new 0407 tests + 93 existing. Re-run this turn. |
| P4 | full app + domain test suite | — | 1966 pass / 0 fail — re-run this turn. |
| P4 | typecheck | — | bunx tsc --noEmit --pretty: 0 errors. |
| P4 | lint (changed files) | — | biome check on agent-service.ts, agent-service.test.ts, schema.ts, schema.test.ts: clean, no fixes needed. |
| P4 | mutation check (R7) | — | Severed classifyObjectiveFailure → return undefined. Both 0407 tests failed (2 fail). Restored → 95 pass. Escalation path is load-bearing for the tests. |
| P4 | schema tests | — | 52 pass / 0 fail in stage-registry schema.test.ts — includes updated fallback-count assertions with resource-exhaustion entries. |
### References

H9

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-01T21:26:21.682Z todo → wip (system)
- 2026-08-01T21:29:30.586Z wip → testing (system)
- 2026-08-01T21:29:39.419Z testing → done (system)
