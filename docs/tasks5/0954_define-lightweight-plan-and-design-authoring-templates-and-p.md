---
schema_version: 1
name: Define lightweight plan and design authoring templates and project guidance
status: todo
template: feature-impl
created_at: 2026-09-25T07:22:28.363Z
updated_at: "2026-09-25T07:22:28.368Z"
feature_id: H14
priority: P2
estimate_hours: 3

---

## 0954. Define lightweight plan and design authoring templates and project guidance

### Background

Plans and Designs now display loose Markdown records. The constitution distinguishes working plans from governed design satellites; authors need a small reusable contract without forcing legacy migration.

### Requirements

- [ ] R1. Add distinct plan and design Markdown templates with small frontmatter and useful section prompts.
- [ ] R2. Align project and init-template ownership guidance with the new authoring reference and route sp:spur-dev generation to it.

### Acceptance Criteria

- [ ] AC1 — New plans and designs use distinct Markdown templates (req: R1)
- [ ] AC2 — Project guidance and spur-dev point to one document contract (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Keep shared ownership in 99 and practical composition in one spur-dev reference. Use the two template files as examples, not runtime schemas. Modify only relevant key-file templates; preserve the existing 04 index and legacy document contracts.

### Plan

- [ ] Add plan/design templates and one concise authoring reference.
- [ ] Update spur-dev skill and planning workflow reference to use the templates.
- [ ] Align current constitution and relevant init templates.
- [ ] Run focused link and format checks.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
