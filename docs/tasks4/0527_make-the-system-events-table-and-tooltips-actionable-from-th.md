---
template: feature-impl
schema_version: 1
name: "Make the System Events table and tooltips actionable from the canonical envelope"
description: ""
status: done
type: task
profile: standard
feature_id: J5
parent_wbs: null
priority: P1
tags: ["observability", "system-events", "web"]
dependencies: ["0526"]
ac_numbering: task-local
created_at: "2026-08-12T13:24:51.431Z"
updated_at: "2026-08-12T16:54:49.699Z"
---

## 0527. Make the System Events table and tooltips actionable from the canonical envelope

### Background

Implements: R5 — The System Events table prioritizes diagnostic decisions; R6 — Each event tooltip explains what happened and what to do next; R10 — Malformed or unknown event data fails safe. Consume the canonical envelope produced by the foundation task and replace duplicated client-side payload guessing with server-projected semantics while preserving raw redacted detail and responsive accessibility. Runs after the envelope foundation.

Rubric: E1 D1 L1 C1 R1 = 5 → decompose (independent UI review and accessibility risk).

### Requirements
- [x] R1. Parse current envelopes and legacy fallback rows at the network boundary, then render desktop columns Time, Severity, Event, Summary, Project/Producer, Correlation, Outcome, and Action with contained long values and low-value catalog fields moved to detail.
- [x] R2. Replace raw-JSON event-name hover with a semantic tooltip showing description, event-specific fields, project/producer context, and remediation; preserve focus, pin/copy, Escape/outside-close, ARIA, compact layout, non-color severity, and raw redacted JSON in expanded detail.
- [x] R3. Keep legacy, unknown, and malformed data usable with explicit unavailable values and add focused pure-function/happy-dom tests across renderer families, actions, columns, truncation, keyboard, and responsive behavior.
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
- `apps/web/src/modules/observability/SystemEventsTab.tsx:256` narrows history and SSE envelopes once, retains the full redacted envelope for detail, and unwraps `data` for existing Jobs/Tasks consumers.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:393` adds the bounded semantic view with explicit unavailable fallback and no fabricated action.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:1093` renders the eight diagnostic desktop columns and a true two-column compact layout.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:1201` pairs severity icon/text and rebuilds the event tooltip around server-owned description, fields, project/producer, correlation, outcome, and remediation while preserving hover, focus, pin, copy, Escape, outside-close, and ARIA behavior.
- Expanded detail keeps prefix/tier/actor plus the full redacted envelope; obsolete renderer-specific payload guessing and JSON-tooltip highlighting were removed.
- `apps/web/tests/modules/observability/system-events-tab.test.ts:30` and `apps/web/tests/modules/observability/components.test.tsx:301` cover parsing/fallback/bounds, all renderer families, columns, semantic tooltip/action, keyboard/focus/pin, severity semantics, and responsive layout.
- `docs/04_DESIGN.md:1467` and `docs/design/actionable-observability-context.md:67` document the shipped Board projection and sibling-tab compatibility seam.
### Testing
**Re-verify (2026-08-12, `--force --focus all --fix all`)**

| Check | Result |
| --- | --- |
| Focused observability tests | PASS — 78 pass / 0 fail / 408 assertions (`bun test apps/web/tests/modules/observability/system-events-tab.test.ts apps/web/tests/modules/observability/components.test.tsx`) |
| `spur task check 0527 --strict-core` | Re-run after full-path Testing rewrite |

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/web/src/modules/observability/SystemEventsTab.tsx:256` (`parseHistoryRow`) + `apps/web/src/modules/observability/SystemEventsTab.tsx:394` (`parseSystemEventView`) narrow envelopes at the boundary; `apps/web/src/modules/observability/SystemEventsTab.tsx:1129`–`:1165` render Time, Severity, Event, Summary, Project / Producer, Correlation, Outcome, Action; `apps/web/src/modules/observability/SystemEventsTab.tsx:1104`–`:1106` compact two-column fallback. Test: `apps/web/tests/modules/observability/components.test.tsx:318`. |
| R2 | MET | `apps/web/src/modules/observability/SystemEventsTab.tsx:1197`–`:1210` non-color severity (icon+text); `apps/web/src/modules/observability/SystemEventsTab.tsx:1333`–`:1451` semantic tooltip; hover/focus/pin/Esc/outside-close/ARIA at `apps/web/src/modules/observability/SystemEventsTab.tsx:1221`–`:1308`. Expanded redacted envelope at `apps/web/src/modules/observability/SystemEventsTab.tsx:1643`–`:1648`. Tests: `apps/web/tests/modules/observability/components.test.tsx:779`, `:841`, `:897`. |
| R3 | MET | `apps/web/src/modules/observability/SystemEventsTab.tsx:451` `unavailableSystemEventView`; fallback path `apps/web/src/modules/observability/SystemEventsTab.tsx:396`. Tests: `apps/web/tests/modules/observability/system-events-tab.test.ts:86`, `:52`, `:72`; compact `action: unavailable` at `apps/web/tests/modules/observability/components.test.tsx:620`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R5 — The System Events table prioritizes diagnostic decisions | MET | test | `apps/web/tests/modules/observability/components.test.tsx:318` eight columns; `:721` row semantics; `:620` compact layout |
| Scenario: R6 — Each event tooltip explains what happened and what to do next | MET | test | `apps/web/tests/modules/observability/components.test.tsx:779` tooltip; `:841` pin/Esc; `:897` Pin; detail redacted JSON `:360` |
| Scenario: R10 — Malformed or unknown event data fails safe | MET | test | `apps/web/tests/modules/observability/system-events-tab.test.ts:86` unavailable fallback; `:72` bounds/malformed action |

