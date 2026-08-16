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
updated_at: "2026-08-16T19:05:08.014Z"
---

## 0571. workflow engine: file.read.into-var setVars never reach downstream steps or ${vars.X} templates

### Background
Root cause CONFIRMED at source level 2026-08-16 (supersedes the symptom-level background): the state-machine dialect drops `ActionResult.setVars` at TWO points in `runActionSequence` (`~/xprojects/ts-libs/packages/dual-workflow-engine/src/action-step.ts:121`):

- **Drop 1 (intra-state):** every action in an onEnter sequence receives the SAME `vars` snapshot; a setVars from action N is invisible to action N+1 (the file's own comment documents the snapshot as caller-owned — "setVars does not affect later actions within the same sequence").
- **Drop 2 (inter-state, silent):** the sequence returns only the LAST action's result, and the driver merges only `enter.result?.setVars` (`state-machine.ts:112`, exit twin at :173). A non-final action's setVars are silently discarded — no warning, no documentation.

The transition-flow dialect is unaffected (one action per node + immediate per-step merge, `transition-flow.ts:110`) — which is why the engine's own tests (state-machine.test.ts:449) pass: their setter is the ONLY action in its state, so its result is always the last. HITL answers work in production for the same reason (hitl.confirm is alone/last in its state). The failure only bites multi-action states that set a var mid-sequence — exactly idea-pipeline's feature-create (agent.run → file.read.into-var → shell × 2), which is why `$featureId` interpolated empty at feature-create and ~20 downstream `$featureId` guards in `config/workflows/idea-pipeline.yaml` evaluate against an empty string.

Version facts: spur-new resolves engine **0.4.32** (catalog); ts-libs source is at 0.4.34 with the bug present in both — the 0.4.33/0.4.34 bumps were release chores, no functional change to this path. The fix therefore lands in ts-libs as 0.4.35, then spur-new updates the catalog (the repo protocol: released semver + `bun update`, never `bun link` for this).

Also verified during root-cause: Spur's `StreamingShellActionRunner` (packages/app/src/workflow/actions/shell.ts:52) exports `context.vars` into the child env — correct; the drop is upstream of it. `FileReadIntoVarActionRunner` returns setVars correctly (packages/app/src/workflow/actions/file-read-into-var.ts:69).
### Requirements
- [ ] R1. Engine fix in `~/xprojects/ts-libs` (dual-workflow-engine): `runActionSequence` accumulates setVars from EVERY action result and threads them forward — action N+1's template resolution and `context.vars` include all prior same-sequence setVars — and the sequence result carries the accumulated map (`ActionStepResult.setVars`); `state-machine.ts` merges the accumulated map (both the onEnter merge at :112 and the onExit merge at :173). Update the stale "same snapshot" comment to the new contract. Behavior change is deliberate: the YAML reads imperatively, and the snapshot isolation was the trap.
- [ ] R2. Engine regression tests (state-machine.test.ts): (a) non-final action's setVars reach the NEXT state's template resolution AND `context.vars`; (b) a mid-sequence setVars is visible to a later action IN THE SAME state; (c) accumulated map survives a continued-failure action (the transition-flow.test.ts:375 precedent); (d) pause/resume still restores merged vars (pause-resume-vars.test.ts must stay green). Then release 0.4.35 and `bun update` the catalog in spur-new.
- [ ] R3. Spur-side proof: with 0.4.35 installed, the probe workflow (file.read.into-var in s1 followed by a shell echo in s1 and a `${vars.X}` template in s2) resolves the value in all three positions, and the idea-pipeline `feature-create` state's `$featureId` consumers interpolate the captured id — run idea-pipeline end-to-end on a throwaway idea to prove the guard chain evaluates the real id.
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
**Closed during --depth ready refinement (2026-08-16).** Root cause is confirmed at source level, not inferred: two distinct drops in runActionSequence (intra-state stale snapshot; inter-state last-result-only merge). Transition-flow is correct by construction — its test suite passing never covered the multi-action state case, which is why the bug survived. Engine version math: spur-new pins 0.4.32 via catalog, ts-libs source at 0.4.34, bug in both — fix releases as 0.4.35, then `bun update` here (never `bun link`). Contract change accepted: intra-sequence visibility changes from never to always — no legitimate consumer exists (every working usage has its setter alone/last in its state).

**Why no YAML workaround was kept on the table:** splitting idea-pipeline's feature-create into more states would route around Drop 2 but leaves Drop 1 armed for the next author; the engine fix is the smaller total diff.
### Design
**WHAT.** A ~20-line engine change plus its test matrix, then the Spur-side version bump. No Spur production code changes.

**WHY this shape.** The transition-flow dialect already proves the correct semantics (per-step immediate merge); the state-machine dialect's `runActionSequence` is the only broken path. Fixing the shared sequence runner fixes both dialects' call patterns without touching control loops (ADR-006 §7 keeps loops dialect-specific; the per-action mechanism is shared — this edit stays inside that seam).

**Frozen edit points (ts-libs, `packages/dual-workflow-engine`).**

1. `src/action-step.ts` — `ActionStepResult` gains `readonly setVars?: Vars`. In `runActionSequence`: maintain `acc`; after each step, `acc = mergeSetVars(acc, step.result.setVars)` and `vars = mergeSetVars(vars, step.result.setVars)` BEFORE the next iteration; return `setVars: acc` on every exit branch (completed/terminal/fail — a terminal action's setVars must not be lost either).
2. `src/state-machine.ts` — replace `mergeSetVars(vars, enter.result.setVars)` (:112) and the onExit twin (:173) with merges of the sequence-level accumulated `setVars`; keep the existing merge-after-lifecycle.enter ordering (resume path persists vars at pause with the merge already applied).
3. `src/action-step.ts` header comment ("same vars snapshot … caller-owned") — rewrite to the new contract: sequence threads setVars forward; drivers still own cross-state merge.
4. `tests/state-machine.test.ts` — the four cases from R2(a)-(d).
5. `CHANGELOG.md` + version 0.4.35 (minor: behavior contract change).

**Spur side (this repo).** `bun update @gobing-ai/ts-dual-workflow-engine` (catalog) after publish; add the probe workflow as `apps/cli/tests/workflow/setvars-probe.test.ts` (or the nearest existing workflow-test home — check `apps/cli/tests/workflow/` first, reuse its harness) asserting same-state shell env + next-state template visibility; then the idea-pipeline end-to-end proof from R3.

**Anti-patterns — do NOT:**

- Do not fix this in Spur's workflow host or YAML (splitting feature-create into more states) — the drop is engine-level; a YAML restructure leaves the trap armed for every future workflow.
- Do not make the merge opt-in via a workflow flag — the old behavior has no legitimate consumer (HITL and the engine tests only pass because their setters are alone/last).
- Do not change transition-flow.ts — it is already correct (per-step merge at :110).
- Do not `bun link` the engine — released semver + `bun update` per the repo's ts-libs protocol.

**Handoff.** None in-repo after R3; idea-pipeline resumes working without YAML edits. Note for 0572 (B3): none — independent surfaces.
### Plan
- [ ] Implement the engine change (action-step.ts accumulation + ActionStepResult.setVars + state-machine.ts two merge points + comment rewrite) in ~/xprojects/ts-libs (R1)
- [ ] Add the four engine regression tests; run the engine suite green (R2)
- [ ] Release 0.4.35; in spur-new `bun update` the catalog and confirm `node_modules` resolves 0.4.35 (R2)
- [ ] Add the Spur-side probe test (same-state shell env + next-state template + guard visibility) and run `bun test apps/cli` (R3)
- [ ] End-to-end proof: run idea-pipeline on a throwaway idea; feature-create completes with real `$featureId` interpolation; then `bun run lint` + full `bun run test` (R3)
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
