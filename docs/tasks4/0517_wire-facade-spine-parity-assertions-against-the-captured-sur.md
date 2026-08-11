---
template: feature-impl
schema_version: 1
name: "Wire facade/spine parity assertions against the captured surface"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "harness", "plugins/sp"]
dependencies: ["0516"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.879Z"
updated_at: "2026-08-11T22:26:22.705Z"
---

## 0517. Wire facade/spine parity assertions against the captured surface

### Background

Split from task 0512 (feature I2, decomposition 2026-08-11): the assertion slice. 0512 owns the capture helper (with provenance); 0516 owns the exclusion data and ADR-054 boundary. This task wires the focused parity test comparing the facade's documented inventories, the spine's CLI-routed rows, and the AGENTS.md noun table against the live captured surface, reporting drift in both directions. Its focused-suite finding set is the input task 0513 consumes.

Implements feature I2 scenarios: R1 (facade inventories match), R2 (CLI-routed spine rows), R4 (AGENTS.md noun inventory). Ordering: after 0516 (assertions consume the exclusion data).

Rubric: E3 D1 L1 C0 R0 = 5 → split (parent scored 5+; size gate).

### Requirements
- [ ] R1. Add at most one focused `plugins/sp/tests/cli-surface-parity.test.ts` comparing facade noun/verb/flag inventories with the captured CLI surface, reusing existing parsers and fixtures instead of duplicating them.
- [ ] R2. Extend the existing routing-table parity assertion for explicitly CLI-routed spine rows, reusing its current parser and fixtures.
- [ ] R3. Report both `documented-not-on-CLI` and `on-CLI-not-documented` findings for facade inventories, CLI-routed spine rows, and the AGENTS.md noun table (root-help comparison), honoring the 0516 exclusion data.
### Acceptance Criteria
```gherkin
Feature: Source-local CLI parity assertions
  Scenario: R1 — Facade inventories match the live CLI surface
    Given the facade documents noun, verb, and flag inventories
    When the focused parity test compares them with the captured CLI surface
    Then both documented-not-on-CLI and on-CLI-not-documented differences fail the test

  Scenario: R2 — CLI-routed spine rows reference real verbs
    Given a spine routing row is marked as a CLI route
    When its noun and verb are checked against the captured surface
    Then an absent noun or verb fails the test

  Scenario: R3 — AGENTS.md noun inventory matches the CLI
    Given AGENTS.md lists the public Spur CLI nouns
    When the list is compared with the captured root help
    Then a noun present on only one side fails the test
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
One focused test file owns the root-noun, facade-inventory, and AGENTS.md noun-table comparisons against the 0512 helper's captured surface; routing-table-parity.test.ts gains the CLI-marked spine-row extension. Bidirectional reporting is the test's failure output — preserved as the drift finding set for 0513. Exclusions from 0516 prevent false positives (e.g. Commander's built-in `help`). Rejected: a general-purpose help parser (narrow fixture-backed adapter only); a pre-allocated multi-file test layout.
### Plan
- [ ] Add the single focused parity test and wire bidirectional noun/verb/flag comparisons against the captured surface.
- [ ] Extend the existing routing assertion for explicitly CLI-routed spine rows.
- [ ] Run the focused plugin parity tests and preserve the complete finding set for task 0513.
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
