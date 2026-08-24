---
schema_version: 1
name: "Refine Features board overlays, editing, prompt, and branch folding"
status: done
template: feature-impl
created_at: 2026-08-24T06:19:46.037Z
updated_at: "2026-08-24T18:32:27.335Z"
feature_id: F841
priority: P2
tags: ["web", "features", "ui", "accessibility"]
---

## 0655. Refine Features board overlays, editing, prompt, and branch folding

### Background
F841 is one boundary-preserving Features-board refinement. Its four visible changes share the same
presentation state and regression surface, so splitting them would add lifecycle ceremony while
making selection, draft, and refresh preservation harder to verify as one behavior.

Current premises were verified against the 2026-08-24 tree:

- `FeaturesShell` renders Feature Tree as a flex-width sibling, so opening it currently narrows the
  detail workspace.
- `FeatureDetail` already owns Metadata as an absolute right inspector; it does not need a new
  drawer host, portal, or state owner. Preview and editor content are still capped at `max-w-4xl`,
  while the detail header is wider, and the BODY/Edit row still occupies body space.
- `FloatingAgentBar` starts expanded at 75% width with a 56rem (`max-w-4xl`) cap. Its submit path is
  intentionally a local stub and sends no request.
- `FeatureTree` recursively renders every descendant and has only row-selection controls; it owns
  no fold state.
- Existing lifecycle handlers reload with `body: false`, but a same-feature `refreshKey` load applies
  the server body unconditionally and can replace an in-progress draft. The refinement must preserve
  metadata/status refresh while guarding the editor buffers.

The task covers all F841 scenarios R1-R15 in one UI delivery and one focused component-test file.
Its implementation boundary is the existing Features components, their component tests, and the
Features-board design satellite; backend, transport, database, CLI, and lifecycle contracts are not
involved.
### Requirements
- [x] R1. Render Feature Tree and Metadata as left/right overlays around one full-width detail
  workspace. Opening or closing either panel must not change the detail header, preview, or editor
  width or horizontal position, and preview/editor boundaries must align with the header.
- [x] R2. Remove the in-body BODY label and editing controls. Put Edit immediately before Metadata
  in the detail header; while editing, replace that slot with Save followed by Cancel. Preserve the
  existing save request, saved preview, cancel-without-request behavior, loading/error feedback,
  metadata content, and body draft semantics.
- [x] R3. Initialize the floating agent prompt folded. When opened, its width must be
  `min(84rem, 100vw - 2rem)`, leaving 1rem gutters on both sides without horizontal overflow. Keep
  the existing local stub behavior; add no dispatch or persistence behavior.
- [x] R4. Give each parent tree node a separate keyboard-operable fold control with an
  action-and-node accessible name, `aria-expanded`, and `aria-controls` targeting a stable child-list
  id. Folding must remove all recursive descendants from the DOM and keyboard order, retain nested
  and unrelated branch state, and remain independent of row selection. Leaf nodes have no fold
  control; branches start expanded.
- [x] R5. Keep overlay, prompt, and branch-fold state local and presentation-only. Their controls
  must preserve selection, status filter, unsaved body draft, and existing lifecycle state without
  feature mutation, lifecycle, persistence, or agent-dispatch requests. Same-feature background
  refreshes must continue updating server-backed detail/tree state while leaving editor buffers
  untouched during edit mode.
- [x] R6. Preserve the existing `feature.updated`, `feature.transitioned`, and
  `queue.job.completed` refresh paths and selected feature. Add focused component coverage for
  overlay geometry, header action order/substitution, save/cancel and lifecycle draft preservation,
  prompt bounds/default, recursive and nested folding, selection isolation, ARIA state, no-call
  presentation controls, and SSE refresh. Update the Features-board UI design satellite in the same
  change.

Non-goals: backend agent dispatch; new API/DTO/database/CLI/lifecycle behavior; persisted fold or
panel preferences; fold-all controls; a shared drawer host, portal, context layer, dependency, or
alternate tree model.
### Acceptance Criteria
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
### Q&A
- **Panel architecture:** Keep Metadata in its existing absolute `FeatureDetail` inspector and make
  the existing Feature Tree container an absolute left overlay. No portal, shared drawer host,
  scrim, focus trap, or state relocation is needed for these non-modal panels.
