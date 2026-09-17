---
schema_version: 1
name: Refuse retiring workflow definitions that still have real non-dry runs
status: todo
template: feature-impl
created_at: 2026-09-17T17:41:14.081Z
updated_at: "2026-09-17T17:50:02.295Z"
feature_id: D62

---

## 0882. Refuse retiring workflow definitions that still have real non-dry runs

### Background

Captured from the creation title: "Refuse retiring workflow definitions that still have real non-dry runs".

### Requirements

- A check refuses retiring a workflow definition that still has real (non-dry) terminal runs absent a recorded decision, reading `runs × metadata_json.dryRun` — the column 0866's verdict table used (0866 review finding 6).

### Acceptance Criteria

- Refusal test with mixed dry/non-dry history; clean retirements pass.
- `bun run spur-check` green.

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

- 2026-09-17T17:50:02.295Z backlog → todo (system)

