---
template: feature-impl
schema_version: 1
name: "ADR-047: supersede ADR-046 — unified --agent, run-scoped affinity, pipe streaming, Phase D hold"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P0
tags: ["adr", "h83", "p0"]
dependencies: []
created_at: "2026-08-05T19:00:59.261Z"
updated_at: "2026-08-05T19:08:24.963Z"
---

## 0437. ADR-047: supersede ADR-046 — unified --agent, run-scoped affinity, pipe streaming, Phase D hold

### Background

ADR-046 made --agent inline unrepresentable on workflow-driven commands, leaving dual legacy (inline default vs inline rejected). Dogfood shows host session hijack via bare -c, missing run↔session map, and batch-looking agent output. Decision authority must land before code.

### Requirements
R1. Add dated ADR-047 to docs/00_ADR.md superseding ADR-046 branch (b).
R2. Define one --agent value table for interactive slash vs workflow agent.run (omit|inline|auto|name).
R3. Mandate run-scoped agent session affinity default-on; config/vars knob to disable.
R4. Separate non-interactive (no TTY, stdin ignore) from buffered; require pipe+onOutput for pipeline agent.run.
R5. Agent matrix: omp, claude, codex, agy, grok, pi — capability notes for resume-by-id / session-dir / degrade.
R6. Explicit non-goal: Phase D host-stage control inversion (future ADR only).
R7. Point docs/03 and cross-cutting ownership at ADR-047; mark ADR-046 Superseded.
### Acceptance Criteria
```gherkin
@core
Scenario: R1 — ADR-047 supersedes ADR-046
  Given docs/00_ADR.md
  When ADR-047 is present and ADR-046 is Superseded
  Then one value table covers interactive and workflow surfaces
  And affinity default-on, pipe streaming, six-agent matrix, and Phase D hold are explicit
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: single decision record replacing ADR-046 dual-surface carve-out.
WHY: honesty rule — wrong ADR must be fixed, not defended.
WHERE: docs/00_ADR.md; cross-links in docs/03_ARCHITECTURE.md § agent/workflow as needed.
NON-GOAL: no runtime code in this task.
### Plan
- [ ] Draft ADR-047 body from H83 design notes
- [ ] Mark ADR-046 Superseded with pointer
- [ ] Minimal arch pointer if needed
- [ ] spur task check
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
- 2026-08-05T19:08:24.963Z todo → cancelled (system)
