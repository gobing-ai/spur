---
schema_version: 1
name: Publish a real-agent fleet latency baseline by phase
status: todo
template: feature-impl
created_at: 2026-11-15T03:27:14.741Z
updated_at: "2026-11-15T04:02:25.062Z"
feature_id: G8
priority: P3
tags:
  - fleet
  - performance
  - measurement
estimate_hours: 6

ac_altitude: task-local
---

## 1331. Publish a real-agent fleet latency baseline by phase

### Background

Task-local: not a G8 ship criterion and not a prerequisite for tasks 1333 or 1334 (operator decision 2026-11-14: pipeline performance was addressed in 0.4.34–0.4.35 and is low priority).

`docs/reports/fleet-perf-receipt.md` holds stub numbers only (about 1.5 s dispatch overhead); `docs/plans/2026-10-21-fleet-performance-measurement.md` lists the real-agent lane as not run. This task runs it when a later transport or warm-turn decision needs numbers.

### Requirements

- [ ] R1 — Run one bounded, identical workload through Codex, Claude Code and Pi as fleet members using the existing `fleet-e2e --perf` lane with real agents.
- [ ] R2 — Record queue, start, model, tool and gate wall time per agent, with p50 and p95 and the trial count; failed trials are kept, not dropped.
- [ ] R3 — State the share of wall time attributable to dispatch transport (enqueue to agent start).
- [ ] R4 — Record binary provenance, executor settings and the command line so the run can be repeated.

### Acceptance Criteria

- [ ] AC1 — A real-agent baseline reports where fleet wall time goes

Task-local check: the report names the command that reproduces it and the trial count per agent and mode.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Reuse the existing perf lane and KPI contract; add no new harness. If a phase cannot be separated for an agent, report it as unavailable with the reason rather than estimating. Output is a report under `docs/reports/` plus its JSON receipt, replacing the 'unverified' rows of the measurement plan. Rejected: a new benchmark tool (the lane exists); synthetic model latency (that is what the stub receipt already is). Invariant: this task changes no dispatch code.

### Plan

- [ ] Confirm the three agents are installed and authenticated; record versions.
- [ ] Pick the bounded workload from the KPI plan; run cold, resume and warm modes, at least 5 trials each.
- [ ] Write the JSON receipt and the report with the per-phase table and transport share.
- [ ] Update the measurement plan's unverified rows to point at the report.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
