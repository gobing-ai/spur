---
schema_version: 1
name: "System Events table enhancement: customizable columns, value sorting, and cell presentation refinement"
status: done
template: feature-impl
created_at: 2026-08-24T06:19:15.204Z
updated_at: "2026-08-24T17:52:16.913Z"
feature_id: J92
priority: P2
dependencies: ["0652"]
---

## 0653. System Events table enhancement: customizable columns, value sorting, and cell presentation refinement

### Background
Premise verified on 2026-08-23. `SystemEventsTable` and `EventTableRow` are private functions inside the 1,782-line `SystemEventsTab.tsx`; there are no separate table/row files. The current desktop table is fixed to Time, Severity, Event, Summary, Producer, Correlation, Agent, Outcome, and Action. The existing row already provides semantic severity text, monospace identifiers, truncation titles, a keyboard/pinnable event tooltip, expanded detail, and the required two-column mobile mode.

This task adds the missing visibility, persistence, sorting, and explicit copy behavior while preserving the working tooltip/detail/SSE/query paths. Extraction of the existing table and row is not required to deliver those behaviors.

Rubric: E2 D1 L1 C1 R1 = 6 → decompose.
### Requirements
- [x] R1. Define the ten supported desktop column keys once: `time`, `severity`, `event`, `summary`, `correlation`, `outcome`, `agent`, `producer`, `action`, and `actor`. Default to exactly Time, Severity, Event, Summary, Correlation, and Outcome; expose the other four in the Columns disclosure added beside Filter and Live.
- [x] R2. Persist the desktop visible-key array under `spur:observability:columns:v1`. Lazily validate JSON, discard unknown/duplicate keys, fall back to defaults for unavailable/malformed/empty storage, and never leave the table with zero visible columns.
- [x] R3. Render only selected desktop columns in `<colgroup>`, headers, body cells, and expanded-row `colSpan`; expose checked state and labels through native checkboxes. Do not persist sort state.
- [x] R4. Sort the currently loaded rows by Time, Severity, Event, Summary, Correlation, Agent, or Outcome. Initial order is Time descending; clicking the active header toggles direction, clicking another sortable header starts ascending, and ties retain input order. Put `aria-sort` and `▲`/`▼` on the active header.
- [x] R5. Preserve existing semantic parsers and detail/tooltip behavior while changing Severity to a compact icon-plus-text pill and retaining monospace prefix/event/correlation/agent styling plus full-value titles for truncated text.
- [x] R6. Add adjacent, keyboard-reachable copy buttons for event name, displayed correlation, and `event.runId` when available. Use `navigator.clipboard.writeText`, expose copied/failed feedback without color alone, and do not turn the existing event-name tooltip trigger into a copy trigger.
- [x] R7. Below 640px, ignore desktop visibility choices for layout and keep the established Time + Event columns with secondary semantics and the expandable detail path.
- [x] R8. Add pure helper/component tests for preference validation, all sort comparators/toggles/stability, dynamic headers/cells/colSpan, copy success/failure, default/optional composition, and the fixed mobile contract. Update the J92 design satellite to match the final in-file table/row placement.

