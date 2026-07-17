---
template: feature-impl
schema_version: 1
name: "Dogfood @1.2 contract enforcement (finalize, fixtures, tests)"
description: ""
status: todo
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["workstream:dogfood", "impl", "dogfood-1.2"]
dependencies: ["0274"]
created_at: "2026-07-17T01:13:58.102Z"
updated_at: "2026-07-17T01:14:24.757Z"
---

## 0276. Dogfood @1.2 contract enforcement (finalize, fixtures, tests)

### Background
**Type:** feature-impl · **Feature:** N · **Package:** dogfood @1.2 Impl A (from 0274)

**Goal:** Make non-compliant dogfood reports *detectable and rejectable*. Enforce finalize structure, protocol string `sp:dogfood-testing@1.2`, golden fixtures, and automated tests.

**Authority:** docs/tasks2/0274 Solution W1-W6; audit docs/tasks2/0273 findings D1-D5, D10.

**Predecessor:** task 0244 delivered always-on dual artifacts @1.1 — do not regress.
### Requirements
- [ ] R1. Bump protocol to sp:dogfood-testing@1.2 in SKILL.md metadata + report-template + monitor-ledger + dev-dogfood prose (W1/D5).
- [ ] R2. Expand Phase 4 finalize-or-abort: require summary footer; unique ### 1-6; #### Fixed + #### Unresolved; no complete if checks fail (W2/D1/D3).
- [ ] R3. Ledger row count must equal declared executed steps (W3/D4).
- [ ] R4. Add pass + fail fixtures under plugins/sp/skills/dogfood-testing/tests/fixtures/ (W4/D2/D10).
- [ ] R5. Automated tests validate pass fixture and reject missing-footer fixture (W5/D1/D2).
- [ ] R6. Optional validate-report helper used by tests (W6) — inline in test file is OK.
- [ ] R7. Preserve dual artifacts, live ledger, anti-fiction cache math, testee-scoped --agent, verdict-grades-testee.
- [ ] R8. bun test skill-structure (+ new dogfood tests) green.
### Acceptance Criteria
```gherkin
@core
Scenario: Complete requires footer
  Given a dogfood report missing the Dogfood Summary footer
  When the @1.2 finalize checklist or validator runs
  Then status complete is refused and missing_footer is reported

@core
Scenario: Pass fixture is green
  Given tests/fixtures/report-complete.md
  When the report contract tests run
  Then they pass
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
1. Version bump strings @1.2.
2. Phase 4 checklist + report-template notes.
3. Ledger cardinality rule.
4. Write fixtures (pass/fail).
5. Tests R22b / fixture assertions.
6. Solution change-map; run tests.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
