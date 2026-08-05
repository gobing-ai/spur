---
template: feature-impl
schema_version: 1
name: "Skill launch hygiene: forward profile/agent vars; observation runbook without tail pipes"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P2
tags: ["skills", "docs", "h83", "p2"]
dependencies: ["0437"]
created_at: "2026-08-05T19:00:59.301Z"
updated_at: "2026-08-05T19:08:26.472Z"
---

## 0444. Skill launch hygiene: forward profile/agent vars; observation runbook without tail pipes

### Background

Outer omp launched workflow with --vars {"wbs":"0436"} only — missing profile:auto despite --auto; observation used trace --follow | tail -60 which buffers and was hijacked.

### Requirements
R1. sp:spur-dev / execution-workflow full-mode launch must pass profile:auto when --auto; pass agent when --agent set.
R2. Document and test (prompt contract or script check) that observation uses workflow trace --follow [--output], never | tail.
R3. Optional: dev-run command prose names the exact jq vars construction.
### Acceptance Criteria
```gherkin
@core
Scenario: R7 (cancelled) — Launch and observation hygiene
  Given /sp:dev-run full mode guidance with --auto
  When the documented launch command is followed
  Then --vars includes profile auto and wbs
  And observation examples use --follow --output without tail
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: skill/reference prompt fixes + contract tests where feasible.
WHY: dogfood compliance.
### Plan
- [ ] Audit run path for vars construction
- [ ] Fix prose + examples
- [ ] Add structure/contract assertion if possible
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
- 2026-08-05T19:08:26.472Z todo → cancelled (system)
