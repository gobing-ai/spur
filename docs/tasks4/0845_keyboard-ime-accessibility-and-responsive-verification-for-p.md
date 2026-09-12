---
schema_version: 1
name: Keyboard, IME, accessibility, and responsive verification for Projects
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.546Z
updated_at: "2026-09-12T04:58:48.106Z"
feature_id: G63
priority: P2
tags:
  - g6-program

dependencies: ["0841", "0842", "0844"]
---

## 0845. Keyboard, IME, accessibility, and responsive verification for Projects

### Background

The prototype already pins the interaction contract with runnable evidence: 19 happy-dom tests and
200 assertions in `apps/web/tests/prototypes/g6-projects.test.ts`, with Chrome 153 checks at 390 px
and 1440 px (`docs/reports/g6-projects-prototype.md`, scenarios KB-1…KB-4, ST-1, LB-1).

Those tests run against `docs/prototypes/g6-projects/index.html`, not production. This task carries
the contract across to the real module so the guarantees survive the port instead of being re-derived
by hand.

The IME case is the one that silently breaks in production: Enter that ends a composition must not
submit.

### Requirements

- **R1** — Enter submits, Shift+Enter inserts a newline, and an Enter that ends an IME composition
  submits nothing.
- **R2** — Escape closes member detail and restores focus to its opener; tabs are keyboard-navigable
  with `aria-selected`.
- **R3** — Status is never color-alone: icon plus text, with live-region announcements for state
  changes.
- **R4** — Verified at 390 px and 1440 px with no horizontal overflow.
- **R5** — The prototype's KB-1…KB-4, ST-1, and LB-1 scenarios are carried to production tests, not
  left behind in the prototype suite.

### Acceptance Criteria

```gherkin
Feature: Keyboard, IME, accessibility, and responsive verification for Projects

  @core
  Scenario: R7 — Keyboard, IME, and accessibility hold
    Given the composer has focus with an IME active
    When Enter ends the composition
    Then nothing is submitted
    And Shift+Enter inserts a newline, Escape restores focus to its opener, and status uses icon plus text rather than color alone

  @core
  Scenario: Layout holds at both widths
    Given the Projects module at 390 px and at 1440 px
    When each view is rendered
    Then no horizontal overflow occurs

  @core
  Scenario: State changes are announced
    Given a request whose state changes after submission
    When the new state renders
    Then it is announced in a live region
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Evidence to carry forward: `apps/web/tests/prototypes/g6-projects.test.ts` (19 tests, 200 assertions)
- Scenario matrix: [projects prototype report](../reports/g6-projects-prototype.md) KB-1…KB-4, ST-1, LB-1; Chrome 153 at 390/1440 px
- Design system: root `DESIGN.md`

### History
