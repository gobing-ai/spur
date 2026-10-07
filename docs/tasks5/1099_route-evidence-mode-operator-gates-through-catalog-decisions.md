---
schema_version: 1
name: Route evidence-mode operator gates through catalog decisions
status: todo
template: feature-impl
created_at: 2026-10-07T01:02:20.692Z
updated_at: "2026-10-07T01:03:33.907Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 4

dependencies: ["1096"]
---

## 1099. Route evidence-mode operator gates through catalog decisions

### Background

Slice S7 of docs/design/decision-observability-and-adoption.md §5. Evidence-mode operator gate answers come from the legacy defaultDecisionMaker().choice in the workflow gate responder (packages/app/src/workflow/, evidence path lines 340 and 442). Covers R13. Starts only when reliability evidence exists for gate-evidence.

### Requirements

- [ ] R1. Add catalog entry `gate-evidence` (yes/no, fallback defers to the operator).
- [ ] R2. Route the evidence-mode path through DecisionService with caller gate and run correlation so it emits the lifecycle events.
- [ ] R3. Bundled gates keep mode never and still pause for the operator.

### Acceptance Criteria

- [ ] AC1 — Operator gates in evidence mode resolve through catalog decisions

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:49.711Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

### Design

Chosen: replace the legacy maker call with DecisionService.decide behind the same evidence-mode switch. Rejected: changing bundled gate modes. Invariant: mode never remains a pure operator pause.

### Plan

1. Failure list: never-mode gate calling a maker, fallback auto-answering yes, missing events.
2. Catalog entry; swap call in the responder.
3. E2E: project override in evidence mode emits decision events; bundled run still pauses.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
