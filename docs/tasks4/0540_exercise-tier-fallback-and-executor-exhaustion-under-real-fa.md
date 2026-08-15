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
updated_at: "2026-08-15T15:14:49.337Z"
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
- [x] **R1.** Exercise tier fallback under real failure rather than asserting it. Drive a stage
      whose starting-tier executor fails on an objective signal (`gate-fail`, `timeout`,
      `insufficient-evidence`, `retry-exhausted`) and confirm the next eligible executor by the
      declared chain runs, with the transition and its trigger observable in the run record.
      Measurable: a test or recorded run shows the escalation and names the trigger.
- [x] **R2.** Executor exhaustion fails loudly. When every eligible executor for a stage has failed
      and no fallback target remains, the run exits non-zero naming the stage, the tiers attempted,
      and the executors tried — never falling through to `agent.default` or a bare binary.
      Measurable: an exhaustion run's exit code is non-zero and its message carries all three.
- [x] **R3.** An unreachable fallback target is distinguished from a failed one. When escalation
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
- [x] Read 0407, 0482, and 0485 to establish what is already covered and avoid re-testing it (R1)
- [x] Build a fixture where the starting-tier executor fails on an objective signal (R1)
- [x] Verify the next eligible executor runs and the run record carries the transition and trigger (R1)
- [x] Add the trigger to the run record if escalation is not currently observable (R1)
- [x] Drive an exhaustion run and assert non-zero exit naming stage, tiers attempted, executors tried (R2)
- [x] Assert no fall-through to `agent.default` or a bare binary on exhaustion (R2)
- [x] Use the live `capable-2` ladder gap as a fixture; assert unreachable is reported and the run continues (R3)
- [x] Run `bun run autofix && bun run spur-check`
### Solution
Change-map (corrected 2026-08-15 — replaces the auto-generated map that had swept 0539's plugin
files from a dirty implement tree; commit 05cdcab5 touches exactly two files).

- `packages/app/src/services/agent-service.ts` (+23):
  - `packages/app/src/services/agent-service.ts:709` — `tiersAttempted` set created alongside
    `attemptedExecutors` (R2: the exhaustion report must say how far the ladder climbed, not just
    which executors died).
  - `packages/app/src/services/agent-service.ts:988` — exhaustion message extended to name the
    stage, the tiers attempted, and the executors tried; run still ends non-zero, never falling
    through to `agent.default` (R2).
  - `packages/app/src/services/agent-service.ts:1034` — each escalated tier is added to
    `tiersAttempted` on the hop (R2).
  - `packages/app/src/services/agent-service.ts:1386` — a fallback tier with no configured executor
    is reported unreachable by name and the eligible `>=`-walk continues from the next reachable
    tier instead of terminating as exhausted (R3).
- `packages/app/tests/services/agent-service.test.ts` (+165):
  - `packages/app/tests/services/agent-service.test.ts:3221` — describe block "AgentService tier
    fallback under real failure (0540)" with four tests:
    `packages/app/tests/services/agent-service.test.ts:3266` (R1 — SIGKILL→timeout through the
    production classifier, declared-chain escalation, stderr + `agent.invoke.escalated` record
    carry the trigger), `packages/app/tests/services/agent-service.test.ts:3295` (R2 — exhaustion
    non-zero naming stage/tiers/executors, `agent.default` configured and never dispatched),
    `packages/app/tests/services/agent-service.test.ts:3320` and
    `packages/app/tests/services/agent-service.test.ts:3352` (R3 — both gap variants:
    fallback-reaches-gap and starting-tier `min_tier` gap).

Not changed (design boundary): the fallback chain, the tier vocabulary, and where escalation lives
(`getNextFallback` stays in `packages/domain/src/stage-registry/schema.ts`).
### Testing
**Re-verify (--force, focus all) 2026-08-15 — Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Real resolution path driven this run: `bun test packages/app/tests/services/agent-service.test.ts --test-name-pattern "0540"` → 4 pass / 0 fail. R1 test (`packages/app/tests/services/agent-service.test.ts:3266`) feeds a signal-terminated (SIGKILL) dispatch through the production classifier — `classifyDispatch` maps signal → `timeout` (`packages/app/src/services/failure-classification.ts:84`, re-read) — escalation runs the declared chain (dispatch order `['pi','claude']`), stderr names the trigger, and the structured `agent.invoke.escalated` row carries trigger + from/to tier (emit at `packages/app/src/services/agent-service.ts:1009`, re-read). |
| R2 | MET | Exhaustion message names stage + tiers attempted + executors tried — `packages/app/src/services/agent-service.ts:988-992` (re-read: `stage=${currentStage.stageId}; tiers attempted: …; executors tried: …`); `tiersAttempted` tracked at `packages/app/src/services/agent-service.ts:711` and fed at `:1034`. Test `packages/app/tests/services/agent-service.test.ts:3295` configures `agent.default` and asserts exactly the declared-chain dispatches occur — no fall-through; run ends non-zero. |
| R3 | MET | Unreachable report names the tier and the walk continues — `packages/app/src/services/agent-service.ts:1390-1393` (re-read: "tier ${targetTier} is unreachable — no executor configured at this tier; continuing from the next reachable tier"). Both gap variants pass this run: fallback-reaches-gap (test `packages/app/tests/services/agent-service.test.ts:3320`) and starting-tier `min_tier` gap (test `:3352`). Live fixture claim confirmed: `.spur/config.yaml:115` has `tier: capable-2` commented out. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R4 — Tier fallback is exercised under real failure, not asserted | MET | test | `packages/app/tests/services/agent-service.test.ts:3266` pass this run — SIGKILL through production `classifyDispatch`, declared-chain escalation, stderr + `agent.invoke.escalated` record both carry the trigger |
| Scenario: R5 — Executor exhaustion fails loudly | MET | test | `packages/app/tests/services/agent-service.test.ts:3295` pass this run — non-zero exit; message carries stage/tiers/executors; `agent.default` configured and never dispatched |
| Scenario: R6 — An unreachable fallback target is distinguished from a failed one | MET | test | `packages/app/tests/services/agent-service.test.ts:3320` + `:3352` pass this run — unreachable named by tier, continuation to next reachable tier asserted |

**Design conformance:** 4/4 claims DONE — driven not asserted (integration harness on the real resolution path, spawn boundary only mocked); three outcomes distinct in tests; observability in the run record (escalation row existed from 0545, this task proves the trigger rides it — no addition needed); scope held (no chain/vocabulary/location change; +23 LOC observability only).

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | correctness | `packages/app/src/services/agent-service.ts:988-992` | No blocker/major/minor findings — error-path messaging only, Set-based attempt tracking, no secrets/IO. |

Coverage: N/A (verdict-based; targeted behavior tests 4/4 pass — no runtime coverage measured).
Fix-pass writes: `.spur/run/0540-verdict.json` (regenerated this run); Solution change-map corrected this run (auto-generated map had swept 0539 plugin files from a dirty tree).
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
