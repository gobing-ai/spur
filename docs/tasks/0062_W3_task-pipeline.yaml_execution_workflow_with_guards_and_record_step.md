---
name: "W3: task-pipeline.yaml — execution workflow with guards and record step"
description: "W3: task-pipeline.yaml — execution workflow with guards and record step"
status: Backlog
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-13T01:08:18.984Z
folder: docs/tasks
type: task
feature-id: F5
priority: P0
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0062. "W3: task-pipeline.yaml — execution workflow with guards and record step"

### Background

Design §6, D01/D05/D06. Orchestration is configuration: existing engine, no new machinery. Pipeline writes only via spur task update.


### Requirements

R1. precheck(task check guard) → implement → test → review → approve(HITL) → verify → record → done/failed, vars: wbs.
R2. record step writes ## Testing/## Review via spur task update --section.
R3. Status transitions requested through the normal verb (lifecycle guards apply).
R4. Run linkage in task_run_links; profile var can skip approve.


### Q&A



### Design

Authority: design §6 (pipeline shape: precheck → implement → test → review → approve(HITL) → verify →
record → done/failed; vars: wbs; profiles via `--var`, never a YAML fork), invariants: the pipeline never
touches files directly (record writes via `spur task update --section`; status transitions via the
normal verb so lifecycle guards apply identically), run linkage in `task_run_links` (kind=pipeline).
Precedent for step kinds: `config/workflows/feature-dev.yaml` (agent.run, rule.check, shell guards).
ADR-022/§3.2 principle: orchestration is configuration — this task ships YAML + zero engine code.


### Solution

1. `config/workflows/task-pipeline.yaml`: states per design §6; precheck guard = shell guard
   `spur task check <wbs>`; implement/test/review/verify = `agent.run` steps carrying `sp:dev-*` command
   inputs; record = shell steps generating section files and calling `spur task update --section`.
2. `approve` state pauses (E3 semantics) unless the profile var skips it.
3. Validation: `spur workflow validate` clean; e2e dry test with a stub agent spec exercising the full
   happy path + precheck-fail path on a temp project.
4. task_run_links row written at run start (hook in WorkflowService or a first shell step). Same commit:
   `04 §7.5`. Gate: `bun run check`.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


