---
schema_version: 1
name: "Feature detail refactor: constrained markdown canvas, collapsible right metadata drawer, and dynamic action bar hierarchy"
status: todo
template: feature-impl
created_at: 2026-08-23T23:16:46.721Z
updated_at: "2026-08-23T23:17:03.299Z"
feature_id: F84
priority: P2
tags: ["web", "features", "detail"]
dependencies: ["0643"]
---

## 0644. Feature detail refactor: constrained markdown canvas, collapsible right metadata drawer, and dynamic action bar hierarchy

### Background

Refactor FeatureDetail.tsx to provide a width-constrained reading/editing canvas for Markdown preview and MDEditor, a collapsible right metadata drawer (folded by default) for frontmatter/linked tasks/child features, and a 3-tier visual hierarchy for stage-based dynamic action buttons. Covers feature scenarios R3, R4, R5. Rubric: E2 D1 L1 C1 R2 = 7 -> decompose (deliverable boundary).

### Requirements
- [ ] R1. Apply readable width constraints (max-w-4xl) to the markdown body in preview mode and MDEditor edit mode.
- [ ] R2. Implement collapsible right metadata drawer (folded by default) with docked trigger button in header/margin to inspect frontmatter, timestamps, linked tasks, and child features.
- [ ] R3. Refactor dynamic action button group into clear primary FSM transition CTA, secondary creation/link buttons, and discrete hazard/cancel options.
### Acceptance Criteria
```gherkin
Feature: Feature detail reading canvas, metadata drawer, and action hierarchy

  Scenario: R3 — Width-constrained Markdown reading and editing area
    Given a feature is selected and its detail view is displayed
    When viewing the body in preview mode or editing in MDEditor
    Then the markdown content is constrained to a readable width container with comfortable padding

  Scenario: R4 — Foldable right-side feature metadata panel
    Given a feature is selected in the detail view
    When the feature details load
    Then the right metadata drawer is folded by default
    And clicking the docked metadata trigger button expands the panel to show frontmatter, linked tasks, and child features

  Scenario: R5 — Refined stage-based dynamic action bar in feature detail
    Given a feature with status "backlog", "active", "verifying", or "blocked"
    When the action bar renders in the feature detail header
    Then primary FSM transition actions are visually prominent
    And secondary creation and link actions are cleanly grouped without clutter
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Implement in apps/web/src/modules/features/FeatureDetail.tsx and feature-actions.ts. Add isMetadataOpen state with slide-over drawer and refine button variant hierarchy per status.

### Plan

- [ ] Wrap MarkdownBody and MDEditor containers in max-w-4xl centered reading canvas
- [ ] Implement right metadata drawer with toggle trigger and folded default
- [ ] Restyle action buttons with primary FSM transition visual emphasis
- [ ] Verify linked tasks navigation, child features navigation, and edit/save flow

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
