---
template: issue
schema_version: 1
name: "Headless HITL taste gates cannot be approved after the fact"
description: ""
status: todo
type: issue
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-04T17:26:20.903Z"
updated_at: "2026-08-04T18:34:14.392Z"
---

## 0433. Headless HITL taste gates cannot be approved after the fact

### Background



### Requirements
A HITL taste gate cannot be approved from a non-interactive session once the run has paused. The
only ways to answer "yes" are decided before the run starts, which defeats the purpose of a gate
whose entire job is to pause for a human.

Mechanics:

- Without a TTY, `hitlResponder` returns `DefaultHitlResponder({ confirmDefault: 'no' })`
  (`apps/cli/src/context.ts:95-99`). `SPUR_HITL_AUTO_APPROVE=1` flips the default to `yes`.
- `hitl.confirm` runs on state entry and persists the answer into `__hitlAnswer`
  (`packages/app/src/workflow/actions/hitl-confirm.ts`), *then* the state pauses. The answer is
  therefore already fixed at `no` by the time the operator sees the pause.
- `spur workflow continue` re-evaluates the persisted `__hitlAnswer`; it does not re-ask. Its
  `--yes` flag documents itself as *not* setting the persisted HITL answer, and there is no
  `--answer`/`--approve` flag on any workflow verb.

Consequences at the two `idea-pipeline.yaml` taste gates:

- `idea-eval`: persisted `no` routes to `cancelled`. A headless operator who approves has no way to
  say so — `continue` cancels the run.
- `design-approval`: persisted `no` routes back to `system-design`, which re-runs the design agent
  and re-enters the gate with the same headless `no`. That is an unbounded loop burning agent time
  on every pass.

The two available escapes are both wrong for the job: setting `idea_approved`/`design_approved` at
launch pre-answers a gate the operator has not yet seen, and `SPUR_HITL_AUTO_APPROVE=1` blanket-
approves *every* confirm in the run, including gates the operator intended to review.

Needed: a way to record an answer for a paused run's gate from a non-interactive caller — e.g.
`spur workflow continue <run-id> --answer yes|no|cancel` writing `__hitlAnswer` before the guards
re-evaluate. Also worth reconsidering: a `no` at `design-approval` should not be able to loop
indefinitely without operator input.
### Acceptance Criteria
```gherkin
Feature: Headless HITL taste gates are answerable after pausing

  @core
  Scenario: R5 — a paused taste gate is answerable without relaunching
    Given a headless workflow run paused at a hitl.confirm gate with a persisted no answer
    When the operator resumes the run with an explicit approval
    Then the gate's approve edge is taken
    And no launch-time approval var was required

  @core
  Scenario: R6 — answering one gate never implies another
    Given a headless run containing more than one taste gate
    When the operator approves the first gate
    Then the later gate still pauses for its own decision

  @core
  Scenario: R7 — a rejected design gate cannot loop unattended
    Given a headless run whose design-approval gate is answered no
    When the run re-enters system-design and returns to the gate
    Then it does not re-consume the same stale answer indefinitely
    And it either pauses for a fresh decision or terminates naming the rejected gate

  @core
  Scenario: R8 — each defect is covered at the shared mechanism
    Given the three fixes are implemented
    When the test suite runs
    Then each defect has a regression test against schema loading, the shell action, or the HITL resume path
    And no defect relies solely on a test of the single workflow file where it was observed
```

**Rejection parity (not a scenario):** `no` and `cancel` must remain separately expressible on the
resume path and must route down the edges their guards name.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause
Reproduced live on 2026-08-04 in a headless (non-TTY) session.

Run `ffcdfbfd-cae9-4cdc-b1df-f4d1058513ef` (`idea-pipeline.yaml`, `profile=auto`,
`idea_approved=false`) reached the `idea-eval` taste gate and paused as designed:

```
▶ idea-eval [running]
→ idea-eval/hitl.confirm · timeout=unbounded
✓ idea-eval/hitl.confirm (0s)
▶ idea-eval [paused]
workflow paused: idea-pipeline -> idea-eval
```

Note the confirm completed in 0s *before* the pause — the headless responder had already written
`no`. The operator then reviewed the evaluation report and approved. Resuming:

```
$ spur workflow continue ffcdfbfd-cae9-4cdc-b1df-f4d1058513ef --yes
workflow failed: idea-pipeline -> cancelled
```

The run cancelled despite an explicit human approval, because `continue` evaluated the persisted
`__hitlAnswer=no` against the guard `test "${vars.__hitlAnswer}" = yes`
(`.spur/workflows/idea-pipeline.yaml`, `from: idea-eval`). `--yes` only skips the CLI's own resume
confirmation.

The `design-approval` loop was not executed to exhaustion — its edge
`from: design-approval → to: system-design` guarded on `__hitlAnswer = no` makes the cycle
self-evident from the definition, and running it would have burned repeated ~5-minute design-agent
passes.

Workaround used to complete the session: relaunch from scratch with `idea_approved=true` and
`design_approved=true` so both gates take their auto-skip edges. That discards the run's prior work
(discovery re-ran) and pre-answers a gate rather than answering it.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
