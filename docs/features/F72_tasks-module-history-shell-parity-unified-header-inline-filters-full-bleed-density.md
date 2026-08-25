---
schema_version: 1
id: "F72"
name: "Tasks module History-shell parity: unified header, inline filters, full-bleed density"
status: backlog
priority: P2
tags: []
created_at: "2026-08-25T04:06:01.619Z"
updated_at: "2026-08-25T05:11:15.715Z"
---

# F72: Tasks module History-shell parity: unified header, inline filters, full-bleed density

## Goal
Bring the Tasks board module up to the History module's shell standard — a one-row module header (icon + name left; phase dropdown, status checkboxes, and one combined WBS/feature input inline; tab strip right starting with a single Kanban tab on an append-only tab contract), a full-bleed main body that gives every available pixel to swimlanes and task cards, and richer task cards that surface key facts without opening the detail panel — with the visual design prototyped in Open Design against root `DESIGN.md` tokens before the React implementation begins, and the floating/right-dock task detail panel's appearance and behavior unchanged.
## Scope
**In scope:**

- Tasks module header rebuilt to the History shell convention: icon + module name (with live chip) on the left, tab strip on the right, starting with a single `Kanban` tab behind the append-only tabs contract (future tabs such as List / Swimlanes / Analytics are additive).
- Inline filters placed in the header row just before the tab strip: phase dropdown, status checkboxes, and one combined input accepting WBS or feature id — no separate filter bar section, to preserve vertical space.
- Full-bleed main body: tab content occupies the full available width; maximum information in one screen without scrollbars is the top priority.
- Task card enrichment so key facts are visible directly on the card (e.g. subtask progress, priority accent, staleness tint) without opening the detail view.
- Open Design prototyping of the visual design against root `DESIGN.md` tokens before React implementation.
- Preserving the headerless `TaskKanbanView` export used by the Workspace module embed.

**Out of scope:**

- Any change to the floating / right-docking task detail panel's appearance or behavior (resizable dock, Escape, path-WBS auto-popup stay as-is).
- New tabs beyond `Kanban` in this feature (the contract must permit them; designing/building them is later work).
- Additional filter types beyond phase dropdown, status checkboxes, and the combined WBS/feature input.
- Task-list contract (`packages/contracts`) or server changes, unless the optional assignee chip is explicitly approved.
- Changes to board modules other than Tasks.
- Re-theming or redesign outside the existing `DESIGN.md` / `.task-kanban` token scope.
## Acceptance Criteria
```gherkin
Feature: Tasks module History-shell parity — unified header, inline filters, full-bleed density

  @core
  Scenario: R1 — Tasks module renders the one-row shell header with History-parity layout
    Given the operator navigates to the Tasks module route
    When the module shell renders
    Then the header is a single row with the same layout and full-width behavior as the History module header
    And the left side shows the module icon, the name "Tasks", and the live chip
    And the right side shows the tab strip containing exactly one tab: "Kanban"

  @core
  Scenario: R2 — Header hosts inline filters with no separate filter section
    Given the Tasks module shell is rendered
    When the operator views the header row
    Then a phase dropdown, status checkboxes, and one combined WBS/feature input appear inline immediately before the tab strip
    And no separate filter bar section exists below the header
    And the previous in-board toolbar row and the TaskFilters bar are removed

  @core
  Scenario: R3 — Combined input opens the path-WBS popup for a bare four-digit WBS
    Given the Tasks board is rendered
    When the operator enters a bare four-digit WBS into the combined input
    Then the existing path-WBS navigation popup for that task opens

  @core
  Scenario: R4 — Combined input filters subtasks for a dotted WBS
    Given the Tasks board is rendered
    When the operator enters a dotted WBS into the combined input
    Then the board filters to that parent's subtasks via the parent filter

  @core
  Scenario: R5 — Combined input falls back to feature substring filtering
    Given the Tasks board is rendered
    When the operator enters text that is neither a bare four-digit WBS nor a dotted WBS
    Then the board applies it as a feature substring filter

  @core
  Scenario: R6 — Board body is full-bleed and header-aligned
    Given the Tasks module is rendered at a standard desktop viewport
    When the Kanban tab renders its lanes and cards
    Then the main body occupies the full available width with no centered max-width wrapper
    And the header and body share the same horizontal padding so lanes align under the header

  @core
  Scenario: R7 — Task card surfaces key facts without opening the detail panel
    Given a task that has subtasks, a non-default priority, and an updatedAt older than 7 days
    When the board renders its card
    Then the card shows subtask progress as done/total derived client-side from parentWbs grouping
    And the card shows a priority accent as a colored left border
    And the card shows a staleness tint
    And all of this is visible without opening the task detail panel

  @core
  Scenario: R8 — Filters stay URL-driven and shareable
    Given the operator has set a phase selection, status visibility, and a combined-input query
    When the resulting URL is opened in a new session
    Then the same phase, status, and query filter state is restored from the URL

  @core
  Scenario: R9 — Floating and right-dock task detail panel behavior is unchanged
    Given the Tasks board is rendered
    When the operator opens a task detail and switches between floating and right-dock modes
    Then the panel appearance, resizing, Escape handling, and path-WBS auto-popup behave exactly as before the refactor

  @core
  Scenario: R10 — Workspace embed keeps the headerless board
    Given the Workspace module renders its Tasks tab
    When the embedded board appears
    Then no module shell header is rendered inside the embed
    And card click to detail, drag-and-drop, and live updates continue to work in the embed

  @edge
  Scenario: R11 — Tab strip contract is append-only for future views
    Given the tabs contract declares only the Kanban tab
    When a new tab entry is appended to the contract
    Then the shell renders the additional tab with no changes to the shell layout logic

  @edge
  Scenario: R12 — Open Design prototype precedes React implementation
    Given the F72 design satellite and root DESIGN.md tokens
    When implementation begins
    Then an Open Design artifact for the header and enriched task cards exists and is cited as T3 surface evidence in the implementation task
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0662 | Tasks module History-shell parity: unified header, inline filters, full-bleed density, enriched cards | cancelled |
| 0663 | Tasks shell: History-parity header, inline filters, full-bleed layout | todo |
| 0664 | Task card enrichment: subtask progress, priority accent, staleness tint | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
