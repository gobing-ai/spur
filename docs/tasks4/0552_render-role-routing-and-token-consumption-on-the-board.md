---
template: feature-impl
schema_version: 1
name: "Render role routing and token consumption on the Board"
description: ""
status: todo
type: task
profile: standard
feature_id: J7
parent_wbs: null
priority: P2
tags: []
dependencies: ["0546", "0547"]
ac_numbering: task-local
created_at: "2026-08-14T00:48:41.426Z"
updated_at: "2026-08-14T00:51:53.618Z"
---

## 0552. Render role routing and token consumption on the Board

### Background
Feature J6 (batch 2) ships the routing data: the decision on every run (task 0545), a queryable
role-to-executor aggregate (0546), and token totals joined over `run_id` (0547). J6's scope
deliberately excludes rendering it, because feature J4 owns Board surfaces.

Data reachable only by query is, in practice, data nobody looks at. A `scribe` role quietly served by
a `capable-3` executor stays invisible for exactly as long as nobody runs the query — which defeats
the point of recording it.

This task renders it. The hard part is not the chart; it is **not lying with a number**. The
underlying data carries three distinctions that are easy to flatten in a UI and expensive to flatten:
unmeasured is not zero, estimated is not exact, and no-data-yet is not no-activity.
### Requirements
- [ ] **R1.** A Board surface shows the role-to-executor routing aggregate: per pair, the run count
      and the escalation count, with role-resolved runs distinguished from explicitly pinned ones.
      Consume task 0546's query; add no query of this task's own. Measurable: a known dataset renders
      the same counts the query returns, with pinned and resolved shown separately.
- [ ] **R2.** Token totals render alongside: input, cache-read, cache-write, and output per role,
      from task 0547. No dollar figure appears anywhere — excluded permanently by operator ruling
      2026-08-13, not deferred. Measurable: the rendered surface contains no currency value, asserted
      by test.
- [ ] **R3.** Unmeasured renders as unmeasured, never as zero. A role whose runs found no matching
      history rows is visually distinct from a role that genuinely consumed nothing. Measurable: a
      dataset containing both states renders them differently.
- [ ] **R4.** An estimated total (time-window join) is marked estimated and never shown as exact
      (`run_id` join). Measurable: a mixed dataset renders both with the distinction visible.
- [ ] **R5.** An empty dataset states that nothing has been recorded rather than rendering zeroes a
      reader could mistake for measurements. Measurable: with no attribution recorded, the surface
      shows an explicit empty state.
### Acceptance Criteria
Covers feature J7 scenarios:

- **R1 — Routing is visible on the Board**
- **R2 — Token totals render beside the routing they belong to**
- **R3 — Unmeasured and estimated states render as themselves**
- **R4 — An empty dataset reads as empty, not as zero activity**

```gherkin
Scenario: R1 — Routing is visible on the Board
  Given persisted routing attribution
  When the Board surface is opened
  Then it shows per role and executor the run count and the escalation count
  And it distinguishes role-resolved runs from explicitly pinned ones

Scenario: R2 — Token totals render beside the routing they belong to
  Given token totals attributed by role
  When the surface is read
  Then it shows input, cache-read, cache-write, and output totals per role
  And it shows no dollar figure anywhere

Scenario: R3 — Unmeasured and estimated states render as themselves
  Given a role with no matched history rows and a role whose totals came from the time-window join
  When both are displayed
  Then the first reads as unmeasured rather than as zero
  And the second is marked estimated rather than shown as exact

Scenario: R4 — An empty dataset reads as empty, not as zero activity
  Given no routing attribution has been recorded yet
  When the surface is opened
  Then it states that no data has been recorded
  And it does not render zeroes that could be mistaken for measured values
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Render, do not re-derive (R1).** Tasks 0546 and 0547 expose the aggregate and the token totals. This
surface consumes them through the existing typed client. A second query here would be a second place
the numbers can be wrong.

**Three honest states are the actual requirement (R3/R4/R5).** A dashboard that renders unmeasured,
estimated, and no-data-yet all as `0` is worse than no dashboard, because it converts a known gap into
an apparent measurement. The distinctions come from upstream and must survive rendering:

| Upstream state | Source | Must not render as |
| --- | --- | --- |
| unmeasured — no matched history rows | task 0547 R3 | `0` |
| estimated — time-window join | task 0547 R4 | an exact figure |
| no data yet | empty result | zero activity |

**No prices (R2).** Not a deferral — a permanent boundary (feature J6 § *Tokens, not prices*). If a
reviewer finds a currency symbol on this surface, it has failed its own contract.

**Extend, do not add a module.** Feature J4 (done) established Board observability surfaces and M3
owns Teams UX. This is a surface within that established structure, not a peer to Teams and
Observability. If the data seems to demand its own module, that is a question for the operator, not a
decision to take here.

**Follow the design system.** Root `DESIGN.md` is the UI SSOT when present — read it before laying
anything out, and keep tokens, typography, and responsive behaviour consistent with it.

**Not in scope:** producing the data (J6), any new observability table or transport, and any change
to routing behavior.
### Plan
- [ ] Read root `DESIGN.md` and the existing J4 surfaces, then render task 0546's role-to-executor aggregate with run and escalation counts (R1)
- [ ] Show role-resolved and pinned runs separately (R1)
- [ ] Render per-role token totals from task 0547 with no currency value anywhere (R2)
- [ ] Render unmeasured distinctly from observed zero (R3)
- [ ] Mark estimated totals as estimated, distinct from exact (R4)
- [ ] Render an explicit empty state when nothing has been recorded (R5)
- [ ] Add tests including a dataset mixing measured, unmeasured, estimated, and empty (R1-R5)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Data sources to consume (add no query):** task 0546 (role-to-executor aggregate), task 0547
  (token totals per role, with unmeasured and estimated states)
- **State distinctions to preserve:** task 0547 R3 (unmeasured ≠ zero; never-fabricate invariant at
  `packages/domain/src/analytics/run-cost.ts:240`), task 0547 R4 (estimated ≠ exact)
- **Pricing boundary (R2):** feature J6 § *Tokens, not prices* — permanent exclusion, operator ruling
  2026-08-13
- **Surfaces to extend, not duplicate:** feature J4 (Board observability and Teams supervisor
  surfaces, done); feature M3 (Teams board UX, verifying)
- **UI SSOT:** root `DESIGN.md` when present (CLAUDE.md § *Design system*); web app under `apps/web/`
  with the typed oRPC client
- **Upstream dependency:** feature J6 tasks 0546 and 0547 must be done first
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