- **Tree panel lifetime:** Keep `FeatureTree` mounted while the outer panel uses native `hidden`
  semantics when closed. This removes the panel from layout, accessibility, and keyboard navigation
  without discarding branch state.
- **Fold ownership/default:** `FeatureTree` owns one local `Set<string>` of collapsed ids. Empty means
  all branches expanded. State is neither persisted nor lifted to the shell.
- **Draft/refresh precedence:** A same-feature refresh in edit mode updates feature metadata/status
  but not server/draft buffers. Preview refreshes and feature-id changes retain their existing full
  load behavior. Existing save, cancel, and lifecycle handlers remain authoritative.
- **Prompt bounds:** The expanded bar uses a fixed 1rem viewport gutter and an 84rem cap, starts
  folded, and retains its current local submit stub.

No open decisions remain. Persisted preferences, fold-all controls, modal drawer behavior, and real
agent dispatch are deferred because F841 explicitly excludes them.
### Design
#### Invariants and surface

- No public API, DTO, route, database, lifecycle, or component prop contract changes are required.
- Reuse the existing state owners: `FeaturesShell` for selection/filter/tree visibility,
  `FeatureDetail` for metadata/body/editing, `FloatingAgentBar` for prompt state, and `FeatureTree`
  for branch presentation state.
- Presentation toggles perform no fetch or mutation. Existing list/detail/SSE and body-update calls
  keep their current endpoints and payloads.

#### Layout and editing

1. In `FeaturesShell.tsx`, keep the work area `relative`, make the selected detail fill it, and move
   the existing tree container to an absolute left overlay above the detail. Keep the tree component
   mounted and set the overlay's native `hidden` state from `isTreeOpen`; retain the current
   `aria-controls`/`aria-expanded` shell toggle. Do not add a portal or layout-width state.
2. In `FeatureDetail.tsx`, leave the existing absolute Metadata aside and local `showMetadata` state
   in place. Remove `max-w-4xl`/centering from the preview and editor wrappers so their content width
   follows the same detail container as the header.
3. Remove the BODY/action row. Render the existing edit mode controls in the header action cluster
   immediately before Metadata: preview shows Edit; edit mode shows Save then Cancel. Reuse
   `handleEdit`, `handleSave`, and `handleCancel` unchanged except for placement.

#### Draft-safe refresh precedence

Mirror the current body mode in a ref so the `refreshKey` load effect can inspect it without making
mode a fetch dependency. When the loaded id equals `paintedIdRef.current` and the ref reports edit
mode, call the existing `applyFeature` seam with `{ body: false }`; otherwise keep the full apply.
This yields one precedence rule: same feature + editing preserves editor buffers, while same feature
+ preview and a different feature keep existing server-body loading. Existing lifecycle reloads
already use `{ body: false }` and need no parallel mechanism.

#### Branch folding

- Add `collapsedIds: Set<string>` in `FeatureTree`; toggle ids immutably through one callback. Keeping
  this state above recursive nodes preserves nested states when an ancestor stops rendering them.
- A node is a parent only when the existing grouped/sorted child list is non-empty. Render a fold
  button beside, never inside, the row-selection button. Its accessible name is
  `Collapse|Expand <feature id>: <feature name>`, `aria-expanded` reflects the branch, and
  `aria-controls` points to `feature-tree-children-<feature id>`.
- Render the child `<ul>` only while expanded. Collapsing therefore removes every recursive
  descendant from DOM/tab order; reopening consults the unchanged root set, restoring nested and
  unrelated states. Selecting the adjacent row calls only `onSelect`.
- Reuse the installed icon set and current recursive tree/model. Do not introduce a second tree
  representation or clean up stale ids; stale local ids are harmless and disappear with component
  lifetime.

#### Floating prompt

Initialize `isOpen` to `false`. On open, use `w-[calc(100vw-2rem)] max-w-[84rem]` with the existing
fixed centering so both 1rem gutters remain and the cap is exactly 50% above the former 56rem cap.
Keep the current textarea, collapse/open controls, z-index, and no-network submit notice.

#### Files and verification seams

- Production: `FeaturesShell.tsx`, `FeatureDetail.tsx`, `FeatureTree.tsx`, `FloatingAgentBar.tsx`.
- Tests: `apps/web/tests/modules/features/components.test.tsx`; update selectors to distinguish fold
  buttons from row-selection buttons and assert structure/state rather than JSDOM pixel geometry.
