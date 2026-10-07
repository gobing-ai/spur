---
schema_version: 1
name: Rescue unparseable idea-pipeline recommendation and needs-design signals with catalog decisions
status: todo
template: feature-impl
created_at: 2026-10-07T01:02:20.691Z
updated_at: "2026-10-07T01:03:33.499Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 5

dependencies: ["1096"]
---

## 1097. Rescue unparseable idea-pipeline recommendation and needs-design signals with catalog decisions

### Background

Slice S5 of docs/design/decision-observability-and-adoption.md §5. idea-pipeline derives the discovery recommendation by awk over `## Recommendation` (config/workflows/idea-pipeline.yaml:146) and reads an agent-written needs_design JSON; unparseable output pauses or defaults today. Covers R11. Starts only when the reliability report shows evidence for idea-recommendation and needs-design.

### Requirements

- [ ] R1. Add catalog entries `idea-recommendation` (choice proceed/reshape/drop) and `needs-design` (noul, fallback yes) to config/decisions.
- [ ] R2. Keep the deterministic parse first; call the decision only when it yields unknown or the JSON is missing/corrupt.
- [ ] R3. A fallback outcome writes unknown so the run pauses for the operator exactly as today.
- [ ] R4. A recommendation the parser classifies never calls a maker.

### Acceptance Criteria

- [ ] AC1 — Unparseable agent output resolves through a catalog decision

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:48.069Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

### Design

Chosen: rescue-only — deterministic parse stays authoritative, decision resolves the residue. Rejected: replacing the awk parse outright (adds latency and model risk on the happy path). Invariant: routing for parseable reports is byte-identical to today.

### Plan

1. Failure list: parse hit calling maker, fallback auto-proceeding, corrupt JSON skipping design.
2. Catalog entries.
3. Workflow decide/rescue step in idea-pipeline after the awk derivation.
4. E2E: inline run with a malformed recommendation line routes via decision; parseable line shows no decision events.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
