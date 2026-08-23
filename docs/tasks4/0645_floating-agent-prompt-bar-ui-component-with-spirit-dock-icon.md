---
schema_version: 1
name: "Floating agent prompt bar UI component with spirit dock icon and foldable glassmorphic container"
status: todo
template: feature-impl
created_at: 2026-08-23T23:16:46.737Z
updated_at: "2026-08-23T23:17:03.768Z"
feature_id: F84
priority: P2
tags: ["web", "features", "agent-ui"]
dependencies: ["0644"]
---

## 0645. Floating agent prompt bar UI component with spirit dock icon and foldable glassmorphic container

### Background

Create a foldable floating prompt bar component for the Features module at the bottom of the viewport (~75% width centered when open, spirit dock icon in bottom-right corner when closed) as a frontend UI stub for upcoming agent execution integration. Covers feature scenarios R6, R7. Rubric: E2 D1 L1 C1 R2 = 7 -> decompose (deliverable boundary).

### Requirements
- [ ] R1. Build FloatingAgentBar component with glassmorphism styling (backdrop-blur-md bg-base-100/80 border border-base-content/10).
- [ ] R2. Implement collapsible state: expanded state (~75% viewport width max-w-4xl centered) with prompt input textarea, model/role chip, and send button; collapsed state (floating spirit/agent icon button in bottom-right corner).
- [ ] R3. Integrate FloatingAgentBar into FeaturesShell with toggle state and ensure clean layering above canvas without obstructing interactions.
### Acceptance Criteria
```gherkin
Feature: Floating agent prompt bar component

  Scenario: R6 — Foldable floating agent prompt bar UI stub
    Given the user is on the Features board
    When viewing the bottom viewport area
    Then a floating glassmorphism prompt bar is displayed at approximately 75% viewport width
    And clicking the collapse trigger docks it as a spirit icon in the bottom-right corner

  Scenario: R7 — Layout responsiveness and empty state resilience
    Given no feature is currently selected in the tree
    When the detail area renders
    Then a centered placeholder guides the user to select a feature without breaking floating panel docking
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Create apps/web/src/modules/features/FloatingAgentBar.tsx and mount in FeaturesShell.tsx. Pure UI state (isOpen, promptText) with stubbed submit action.

### Plan

- [ ] Create FloatingAgentBar.tsx with expanded glassmorphic card and collapsed spirit dock icon
- [ ] Wire up expand/collapse toggle and prompt input state
- [ ] Mount in FeaturesShell.tsx and verify z-index and responsive layout
- [ ] Add unit/component tests for layout states and interactions

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
