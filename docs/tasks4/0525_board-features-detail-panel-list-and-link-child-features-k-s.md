---
template: feature-impl
schema_version: 1
name: "Board Features detail panel: list and link child features (K subtree)"
description: ""
status: todo
type: task
profile: standard
feature_id: K
parent_wbs: null
priority: P2
tags: ["board-features"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T07:09:29.141Z"
updated_at: "2026-08-12T07:11:42.861Z"
---

## 0525. Board Features detail panel: list and link child features (K subtree)

### Background

- Closure-audit result for K (sp-dev-find-next handoff, 2026-08-12): R1 and R2 clauses 1-2 are satisfied by the corpus; R2 clause 3 is unmet.
- Implements: R2 — Project switcher is a child of K (carried scenario, no R-prefix per DD-09).
- Evidence for the gap:
  - Corpus: K's `## Tasks` auto-gen region renders `_No linked tasks._`; `spur feature refresh` populates it only from direct `feature_id == K` task edges (`packages/app/src/services/feature-service.ts:378-380`, `renderTasksTable` at `:1056-1065`) — no child-feature subtree links.
  - Board: `apps/web/src/modules/features/FeatureDetail.tsx` metadata pane filters linked tasks by `t.featureId === featureId` (`:634-637`) and has no children section; `FeatureShowData` (`apps/web/src/lib/feature-types.ts:18-26`) carries no children field.
- Non-duplication: F8 (tree/detail/lifecycle/check — 0194, 0342 done), F81 (detail action group — done), F82 (status icons/filter — active, 0325/0326 done), K1 (project switcher — done) none ship a child-feature listing in the detail panel. This is net-new Board Features surface inside K's Goal/Scope (`apps/web/src/modules/features`).
- Rubric: E2 D1 L1 C0 R0 = 4 → single cohesive task (one module, one review gate); keep as one task.

### Requirements
- [ ] R1. FeatureDetail renders a child-features section listing every direct child of the selected feature (same ID-prefix rule as FeatureTree: `id.length === parent.length + 1 && id.startsWith(parent)`), each with name, status badge, and click-to-navigate.
- [ ] R2. For an umbrella feature whose direct task edge set is empty (e.g. K), the panel shows its child subtree instead of a dead-end "No linked tasks" state.
- [ ] R3. A feature with no children renders no children section (no empty-state noise).
- [ ] R4. No server contract change required: children derive client-side from the flat feature list the shell already loads, reusing the existing grouping helper.
### Acceptance Criteria
```gherkin
Feature: Features module (Spur Board)

  Scenario: R1 — Project switcher is a child of K
    Given a feature F with direct children F1, F2 selected in the Board Features detail panel
    When the detail panel renders
    Then a child-features section lists F1 and F2
    And each child shows its name and status badge
    And clicking a child navigates the selection to that child

  Scenario: R2 — Project switcher is a child of K
    Given feature K has zero direct linked tasks and a direct child K1
    When K is selected in the Board Features detail panel
    Then the panel lists or links the K1 subtree instead of a dead-end no-linked-tasks state

  Scenario: R3 — Project switcher is a child of K
    Given a feature with no direct children is selected
    When the detail panel renders
    Then no child-features section is rendered

  Scenario: R4 — Project switcher is a child of K
    Given the Features module is loaded
    When a feature with children is selected
    Then its children derive client-side from the flat feature list already loaded by the shell
    And no additional server contract or fetch is introduced
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
- Chosen approach: derive children client-side from the `FeatureSummary[]` list already held by `FeaturesShell` (`apps/web/src/modules/features/FeaturesShell.tsx:33-40`), pass the selected feature's children into `FeatureDetail` as a prop, and render a "Child features" section in the metadata pane next to Linked Tasks. Reuses `groupByParent`'s ID-prefix rule (`FeatureTree.tsx:47-61`) so tree and detail agree by construction.
- Why: zero contract/API churn — the flat list is already fetched once and SSE-refreshed; the tree already proves the derivation works client-side. Extending `FeatureShowData` with a server children field would duplicate data the client already has and add a contract change for no fidelity gain.
- Rejected: (1) server-side `children` in the show response — contract churn, redundant with the list endpoint; (2) modifying `spur feature refresh` to render child links in the corpus `## Tasks` region — that is Planning CLI/corpus machinery owned by root F, explicitly out of K's Scope.
- Invariants: same ID-prefix convention as `FeatureTree` (DD-14); status badges reuse `FeatureStatusIcon`; navigation reuses the existing tree select path (clicking a child selects it in the shell).
- Key signature (sketch): `FeatureDetail` gains `children?: FeatureSummary[]` prop; `FeaturesShell` computes `children = groupByParent(features).get(selectedId)` and passes it.
### Plan
1. Extract/confirm the child-grouping helper so both `FeatureTree` and `FeatureDetail` consume one derivation (reuse existing `groupByParent` if exported, else export it).
2. Thread `children` from `FeaturesShell` into `FeatureDetail` (compute via the helper for `selectedId`).
3. Render a "Child features (N)" section in the metadata pane: name, `FeatureStatusIcon`, click navigates to the child (reuse the tree's select handler path).
4. Add component tests in `apps/web/tests/modules/features/components.test.tsx` covering R1-R3 (children listed; empty-edge umbrella shows subtree; no children → no section).
5. Verify with the existing features module test suite; no server/contract changes.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