Non-goals: server/global sorting across unloaded cursor pages, persistence of sort direction, backend/schema changes, a clipboard fallback package, cross-tab `storage` event synchronization, or extracting `SystemEventsTable`/`EventTableRow` solely for file-shape conformity.
### Acceptance Criteria
```gherkin
Feature: System Events table enhancement

  Scenario: R4 — Customizable column visibility with persistence
    Given the System Events table
    When the operator changes checked columns in the Columns disclosure
    Then only checked desktop columns render in the header and body
    And the checked keys reload from spur:observability:columns:v1
    And malformed, unknown-only, or empty saved values fall back to the six defaults

  Scenario: R5 — Default column composition
    Given no valid saved column preference
    When the desktop table renders
    Then its columns are exactly Time, Severity, Event, Summary, Correlation, and Outcome
    And Agent, Producer, Action, and Actor remain available as optional columns

  Scenario: R6 — Column value sorting
    Given multiple loaded System Events rows
    When the operator selects a sortable header
    Then only the loaded rows are stably ordered by that column and direction
    And the active header exposes aria-sort plus ▲ or ▼

  Scenario: R7 — Cell visual formatting and ergonomics
    Given a System Events row
    When its cells render
    Then Severity uses an icon-plus-text status pill
    And technical values retain monospace styling and full-value access
    And event name, displayed correlation, and available run id have labelled one-click copy buttons
    And the existing pinnable tooltip and expanded detail remain keyboard reachable

  Scenario: R9 — Responsive table layout
    Given a viewport below 640px
    When the System Events table is displayed
    Then it renders Time and Event columns regardless of desktop column preferences
    And secondary fields remain available in the Event stack and expandable detail
```
### Q&A
- **Are `SystemEventsTable.tsx` and `EventTableRow.tsx` new files?** No. Both are currently private functions with extensive tests inside `SystemEventsTab.tsx`; this task keeps them there and corrects the derived J92 diagram.
- **What does sorting cover?** Only rows currently loaded from the cursor API, including later appended pages. Global database sorting by arbitrary presentation fields would require backend/index work outside J92.
- **Which optional columns sort?** Agent sorts because the feature names it. Producer, Action, and Actor are visibility-only because the feature's authoritative sortable list omits them.
- **What is persisted?** Visible desktop column keys only. Default Time-descending sort is deterministic on every load.
- **What happens to invalid localStorage?** Ignore it and render defaults; storage input never crashes the module. Empty selection is rejected so the table remains usable.
- **Does clicking the event name copy it?** No. That established control pins the forensic tooltip. A separate labelled copy button provides the new one-click action.
### Design
Create only `ColumnCustomizer.tsx`. It owns and exports `EventColumnKey`, the ordered column metadata, `DEFAULT_VISIBLE_COLUMNS`, and the native `<details>/<summary>` checkbox UI. A lazy loader checks `typeof window`, parses the stored `string[]`, filters it against known keys in canonical order, and falls back to a fresh default array when invalid or empty. Toggle writes the next valid array immediately; disable removal of the final selected column.

Extend `ObservabilityFilters` with concrete column state props and render `ColumnCustomizer` in the existing right action cluster. Do not add a generic slot or a placeholder. `SystemEventsTab` owns `visibleColumns` because it coordinates both the filter action and table render.

Keep `SystemEventsTable` and `EventTableRow` in `SystemEventsTab.tsx`. Pass visibility and sort state explicitly. The existing row has substantial tooltip/detail state and tests; moving it creates risk without contributing to J92 behavior. Render explicit conditional cells rather than a generic cell-renderer abstraction, and compute expanded-row `colSpan` from the selected desktop count (mobile remains `2`).

Use a pure `sortEventRows(rows, state)` helper over a copied array. Freeze the value mapping:

- `time`: `Date.parse(occurredAt)`; invalid values sort before valid values ascending.
- `severity`: `info = 0`, `warning = 1`, `error = 2` from the parsed view.
- `event`: `eventName`.
- `summary`, `correlation`, `agent`, `outcome`: parsed view strings, with missing values normalized to `''`.

Initial state is `{ key: 'time', direction: 'desc' }`. Compare strings with `localeCompare`; retain original indexes as the final tie-breaker. Producer, Action, and Actor are visibility-only because J92's authoritative sort list omits them. Sorting is intentionally limited to the loaded page; `Load older` appends rows and the same memoized sort is reapplied.

Add one small local `CopyValueButton` used by the event cell, correlation cell, and run-id detail. It calls the native clipboard API and announces `Copied` or `Copy failed`; missing values render no button. Keep the current event-name button dedicated to pinning the tooltip.

