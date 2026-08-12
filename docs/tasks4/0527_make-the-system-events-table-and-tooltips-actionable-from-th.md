---
template: feature-impl
schema_version: 1
name: "Make the System Events table and tooltips actionable from the canonical envelope"
description: ""
status: todo
type: task
profile: standard
feature_id: J5
parent_wbs: null
priority: P1
tags: ["observability", "system-events", "web"]
dependencies: ["0526"]
ac_numbering: task-local
created_at: "2026-08-12T13:24:51.431Z"
updated_at: "2026-08-12T13:28:03.859Z"
---

## 0527. Make the System Events table and tooltips actionable from the canonical envelope

### Background

Implements: R5 — The System Events table prioritizes diagnostic decisions; R6 — Each event tooltip explains what happened and what to do next; R10 — Malformed or unknown event data fails safe. Consume the canonical envelope produced by the foundation task and replace duplicated client-side payload guessing with server-projected semantics while preserving raw redacted detail and responsive accessibility. Runs after the envelope foundation.

Rubric: E1 D1 L1 C1 R1 = 5 → decompose (independent UI review and accessibility risk).

### Requirements
- [ ] R1. Parse current envelopes and legacy fallback rows at the network boundary, then render desktop columns Time, Severity, Event, Summary, Project/Producer, Correlation, Outcome, and Action with contained long values and low-value catalog fields moved to detail.
- [ ] R2. Replace raw-JSON event-name hover with a semantic tooltip showing description, event-specific fields, project/producer context, and remediation; preserve focus, pin/copy, Escape/outside-close, ARIA, compact layout, non-color severity, and raw redacted JSON in expanded detail.
- [ ] R3. Keep legacy, unknown, and malformed data usable with explicit unavailable values and add focused pure-function/happy-dom tests across renderer families, actions, columns, truncation, keyboard, and responsive behavior.
### Acceptance Criteria
```gherkin
Feature: Actionable System Events Board

Scenario: R1 — The System Events table prioritizes diagnostic decisions
  Given events with canonical presentation metadata
  When the desktop table renders
  Then it shows time, severity, event, summary, project or producer, correlation, outcome, and action columns without overlap

Scenario: R2 — Each event tooltip explains what happened and what to do next
  Given an event from any registered renderer family
  When its name is hovered, focused, or pinned
  Then description, event-specific fields, context, and available remediation are shown and selectable
  And raw redacted JSON remains in the expanded detail

Scenario: R3 — Malformed or unknown event data fails safe
  Given legacy, unknown, or malformed envelope fields
  When the tab renders
  Then a bounded generic fallback remains usable with explicit unavailable values
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: treat backend `presentation` as the semantic SSOT. `SystemEventsTab` narrows the envelope once, then table and tooltip render projected summary/fields/action rather than reinterpreting arbitrary payload keys. The expanded row remains the forensic surface for context metadata and full redacted `data`.

Rejected: adding more branches to `buildTooltipSummary` (duplicates backend semantics and still diverges by transport); a new event-details page (unrequested navigation and more state); keeping Prefix/Tier as primary columns (catalog implementation facts are lower-value than severity/summary/action).

Invariants: eight desktop columns; two-column compact fallback; keyboard-equivalent tooltip behavior; selectable copy content; explicit unavailable values; no client rendering of unredacted raw data; root DESIGN.md tokens/conventions remain authoritative.
### Plan
1. Add envelope/presentation runtime narrowing and legacy fallback tests.
2. Replace row identity derivation with projected correlation/outcome values.
3. Rework desktop and compact column layouts.
4. Rebuild the event-name tooltip around semantic presentation and action.
5. Update expanded detail to show context plus redacted data.
6. Add renderer-family, accessibility, and responsive tests; visually verify the Board.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
