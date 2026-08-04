---
template: feature-impl
schema_version: 1
name: "spur workflow trace --follow --output log-streaming source"
description: ""
status: todo
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["workflow", "cli", "trace", "log", "follow"]
dependencies: ["0426"]
created_at: "2026-08-04T17:25:04.939Z"
updated_at: "2026-08-04T18:35:54.244Z"
---

## 0428. spur workflow trace --follow --output log-streaming source

### Background

Feature D2 — real-time following of the consolidated run log. Extends `spur workflow trace <run-id> --follow` with a log-streaming source: `--output` tails `.spur/run/<RUNID>.log` (tail -f equivalent) and exits at terminal status. Operator-settled: extend `trace --follow`, no new `monitor` verb. The structured DB timeline remains the default; `--output` is a distinct source, not an interleaving. Updates its own `spur-cli` workflow reference row (ADR-038 parity).

Implements: R8 — spur workflow trace RUNID --follow streams the all-in-one log in real time.

Rubric: E2 D1 L2 C1 R0 = 6 → decompose (child of parent score 14).

### Requirements
- [ ] R1. `spur workflow trace <run-id> --follow --output` streams `.spur/run/<RUNID>.log` and exits at terminal status.
- [ ] R2. `--output` requires `--follow` and is rejected with `--json` (a human stream).
- [ ] R3. The structured DB timeline remains the default follow source; `--output` is a distinct source and does not interleave with it.
- [ ] R4. No new `spur workflow monitor` verb is added.
- [ ] R5. Update the `spur-cli` workflow reference trace signature (ADR-038 parity test must pass).
### Acceptance Criteria
```gherkin
Feature: spur workflow trace --follow --output log-streaming source

  @core
  Scenario: R8 — spur workflow trace RUNID --follow streams the all-in-one log in real time
    Given an active workflow run with a written RUNID.log and the persisted run state
    When the operator runs spur workflow trace RUNID --follow
    Then the follower streams new log lines from RUNID.log as the run progresses
    And no new spur workflow monitor verb exists
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

D2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
