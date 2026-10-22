---
schema_version: 1
name: Claude Code warm task-turn adapter
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.913Z
updated_at: "2026-10-22T07:02:11.467Z"
feature_id: G74
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1275"]
---

## 1276. Claude Code warm task-turn adapter

### Background

Implements: R3 — Claude Code completes keyed tasks in a warm process.
Work package E3. Runs after the correlated task-turn seam. Candidate transport: current stream-json CLI input/output framing (docs/design/fleet-task-turn-execution.md §5).
Rubric: E6 D1 L2 C1 R1 = 11 → own task (distinct protocol, independent review).

### Requirements

- [ ] R1. Qualify the installed Claude Code binary/version for stream-json persistent input; record provenance.
- [ ] R2. Two related keyed tasks execute serially in one process with correlated terminal results and validated artifacts.
- [ ] R3. Distinguish final result success/error from partial output and process exit; acceptance alone never records success.
- [ ] R4. Independent review uses a fresh conversation; unqualified versions keep resume/one-shot fallback.

### Acceptance Criteria

- [ ] AC1 — Claude Code completes keyed tasks in a warm process

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: adapter selection in the turn seam keyed by executor kind; parse result records from the existing shim framing.
Rejected: new SDK dependency; disabling hooks/skills for faster startup.
Invariants: per-version qualification; fresh reviewer context.

### Plan

1. Version qualification spike.
2. Adapter + terminal mapping.
3. Process fixture E2E (two serial turns, crash mid-turn, error result).
4. Opt-in real-agent trial row in the phase receipt.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
