---
name: "W2: Feature lifecycle engine integration including verifying"
description: "W2: Feature lifecycle engine integration including verifying"
status: Backlog
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-13T01:08:18.984Z
folder: docs/tasks
type: task
feature-id: F4
priority: P1
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0059. "W2: Feature lifecycle engine integration including verifying"

### Background

Design §2.3/§5, DD-13. Same mechanism as tasks; feature:<id> run binding.


### Requirements

R1. feature-lifecycle run binding + requestTransition path.
R2. verifying guards: enter warns unless linked tasks done/cancelled; verifying→done = feature check --strict (+ optional HITL); rework path.
R3. feature.transitioned events + History append.


### Q&A



### Design

Authority: design §2.3 feature graph + DD-13 guard placement (active→verifying warns unless linked tasks
done/cancelled; verifying→done requires `feature check --strict` + optional HITL; verifying→active =
rework with mandatory History entry), §5.2 binding `feature:<id>`, DD-04 file-wins. Same upstream gate as
0055 (ts-libs E1/E2).


### Solution

1. Extend the 0055 lifecycle adapter for features: createOrAttach(`feature:<id>`,
   feature-lifecycle definition); linked-task completeness computed from the task corpus (feature_id
   edges) and surfaced to the entry guard.
2. `feature.transitioned` events + History append ride the existing write-service steps — no new
   emission code, only the feature lifecycle wiring.
3. Tests: verifying entry warning vs clean entry; strict-gate on done; rework path History entry;
   file-wins re-seed for features.
4. Gate: `bun run check`; ≥90%; integration against released engine version (shared gate with 0055).


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


