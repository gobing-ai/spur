---
schema_version: 1
name: Report decision reliability from recorded decision events
status: todo
template: feature-impl
created_at: 2026-10-07T01:02:20.691Z
updated_at: "2026-10-07T01:03:33.296Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 4

dependencies: ["1095"]
---

## 1096. Report decision reliability from recorded decision events

### Background

Slice S3 of docs/design/decision-observability-and-adoption.md §5, plus the audit and roadmap of §4–§5. Each adoption slice (task 1094 and the rescue tasks) starts only when recorded evidence exists for its decision id and maker. Covers R9, R10.

### Requirements

- [ ] R1. Reliability view over system_events where source = decision, grouped by decisionId × maker: samples, acceptedRate, fallbacks by reason, medianConfidence, p50/p95 durationMs, firstSeen/lastSeen.
- [ ] R2. Reads recorded events only; never calls a maker; a decision with zero rows reports evidence none.
- [ ] R3. Surface lives under the existing `decision` noun; a new public verb or flag needs operator consent before landing (default proposal: `spur decision status --reliability --json`).
- [ ] R4. Mark the audit/roadmap satellite accepted once the report exists, keeping the §4 classification table complete for all shipped workflows.

### Acceptance Criteria

- [ ] AC1 — A reliability report summarizes recorded decision outcomes per decision and maker
- [ ] AC2 — The workflow audit classifies every shipped workflow step

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:47.269Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

### Design

Chosen: compute in packages/app (application service over the system_events DAO), thin CLI transport. Rejected: a separate analytics store — events already hold every field. Invariant: no maker call on this path. Percentiles computed in-process over the bounded per-group sample.

### Plan

1. Failure list: empty ledger, mixed makers, null confidence rows, non-decision sources leaking in.
2. App service query + aggregation.
3. CLI flag under decision status with --json (after operator consent on the surface).
4. E2E: run several `spur decision run` calls, then report shows counts matching the ledger.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
