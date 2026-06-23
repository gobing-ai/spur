---
schema_version: 1
name: "Promote UI boundary rule to error + wire into pre-check gate + doc sync"
status: todo
template: feature-impl
created_at: 2026-06-23T06:04:57.965Z
updated_at: 2026-06-23T06:04:57.965Z
feature_id: F7
priority: P2
tags: ["rules", "ui", "gate", "docs"]
---

## 0104. Promote UI boundary rule to error + wire into pre-check gate + doc sync

### Background

The irreversible-commitment milestone: once the refactor (Tasks 1-2) conforms and the rule (Task 3) reports zero violations at warning, promote both rules to error and make them part of the standing gate so regressions are blocked at pre-check. Separate from Task 3 because flipping to error + wiring the gate is the permanent enforcement step and warrants its own checkpoint.

### Requirements

1) Promote Rule A and Rule B (config/rules/ui/) from warning to error. 2) Wire the ui boundary rule into recommended-pre-check (config/rules/recommended-pre-check.yaml) so `bun run test-pre-check` enforces it. 3) Verify the full gate stays green end-to-end: bun run lint + bun run test + bun run test-pre-check + bun run build. 4) Doc sync in the SAME commit: update docs/04_DESIGN.md (rule/config surface index) and docs/05_FEATURES.md (F7 status / new sub-feature for the UI seam) per the doc-map conflict rules; add an ADR entry only if this introduces a new cross-cutting decision (UI-component-seam boundary) — author-doc-first if so. 5) Confirm git status shows only intentional changes. Gate: all five verification-gate checks pass; no biome-ignore added to silence the gate.

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