- Design: `docs/design/features-board-layout-refactor.md`; replace its obsolete docked/narrow-body
  and expanded-56rem prompt statements with the F841 contract.

Rejected: new drawer infrastructure, global context, persisted UI preferences, another tree model,
or a prompt-width configuration. Each adds a seam without satisfying an accepted scenario.
### Plan
1. Update focused component tests to encode F841 R1-R15: stable overlay/full-width structure, header
   Edit/Save/Cancel order and save/cancel behavior, folded prompt bounds, independent recursive fold
   state/ARIA, no-call toggles, draft-safe lifecycle refresh, and all three planning-event refresh
   types. Adapt existing tree selectors for the new separate fold buttons.
2. Convert the shell tree container to a mounted native-hidden absolute overlay and make the detail
   workspace width independent of tree visibility (R1, R13, R15).
3. Keep Metadata's existing absolute overlay, remove the preview/editor width cap and BODY row, move
   existing edit controls before Metadata, and guard same-feature edit-mode refreshes through
   `applyFeature({ body: false })` (R2-R6, R13-R15).
4. Start `FloatingAgentBar` folded and apply the 84rem/viewport-gutter width expression without
   changing its stub submission behavior (R7-R8, R13).
5. Add root-owned collapsed-id state and separate accessible parent fold controls to the existing
   recursive Feature Tree; conditionally omit collapsed descendants (R9-R13).
6. Update `docs/design/features-board-layout-refactor.md` to the accepted overlay, full-width body,
   header editing, prompt, branch-folding, state, and accessibility contract.
7. Run the focused Features component test first, then formatting/lint and the repository gates
   required by the task pipeline; record commands and outcomes in Testing and require a real verify
   PASS before completion.
