---
schema_version: 1
name: Fleet phase timing receipt and cold/resume baseline driver
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.908Z
updated_at: "2026-10-22T07:00:34.993Z"
feature_id: G74
priority: P1
tags:
  - fleet
  - performance

---

## 1273. Fleet phase timing receipt and cold/resume baseline driver

### Background

Implements: R1 — A reproducible phase receipt compares all three first-batch agents.
Work package E0 (+ driver half of E7) in docs/plans/2026-10-21-fleet-task-execution-brainstorm.md §4; KPI contract docs/plans/2026-10-21-fleet-performance-measurement.md §2-3.
No dependency; first in the chain. Warm modes are recorded as unsupported until the adapter tasks land.
Rubric: E8 D1 L2 C1 R1 = 13 → own task (independent stream, measurement prerequisite).

### Requirements

- [ ] R1. Record the KPI phase timestamps (enqueue, claim, preflight, process ready, accepted, first output, terminal, contract validation, gates, receipt) with correlation ids; unobservable phases are absent, never zero.
- [ ] R2. Extend scripts/commands/fleet-e2e.ts with a paired-trial mode that pins binary path/version, model/provider/reasoning, revision and workload digest for Codex, Claude Code and Pi in cold and resume modes.
- [ ] R3. Emit a JSON receipt plus a short Markdown comparison with p50/p95 validated completion, useful throughput, completion rate, token/resource observations and a repeat command; failed, cancelled and timed-out trials stay in denominators.
- [ ] R4. Label provisional targets separately from measured values; deterministic fixture lane proves attribution, real-agent lane is opt-in.

### Acceptance Criteria

- [ ] AC1 — A reproducible phase receipt compares all three first-batch agents

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: reuse the existing fleet E2E driver, trace ids and run-log redaction; add phase marks at the existing traced boundaries (agent-run action, runFleetWorkItem, strategy tick) rather than a new telemetry service.
Rejected: separate metrics product; wall-clock deltas across processes (use monotonic within a process, UTC + ids across).
Invariants: no credentials/env dumps in receipts; missing phases explicit; no fabricated gains.

### Plan

1. Write failure cases first (dropped trial, clock-domain mix, missing phase, killed trial).
2. Add phase marks and receipt schema.
3. Paired-trial driver mode + Markdown summary.
4. Deterministic fixture E2E producing a repeatable receipt artifact.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
