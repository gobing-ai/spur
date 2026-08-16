---
template: standard
schema_version: 1
name: "Authoring-time task size warning on spur task create / update --section (ADR-051 consent pending)"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T23:28:49.554Z"
updated_at: "2026-08-16T23:31:44.181Z"
---

## 0575. Authoring-time task size warning on spur task create / update --section (ADR-051 consent pending)

### Background
Split out of task 0568 (2026-08-16) so that task could clear its own size gate: 0568 carried 6 R-items against `maxReqs: 5` (`bun plugins/sp/scripts/task-size-precheck.ts --wbs 0568` → `FAIL — 6 R-items, 6 Plan items`). Parking this requirement drops 0568 to 5 and clears the gate — the remaining five requirements are all doc/skill/parser work with no consent gate.

**Held pending operator consent.** This is a change to the **public** `spur` CLI surface (`spur task create`, `spur task update --section`), which per **ADR-051** requires explicit operator consent with design context before it is built, plus `docs/04_DESIGN.md` updated in the same commit (T3). Operator decision 2026-08-16: **parked** — not approved, not rejected. Do not implement without revisiting that call.

The underlying gap is real: the size gate today fires first at *pipeline precheck*, which is after a task has already been authored, refined, and queued. An authoring-time warning surfaces the same signal at the moment the oversize is created, when it is cheap to fix. 0568 itself is the worked example — it was authored at 6 R-items and nothing said so until it was picked up for execution.
### Requirements
- [ ] R1. Add a plan-time size warning at authoring time (not first at pipeline precheck): `spur task create` and `spur task update --section Plan|Requirements` emit a visible non-blocking stderr warning when R-item count > 5 or Plan checklist items > 8, reusing `evaluateTaskSize` / `countRItems` / `countPlanItems` and `DEFAULT_TASK_SIZE_LIMITS` from `packages/app/src/services/task-size-precheck.ts`. Acceptance: a task authored with 9 Plan items produces the warning before any pipeline run; zero false positives on a conforming 8-item task; the plugin parity test (`plugins/sp/tests/task-size-precheck.test.ts:76`) still passes. Surface-change note: this touches the public CLI and requires operator consent per ADR-051 + `docs/04_DESIGN.md` in the same commit (T3).
### Acceptance Criteria
```gherkin
Scenario: R1 — Authoring an oversized task warns at write time
  Given a task authored with 9 Plan checklist items
  When `spur task update <wbs> --section Plan --from-file <path>` completes
  Then a non-blocking warning naming the count versus the cap is printed to stderr
  And the write itself still succeeds (the pipeline precheck remains the hard gate)

Scenario: R1 — A conforming task stays silent
  Given a task with 5 R-items and 8 Plan items
  When it is created or its Plan section is updated
  Then no size warning is emitted (zero false positives)

Scenario: R1 — The caps are not duplicated in the CLI layer
  Given the warning is wired in `apps/cli/src/commands/task.ts`
  When the thresholds are read
  Then they come from `DEFAULT_TASK_SIZE_LIMITS` in `packages/app/src/services/task-size-precheck.ts`
  And `plugins/sp/tests/task-size-precheck.test.ts:76` parity stays green

Scenario: R1 — The surface change is consent-gated
  Given this task changes the public `spur` CLI surface
  When implementation begins
  Then explicit operator consent per ADR-051 is recorded first
  And `docs/04_DESIGN.md` is updated in the same commit (T3)
```
### Q&A
Q3, Q4 and Q8 moved verbatim from task 0568's Q&A at the 2026-08-16 split — all three are specific to this requirement.

**Q3: Where should the plan-time size check live?** Reuse the caps already centralized in
`packages/app/src/services/task-size-precheck.ts` (`maxReqs: 5`, `maxPlanItems: 8` via the
`LARGE_TASK_REQS`/`LARGE_TASK_PLAN_ITEMS` constants) rather than duplicating them. The cheapest
surface is a `spur task check --size` mode (or an authoring-time warning in `task create` /
`task update --section Plan`), so the authoring session sees it before any pipeline run. The
`task-size-precheck.ts` script and the app service must stay in parity — there is already a test
pinning them (`plugins/sp/tests/task-size-precheck.test.ts` "plugin large-task thresholds stay
aligned").

**Q4: Hook vs guidance?** A hook (e.g. task-file-policy) could block Plan writes over the cap,
but that is heavier than needed and risks false positives during legitimate multi-edit workflows.
A visible authoring-time warning is the right calibration — the pipeline precheck remains the hard
gate; this requirement just moves the discovery earlier so the operator does not burn a run +
round-trip.

**Q8: New CLI flag or warning on existing verbs?** Warning on `task create` /
`task update --section` — no new flag, no new noun (ADR-051 noun discipline). The change still
touches the public CLI surface, so operator consent + `docs/04_DESIGN.md` in the same commit (T3)
are required. Caps and counting logic are reused from the app service, never duplicated in the CLI
layer (ADR-021).

**Q10 (2026-08-16): Why is this its own task?** Split from 0568, which carried 6 R-items against
`maxReqs: 5` and therefore failed its own size gate (`task-size-precheck --wbs 0568` →
`FAIL — 6 R-items, 6 Plan items`). This was the only requirement in that set behind a consent gate,
so parking it both cleared 0568 to exactly 5 R-items and isolated the decision the operator still
owns. Worth noting as the motivating example: 0568 was authored oversized and nothing surfaced it
until execution — precisely the gap this task closes.
### Design
Moved verbatim from task 0568's Design at the 2026-08-16 split (this was 0568's R1; it is R1 here).

**R1 — Plan-time size warning.** WHERE: `apps/cli/src/commands/task.ts` (thin wiring; ADR-021) calling `evaluateTaskSize` / `countRItems` / `countPlanItems` + `DEFAULT_TASK_SIZE_LIMITS` from `packages/app/src/services/task-size-precheck.ts:112` (currently no CLI consumer — the pipeline precheck shells the plugin script's own copy). WHAT: after a successful `spur task create` and `spur task update --section Plan|Requirements`, count R-items/Plan items in the resulting task body and print a non-blocking stderr warning naming the count vs cap. WHY warning-not-block: hooks blocking writes risk false positives in legitimate multi-edit workflows; the pipeline precheck remains the hard gate. GATES: public-CLI surface change → operator consent per ADR-051 + `docs/04_DESIGN.md` same commit (T3). Parity test to keep green: `plugins/sp/tests/task-size-precheck.test.ts:76` ("plugin large-task thresholds stay aligned"). Anti-pattern: do NOT duplicate the caps in the CLI layer, and do NOT add a new noun/verb.

**Consent status.** Parked by operator decision 2026-08-16 — neither approved nor rejected. Implementation must not begin until that call is revisited and recorded.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
