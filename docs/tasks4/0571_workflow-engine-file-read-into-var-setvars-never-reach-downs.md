---
template: feature-impl
schema_version: 1
name: "workflow engine: file.read.into-var setVars never reach downstream steps or ${vars.X} templates"
description: ""
status: done
type: task
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T17:40:22.860Z"
updated_at: "2026-08-16T21:02:06.902Z"
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
[x] R1. Engine fix in `~/xprojects/ts-libs` (dual-workflow-engine): `runActionSequence` accumulates setVars from EVERY action result and threads them forward — action N+1's template resolution and `context.vars` include all prior same-sequence setVars — and the sequence result carries the accumulated map (`ActionStepResult.setVars`); `state-machine.ts` merges the accumulated map (both the onEnter merge at :112 and the onExit merge at :173). Update the stale "same snapshot" comment to the new contract. Behavior change is deliberate: the YAML reads imperatively, and the snapshot isolation was the trap.
[x] R2. Engine regression tests (state-machine.test.ts): (a) non-final action's setVars reach the NEXT state's template resolution AND `context.vars`; (b) a mid-sequence setVars is visible to a later action IN THE SAME state; (c) accumulated map survives a continued-failure action (the transition-flow.test.ts:375 precedent); (d) pause/resume still restores merged vars (pause-resume-vars.test.ts must stay green). Then release 0.4.35 and `bun update` the catalog in spur-new.
[x] R3. Spur-side proof: with 0.4.35 installed, the probe workflow (file.read.into-var in s1 followed by a shell echo in s1 and a `${vars.X}` template in s2) resolves the value in all three positions, and the idea-pipeline `feature-create` state's `$featureId` consumers interpolate the captured id — run idea-pipeline end-to-end on a throwaway idea to prove the guard chain evaluates the real id.
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
[x] Implement the engine change (action-step.ts accumulation + ActionStepResult.setVars + state-machine.ts two merge points + comment rewrite) in ~/xprojects/ts-libs (R1)
[x] Add the four engine regression tests; run the engine suite green (R2)
[x] Release 0.4.35; in spur-new `bun update` the catalog and confirm `node_modules` resolves 0.4.35 (R2)
[x] Add the Spur-side probe test (same-state shell env + next-state template + guard visibility) and run `bun test apps/cli` (R3)
[x] End-to-end proof: run idea-pipeline on a throwaway idea; feature-create completes with real `$featureId` interpolation; then `bun run lint` + full `bun run test` (R3)
### Solution
- Engine fix (ts-libs `b4184bb`): `runActionSequence` (action-step.ts) now folds every action's setVars into an accumulator AND threads it into `vars` before the next iteration; `ActionStepResult.setVars` carries the accumulated map on all three exit branches (completed/terminal/fail). `state-machine.ts:112`/`:173` merge the accumulated map (onEnter + onExit); stale "same snapshot" comment rewritten to the imperative contract. Transition-flow dialect untouched (uses `runActionStep` directly with its own immediate merge).
- Released as family `0.4.35` (`7fd1643`), live on npm; spur-new catalog bumped to `^0.4.35` (7 entries, lockstep family), lockfile resolves 0.4.35.
- Spur-side proof: probe test `apps/cli/tests/workflow/setvars-probe.test.ts` (same-state child env + next-state `${vars.X}` template + guard visibility) and idea-pipeline e2e run `63d57a3e` reaching `done` with real `$featureId=D3` interpolation (durable log `.spur/run/63d57a3e-3fdc-4fd4-ae1c-353a2545ad71.log`).
- Reviewer note: all 7 catalog `@gobing-ai` entries bumped rather than engine-only — justified by the family's lockstep release.
### Testing
**Pipeline verify results** (implementation run, 2026-08-16):

