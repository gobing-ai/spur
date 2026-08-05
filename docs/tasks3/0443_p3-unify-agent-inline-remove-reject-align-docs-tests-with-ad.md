---
template: feature-impl
schema_version: 1
name: "P3: unify --agent inline — remove reject, align docs/tests with ADR-047"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P1
tags: ["inline", "docs", "h83", "p3"]
dependencies: ["0437"]
created_at: "2026-08-05T19:00:59.295Z"
updated_at: "2026-08-05T19:08:26.265Z"
---

## 0443. P3: unify --agent inline — remove reject, align docs/tests with ADR-047

### Background

AgentService rejects inline; workflow-driven commands advertise <auto|name> only; cross-cutting still says inline is default. Dual legacy confuses agents and operators.

### Requirements
R1. spur agent run --agent inline resolves to agent.default (same as omit) and dispatches; no exit 2.
R2. Workflow vars: omit and inline both resolve to agent.default injection path; never fail stages on literal inline.
R3. Interactive slash contract unchanged: omit/inline stay in host session (prompt-side).
R4. Update cross-cutting, flag-glossary, dev-run/plan/runall, execution-workflow, help cmd_agent; remove ADR-046 unrepresentable claims.
R5. Fix plugins/sp tests: inline-execution-contract, flag-contract-parity, command-flag-parity, agent-service tests.
R6. dev-plan/dev-runall may keep advertising inline as accepted synonym for default.
### Acceptance Criteria
```gherkin
@core
Scenario: R6 — Unified --agent inline
  Given --agent inline on spur agent run
  When resolution runs
  Then agent.default is selected and a subprocess starts
  And plugin docs no longer claim inline is unrepresentable on workflow-driven commands

@core
Scenario: R7 — Docs and tests agree
  Given cross-cutting.md, flag-glossary, dev-run/plan/runall, ADR-047, and plugin contract tests
  When the surface is inspected
  Then there is no dual "inline is default" vs "inline is unrepresentable" split
  And observation guidance prefers workflow trace --follow --output
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: resolveAgent('inline') → default executor; docs single table.
WHY: one mental model.
NOT: Phase D host stages.
### Plan
- [ ] Runtime resolve change + tests
- [ ] Docs sweep
- [ ] Plugin contract tests green
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H83

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-05T19:08:26.265Z todo → cancelled (system)
