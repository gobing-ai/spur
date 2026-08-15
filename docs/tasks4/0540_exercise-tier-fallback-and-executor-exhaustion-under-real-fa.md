---
template: feature-impl
schema_version: 1
name: "Exercise tier fallback and executor exhaustion under real failure"
description: ""
status: done
type: task
profile: standard
feature_id: I3
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T23:28:17.816Z"
updated_at: "2026-08-15T07:33:54.725Z"
---

## 0540. Exercise tier fallback and executor exhaustion under real failure

### Background
Tier fallback shipped through H9/0407 and was extended by 0482 (unreachable tier-fallback) and 0485
(exhaustion failover, classifier coverage) — all done. The operator's standing observation, restated
2026-08-13, is that it has still never been exercised well under real failure: the mechanism is
tested at the unit level but the end-to-end escalation path has not been driven.

That matters more after feature B2 lands, not less. Once a **role** selects the starting tier on every
dispatch path instead of only where a prompt matched a regex, escalation stops being a rarely-reached
branch and becomes the routine response to a stage failing on its cheapest eligible executor.

Escalation itself is unchanged by B2 — `getNextFallback` stays in the domain package per 0348. This
task exercises it; it does not redesign it.
### Requirements
- [ ] **R1.** Exercise tier fallback under real failure rather than asserting it. Drive a stage
      whose starting-tier executor fails on an objective signal (`gate-fail`, `timeout`,
      `insufficient-evidence`, `retry-exhausted`) and confirm the next eligible executor by the
      declared chain runs, with the transition and its trigger observable in the run record.
      Measurable: a test or recorded run shows the escalation and names the trigger.
- [ ] **R2.** Executor exhaustion fails loudly. When every eligible executor for a stage has failed
      and no fallback target remains, the run exits non-zero naming the stage, the tiers attempted,
      and the executors tried — never falling through to `agent.default` or a bare binary.
      Measurable: an exhaustion run's exit code is non-zero and its message carries all three.
- [ ] **R3.** An unreachable fallback target is distinguished from a failed one. When escalation
      reaches a tier for which no executor is configured, the run reports it as unreachable naming
      the tier and continues to the next reachable tier rather than terminating as exhausted.
      Measurable: a config with a gap in the tier ladder produces the unreachable report and the run
      continues. Prior art to read first: tasks 0407, 0482, and 0485.
### Acceptance Criteria
Covers feature I3 scenarios:

- **R4 — Tier fallback is exercised under real failure, not asserted**
- **R5 — Executor exhaustion fails loudly**
- **R6 — An unreachable fallback target is distinguished from a failed one**

