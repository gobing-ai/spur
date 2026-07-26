---
schema_version: 1
id: "R2"
name: "Features tree status affordance: icon-only leading indicator with accessible name"
status: done
priority: P2
tags: []
created_at: "2026-07-26T00:12:26.757Z"
updated_at: "2026-07-26T23:12:36.577Z"
---

# R2: Features tree status affordance: icon-only leading indicator with accessible name

## Goal
Make the FEATURES tree's per-node status readable at a glance instead of read word-by-word: a single
icon-only indicator in a fixed leading slot before the feature id, carrying its human-readable status
as an accessible name rather than as on-screen text.

This is a fine-tune of what task 0325 shipped under the parent map R. 0325 put a status affordance on
every tree node and closed the "status is invisible" gap; what it shipped is a bordered outline
`Badge` holding an SVG icon **plus** the raw status string, pinned to each row's trailing edge
(`apps/web/src/modules/features/FeatureTree.tsx:104-117`). At tree density that repeats pill chrome
down the panel and produces a ragged right edge from six different word lengths, so the status column
competes for attention with the feature names the operator is actually scanning.

### What reaching the end looks like

- Each tree row reads `[status icon] [id] [name]` — the icon sits in a fixed-width leading slot, so
  icons stay optically aligned down the column across every nesting depth, and a future
  expand/collapse chevron can take an adjacent slot without reflowing the row.
- No status text and no badge border/background in the tree. The panel's right edge is clean.
- The status is still fully available to every user: the icon exposes its human-readable label
  (`Backlog`, `Verifying`, …) as an accessible name in the markup, so screen readers announce it and
  it survives with or without a tooltip. A visual tooltip is layered on as enhancement only — never
  as the sole channel.
- The six glyphs are mutually distinguishable by **shape** at 14px and in greyscale, not by color
  alone, so the indicator carries its meaning under WCAG 1.4.1 once the text label is gone.
- Status color resolves through one token family with verified contrast on both the dark and light
  canvases — not today's split between Spur and daisyUI tokens.

Discovery, the full evidence base, and the rejected alternatives are recorded in
`docs/plans/2026-07-25-feature-tree-status-icon-brainstorm.md`.
## Scope
- In:
    - `apps/web/src/modules/features/FeatureTree.tsx` — replace the trailing `StatusBadge` with a
      fixed-width leading status slot rendered before the feature id.
    - `apps/web/src/modules/features/status-icons.tsx` — promote the existing-but-unread
      `StatusMeta.label` to the indicator's accessible name; harden the six glyph silhouettes for
      shape-first distinguishability at 14px; converge `colorClass` on one token family.
    - `apps/web/src/styles/global.css` — light-theme values for the semantic status tokens, **only if**
      the color convergence proceeds (see Out).
    - A minimal presentational tooltip affordance for the indicator (mechanism chosen at implementation
      time — daisyUI `tooltip`/`data-tip` if verified available, else a local wrapper). Additive only.
    - `apps/web/tests/modules/features/components.test.tsx` — rework the assertions that query the tree
      by rendered status *text* so they query by accessible *name*, and add coverage for leading-slot
      placement and greyscale/shape distinguishability of all six statuses.
- Out:
    - The Feature detail pane's status pill (`FeatureDetail.tsx:393`) and its metadata status row. The
      detail pane is a reading surface with one status, where a labelled pill is correct; the tree is a
      scanning surface. This divergence is deliberate.
    - Task Kanban status treatment (`KanbanColumn.tsx:31`, `TaskCard.tsx`, `TaskDetail.tsx`).
    - The parallel `taskStatusIcon()` registry in `@gobing-ai/spur-domain/schema`, and any convergence
      of it with the web-local `FEATURE_STATUS_MAP`. Real debt, but paying it down means editing a
      domain package consumed by three modules to satisfy a left-panel polish request. Recorded as
      follow-up (brainstorm Approach C), not done here.
    - Extracting a shared `StatusIndicator` primitive into `components/ui/`.
    - Tree expand/collapse behavior. No chevron exists today (`FeatureTree.tsx:82-98` always renders
      children); the leading slot is merely designed not to block adding one later.
    - The status-filter popup in the panel header — that is task 0326's surface, already done.
    - Any change to feature status semantics, the canonical status set, or feature file formats.
    - Color-token convergence **if** the light-theme contrast prerequisite is not met. In that case the
      current 4/2 Spur-vs-daisyUI split stays and is recorded as debt rather than swapped blind.
