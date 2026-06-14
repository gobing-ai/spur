---
name: "W3: sp:dev-* slash command subset and subagents"
description: "W3: sp:dev-* slash command subset and subagents"
status: Backlog
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-13T01:08:18.985Z
folder: docs/tasks
type: task
feature-id: H1
priority: P1
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0065. "W3: sp:dev-* slash command subset and subagents"

### Background

Design §12.3 + delivery doc §7.3/7.4. dev-* names continue rd3:dev-* muscle memory; final subset = ADR-016 decision test per candidate.


### Requirements

R1. ADR-016 test applied per candidate (dev-plan, dev-run, dev-unit, dev-review, dev-verify, dev-new-task, dev-fixall, dev-gitmsg, dev-docs, dev-changelog, dev-handover, dev-refine); record pass/fail rationale.
R2. Shipped commands are thin wrappers of sp:spur-dev.
R3. expert-dev/expert-tasks/expert-features thin subagent wrappers.


### Q&A



### Design

Authority: design §12.3 + delivery doc §7.3 (candidates: dev-plan, dev-run, dev-unit, dev-review,
dev-verify, dev-new-task, dev-fixall, dev-gitmsg, dev-docs, dev-changelog, dev-handover, dev-refine —
names continue rd3:dev-* for muscle memory) and §7.4 (expert-dev/tasks/features). ADR-016 decision test
applied **per candidate**: a command exists only where the LLM converts non-deterministic intent into a
reliable sequence; expect few, not 42. ADR-023(2): commands and subagents are thin wrappers of skills.


### Solution

1. Verdict table first: run each candidate through the ADR-016 test; record pass/fail + one-line
   rationale in this task's `## Review` (the auditable filter output).
2. For passing candidates: `plugins/sp/commands/dev-<verb>.md` — argument parsing + `sp:spur-dev` (or
   companion) invocation only; mirror the existing rule-add/workflow-add command style.
3. `plugins/sp/agents/expert-dev.md`, `expert-tasks.md`, `expert-features.md` mirroring the
   expert-rules/expert-workflows pattern: description, trigger examples, skill delegation.
4. Same commit: delivery doc §7.3 updated with the final subset (replacing 'candidates'). Gate: each
   shipped command demonstrably wraps the skill with zero embedded pipeline logic (review).


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