```gherkin
Scenario: R4 — Tier fallback is exercised under real failure, not asserted
  Given a stage whose starting-tier executor fails on an objective signal
  When the run escalates
  Then the next eligible executor by the declared fallback chain runs
  And the transition is observable in the run record with the trigger that caused it

Scenario: R5 — Executor exhaustion fails loudly
  Given every executor eligible for a stage has failed
  When no fallback target remains
  Then the run exits non-zero naming the stage, the tiers attempted, and the executors tried
  And it does not silently fall through to agent.default or to a bare binary

Scenario: R6 — An unreachable fallback target is distinguished from a failed one
  Given a fallback tier for which no executor is configured
  When escalation reaches that tier
  Then the run reports the fallback as unreachable, naming the tier
  And it continues to the next reachable tier rather than terminating as exhausted
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Drive it, do not assert it.** The deliverable is evidence that a real escalation happened, not a
unit test that `getNextFallback` returns the next entry — that already exists. Prefer a recorded run
or an integration test that spawns the real resolution path over a mock that returns a canned signal.

**Three behaviors, three distinct outcomes** — the point is that they are currently hard to tell
apart from the outside:

| Condition | Correct outcome |
| --- | --- |
| Starting-tier executor fails on an objective signal | escalate to the next eligible executor; record the trigger (R1) |
| Every eligible executor has failed | exit non-zero naming stage, tiers attempted, executors tried (R2) |
| Fallback tier has no executor configured | report unreachable, continue to the next reachable tier (R3) |

R2 and R3 are the pair most likely to be conflated today: a gap in the operator's tier ladder looks
like exhaustion, so a run that should have continued terminates instead. `.spur/config.yaml` in this
repo has exactly such a gap — `capable-2` is commented out while `capable-1` and `capable-3` are
live — which makes it a ready-made fixture.

**Observability is part of the requirement.** An escalation the operator cannot see in the run record
is not verified behavior. Check what the run record and system events actually carry for a fallback
transition; if the trigger is not there, adding it is in scope.

**Not in scope:** changing the fallback chain, the tier vocabulary, or where escalation lives.
### Plan
- [ ] Read 0407, 0482, and 0485 to establish what is already covered and avoid re-testing it (R1)
- [ ] Build a fixture where the starting-tier executor fails on an objective signal (R1)
- [ ] Verify the next eligible executor runs and the run record carries the transition and trigger (R1)
- [ ] Add the trigger to the run record if escalation is not currently observable (R1)
- [ ] Drive an exhaustion run and assert non-zero exit naming stage, tiers attempted, executors tried (R2)
- [ ] Assert no fall-through to `agent.default` or a bare binary on exhaustion (R2)
- [ ] Use the live `capable-2` ladder gap as a fixture; assert unreachable is reported and the run continues (R3)
- [ ] Run `bun run autofix && bun run spur-check`
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/agent-service.ts:1034` |
| `packages/app/src/services/agent-service.ts:1386` |
| `packages/app/src/services/agent-service.ts:709` |
| `packages/app/src/services/agent-service.ts:985` |
| `packages/app/src/services/agent-service.ts:991` |
| `packages/app/tests/services/agent-service.test.ts:3210` |
| `plugins/sp/scripts/feature-sync-bounded.ts:23` |
| `plugins/sp/scripts/feature-sync-bounded.ts:244` |
| `plugins/sp/scripts/feature-sync-bounded.ts:260` |
| `plugins/sp/scripts/feature-sync-bounded.ts:429` |
| `plugins/sp/scripts/task-size-precheck.ts:100` |
| `plugins/sp/scripts/task-size-precheck.ts:69` |
| `plugins/sp/scripts/task-size-precheck.ts:90` |
| `plugins/sp/tests/feature-sync-bounded.test.ts:11` |
| `plugins/sp/tests/feature-sync-bounded.test.ts:21` |
| `plugins/sp/tests/feature-sync-bounded.test.ts:337` |
| `plugins/sp/tests/feature-sync-bounded.test.ts:636` |
| `plugins/sp/tests/task-size-precheck.test.ts:48` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `agent-service.test.ts:3266` drives a real `executeRun` stage whose starting-tier executor dies by SIGKILL → classified `timeout` (`failure-classification.ts:84`); escalation to the declared next tier (standard→capable-1) observed on stderr and as structured `agent.invoke.escalated` record (`agent-service.ts:1003-1024`). Mutation check: severing the timeout classifier fails the test. |
| R2 | MET | Exhaustion run exits non-zero; message names stage + tiers attempted + executors tried (`agent-service.ts:991`, `tiersAttempted` :712/:1034; test :3295). With `agent.default` configured, exactly 2 dispatches occur — no fall-through. |
| R3 | MET | Both gap variants covered: fallback-reaches-gap (`verify`, test :3320) and starting-tier/min_tier gap (`plan`, test :3352). Unreachable report names the tier (:1393); eligible `>=`-walk continues to the next reachable tier instead of terminating exhausted. Fixture mirrors the live `.spur/config.yaml` capable-2 gap. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
### References
- **Mechanism under test (do not change):** `packages/domain/src/stage-registry/schema.ts:432-444`
  (`getNextFallback`), `:425-427` (`isTierEligible`), `:314-410` (model policy / trigger vocabulary),
  `packages/app/src/services/agent-service.ts:996` + `:1142` (starting-tier selection)
- **Prior coverage to read before adding any test:** tasks 0407 (automatic fallback on objective
  failure), 0482 (unreachable tier-fallback), 0485 (exhaustion failover, classifier coverage)
- **Existing tests:** `packages/app/tests/services/agent-service.test.ts:2010`, `:2056`, `:2093`;
  `packages/domain/tests/stage-registry/schema.test.ts`
- **Ready-made fixture:** `.spur/config.yaml` has a live gap in the tier ladder — `capable-2` is
  commented out while `capable-1` (`omp-deepseek`) and `capable-3` (`codex-sol`) are declared, so
  stage `plan` (`min_tier: capable-2`) must escalate past an unconfigured tier
- **Observability surface:** run record + `system_events` v2 envelope
  (`docs/design/actionable-observability-context.md`, `docs/04_DESIGN.md §7.9`)
### History
- 2026-08-15T07:15:49.809Z todo → wip (system)
- 2026-08-15T07:33:53.550Z wip → testing (system)
- 2026-08-15T07:33:54.725Z testing → done (system)
