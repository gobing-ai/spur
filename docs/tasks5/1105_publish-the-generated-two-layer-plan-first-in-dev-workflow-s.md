---
schema_version: 1
name: Publish the generated two-layer plan first in dev workflow skills and commands
status: backlog
template: feature-impl
created_at: 2026-10-07T06:14:17.623Z
updated_at: "2026-10-07T06:14:50.812Z"
feature_id: I13

dependencies: ["1104"]
---

## 1105. Publish the generated two-layer plan first in dev workflow skills and commands

### Background

Graduated from map I13. The 1101 audit (`docs/analysis/2026-10-native-todo-adoption-audit.md:89-101`) found that the list is
hand-written, published late and collides with setup rows. Task 1104 supplies the generated plan; this task makes every
workflow-backed `/sp:dev-*` run publish it verbatim as its first action and keep it truthful.

### Requirements

- [ ] R1. `plugins/sp/skills/spur-dev/references/cross-cutting.md` and `inline-pipeline-driver.md`: publish the `workflow show --format todo` plan verbatim as the first action; drop the separate bootstrap A–D rows; insert on-entry steps as the next digit; re-entry reuses the label with `attempt N`; render skipped/failed as `pending` + `[outcome]` text.
- [ ] R2. Document the per-host update style (per-item `TaskCreate`/`TaskUpdate`, pi `todo` vs full-list `update_plan`/`write_todos`/`todowrite`/`todo_write`) and that per-item hosts append inserted steps at the end (labels carry identity).
- [ ] R3. `execution-batch.md`: letters-first batch plan (A prepare, B..Y tasks, Z report, waves > 24); add a task's phase digits when it starts.
- [ ] R4. `plugins/sp/commands/dev-{run,runall,parallel,idea,plan}.md` first instruction publishes the plan; `plugins/sp/agents/super-planner.md` states the parent host owns the visible list.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
