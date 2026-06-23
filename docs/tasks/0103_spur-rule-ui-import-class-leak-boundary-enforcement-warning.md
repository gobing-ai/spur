---
schema_version: 1
name: "Spur rule: UI import + class-leak boundary enforcement (warning)"
status: todo
template: feature-impl
created_at: 2026-06-23T06:04:57.965Z
updated_at: 2026-06-23T06:04:57.965Z
feature_id: F7
priority: P2
tags: ["rules", "ui", "boundary"]
---

## 0103. Spur rule: UI import + class-leak boundary enforcement (warning)

### Background

With the component layer in place (Tasks 1-2), enforce that ui.ts is the only UI import seam and that no daisyUI component classes leak outside components/ui/. The rule engine already has the two evaluators needed (proven in config/rules/boundary/dao-boundary.yaml): `forbidden-import` (block third-party UI lib specifiers outside the seam) and `rg` (flag raw daisyUI component className strings). Both rules START at severity warning so the gate never breaks during adoption — the warning->error promotion is Task 4. Precedent for warning severity: require-corresponding-test in test-location.yaml.

### Requirements

1) Create a new preset directory config/rules/ui/ with a rule file (e.g. ui-import-boundary.yaml). 2) Rule A (forbidden-import, warning): forbid importing third-party UI library specifiers (e.g. daisyui, @uiw/react-md-editor, and future UI libs) anywhere under apps/web/src/** EXCEPT apps/web/src/components/ui/** and apps/web/src/ui.ts. 3) Rule B (rg, warning): flag className strings containing daisyUI COMPONENT classes (btn|card|badge|modal|menu|navbar|drawer|tabs|alert|dropdown|collapse|join|tooltip|loading|select|checkbox|toggle) outside components/ui/ — MUST NOT match layout/utility classes (flex, grid, gap-*, p-*, etc.); build the allowlist/regex carefully to avoid noise. 4) Scope: include apps/web/src/**, exclude components/ui/** + ui.ts + tests + node_modules. 5) Run `spur rule run` against the (now-conforming post Task 2) tree to confirm zero violations. Do NOT yet wire into recommended-pre-check (that is Task 4). Gate: rule validates (`spur rule validate`); bun run lint green; 04_DESIGN.md rule surface updated in same commit if it indexes rules.

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