### Solution
- `apps/web/src/modules/features/FeaturesShell.tsx:40`: `FeaturesShell` renders full-width workspace and absolute left overlay tree with native hidden attribute.
- `apps/web/src/modules/features/FeatureDetail.tsx:58`: `FeatureDetail` replaces in-body editing with header Edit/Save/Cancel actions and guards draft reloads via modeRef.
- `apps/web/src/modules/features/FloatingAgentBar.tsx:12`: `FloatingAgentBar` initializes folded and expands to wider 84rem glass bar.
- `apps/web/src/modules/features/FeatureTree.tsx:25`: `FeatureTree` implements accessible branch folding and omits collapsed descendants from the DOM.
- `docs/design/features-board-layout-refactor.md:1`: `Features Board Layout Refactor` satellite updated with F841 overlay, prompt, and folding specifications.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Verified in `apps/web/tests/modules/features/components.test.tsx:1198` |
| R2 | MET | Verified in `apps/web/tests/modules/features/components.test.tsx:1228` |
| R3 | MET | Verified in `apps/web/tests/modules/features/components.test.tsx:1140` |
| R4 | MET | Verified in `apps/web/tests/modules/features/components.test.tsx:1352` |
| R5 | MET | Verified in `apps/web/tests/modules/features/components.test.tsx:1442` |
| R6 | MET | Verified in `apps/web/tests/modules/features/components.test.tsx:1546` |
| AC-1 | MET | Scenario R1 verified in `apps/web/tests/modules/features/components.test.tsx:1198` |
| AC-2 | MET | Scenario R2 verified in `apps/web/tests/modules/features/components.test.tsx:1228` |
| AC-3 | MET | Scenario R3 verified in `apps/web/tests/modules/features/components.test.tsx:1255` |
| AC-4 | MET | Scenario R4 verified in `apps/web/tests/modules/features/components.test.tsx:1255` |
| AC-5 | MET | Scenario R5 verified in `apps/web/tests/modules/features/components.test.tsx:1276` |
| AC-6 | MET | Scenario R6 verified in `apps/web/tests/modules/features/components.test.tsx:1316` |
| AC-7 | MET | Scenario R7 verified in `apps/web/tests/modules/features/components.test.tsx:1140` |
| AC-8 | MET | Scenario R8 verified in `apps/web/tests/modules/features/components.test.tsx:1140` |
| AC-9 | MET | Scenario R9 verified in `apps/web/tests/modules/features/components.test.tsx:1352` |
| AC-10 | MET | Scenario R10 verified in `apps/web/tests/modules/features/components.test.tsx:1352` |
| AC-11 | MET | Scenario R11 verified in `apps/web/tests/modules/features/components.test.tsx:1388` |
| AC-12 | MET | Scenario R12 verified in `apps/web/tests/modules/features/components.test.tsx:1421` |
| AC-13 | MET | Scenario R13 verified in `apps/web/tests/modules/features/components.test.tsx:1442` |
| AC-14 | MET | Scenario R14 verified in `apps/web/tests/modules/features/components.test.tsx:1508` |
| AC-15 | MET | Scenario R15 verified in `apps/web/tests/modules/features/components.test.tsx:1546` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Feature Tree opens without resizing the detail workspace | MET | test | `apps/web/tests/modules/features/components.test.tsx:1198` |
| Scenario: R2 — Metadata opens without resizing the detail workspace | MET | test | `apps/web/tests/modules/features/components.test.tsx:1228` |
| Scenario: R3 — Preview mode exposes editing only in the detail header | MET | test | `apps/web/tests/modules/features/components.test.tsx:1255` |
| Scenario: R4 — Edit mode replaces the header Edit action with Save and Cancel | MET | test | `apps/web/tests/modules/features/components.test.tsx:1255` |
| Scenario: R5 — Saving from the header preserves body-update behavior | MET | test | `apps/web/tests/modules/features/components.test.tsx:1276` |
| Scenario: R6 — Cancelling from the header discards the body draft | MET | test | `apps/web/tests/modules/features/components.test.tsx:1316` |
| Scenario: R7 — Agent prompt starts folded | MET | test | `apps/web/tests/modules/features/components.test.tsx:1140` |
| Scenario: R8 — Expanded agent prompt respects its width cap and viewport gutters | MET | test | `apps/web/tests/modules/features/components.test.tsx:1140` |
| Scenario: R9 — Parent nodes expose an accessible fold control | MET | test | `apps/web/tests/modules/features/components.test.tsx:1352` |
| Scenario: R10 — Folding a branch hides every recursive descendant independently | MET | test | `apps/web/tests/modules/features/components.test.tsx:1352` |
| Scenario: R11 — Reopening a branch restores its preserved nested fold state | MET | test | `apps/web/tests/modules/features/components.test.tsx:1388` |
| Scenario: R12 — Selecting a parent row does not change its fold state | MET | test | `apps/web/tests/modules/features/components.test.tsx:1421` |
| Scenario: R13 — Presentation controls preserve existing board state without server calls | MET | test | `apps/web/tests/modules/features/components.test.tsx:1442` |
| Scenario: R14 — Lifecycle refresh preserves an in-progress body draft | MET | test | `apps/web/tests/modules/features/components.test.tsx:1508` |
| Scenario: R15 — Existing planning events still refresh the tree and selected detail | MET | test | `apps/web/tests/modules/features/components.test.tsx:1546` |

- Coverage: 77.42% line coverage on features module; full unit suite passes 6332 tests in `bun run test`.
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Ergonomics | FeaturesShell.tsx | Left/right overlay panels give full workspace width to detail canvas |
| P4 | Usability | FeatureDetail.tsx | Header editing controls avoid layout jumps and modeRef guards draft buffers |
| P4 | Accessibility | FeatureTree.tsx | Dedicated parent fold buttons carry explicit aria-expanded and aria-controls |
| P4 | Maintainability | FloatingAgentBar.tsx | Folded spirit dock default with bounded 84rem expansion preserves viewport gutters |
### References
- Parent feature: [F841 — Features board overlay panels, wider folded prompt bar, and branch folding](../features/F841_features-board-overlay-panels-wider-folded-prompt-bar-and-branch-folding.md)
- UI system SSOT: [DESIGN.md](../../DESIGN.md)
- Features-board satellite: [features-board-layout-refactor.md](../design/features-board-layout-refactor.md)
- Implementation seams: `apps/web/src/modules/features/{FeaturesShell,FeatureDetail,FeatureTree,FloatingAgentBar}.tsx`
- Regression seam: `apps/web/tests/modules/features/components.test.tsx`
### History
- 2026-08-24T17:16:31.693Z todo → wip (system)
- 2026-08-24T17:33:05.617Z wip → testing (system)
- 2026-08-24T17:33:43.164Z testing → done (system)
