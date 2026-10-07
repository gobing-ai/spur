---
schema_version: 1
name: Rescue ambiguous history-anatomy verdicts without overturning FAIL
status: todo
template: feature-impl
created_at: 2026-10-07T01:02:20.692Z
updated_at: "2026-10-07T01:03:33.704Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 3

dependencies: ["1096"]
---

## 1098. Rescue ambiguous history-anatomy verdicts without overturning FAIL

### Background

Slice S6 of docs/design/decision-observability-and-adoption.md §5. history-anatomy normalizes validator prose with a shell `Verdict:` line rewrite (config/workflows/history-anatomy.yaml:236). Covers R12. Starts only when reliability evidence exists for anatomy-validation-verdict.

### Requirements

- [ ] R1. Add catalog entry `anatomy-validation-verdict` (PASS/FAIL, fallback FAIL).
- [ ] R2. Any exact `Verdict: FAIL` line short-circuits to FAIL without a maker call.
- [ ] R3. Decision consulted only when verdict lines are absent or ambiguous; it can never turn a deterministic FAIL into PASS.
- [ ] R4. Deterministic status checks in pr-review, wayfinder, wrapup, feature-verification and history stay free of decision calls (pin with a workflow scan test).

### Acceptance Criteria

- [ ] AC1 — A deterministic FAIL is never overturned by a decision

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:48.887Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

### Design

Chosen: rescue-only after the existing normalization, fallback FAIL. Rejected: model-first verdict (would launder FAIL). Invariant: FAIL dominates.

### Plan

1. Failure list: FAIL line overridden, ambiguous text auto-PASS, decision added to deterministic gates.
2. Catalog entry and workflow step.
3. E2E: validator file with mixed lines yields FAIL with no maker call.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