**Design conformance**

| Claim | Status | Evidence |
| --- | --- | --- |
| Backend `presentation` is semantic SSOT | DONE | `apps/web/src/modules/observability/SystemEventsTab.tsx:394` |
| Narrow once; table/tooltip use projection | DONE | `apps/web/src/modules/observability/SystemEventsTab.tsx:256`, `:347`, `:1215` |
| Expanded row forensic surface | DONE | `apps/web/src/modules/observability/SystemEventsTab.tsx:1597`–`:1648` |
| Eight desktop columns; two-column compact | DONE | `apps/web/src/modules/observability/SystemEventsTab.tsx:1129`–`:1165`, `:1104`–`:1106` |
| Keyboard-equivalent tooltip; selectable copy | DONE | `apps/web/src/modules/observability/SystemEventsTab.tsx:1333`–`:1451` |
| Explicit unavailable; no unredacted raw | DONE | `apps/web/src/modules/observability/SystemEventsTab.tsx:295`–`:296`, `:451` |

**SECUA**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1–P3 | All | — | None |
| P4 | Usability | `apps/web/src/modules/observability/SystemEventsTab.tsx` | Live browser visual inspection unavailable this session; happy-dom responsive/a11y coverage stands in |

Fix-pass artifacts: `.spur/run/0527-verdict.json`, `.spur/run/0527-verify-answer.txt`.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1 | All | — | None. |
| P2 | All | — | None. |
| P3 | All | — | None. |
| P4 | Usability | `apps/web/src/modules/observability/SystemEventsTab.tsx` | Live browser visual inspection unavailable in this session; responsive/accessibility behavior is covered by happy-dom tests. |
- Security: only schema-v2 envelopes are retained for expanded raw detail; legacy/malformed raw payloads render `unavailable`, actions are validated, and display strings are bounded.
- Architecture: backend `presentation` remains the semantic SSOT; one boundary parser feeds table, tooltip, and detail. Existing Jobs/Tasks projections reuse the canonical `data` compatibility seam.
- Ponytail: removed renderer-specific guessing and JSON syntax-highlighting paths; net source/test deletion exceeds additions. No dependency, framework, route, or speculative abstraction added.
- Disposition: PASS.
### References

J5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T14:36:57.164Z todo → wip (system)
- 2026-08-12T14:53:30.298Z wip → testing (system)
- 2026-08-12T14:54:21.942Z testing → done (system)
