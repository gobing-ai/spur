---
name: "W1: Task lifecycle engine integration with file-wins rehydration"
description: "W1: Task lifecycle engine integration with file-wins rehydration"
status: Backlog
created_at: 2026-06-13T01:08:18.983Z
updated_at: 2026-06-13T01:08:18.983Z
folder: docs/tasks
type: task
feature-id: F4
priority: P0
tags: ["rd3-migration","wave-1","upstream-gated"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0055. "W1: Task lifecycle engine integration with file-wins rehydration"

### Background

Design §5.2, DD-04, ADR-022. Gated by ts-libs E1 (durable named runs) + E2 (external transition API).


### Requirements

R1. Lifecycle run binding task:<wbs>, create-or-attach.
R2. update <wbs> <status> → engine requestTransition; denied = aborted write with guard report.
R3. File-wins rehydration on missing/disagreeing run state (DD-04), self-healing tested.
R4. task_run_links rows for lifecycle runs.


### Q&A



### Design

Authority: design §5.2 (run binding `task:<wbs>`; create-or-attach; transition via engine
`requestTransition`; denial aborts the whole write with the guard report), DD-04 (**file wins**: missing
or disagreeing engine state ⇒ re-seed from frontmatter + corrective event — self-healing), ADR-022 (no
local FSM fallback). **Upstream gate:** ts-libs tasks 0033 (E1 durable named runs) and 0034 (E2 external
transition API) must be released; consume by semver (temporary `bun link` only while validating).


### Solution

1. `packages/app/src/workflow/lifecycle-adapter.ts` (or alongside existing workflow wiring): implements
   the 0049 `LifecyclePort` over the engine — createOrAttach(`task:<wbs>`, task-lifecycle definition),
   requestTransition, re-seed path emitting the corrective event; replaces the schema-only stub.
2. `task_run_links` rows written for lifecycle runs (kind=lifecycle) on attach.
3. Tests: engine test doubles for the port contract now; integration tests against the released engine
   version once 0033/0034 ship (gate this task's Done on the real integration, not the doubles).
4. Rehydration test: corrupt/clear engine state, next transition re-seeds from file and succeeds (DD-04).
   Gate: `bun run check`; ≥90%.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