Files: `apps/web/src/modules/observability/{ColumnCustomizer.tsx,ObservabilityFilters.tsx,SystemEventsTab.tsx}`, `apps/web/tests/modules/observability/{components.test.tsx,system-events-tab.test.ts}`, and `docs/design/observability-frontend-enhancement.md` for the corrected file-placement diagram. No API, DAO, or schema target.
### Plan
1. Add failing helper/component cases for preference parsing/fallback, exact default/optional columns, dynamic header/body/colSpan, each sortable value and toggle, stable ties, clipboard outcomes, and fixed compact rendering (R1–R8).
2. Implement `ColumnCustomizer.tsx` with canonical metadata, safe lazy storage loading, at-least-one selection, persistence, and accessible native disclosure controls (R1–R3).
3. Add concrete column props/control to `ObservabilityFilters.tsx`; initialize visibility and sort state in `SystemEventsTab` without changing its query/SSE lifecycle (R1–R4).
4. Make the existing in-file table/row render selected desktop columns, computed colSpan, sortable headers, and the stably sorted loaded rows; preserve the mobile override (R3, R4, R7).
5. Refine the existing severity presentation and add the native clipboard button at event, correlation, and available run-id values without replacing tooltip/detail interactions (R5, R6).
6. Update the J92 design satellite's file diagram, run targeted Observability tests plus web typecheck/lint, and confirm no backend or `RoutingTab.tsx` diff (R8).
### Solution
- `apps/web/src/modules/observability/ColumnCustomizer.tsx:25`: `ALL_COLUMNS` defines the ten canonical desktop columns; the same module validates, persists, and enforces a non-empty canonical selection.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:674`: `sortEventRows` implements the seven sortable dimensions with stable ties; `CopyValueButton` begins at line 729.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:1106`: `SystemEventsTable` maps selected columns through colgroup, sortable headers, body cells, and the expanded-row span while preserving the missing-Agent blank-cell contract.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:1224`: `SeverityLabel` provides icon-plus-text presentation while existing tooltip/detail paths remain in place.
- `apps/web/tests/modules/observability/components.test.tsx:2209`: The integrated case proves default/optional composition, dynamic cells and span, persistence, and event/correlation/run-id copy placement.
- `apps/web/tests/modules/observability/components.test.tsx:2287`: Pure/helper cases cover malformed preferences, every comparator, sort toggles, stability, copy success/failure, and at-least-one enforcement; mobile coverage is at line 687.
- `apps/web/tests/modules/observability/components.test.tsx:2645`: Regressions prove a missing Agent renders as a blank optional cell and duplicate stored keys are discarded.
- `docs/design/observability-frontend-enhancement.md:10`: The Observability frontend enhancement design records the final in-file table placement and exact sortable/visibility-only columns.
- `DESIGN.md:485`: The current J92 UI authority records the default and optional column composition, including the blank missing-Agent exception.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/observability/components.test.tsx:2209` |
| R2 | MET | `apps/web/tests/modules/observability/components.test.tsx:2680` |
| R3 | MET | `apps/web/tests/modules/observability/components.test.tsx:2645` |
| R4 | MET | `apps/web/tests/modules/observability/components.test.tsx:2329` |
| R5 | MET | `apps/web/tests/modules/observability/components.test.tsx:2580` |
| R6 | MET | `apps/web/tests/modules/observability/components.test.tsx:2542` |
| R7 | MET | `apps/web/tests/modules/observability/components.test.tsx:687` |
| R8 | MET | `apps/web/tests/modules/observability/components.test.tsx:2645` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R4 — Customizable column visibility with persistence | MET | test | `apps/web/tests/modules/observability/components.test.tsx:2209`; coverage-enabled J92 gate: 207 pass, 0 fail. |
| Scenario: R5 — Default column composition | MET | test | `apps/web/tests/modules/observability/components.test.tsx:2209`; coverage-enabled J92 gate: 207 pass, 0 fail. |
| Scenario: R6 — Column value sorting | MET | test | `apps/web/tests/modules/observability/components.test.tsx:2329`; coverage-enabled J92 gate: 207 pass, 0 fail. |
| Scenario: R7 — Cell visual formatting and ergonomics | MET | test | `apps/web/tests/modules/observability/components.test.tsx:2645`; coverage-enabled J92 gate: 207 pass, 0 fail. |
| Scenario: R9 — Responsive table layout | MET | test | `apps/web/tests/modules/observability/components.test.tsx:687`; coverage-enabled J92 gate: 207 pass, 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Ergonomics | `apps/web/src/modules/observability/ColumnCustomizer.tsx:110` | At-least-one column enforcement prevents rendering empty broken tables. |
| P4 | Maintainability | `apps/web/src/modules/observability/SystemEventsTab.tsx:1115` | Retaining `SystemEventsTable` and `EventTableRow` in-file avoids cross-file coupling risks. |

- Traceability: R1–R8 fully verified by automated tests in `components.test.tsx`.
- Security & Safety: No external dependencies; no untrusted HTML injection; clipboard API safely guarded.
- Final disposition: Ready for completion. Hand off to Task 0654.
### References
- Parent feature: `J92` (R4–R7, R9)
- Dependency: task `0652`
- UI system: `DESIGN.md` (System Events table and accessibility contracts)
- J92 surface design: `docs/design/observability-frontend-enhancement.md`
- Current implementation: `apps/web/src/modules/observability/SystemEventsTab.tsx`
- Filter action seam: `apps/web/src/modules/observability/ObservabilityFilters.tsx` from 0652
- Tests: `apps/web/tests/modules/observability/components.test.tsx` and `system-events-tab.test.ts`
### History
- 2026-08-24T15:54:13.015Z todo → wip (system)
- 2026-08-24T16:01:33.759Z wip → testing (system)
- 2026-08-24T16:01:48.611Z testing → done (system)
