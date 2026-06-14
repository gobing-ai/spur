---
name: "W3: spur workflow continue — HITL resume"
description: "W3: spur workflow continue — HITL resume"
status: Backlog
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-13T01:08:18.984Z
folder: docs/tasks
type: task
feature-id: F5
priority: P0
tags: ["rd3-migration","wave-3","upstream-gated"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0063. "W3: spur workflow continue — HITL resume"

### Background

Design §6 + delivery doc §1.4, D04. Gated by ts-libs E3 (pause/resume).


### Requirements

R1. continue [run-id] [--yes]: omitted run-id discovers latest paused run and confirms; --yes auto-accepts.
R2. Works for lifecycle and pipeline runs.
R3. Same-commit 04 sync.


### Q&A



### Design

Authority: delivery doc §1.4 (`spur workflow continue [run-id] [--yes]`: omitted run-id discovers the
most recent paused run and confirms; `--yes` accepts without prompting), design §6 (the HITL gate),
upstream gate ts-libs 0035 (E3: pause/resume + paused-run query, most-recent-first). Works for both
lifecycle and pipeline runs.


### Solution

1. WorkflowService: `continuePaused(runId?, yes?)` — explicit id resumes directly; omitted id queries
   paused runs (E3 query API), takes the latest, prompts unless `--yes`.
2. `apps/cli` workflow command: add the verb following the existing workflow noun pattern; `--json`
   envelope with resumed run state.
3. Tests: explicit-id resume; latest-discovery ordering; `--yes` skip; resuming a non-paused run is a
   clear error (exit 1, message per error rules).
4. Gate: integration against released engine with E3; same commit `04 §1.1` workflow rows + `§7.5`.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