## Acceptance Criteria
```gherkin
Feature: Features tree status affordance: icon-only leading indicator with accessible name

  Background:
    Given the Spur Board is open on the Features module
    And the FEATURES left panel has rendered the feature tree

  @core
  Scenario: R1 — Status indicator renders as the leading element of a tree row
    Given a feature "F1" with status "active" is present in the tree
    When the operator looks at that feature's row
    Then the row's first rendered element is the status indicator
    And the feature id "F1" is rendered after the status indicator
    And the feature name is rendered after the feature id

  @core
  Scenario: R2 — Status text and badge chrome are absent from the tree
    Given a feature "F1" with status "verifying" is present in the tree
    When the row is rendered
    Then the literal text "verifying" does not appear anywhere in the row
    And the status indicator has no border and no background fill

  @core
  Scenario: R3 — The status indicator exposes its human-readable label as an accessible name
    Given a feature "F1" with status "verifying" is present in the tree
    When an assistive technology queries the status indicator
    Then its accessible name is "Verifying"
    And that name comes from the status map's label field, not from the raw status string
    And the name is present in the markup independently of any tooltip

  @core
  Scenario Outline: R4 — Every canonical status resolves to its own labelled indicator
    Given a feature with status "<status>" is present in the tree
    When the row is rendered
    Then exactly one status indicator is rendered for that row
    And its accessible name is "<label>"

    Examples:
      | status    | label     |
      | backlog   | Backlog   |
      | active    | Active    |
      | verifying | Verifying |
      | blocked   | Blocked   |
      | done      | Done      |
      | cancelled | Cancelled |

  @core
  Scenario: R5 — Hovering the indicator reveals the status label visually
    Given a feature "F1" with status "blocked" is present in the tree
    When the operator hovers the pointer over its status indicator
    Then the label "Blocked" becomes visible
    And removing the tooltip affordance would leave R3's accessible name intact

  @core
  Scenario: R6 — The six glyphs are distinguishable by shape without color
    Given the six canonical status glyphs are rendered at 14 pixels
    When color is removed from all six
    Then each glyph's silhouette differs from the other five
    And no two statuses are distinguished by fill color alone

  @core
  Scenario: R7 — Indicators stay optically aligned across nesting depths
    Given a root feature "F" and a nested descendant "F1A" are present in the tree
    When both rows are rendered
    Then each row's status indicator occupies a fixed-width slot of the same width
    And the indicator does not shift horizontally as the status string length changes

  @core
  Scenario: R8 — Selected and hover row states do not obscure the indicator
    Given a feature "F1" with status "done" is present in the tree
    When the operator selects that row
    Then the status indicator remains visible
    And its accessible name is unchanged

  @core
  Scenario: R9 — Long feature names truncate without displacing the indicator
    Given a feature whose name exceeds the panel width is present in the tree
    When the row is rendered
    Then the feature name is truncated
    And the status indicator remains fully visible at its fixed leading slot

  @core
  Scenario: R10 — Status colors resolve through one token family with sufficient contrast
    Given the tree renders all six canonical statuses
    When the color class of each status indicator is inspected
    Then all six resolve through a single token family
    And each glyph has a contrast ratio of at least 3:1 against the panel background
    And that holds on both the dark and the light theme canvas

  @core
  Scenario: R11 — Existing tree tests assert on accessible name rather than status text
    Given the feature-module component tests exercise the tree
    When the suite runs against the icon-only tree
    Then no test locates a tree row by its rendered status text
    And the suite passes

  @edge
  Scenario: R12 — An unrecognized status degrades to a labelled fallback indicator
    Given a feature carrying a status outside the six canonical values
    When its row is rendered
    Then a fallback indicator is rendered in the leading slot
    And it exposes a non-empty accessible name
    And the row does not fail to render

  @edge
  Scenario: R13 — The detail pane keeps its labelled status pill
    Given the operator selects a feature in the tree
    When the feature detail pane renders
    Then the detail pane still shows the status as a labelled pill
    And the tree's icon-only treatment has not been applied to it
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0332 | Features tree: make the status icon self-describing and vocabulary-linked | done |
| 0333 | Features tree: move status to a fixed leading slot and drop the text label | done |
| 0334 | Features tree: harden the six status glyphs for shape-first distinguishability | done |
| 0335 | Features tree: converge status colors on the Spur token family with light-theme values | done |
| 0336 | Features tree: add a hover tooltip revealing the status label | done |
| 0337 | Features tree: resolve cancelled-glyph light-canvas contrast, then complete the Spur token swap (AC R10) | cancelled |
| 0338 | Features tree: resolve cancelled-glyph light-canvas contrast, then complete the Spur token swap (AC R10) | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-07-26T23:12:36.251Z backlog → active (system)
- 2026-07-26T23:12:36.423Z active → verifying (system)
- 2026-07-26T23:12:36.577Z verifying → done (system)
