---
template: feature-impl
schema_version: 1
name: "spur task refresh: auto-generate parent sub-task roster block"
description: ""
status: todo
type: task
profile: standard
feature_id: H2
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-25T21:35:05.729Z"
updated_at: 2026-06-25T21:35:31.527Z
---

## 0123. spur task refresh: auto-generate parent sub-task roster block

### Background
Follow-on from task 0121 (R5, deferred by scope guard). 0121 delivered the parent↔child roll-up **gate** in `spur task check` — a check that *warns* when a decomposition parent's `## Plan` has no sub-task roster table. This task delivers the **generator** half: a command-driven roster *refresh* for parents, mirroring `spur feature refresh`'s auto-generated `## Tasks` block, so the roster's status column stays current without hand-editing.

Scope: regenerate the parent's `## Plan` sub-task roster table (one row per child task: WBS, title, status) on demand, idempotently. The gate (0121) reads a missing/stale roster; this closes the loop by maintaining it. Reference the existing `feature refresh` auto-block generator (`packages/app/src/services/task-service.ts` byParent index, ~line 710) as the model.
### Acceptance Criteria

```gherkin
Feature: spur task refresh: auto-generate parent sub-task roster block

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Design

### Plan

- [ ] Implementation step

### Solution

### Testing

### Review

### References

### History
