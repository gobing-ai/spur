---
template: brainstorm
schema_version: 1
name: "Define /sp:dev-next v1 routing table (status × signals → command)"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:dev-next"]
dependencies: []
created_at: "2026-07-17T00:54:24.636Z"
updated_at: "2026-07-17T00:56:07.476Z"
---

## 0270. Define /sp:dev-next v1 routing table (status × signals → command)

### Background
**Type:** `wayfinder:grilling` · **Feature:** [N](../features/N_sp-plugin-next-layer-ux-dev-next-router-and-dogfood-hardening.md)

**Question (answer when claimed):** What is the deterministic v1 routing table for `/sp:dev-next` — mapping (task/feature corpus status + optional light-gate signals) → exactly one recommended `/sp:dev-*` or `spur` verb, including multi-candidate **stop** cases?

**Product contract (locked):**

| Decision | Locked value |
| --- | --- |
| Product shape | Status-router + **dispatcher** over existing commands (no second pipeline FSM) |
| Auto-advance | Chain on clean success along existing `--next`/lifecycle edges; stop on HITL, guard fail, multi-candidate fork |
| Signals | Corpus status **first** (`spur task\|feature show\|list --json`); light gates only when needed |
| Identity | Task WBS primary; optional feature ID → next frontier task then route |
| Flags expected | `--dry-run` (print only), `--once` (no chain) |

**Why:** Operators must know which of ~27 commands to run. Partial automation exists (`--next` on refine/run/verify; full `dev-run` pipeline). Missing: a single status-aware entry that also covers hygiene (unit gaps, rule check, fixall) without reimplementing the spine.

**Prior art to read:**
- `plugins/sp/README.md` — command index + main flow
- `plugins/sp/commands/dev-run.md` — `--next` chain semantics
- `plugins/sp/commands/dev-refine.md` — backlog→todo + chain
- `plugins/sp/skills/spur-dev/references/dev-operations.md` — per-command contracts
- `plugins/sp/skills/spur-dev/references/execution-workflow.md` — status selection
- Task `0119` — original `--next` auto-chain
- Feature `I` (done) — hands-off ready baseline

**Out of this ticket:** Skill ownership (→ 0271), CLI flag details (→ 0272), implementation code.
### Requirements
- [ ] R1. Table covers **planning half** statuses (at least): feature without AC / AC fail / no tasks; task `backlog` (needs refine); task `todo` ready to run.
- [ ] R2. Table covers **execution half** statuses (at least): `wip` (resume implement or continue), `testing` (verify), review-pending / guard failure recovery pointer, `done` (wrap candidate).
- [ ] R3. Table covers **hygiene / light-gate** routes when corpus status alone is insufficient: empty/insufficient tests → `dev-unit`; lint/type red → `dev-fixall`; rule findings → `spur rule run` or `rule-scan`/`rule-add` as appropriate; task check L3 failures → surface fix then re-route.
- [ ] R4. Every row names: **precondition**, **primary signal source** (CLI verb + field), **command to dispatch**, **success → chain?** (yes/no + target), **stop reason** if not unique.
- [ ] R5. Multi-candidate forks are explicit **HITL stop** rows (decision-brief), never silent priority hacks without documenting the priority order.
- [ ] R6. Feature-ID path: algorithm to pick next frontier task (unblocked `todo`/`backlog`, deps done) is written; if none → feature-level next (e.g. wrapall / feature advance / plan) or stop with reason.
- [ ] R7. Explicit non-routes: never dispatch into `task-pipeline.yaml` reimplementation; never bypass lifecycle guards.
- [ ] R8. Deliverable written into this task's `### Solution` as a markdown table + short narrative; map feature N `## Decisions so far` gets a one-line gist when this ticket is marked done.
### Acceptance Criteria
```gherkin
@core
Scenario: Routing table is complete enough to implement the router
  Given task 0270 Solution contains a routing table
  When a designer implements /sp:dev-next against that table alone
  Then every common status an operator hits in the daily flow has a row
  And every multi-candidate case is a documented stop or ordered priority

@core
Scenario: No second FSM
  Given the Solution
  When reading recommended dispatches
  Then each dispatch targets an existing /sp:dev-* or spur verb
  And none invent a new multi-step engine inside dev-next
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan
1. Load command index + lifecycle status model from spur-dev references.
2. Draft rows for pure status transitions (no light gates).
3. Add light-gate rows with short-circuit order recommendation.
4. Add feature-ID frontier selection algorithm.
5. Stress-test table against 3 fictional scenarios (new feature, mid-implement, post-done wrap).
6. Write Solution; update feature N Decisions so far; mark done.
### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Feature N map: `docs/features/N_sp-plugin-next-layer-ux-dev-next-router-and-dogfood-hardening.md`
- Depends on: (none — frontier)
- Blocks: 0272 (CLI surface needs table)
- Related: 0271 (ownership can proceed in parallel)
### History
