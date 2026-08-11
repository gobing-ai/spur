---
template: feature-impl
schema_version: 1
name: "Parity scope data: explicit exclusions and the ADR-054 ownership boundary"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "harness", "plugins/sp"]
dependencies: ["0512"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.816Z"
updated_at: "2026-08-11T22:26:22.489Z"
---

## 0516. Parity scope data: explicit exclusions and the ADR-054 ownership boundary

### Background

Split from task 0512 (feature I2, decomposition 2026-08-11): the explicit-scope slice of the original harness-extension task. 0512 keeps the CLI-surface capture helper and npm-skew documentation; 0517 wires the parity assertions. This task owns the scope data the parity checks consume: explicit exclusions (Tier C / outside-facade nouns, Commander built-ins such as `help`, `--help`-only long-tail nouns, slash-command and inline spine rows) each with a reason, and the ADR-054 ownership boundary assertion.

Implements feature I2 scenarios: R11 (explicit facade exclusions), R12 (non-CLI spine routes), R8 (facade and spine ownership remain distinct). Ordering: after 0512 (needs the capture helper); before 0517 (the assertions consume the exclusion data).

Rubric: E3 D1 L1 C0 R0 = 5 → split (parent scored 5+; size gate: 6 R-items > cap 5).

### Requirements
- [ ] R1. Author explicit exclusion data for Tier C / outside-facade nouns (including Commander built-ins such as `help`), `--help`-only long-tail nouns, and slash-command or inline spine rows; every exclusion carries a reason and is consumed by the parity assertions without regex silence.
- [ ] R2. Classify non-CLI spine routes (slash-command or inline model-bearing steps) as explicit exclusions so they are never reported as missing CLI verbs.
- [ ] R3. Assert the ADR-054 boundary: `sp:spur-cli` owns noun/verb/flag semantics and `sp:spur-dev` owns multi-step orchestration; status-transition verbs remain facade-owned.
### Acceptance Criteria
```gherkin
Feature: Parity scope data
  Scenario: R1 — Explicit facade exclusions do not create false drift
    Given a noun is explicitly marked as outside the facade reference with a reason
    When the parity harness compares documented coverage
    Then that noun is not reported as missing facade documentation

  Scenario: R2 — Non-CLI spine routes do not create false drift
    Given a spine row targets a slash command or inline model-bearing step
    When CLI route parity is checked
    Then the row is excluded explicitly rather than treated as a missing CLI verb

  Scenario: R3 — Facade and spine ownership remain distinct
    Given the facade and spine state their ADR-054 ownership
    When the boundary assertion runs
    Then ownership inversion fails while facade-owned status-transition verbs remain valid
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Exclusions are explicit data with reasons (never regex silence) — a fixture consumed by 0517's parity assertions. The boundary assertion is a focused test asserting each surface documents its owned scope and fails on inversion; it does not assert the facade contains no lifecycle steps (ADR-054). Rejected: embedding exclusions in prose guidance (not machine-checkable); asserting the facade has zero orchestration prose (contradicts ADR-054).
### Plan
- [ ] Author the exclusion fixture (Tier C, long-tail, Commander built-ins, slash-command, inline rows) with reasons.
- [ ] Add the ADR-054 boundary assertion wired through the 0512 capture helper.
- [ ] Validate the fixture against the live CLI surface so 0517 sees no false drift.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

I2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
