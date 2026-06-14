---
name: "W3: task-write-guard hook and resolve/info decision"
description: "W3: task-write-guard hook and resolve/info decision"
status: Backlog
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-13T01:08:18.985Z
folder: docs/tasks
type: task
feature-id: H2
priority: P1
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0067. "W3: task-write-guard hook and resolve/info decision"

### Background

Design §12.3, F04 + delivery doc §1.3 TBD. Pure delegation; SPUR_WRITE_GUARD=off escape hatch.


### Requirements

R1. PreToolUse hook: path → resolve → owned? → post-edit check; deny with findings on hard failure.
R2. Decide task info/feature info (one-call path→frontmatter) vs resolve+show composition; record decision + sync delivery doc.
R3. Hook contains zero logic beyond delegation.


### Q&A



### Design

Authority: design §12.3 hook contract (PreToolUse: path → `spur task resolve` → if owned →
`spur task check` post-edit state → deny with findings on hard failure; **pure delegation, zero logic**;
`SPUR_WRITE_GUARD=off` escape hatch), F04. This task also settles the delivery doc §1.3 TBD: `spur task
info` / `spur feature info` (one-call path→frontmatter JSON) vs `resolve` + `show --json` composition —
measured by what the hook actually needs (subprocess count, latency).


### Solution

1. `plugins/sp/hooks/task-write-guard.ts`: stdin hook payload → target path → resolve → owned? → check →
   allow/deny with findings text; env toggle; exits fast for non-corpus paths (folder-registry prefix
   check before any subprocess).
2. Decision: prototype both lookup shapes, measure per-edit overhead; if the 2-call path is materially
   slower, add `info` verbs (small TaskService/FeatureService additions) — record the decision +
   rationale here and sync delivery doc §1.3 + `04` in the same commit.
3. Hook registration in plugin hooks config; manual verification transcript with allowed + denied edits.
4. Gate: hook contains no validation logic (review); bypass works; non-corpus edits unaffected.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


