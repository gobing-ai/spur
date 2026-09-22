---
schema_version: 1
name: Deliver the measured task-pipeline optimization selected by 0912
status: blocked
template: standard
created_at: 2026-09-22T02:56:46.301Z
updated_at: "2026-09-22T02:57:59.825Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w04
estimate_hours: 8

ac_altitude: task-local
dependencies: ["0914", "0915", "0912", "0913"]
---

## 0917. Deliver the measured task-pipeline optimization selected by 0912

### Background

0912 will select a bounded pilot or report insufficient evidence; 0913 supplies trustworthy feedback. Existing D9 fast paths remain subject to ADR-107, and D62 already provides the candidate registry and promotion mechanism. This task consumes those outputs rather than choosing an optimization before measurement. Covers proposed feature R4. Depends on W01, W02, 0912 and 0913.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W04 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E8 D1 L2 C1 R1 = 13. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [ ] R1. Select exactly one bounded task-pipeline bottleneck from the landed 0912 baseline; freeze the cohort, primary metric, benefit threshold, reliability criteria, owner and candidate deadline before evaluation.
- [ ] R2. Preserve deterministic admission, current proof, reviewer independence, role pins, availability/capability policy and the safety fallback on unknown evidence.
- [ ] R3. Use existing promotion tooling to distinguish static projections, replay equivalence and measured real outcomes; retain ADR-107 eligibility requirements.
- [ ] R4. Promote a candidate only on qualifying evidence or retire it with a named outcome; insufficient evidence must not enable a route or count as a delivered speed improvement.

### Acceptance Criteria

- [ ] AC1 — The candidate or insufficiency decision cites 0912's actual cohort and predeclared metric/threshold/deadline, with 0913 evidence distinctions preserved. (req: R1)
- [ ] AC2 — Safety-floor and unknown-evidence regression cases pass on every reachable route. (req: R2)
- [ ] AC3 — Evaluation labels projections and replay separately from real candidate measurements and enforces the existing activation floor. (req: R3)
- [ ] AC4 — By the deadline the candidate is promoted with evidence or retired; an insufficient sample leaves the safety default and no fabricated speed claim. (req: R4)
- [ ] AC5 — Task optimization earns promotion (req: R1)

Feature-level traceability: this task delivers D63 scenario R4; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The exact graph edit is intentionally selected by 0912, not pre-invented here. Candidates may remove redundant preparation/check work or bound contract repair; do not remove independent review/verification. Reuse config/proportional-route-table.ts and the existing promotion registry. If affected-only checks are selected, require conservative dependency closure and a full fallback for unknown/global changes; task-local naming alone is not evidence that a check is narrow. Analytical savings based on recorded durations must not be labeled realized candidate performance.

### Plan

- [ ] 1. Recheck the completed 0912/0913 evidence, current source and ADR-107 eligibility; refine this task before starting implementation.
- [ ] 2. Register the single candidate using the existing mechanism with deadline and predeclared success/non-regression thresholds.
- [ ] 3. Implement and test routing equivalence plus missing/stale evidence cases, then observe qualifying authorized real runs.
- [ ] 4. Record promotion or retirement; update affected command/skill guidance and the measured rollout procedure for later slices.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:57:59.825Z todo → blocked (system)

