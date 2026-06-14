---
name: "W2: Task-to-feature traceability validation (L4)"
description: "W2: Task-to-feature traceability validation (L4)"
status: Backlog
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-13T01:08:18.984Z
folder: docs/tasks
type: task
feature-id: F3
priority: P1
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0060. "W2: Task-to-feature traceability validation (L4)"

### Background

Design §3 L4, DD-09, C04 absorbed into the check verbs.


### Requirements

R1. Task AC ⊆ linked feature AC by normalized scenario title.
R2. Orphan feature scenarios = warnings.
R3. Dangling feature_id/parent_wbs/dependencies warnings.
R4. Surfaced in both task check and feature check.


### Q&A



### Design

Authority: design §3 L4 + §3.3 coverage contract (DD-09: task covers a feature scenario when a
normalized-title match exists; subset rule on the task side; orphan feature scenarios are warnings —
features legitimately precede decomposition), C04 (one validation surface: traceability lives inside
`task check` and `feature check`, no separate verb).


### Solution

1. Consume `checkAcCoverage` (0043) from both check services: task side reports uncovered task scenarios
   (error-level only if the hard core says so — default warning), feature side reports orphans + dangling
   edges; dangling `dependencies`/`parent_wbs` warnings on the task side.
2. Findings carry both sides of the edge (wbs ↔ feature id, scenario titles) for actionable output.
3. Tests: fixture pairs (feature AC + linked tasks) covering full/partial/zero coverage, R-id-prefixed
   titles, checklist-tier ACs.
4. Same commit: `04 §7.2/§7.4` traceability rows. Gate: `bun run check`; ≥90%.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


