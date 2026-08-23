---
schema_version: 1
name: "Features board shell layout alignment, module header, and collapsible left Feature Tree dock"
status: todo
template: feature-impl
created_at: 2026-08-23T23:16:46.702Z
updated_at: "2026-08-23T23:17:02.818Z"
feature_id: F84
priority: P2
tags: ["web", "features", "layout"]
---

## 0643. Features board shell layout alignment, module header, and collapsible left Feature Tree dock

### Background

Align FeaturesShell.tsx with History module layout (max-w-[1600px] container, top module header with icon, title, description, and module action container). Convert the static left tree column into a floating/dockable sidebar with collapsible toggle and smooth CSS transitions. Covers feature scenarios R1, R2. Rubric: E2 D1 L1 C1 R2 = 7 -> decompose (deliverable boundary).

### Requirements
- [ ] R1. Center the Features board workspace in a max-w-[1600px] width-constrained container.
- [ ] R2. Add a unified module header with module icon 🎯, 'Features' title, subtitle description, and right-aligned action container for root feature creation and status filters.
- [ ] R3. Implement collapsible/dockable left Feature Tree panel with expand/collapse toggle affordance.
### Acceptance Criteria
```gherkin
Feature: Features board shell layout and collapsible tree dock

  Scenario: R1 — Aligned shell layout with width constraint and module header
    Given a user navigates to the Features board module
    When the page renders
    Then the main view is centered within a max-w-[1600px] width-constrained container
    And the header displays the module icon, "Features" title, description, and top-right action button container

  Scenario: R2 — Floating and collapsible left Feature Tree panel
    Given the Features board shell is loaded
    When the user toggles the tree dock button
    Then the left Feature Tree panel collapses or expands smoothly
    And the main detail view dynamically occupies the available canvas width
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Implement in apps/web/src/modules/features/FeaturesShell.tsx and FeatureTree.tsx. Introduce isTreeOpen state, collapsible sidebar wrapper with transition-all duration-200, and standard header layout.

### Plan

- [ ] Refactor FeaturesShell.tsx container to max-w-[1600px] mx-auto w-full
- [ ] Implement standardized module header with title, icon, and action container
- [ ] Add collapsible floating dock wrapper for FeatureTree with toggle button
- [ ] Verify tree navigation and status filter menu remain functional

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
