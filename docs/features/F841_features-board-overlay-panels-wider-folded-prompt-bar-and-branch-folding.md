---
schema_version: 1
id: "F841"
name: "Features board overlay panels, wider folded prompt bar, and branch folding"
status: done
priority: P2
tags: []
created_at: "2026-08-24T06:03:19.828Z"
updated_at: "2026-08-24T17:33:50.212Z"
---

# F841: Features board overlay panels, wider folded prompt bar, and branch folding

## Goal

Refine the Features board into a stable full-width detail workspace with unobtrusive overlay chrome, header-aligned editing controls, a folded wider agent prompt, and independently collapsible tree branches.

## Scope

- In scope:
  - Render Feature Tree and Metadata as left/right overlay siblings outside the main detail body so opening either panel never resizes the header or body, and preview/editor width matches the detail header.
  - Remove the `BODY` label and in-body edit control; place a matching `Edit` button immediately before `Metadata`, with `Save` and `Cancel` occupying that header action slot while editing.
  - Start the floating agent prompt bar folded and cap its expanded width at 84rem, with viewport gutters preventing overflow.
  - Add an independent, accessible fold control to each parent node that hides or restores all recursive descendants, preserves nested fold state, and remains separate from row selection.
  - Preserve existing feature state ownership, API calls, lifecycle actions, body-draft guards, metadata behavior, and SSE refresh behavior.
- Out of scope:
  - Backend agent dispatch or any new API, DTO, database, CLI, lifecycle, or persistence behavior.
  - Persisted tree-fold preferences or global fold-all/unfold-all controls.
  - New shared drawer hosts, portals, context layers, dependencies, or alternate feature-tree data models.

## Acceptance Criteria

```gherkin
Feature: Features board overlay panels, wider folded prompt bar, and branch folding

  @core
  Scenario: R1 — Feature Tree opens without resizing the detail workspace
    Given a feature is selected with its body preview visible and the Feature Tree closed
    When the user opens the Feature Tree
    Then the tree appears as a left-side overlay outside the detail body
    And the detail header and body preview retain their previous width and horizontal position
    And the preview content boundaries remain aligned with the detail header

  @core
  Scenario: R2 — Metadata opens without resizing the detail workspace
    Given a feature with frontmatter, timestamps, linked tasks, child features, and a file path is being edited
    And Metadata is folded
    When the user opens Metadata
    Then the metadata appears as a right-side overlay outside the detail body
    And it displays the existing metadata content
    And the detail header and body editor retain their previous width and horizontal position
    And the editor content boundaries remain aligned with the detail header

  @core
  Scenario: R3 — Preview mode exposes editing only in the detail header
    Given a feature is selected in preview mode
    When the detail view finishes rendering
    Then no "BODY" label or edit control appears inside the body area
    And an "Edit" button appears immediately before "Metadata" in the detail header

  @core
  Scenario: R4 — Edit mode replaces the header Edit action with Save and Cancel
    Given a feature is selected in preview mode
    When the user selects "Edit"
    Then the body enters edit mode
    And "Edit" is replaced in the same header action slot by "Save" followed by "Cancel"
    And those actions appear immediately before "Metadata"
    And no duplicate editing controls appear inside the body area

  @core
  Scenario: R5 — Saving from the header preserves body-update behavior
    Given the feature body is being edited with a draft different from the persisted body
    When the user selects "Save"
    Then the draft is persisted as the feature body
    And the saved body is displayed in preview mode
    And "Edit" returns to its header slot immediately before "Metadata"

  @core
  Scenario: R6 — Cancelling from the header discards the body draft
    Given the feature body is being edited with a draft different from the persisted body
    When the user selects "Cancel"
    Then no body update request is sent
    And the persisted body is restored in preview mode
    And "Edit" returns to its header slot immediately before "Metadata"

  @core
  Scenario: R7 — Agent prompt starts folded
    Given the Features board is mounted for a new visit
    When the shell finishes rendering
    Then the expanded agent prompt is absent
    And a keyboard-accessible spirit-icon control for opening the prompt is displayed

  @core
  Scenario: R8 — Expanded agent prompt respects its width cap and viewport gutters
    Given the floating agent prompt is folded
    When the user opens the prompt
    Then its width is the lesser of 84rem and the viewport width remaining after both gutters
    And visible left and right gutters remain
    And the prompt introduces no horizontal viewport overflow

  @core
  Scenario: R9 — Parent nodes expose an accessible fold control
    Given the Feature Tree contains parent nodes and leaf nodes
    When the tree renders
    Then every parent node has a keyboard-operable fold control whose accessible name identifies the node and action
    And each fold control reports its expanded state
    And each fold control is separate from the node's row-selection control
    And leaf nodes have no fold control

  @core
  Scenario: R10 — Folding a branch hides every recursive descendant independently
    Given a parent branch is expanded with both direct and recursive descendants visible
    And another branch has its own selection and fold state
    When the user folds the parent branch
    Then every descendant of that parent is hidden and removed from keyboard navigation
    And the parent remains visible and reports a collapsed state
    And the selected feature and every unrelated branch retain their previous state

  @core
  Scenario: R11 — Reopening a branch restores its preserved nested fold state
    Given one nested branch was expanded and another nested branch was folded before their ancestor was folded
    When the user reopens the ancestor
    Then the previously expanded branch and its visible descendants are restored
    And the previously folded branch is restored as folded
    And descendants of the still-folded branch remain hidden until that branch is reopened

  @core
  Scenario: R12 — Selecting a parent row does not change its fold state
    Given a parent branch has a known fold state
    When the user selects the parent row
    Then that feature becomes the selected detail
    And the branch retains its previous expanded state
    And descendant visibility remains unchanged

  @core
  Scenario: R13 — Presentation controls preserve existing board state without server calls
    Given a feature is selected with a status filter and an unsaved body draft
    When the user toggles one overlay, prompt, or branch-fold control
    Then the selected feature, status filter, and body draft remain unchanged
    And no feature mutation, lifecycle, persistence, or agent-dispatch request is sent

  @core
  Scenario: R14 — Lifecycle refresh preserves an in-progress body draft
    Given an active feature is being edited with the unsaved draft "local changes"
    When the user completes the existing "Verify" lifecycle action successfully
    Then the selected feature advances to "verifying"
    And success feedback and the available lifecycle actions reflect the returned state
    And the editor remains in edit mode with the draft exactly equal to "local changes"

  @core
  Scenario: R15 — Existing planning events still refresh the tree and selected detail
    Given a selected feature and its tree row display server-backed state
    And that server-backed state subsequently changes
    When an existing refresh-triggering "feature.updated", "feature.transitioned", or "queue.job.completed" event arrives
    Then the Feature Tree and selected detail reload the changed state without a manual page refresh
    And the same feature remains selected
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0655 | Refine Features board overlays, editing, prompt, and branch folding | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-24T17:33:49.508Z backlog → active (system)
- 2026-08-24T17:33:49.843Z active → verifying (system)
- 2026-08-24T17:33:50.212Z verifying → done (system)