- Verdict: PASS (from verdict artifact)
- Engine regression suite (ts-libs): 4 new cases — non-final setVars reach next state (state-machine.test.ts:589), mid-sequence same-state visibility (:641), accumulated map survives continued-failure (:677), pause-resume green. Suite: 394/394 across 23 files.
- Probe test: `apps/cli/tests/workflow/setvars-probe.test.ts` — 1/1.
- Monorepo gate at implementation time: 5571/5573 (2 excluded = concurrent pr-reviewing session's R42/R43).
- e2e: idea-pipeline run `63d57a3e` terminal `done` — feature-create's into-var → both shell writes exit 0 with the real interpolated id.

**Re-audit (--force, second session, 2026-08-16 ~14:00 PST): verdict re-confirmed PASS. All evidence re-run fresh, none inherited.**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | engine `action-step.ts` lines 136-153 (ts-libs repo, outside this tree) — accumulator + forward threading + `setVars` on all three exit branches; `state-machine.ts:112,173` merge the sequence-level map; comment rewritten to the imperative-read contract. Conforms to all five frozen Design edit points |
| R2 | MET | ts-libs suite re-run this session: **394 pass / 0 fail, 23 files**; the four new cases at `state-machine.test.ts:589,641,677` + pause-resume green; engine released at 0.4.35, spur-new `package.json`/bun.lock at 0.4.35 (commit bbbd66b0) |
| R3 | MET | Probe test re-run: 1/1 pass (4 expects: same-state shell env, next-state template, guard); e2e run `63d57a3e-3fdc-4fd4-ae1c-353a2545ad71` traced: feature-create/file.read.into-var ✓ → both feature-create/shell exit 0 (pre-fix the first exited 1) → run terminal `done` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — A var set by file.read.into-var is visible to a shell step in the same state | MET | test | `apps/cli/tests/workflow/setvars-probe.test.ts` (same-state `$myId` assertion) re-run pass |
| Scenario: R2 — The var is visible in the next state and in templates | MET | test | same probe, next-state `${vars.myId}` template + guard assertions, re-run pass |
| Scenario: R3 — idea-pipeline feature-create completes end to end | MET | command | run 63d57a3e trace: into-var done → Goal/Scope shells exit 0 → `done`; "Updated section 'Goal' in feature D3" in run log |

**Design-conformance:** 5/5 frozen edit points DONE (`ActionStepResult.setVars`, accumulation+forward-thread, both state-machine merge points, comment rewrite, comment-retired contract); anti-patterns all absent (no YAML workaround, no opt-in flag, transition-flow untouched, no bun link — bun.lock at released 0.4.35).

**Full-gate triage (re-audit `bun run spur-check`: 5578 pass / 26 fail — zero failures touch 0571's surface):** 23 = known sandbox port-binding/registry denials (project-start, spur projects, ProjectRegistry, startServer, healthModule, rpc client, createServerContext — environmental, pre-existing); 2 = R42/R43 skill-structure keyed to the concurrent session's untracked pr-reviewing files (operator-approved exclusion from the implementation run); 1 = `scaffold-manifest` count 36-vs-35 — **pre-existing drift at HEAD** (last manifest-touching commits are a780ab42/bcf309d7/eaa02365, all pre-0571; no 0571 file is a scaffold). Note, not fixed here — out of 0571's scope.

**Corpus side effects of the e2e proof (disclosed):** the run updated D3's Goal/Scope/AC sections and batch-created a throwaway task (0575) which was cleaned up post-run; D3's current sections are coherent with its defect family and the tree is clean at HEAD.

Coverage: N/A (engine-side change; engine suite 394/394 is the coverage).
### Review
Review (subagent run `11070d93`): verdict PASS — no blockers, no P1–P3.

| Priority | Location | Finding |
| --- | --- | --- |
| P1 | — | None — no blockers found |
| P2 | — | None |
| P3 | — | None |
| P4 (advisory, out of scope) | ts-libs `packages/llm-jsonl-importer` | catalog floor `^0.4.31` / lockfile 0.4.33 lags the 0.4.35 family; fold into a future lockstep bump |

SECUA: fold-then-merge is associative under last-write-wins (no double-merge); `ActionStepResult` additive-optional, zero consumers in spur-new (non-breaking); string-only defensive filter in `mergeSetVars` preserved; transition-flow verified still correct.

Verify (subagent run `0a4005d2`): verdict PASS — all three requirements and all three AC scenarios satisfied with live re-run evidence. Re-audit (second session, 2026-08-16): re-confirmed PASS — engine suite 394/394, probe test 1/1, e2e run 63d57a3e traced; details in Testing.

Residual risk (accepted in task contract): intra-sequence setVars visibility changes from never → always; task Q&A established no legitimate consumer of snapshot isolation; full suites green; documented in CHANGELOG.
### References

D3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-16T19:44:57.286Z todo → wip (system)
- 2026-08-16T20:21:54.374Z wip → testing (system)
- 2026-08-16T20:22:25.838Z testing → done (system)
