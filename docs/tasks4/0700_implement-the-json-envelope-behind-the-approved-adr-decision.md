---
schema_version: 1
name: "Implement the JSON envelope behind the approved ADR decision"
status: blocked
template: feature-impl
created_at: 2026-08-27T19:45:35.625Z
updated_at: "2026-08-27T19:48:39.332Z"
feature_id: F95
priority: P2
dependencies: ["0698"]
---

## 0700. Implement the JSON envelope behind the approved ADR decision

### Background

F95's implementation task. **Gated:** do not start until the envelope ADR (0698) is approved — a
public CLI surface change across every noun requires explicit operator consent per the ADR-051
amendment. Blocked by design until that decision lands.

### Requirements

- [ ] R1. **Implement the approved envelope across nouns** per the ADR decision and its
      compat/deprecation story.
- [ ] R2. **GATE — do not start before ADR approval.** The ADR-051 amendment's operator consent
      is the precondition; this requirement exists so the gate survives decomposition.

### Acceptance Criteria

- [ ] AC1. Given the approved ADR, when the envelope ships, then every noun emits
      `{ok, data, error}` per the decision and consumers follow the migration story.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

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

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-27T19:48:39.332Z todo → blocked (system)
