---
template: feature-impl
schema_version: 1
name: "workflow engine: file.read.into-var setVars never reach downstream steps or ${vars.X} templates"
description: ""
status: todo
type: task
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T17:40:22.860Z"
updated_at: "2026-08-16T17:41:01.719Z"
---

## 0571. workflow engine: file.read.into-var setVars never reach downstream steps or ${vars.X} templates

### Background
Confirmed 2026-08-15 by a minimal probe workflow and a live pipeline failure: `file.read.into-var` reports `done ✓` but the var it sets is **empty everywhere downstream** — not as a shell env var in the same state, not as `$var` in the next state, and not via `${vars.X}` template substitution. The action implementation itself is correct (`packages/app/src/workflow/actions/file-read-into-var.ts:64` trims by default and returns `setVars: { [varName]: projected }`); the engine-side propagation of `ActionResult.setVars` is what is broken (owner: `@gobing-ai/ts-dual-workflow-engine` in ts-libs, with the Spur-side adapter as the integration suspect).

First observed as idea-pipeline run 25da545c dying at `feature-create`: `$spurBin feature update "$featureId" --section Goal …` exited 1 because `$featureId` interpolated empty even though the read step had succeeded (feature L existed and the same command worked by hand). Blast radius in `config/workflows/idea-pipeline.yaml`: ~20 `$featureId` consumers, including the Goal/Scope/AC shell writes (lines ~158/164/202), `feature refresh` (~408), the handoff message, and every `feature check "$featureId"` transition guard (lines 545–644) — those guards have been evaluating against an empty string, which means auto-profile routing through ac-generate/feature-check/design-approval has been silently wrong since the action was introduced.

Reproduction (20 lines): a workflow with `initialState:` + `states: [{id, onEnter: [...]}]` — state s1 reads a file containing `L\n` into var `myId` via `file.read.into-var`, then a shell step `echo "same-state=[$myId]"`; state s2 echoes `tpl=[${vars.myId}]`. All three print empty. Note the engine rejects `initial:`/`actions:` — schema wants `initialState:`/`onEnter:`.

The same engine gap likely explains part of D3's "shell interpolation" theme. Fix belongs in the engine's action-result handling, not in YAML workarounds; until it lands, idea-pipeline remains un-runnable end-to-end and its stages must be driven inline via the `spur feature` / `spur task` CLI.
### Requirements
- [ ] R1. Root-cause why `ActionResult.setVars` from `file.read.into-var` never reaches same-state shell env, next-state shell env, or `${vars.X}` template substitution — read the engine's action-result merge path in `@gobing-ai/ts-dual-workflow-engine` and the Spur adapter in `packages/app/src/workflow/`, name the exact drop point.
- [ ] R2. Fix the propagation at the engine layer (no YAML-side workaround) so a var set by any action is visible to later actions in the same state, to subsequent states, and to template substitution, per the action's documented contract.
- [ ] R3. Regression test: an engine-level test running the probe shape (file.read.into-var in s1 → shell echo in s1 and s2, and `${vars.X}` in a guard/note) asserting the value is visible in all three positions; plus a workflow-level fixture proving the idea-pipeline `featureId` capture reaches the Goal/Scope shell writes.
### Acceptance Criteria
```gherkin
Scenario: R1 — A var set by file.read.into-var is visible to a shell step in the same state
  Given a workflow whose state s1 reads a file containing "L" into var myId
  When s1's next action is a shell step referencing $myId
  Then the shell environment carries myId=L

Scenario: R2 — The var is visible in the next state and in templates
  Given the same workflow transitions s1 to s2
  When s2 runs a shell step with $myId and a note with ${vars.myId}
  Then both resolve to L

Scenario: R3 — idea-pipeline feature-create completes end to end
  Given the fix is landed and released through ts-libs
  When the idea-pipeline runs with a valid idea
  Then the feature-create state's Goal/Scope shell writes interpolate the captured featureId
  And the feature check transition guards evaluate against the real id
```
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

D3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
