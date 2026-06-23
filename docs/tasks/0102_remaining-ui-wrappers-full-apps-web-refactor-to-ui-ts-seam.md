---
schema_version: 1
name: "Remaining UI wrappers + full apps/web refactor to ui.ts seam"
status: todo
template: feature-impl
created_at: 2026-06-23T06:04:57.964Z
updated_at: 2026-06-23T06:04:57.964Z
feature_id: F7
priority: P1
tags: ["web", "ui", "daisyui", "refactor"]
---

## 0102. Remaining UI wrappers + full apps/web refactor to ui.ts seam

### Background

Follows the Button pilot (Task 1) which establishes the wrapper pattern and ui.ts barrel. This task completes the component layer for the remaining daisyUI surface and migrates all remaining call sites so daisyUI is fully centralized behind ui.ts. After this task, NO file outside components/ui/ should hand-write a daisyUI component className.

### Requirements

Ordered by class-frequency (descending): build typed wrappers for Badge (21), Select (15), Card (12), Loading (8), Modal (7), Checkbox (6), Toggle (3), Join (2) — ~8 components covering the entire remaining surface (~127 call sites). Each wrapper: encapsulates its daisyUI classes behind props, allows layout-utility className passthrough, follows the conventions set in Task 1. Re-export every wrapper from ui.ts. Refactor all remaining call sites to import from the ui.ts seam. Keep the existing custom components (ResizeHandle, ThemeToggle, etc.) consistent with the seam if they are part of the public component surface. Gate: bun run lint + bun run test + bun run build green; no raw daisyUI component classes remain outside components/ui/; git status only intentional changes.

### Acceptance Criteria

```gherkin
Feature: 

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design

<!-- Decision record — WHAT/WHY. Chosen approach + 1-line reason, rejected alternatives, key signatures (not bodies), invariants. ≤2 illustrative snippets MAX. -->

### Plan

- [ ] Implementation step

### History
