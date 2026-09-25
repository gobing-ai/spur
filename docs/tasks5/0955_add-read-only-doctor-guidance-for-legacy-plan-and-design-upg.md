---
schema_version: 1
name: Add read-only doctor guidance for legacy plan and design upgrades
status: todo
template: feature-impl
created_at: 2026-09-25T07:22:28.366Z
updated_at: "2026-09-25T07:22:34.754Z"
feature_id: H14
priority: P2
estimate_hours: 2

dependencies: ["0954"]
---

## 0955. Add read-only doctor guidance for legacy plan and design upgrades

### Background

Existing plan and design documents vary widely. They should remain readable while authors get a repeatable way to identify and propose safe upgrades.

### Requirements

- [ ] R1. Extend spur-doctor with a bounded read-only review of docs/plans and docs/design Markdown files.
- [ ] R2. Proposals preserve historical meaning, filenames, headings and references, and verify changed documents without strict validation.

### Acceptance Criteria

- [ ] AC1 — Doctor proposes safe upgrades for legacy Markdown (req: R1)
- [ ] AC2 — Document contract is reviewed and verified (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Doctor cites file evidence and emits proposal rows; it never writes. Accepted doc edits route to sp:doc-evolve and the constitution. Do not bulk rewrite existing files or add CLI commands.

### Plan

- [ ] Inspect representative legacy files and the doctor contract.
- [ ] Add the upgrade review procedure and proposal evidence shape.
- [ ] Verify read-only wording, links and examples.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
