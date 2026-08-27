---
schema_version: 1
name: "Survey and inventory current per-noun --json shapes into docs/04_DESIGN.md"
status: cancelled
template: feature-impl
created_at: 2026-08-27T19:45:35.427Z
updated_at: "2026-08-27T20:11:35.182Z"
feature_id: F95
priority: P2
---

## 0699. Survey and inventory current per-noun --json shapes into docs/04_DESIGN.md

### Background

The envelope ADR (0698) needs ground truth: what does each noun's `--json` emit today? The 0688
session found three deviations by accident; a decision made without the full inventory will miss
the rest. Survey-first task for F95.

### Requirements

- [ ] R1. **Survey every noun's `--json` verbs** and record current top-level shapes as a
      per-noun inventory section in `docs/04_DESIGN.md`.
- [ ] R2. **Name each deviation** from the proposed `{ok, data, error}` envelope — the three 0688
      breaks plus anything else the survey finds.

### Acceptance Criteria

- [ ] AC1. The inventory section exists in `docs/04_DESIGN.md`, covers all nouns, and flags every
      deviation from the proposed envelope.

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

- 2026-08-27T20:11:35.182Z todo → cancelled (system)
