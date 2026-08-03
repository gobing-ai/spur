---
template: issue
schema_version: 1
name: "Feature lifecycle deadlock: two P0 features in active can never transition out"
description: ""
status: todo
type: issue
profile: standard
feature_id: F4
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-03T00:40:11.223Z"
updated_at: "2026-08-03T00:41:02.057Z"
---

## 0418. Feature lifecycle deadlock: two P0 features in active can never transition out

### Background
Two P0 features in `active` deadlock the feature lifecycle permanently: neither can transition
forward, and neither can transition backward. There is no CLI path out.

**Live instance (2026-08-02):** F2 (`Task management CLI`, P0) and F4 (`Lifecycle and events`, P0)
are both `active`. Both are finished work — every linked task in each is `done` — but both are stuck.

**Reproduction (observed, not hypothetical):**

```
$ spur feature update F2 verifying
GuardDeniedError: Lifecycle transition denied for feature F2:
  Guard "shell" denied transition from "active" to "verifying" —
  F2 (active): FAIL
    [ERR] L3 : One-active-goal violated: P0 feature "F4" is already active

$ spur feature update F4 verifying      # the mirror image
  [ERR] L3.one-active-goal: One-active-goal violated: P0 feature "F2" is already active

$ spur feature update F4 backlog        # no way back either
GuardDeniedError: No transition from "active" to "backlog"
```

**Why it is closed with no exit:**

1. `packages/app/src/services/feature-check.ts:332` — the one-active-goal rule fires on any *other*
   P0 feature whose status is `active` **or** `verifying`, at severity `error`. Advancing to
   `verifying` therefore does not relieve the conflict for the other feature.
2. `.spur/workflows/feature-lifecycle.yaml:37` — the path is forward-only
   (`backlog → active → verifying → done`). There is no `active → backlog` edge, so a feature cannot
   be de-escalated out of the conflicting state.
3. The guard at the `active→verifying` placement invokes `spur feature check`
   (`.spur/workflows/feature-lifecycle.yaml:7-8`), so the error is blocking, not advisory.

Each feature's only forward edge is guarded by a check that fails because of the other; the backward
edge does not exist. The state is unreachable-from and unescapable.

**How the corpus reaches this state without anyone doing anything wrong:** feature activation happens
as a side effect of task completion. F4 went `backlog → active` on 2026-07-25 (system). F2 went
`backlog → active` on 2026-08-03 (system) when task 0416 completed. No operator ever chose to have two
P0 goals active; the lifecycle put the corpus into a state its own rules forbid and cannot leave.

**Current workarounds are all bad:** demoting a feature's `priority` off P0, or hand-editing `status`
in feature frontmatter. Both defeat the WIP limit rather than satisfying it, and the second violates
the CLI-gated corpus-write contract.

Found during the `/sp:dev-verify 0416 --fix all` shippable gate.
### Requirements
- R1. **A corpus with two active P0 features must be recoverable through the CLI.** From the live
  F2/F4 state, an operator can reach a legal single-active-goal state using `spur feature` verbs
  alone — no frontmatter hand-edits, no priority demotion used as a workaround.

- R2. **Root-cause the closed cycle, do not just widen the escape hatch.** The defect is the
  combination of a blocking cross-feature rule with a forward-only FSM. Decide explicitly which side
  gives: a de-escalation edge out of `active`, a rule that does not block the transition that would
  *relieve* it, or an override verb. Record the rationale.

- R3. **The lifecycle must not create states its own rules forbid.** Auto-activation on task
  completion currently produces a two-P0-active corpus with no warning. Either the activation path
  respects the one-active-goal limit, or the limit stops being a blocking error — the two must be
  consistent.

- R4. **Regression coverage.** Tests prove the deadlock cannot recur: a fixture with two P0 active
  features can be driven back to a legal state through the CLI, and the transition that relieves the
  conflict is not itself blocked by it.
### Acceptance Criteria
```gherkin
Feature: Feature lifecycle deadlock recovery

  Scenario: A two-P0-active corpus is recoverable via the CLI
    Given two P0 features are both in status active
    When an operator uses spur feature verbs to restore a single active goal
    Then the transition succeeds without editing frontmatter by hand
    And neither feature's priority has to be demoted to work around the rule

  Scenario: The relieving transition is not blocked by the rule it relieves
    Given two P0 features are both in status active
    When one is transitioned along the path that would leave a single active goal
    Then the one-active-goal rule does not deny that transition

  Scenario: Auto-activation cannot silently create a forbidden state
    Given a P0 feature is already active
    When completing a task auto-activates a second P0 feature
    Then the conflict is surfaced at the moment it is created
    And the corpus is not left in a state with no legal exit

  Scenario: Regression coverage for the deadlock
    Given a fixture with two P0 features in active
    When the lifecycle test suite runs
    Then a test proves the corpus can be driven back to a legal state
    And removing the fix makes that test fail
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Not yet decided — this records the option space found while diagnosing, so whoever picks it up does
not have to re-derive it. R2 requires an explicit choice with rationale.

**Option A — add a de-escalation edge (`active → backlog`).**
Smallest FSM change; gives an unconditional way out of the conflicting state. But `backlog` is
semantically wrong for finished work (both F2 and F4 have all linked tasks `done`), so this creates a
correct-but-misleading corpus unless paired with a better target status.

**Option B — make the one-active-goal rule direction-aware.**
The rule currently blocks the very transition that would resolve it. `active → verifying` on the
older goal *reduces* the number of `active` P0s; denying it is the actual bug. Narrow the rule so it
does not block a transition that strictly moves a feature toward terminal. Most targeted fix; leaves
the WIP limit's intent intact. Note `verifying` is currently counted alongside `active`
(`feature-check.ts:332`), so relieving via `verifying` needs that treatment revisited too.

**Option C — an explicit override verb.**
`spur feature update <id> <status> --force-goal` mirroring the task-side `--force-done` precedent
(recorded, auditable). Honest escape hatch, but it does not stop the lifecycle from manufacturing the
state (R3) — it only makes it survivable. Probably a complement to A or B, not a substitute.

**Preference:** B as the root-cause fix, plus R3's activation-side guard so the state stops being
created silently. A/C are escape hatches for corpora already stuck — the live F2/F4 pair needs one of
them to recover regardless of which long-term fix lands.

**Do not** resolve this by demoting a feature's `priority` off P0 or by hand-editing `status`
frontmatter. Both defeat the WIP limit rather than satisfying it, and the second breaks the CLI-gated
write contract.
### Plan
- [ ] Decide the R2 fix shape (Option A / B / C above) and record the rationale in `### Design`.
- [ ] Implement the chosen fix in `packages/app/src/services/feature-check.ts` and/or
      `.spur/workflows/feature-lifecycle.yaml`.
- [ ] Add the R3 activation-side guard so task completion cannot silently create a second active P0.
- [ ] Recover the live F2/F4 pair through the CLI once a legal path exists; confirm
      `spur feature check F2` and `spur feature check F4` both drop the `L3.one-active-goal` error.
- [ ] R4 regression tests: two-P0-active fixture is recoverable; the relieving transition is not
      denied by the rule it relieves. Mutation-check both.
- [ ] `bun run lint`, `bun run test`, `bun run build`.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
