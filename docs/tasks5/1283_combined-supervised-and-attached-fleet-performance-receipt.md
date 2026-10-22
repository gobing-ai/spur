---
schema_version: 1
name: Combined supervised and attached fleet performance receipt
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.146Z
updated_at: "2026-10-22T07:02:21.769Z"
feature_id: G75
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1282"]
---

## 1283. Combined supervised and attached fleet performance receipt

### Background

Implements: R6 — A combined fleet receipt distinguishes participation gains from convenience.
Work package B6. Extends the G74 phase receipt driver. Depends on attached stage execution and the G74 adapters. If attached-ready adds no material gain over supervised-warm, report it as convenience only.
Rubric: E5 D1 L1 C1 R1 = 9 → own task.

### Requirements

- [ ] R1. Run identical first-batch workloads on attached-ready, supervised-cold and supervised-warm workers including busy waits, attach overhead and failures.
- [ ] R2. Report p50/p95 completion, useful throughput and completion rate with quality and cost guardrails.
- [ ] R3. Record Grok Build and Antigravity CLI as second-batch probes; unsupported attachments are never counted as gains.

### Acceptance Criteria

- [ ] AC1 — A combined fleet receipt distinguishes participation gains from convenience

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: add attached modes to the G74 receipt driver; same schema.
Rejected: separate benchmark harness.
Invariants: failure denominators kept; no fabricated gains.

### Plan

1. Attached modes in the driver.
2. Combined fixture receipt.
3. Opt-in real-agent comparison + Markdown summary.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
