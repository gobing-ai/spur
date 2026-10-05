---
schema_version: 1
name: Dispatch a task created after the fleet loops start, and finalize a killed member turn
status: backlog
template: feature-impl
created_at: 2026-10-05T23:56:25.473Z
updated_at: "2026-10-05T23:56:27.394Z"
feature_id: G71

---

## 1091. Dispatch a task created after the fleet loops start, and finalize a killed member turn

### Background

Task 1077's end-to-end harness (`scripts/commands/fleet-e2e.ts`, landed at 8 of 9 steps green) refuted
two behaviours needed by the plan §1 kill/re-dispatch scenario. Both are recorded with reproducible
evidence in `docs/reports/2026-10-05-fleet-e2e-kill-leg-findings.md`; task 1077 stays open on them.

**K1 — the orchestrator does not dispatch a task created after its loops started.** With the member
loops already running, a `fleet:auto` task created afterwards (prepared so `task check --as wip`
passes, promoted to `todo`) is never dispatched: over 240 s of polling **with a real CLI nudge to the
planner on every poll** (`spur message send --to <planner> "tick for <wbs>"`), the member's inbox never
receives a `fleet:task:<wbs>:1` row and the task stays `todo`. The same task created *before* the loops
start is dispatched on the first tick, every run.

**K2 — a run for an operator-dispatched (unkeyed) turn never finalizes when the member is killed.**
With the operator path (`message send --to <coder> "/sp:dev-run <wbs> --auto"`), the member turn
starts and hangs; the loop is killed and restarted (restart happens *before* the receipt poll, so its
reconcile can run); `spur message inbox --json` still reports `runStatus: running` for the whole
90 s budget. The keyed strategy dispatch finalizes as `errored` after the same kill (observed in the
same session), so finalization appears tied to the keyed correlation — an inference, not yet read in
the run-finalization path.

### Requirements

- [ ] R1. A `fleet:auto` task that becomes `todo` after the member loops are already running is dispatched by the orchestrator within a bounded time, with a keyed attempt row (`fleet:task:<wbs>:1`) appearing in the member's inbox — without an operator message being required to wake it.
- [ ] R2. A member turn dispatched from an operator (unkeyed) inbox message reaches a terminal run receipt when the member loop is killed mid-turn and restarted: the inbox row's `runStatus` leaves `running` within a bounded time, exactly as the keyed dispatch path already does.
- [ ] R3. Task 1077's harness reaches 9 of 9 steps with `kill-redispatch` green through the *strategy* dispatch (its attempt-2 key assertion restored), and the receipt records it.

### Acceptance Criteria

```gherkin
Scenario: R1 — A late-created fleet:auto task is dispatched
  Given running member loops and an orchestrator bound to the project
  And a fleet:auto task created and promoted to todo after those loops started
  When the orchestrator's next tick runs
  Then a keyed dispatch message reaches the member inbox without any external nudge
  And the member process runs the turn

Scenario: R2 — A killed operator-dispatched turn reaches a terminal receipt
  Given a member turn started from an operator inbox message with no keyed request
  When the member loop is killed mid-turn and restarted
  Then the inbox row's runStatus becomes terminal (not running) within the bounded budget

Scenario: R3 — The harness proves the kill/resume leg through the strategy
  Given the fixes above
  When scripts/commands/fleet-e2e.ts runs
  Then all nine steps pass
  And kill-redispatch asserts the strategy's attempt-2 key alongside the --continue resume
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **K1.** Start from the tick triggers: `StrategyRuntime.tick` is driven by the loop's wake set
  (`agent-loop-service.ts`), and a corpus change is not one of them. Decide the intended contract —
  either the loop ticks on a backstop (`--poll`) regardless of wakes, or the task-creation path emits a
  wake the orchestrator follows (`task.created`/`task.updated` already exist in the event catalog) —
  then make the harness's late-created task provable without an operator nudge.
- **K2.** Trace run-row finalization on kill: who writes `coordination_runs.status`/`completed_at` for a
  turn whose loop died, and why the unkeyed path leaves it `running` while the keyed path reaches
  `errored`. `DeliveryReconciler` / the loop's startup reconcile is the likely owner; confirm by
  reading the path before changing it.
- **R3.** With K1/K2 fixed, restore the harness's keyed attempt-2 assertion (currently replaced by
  explicit evidence) and re-run to 9 of 9; the receipt then unblocks task 1077's AC.
- Evidence for all three: `docs/reports/2026-10-05-fleet-e2e-kill-leg-findings.md`,
  `docs/reports/fleet-e2e-receipt.json`, and the kept scratch projects created by
  `bun scripts/spur-dev.ts fleet-e2e --keep`.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
