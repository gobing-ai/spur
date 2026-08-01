---
template: feature-impl
schema_version: 1
name: "Add inline execution mode and make it the default"
description: ""
status: todo
type: task
profile: standard
feature_id: H9
parent_wbs: null
priority: P1
tags: ["sp-plugin", "cli", "executor"]
dependencies: ["0405"]
created_at: "2026-08-01T05:22:55.714Z"
updated_at: "2026-08-01T05:30:34.132Z"
---

## 0406. Add inline execution mode and make it the default

### Background

Every dispatch currently shells out to `spur agent run`, spawning a subprocess even when the operator is already inside a capable coding agent. Measured cost of that hop on this box is substantial: a bun process exec costs roughly 2.3 seconds against 0.02 for node, and the hop buys nothing when the current agent could run the prompt directly.

The risk is not the happy path but the boundary: `--inline` must not silently swallow steps that genuinely require an isolated or differently-modelled executor. The dispatch-surface rule from feature H6 (`plugins/sp/skills/parallel-execution/references/dispatch-surface.md`) already enumerates when escalation to `spur agent run` is required — a different model, headless or unattended operation, a durable auditable record, or workspace/credential isolation. Inline must honour those triggers rather than override them.

### Requirements
R1. Add an inline execution mode that runs the prompt or slash command directly in the current coding agent, with no `spur agent run` subprocess.
R2. Make inline the default execution mode.
R3. Preserve explicit subprocess dispatch: `agent.run` workflow steps and direct `spur agent run` invocations behave as before.
R4. Inline must not override the dispatch-surface escalation triggers from H6. When a named trigger applies — a different model or agent is required, the step must run headless or unattended, a durable auditable run record is required, or workspace/credential isolation is required — the subprocess path is used regardless of the default, and the applied trigger is named.
R5. Provide an explicit way to force subprocess dispatch when the operator wants it despite the default.
R6. State what inline does not provide relative to subprocess dispatch — at minimum the loss of an isolated workspace and of a separate run record — so the default is a documented trade rather than an invisible one.
R7. Use the naming settled in task 0405 throughout.
R8. Do not change tier selection or fallback behavior here — that is task 0406.
### Acceptance Criteria
Covers feature scenarios R1 and R2.

```gherkin
Feature: inline execution mode

  Scenario: Inline is the default execution mode
    Given an operator running a dev command from within a coding agent
    When no execution mode is specified
    Then the prompt runs directly in the current agent
    And no spur agent run subprocess is spawned

  Scenario: Explicit subprocess dispatch still works
    Given a step that requires a named external executor
    When it dispatches via agent.run or spur agent run
    Then the subprocess path behaves as it did before this feature

  Scenario: A dispatch-surface trigger overrides the inline default
    Given a step requiring a different model, headless operation, an auditable record, or isolation
    When it runs under the inline default
    Then the subprocess path is used instead
    And the applied trigger is named

  Scenario: The operator can force subprocess dispatch
    Given the inline default is active
    When the operator explicitly requests subprocess dispatch
    Then the subprocess path is used

  Scenario: The trade is documented
    Given inline is the default
    When its documentation is read
    Then it states what inline does not provide relative to subprocess dispatch
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Where inline diverges from the current path

Both operator-facing entries funnel through one place: `AgentService.executeRun`. `run`
(`agent-service.ts:318-330`) and `runTraced` (`:348-358`, the pipeline/workflow entry, non-interactive
by contract) each call it and then interpret the result. Everything below `executeRun` is subprocess
mechanics — executor resolution, `AiRunner`, `ProcessExecutor`.

Inline is therefore a **branch above `executeRun`, not a variant inside it**. Trying to express
"don't spawn" as an option threaded through the runner means every layer below grows a
does-this-actually-spawn conditional, and the subprocess path — which still has to work unchanged
(R3) — gets more complex in service of the path that bypasses it.

#### The hard part is the return contract, not the dispatch

`executeRun` yields a structured outcome: `exitCode`, `signal`, `stdout`, `stderr`, `durationMs`
(`:96-103`, `:167-178`). Callers depend on those fields — `runTraced`'s R2b comment at `:354-356`
explicitly notes that `agent.run` consumes `exitCode`/`signal` to write timeout handoff artifacts.

Inline execution has no subprocess and so has no honest value for most of them. Decide deliberately
what inline returns and **do not fabricate**: a synthesized `exitCode: 0` and `durationMs: 0` would
be indistinguishable from a real successful run and would silently corrupt the handoff artifacts and
any observability keyed on them. Prefer an explicitly-marked inline outcome that downstream code can
recognise, and audit the consumers of those fields as part of this task.

This is the main correctness risk in 0406 and deserves more attention than the dispatch switch.

#### Honouring the dispatch-surface triggers (R4)

`dispatch-surface.md` already enumerates them and already requires the caller to name which one
applied. The check belongs at the same branch point as the inline decision, and it must be
*positive*: the subprocess path is chosen when a trigger applies, rather than inline being skipped
when something looks unusual. A negative formulation degrades to inline-by-accident the moment a new
trigger is added and someone forgets to add its guard.

Note the `runTraced` contract — non-interactive by design — makes it the most likely place for a
headless trigger to apply. Pipeline steps that today rely on subprocess isolation must keep it.

#### What inline cannot provide (R6)

At minimum: no isolated workspace, no separate run record, no independent timeout or abort boundary,
and the executor is whatever the operator happens to be running rather than a tier-selected one.
That last item is the coupling to task 0407 — an inline step cannot escalate to a different tier,
because there is no second process to escalate into. State that interaction explicitly; it is the
non-obvious consequence of making inline the default.
### Plan
- [ ] Re-read `dispatch-surface.md` and enumerate the escalation triggers inline must honour.
- [ ] Implement the inline path; make it the default.
- [ ] Wire trigger detection so a named trigger forces the subprocess path and reports which one applied.
- [ ] Add the explicit force-subprocess control.
- [ ] Document the trade-off.
- [ ] Verify existing agent.run steps and spur agent run are unaffected.
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
