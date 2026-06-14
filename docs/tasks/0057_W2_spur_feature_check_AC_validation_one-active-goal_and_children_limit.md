---
name: "W2: spur feature check — AC validation, one-active-goal and children limit"
description: "W2: spur feature check — AC validation, one-active-goal and children limit"
status: Backlog
created_at: 2026-06-13T01:08:18.983Z
updated_at: 2026-06-13T01:08:18.983Z
folder: docs/tasks
type: task
feature-id: F3
priority: P0
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0057. "W2: spur feature check — AC validation, one-active-goal and children limit"

### Background

Design §3, B08/B09, DD-13/DD-14.


### Requirements

R1. Gherkin/checklist AC validation via the shared BDD module.
R2. One active P0 goal across {active, verifying}.
R3. ≤9 children per node enforced (split-the-parent signal).
R4. Traceability: feature_id edges of linked tasks resolve; orphan-scenario warnings.


### Q&A



### Design

Authority: design §3 (layers apply to features), B08 (AC Gherkin/checklist validation via the shared BDD
module — never a private parser), B09 + DD-13 (one active P0 goal counted over {active, verifying}),
DD-14 (≤9 children per node — overflow is a split-the-parent signal, reported as a finding, not
engineered around).


### Solution

1. `packages/app/src/services/feature-check.ts`: mirrors 0051's layered composition; feature-specific
   rules: AC validation (0043 module), one-active-goal, children limit, `feature_id` edge targets exist
   and are not done/cancelled.
2. Findings model and `--strict`/exit-code behavior identical to task check (shared findings types).
3. Tests: goal-rule fixtures (two active P0s; P0 in verifying still owns the goal), 9-children overflow,
   malformed AC, dangling edges; run against the real docs/features corpus as a must-pass fixture.
4. Same commit: `04 §7.2` check row. Gate: `bun run check`; ≥90%.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


