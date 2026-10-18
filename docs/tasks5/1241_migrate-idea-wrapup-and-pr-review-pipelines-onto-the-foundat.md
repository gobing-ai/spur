---
schema_version: 1
name: Migrate idea, wrapup and pr-review pipelines onto the foundation
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.820Z
updated_at: "2026-10-18T02:02:21.844Z"
feature_id: D65
priority: P2
tags:
  - workflow
  - migration
estimate_hours: 4

dependencies: ["1240"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1241-verdict.json
---

## 1241. Migrate idea, wrapup and pr-review pipelines onto the foundation

### Background

Feature D65 P3. The remaining model-bearing workflows still depend on the inline driver; lifecycle workflows (task-lifecycle, feature-lifecycle) are out of scope.

**Refine corrections (2026-10-17)**
- R1 "idea-pipeline, wrapup-pipeline and pr-review still depend on the inline driver" → only idea-pipeline is inline-driven (dev-idea/dev-plan); wrapup (headless, dev-wrap.md:31 "no inline wrap driver"), pr-review (all shell), history-anatomy and wayfinder-resolution already run on the engine → port idea-pipeline only; verify the others pass the 1233 lint and fleet dispatch. Title kept (CLI cannot rename).
- Estimate 8h → 4h (one port instead of three).

### Requirements

- [x] R1. idea-pipeline runs on the engine with host/subprocess/fleet dispatch (`vars.executor`) and passes the self-contained lint.
- [x] R2. Operator gates of idea-pipeline, wrapup-pipeline and wayfinder-resolution carry evidence/catalog decision bindings; --auto behaves as today's recommendations.
- [x] R3. wrapup-pipeline, pr-review, history-anatomy and wayfinder-resolution pass the self-contained lint and dispatch through the same agent.run contract (fleet included) without inline driving.
- [x] R4. dev-idea and dev-plan driver references reduce to the run → work → continue loop.

### Acceptance Criteria

- [x] AC1 — R13 — Remaining workflows migrate and the inline bookkeeping surface is removed (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Mechanical port of idea-pipeline using the P1 contracts; the other engine-run workflows need only rebinding and lint conformance. One E2E run of idea-pipeline (host executor) plus validate across config/workflows is the check. No new mechanism.

### Plan

- [x] Declare completions for the three allowance stages and delete those allowance entries
- [x] Replace `mode: never` with evidence bindings on the idea, wayfinder and wrapup gates (unpaused, with the answer fold)
- [x] Keep the auto-skip guards and every transition/guard identical
- [x] Reduce dev-idea / dev-plan driver references to the run -> work -> continue loop
- [x] Re-key the two pins that described the deleted inline hand-off

### Solution

Mechanical migration onto the D65 foundation (design `workflow-execution-foundation` §3.3/§4.1/§4.2/§4.4/§4.5); no new mechanism, no new verb or flag.

| Change (`file:line`) | Why |
| --- | --- |
| `config/workflows/idea-pipeline.yaml:82` | declares the `executor` var (`host` / `fleet` / empty = subprocess) the 1232 dispatch reads, so the pipeline's stages run on any executor (R1). |
| `config/workflows/idea-pipeline.yaml:153` | `discovery` declares `expectFiles: …-idea-needs-design.json`. The plural form feeds the work item; the singular `expectFile` stays the subprocess post-exit guard, so a missing signal still falls back to the catalog decision instead of failing the stage. |
| `config/workflows/idea-pipeline.yaml:253` | `feature-create` declares the goal/scope intent artifacts it writes; the shell that feeds them to `feature update --from-file` already fails closed, so this adds the work-item contract only. |
| `config/workflows/idea-pipeline.yaml:210,383,485,567` | the four operator gates replace `decision: {mode: never}` with `mode: evidence` + `statusVar` + `evidenceNodes` (discovery / ac-generate / system-design / decompose), and drop `pause: true` — an evidence binding cannot live in a paused state (0911 D2); interactively the responder asks the operator, under `profile=auto` the binding answers (1236 R1/R2). |
| `config/workflows/idea-pipeline.yaml` (each gate) | a two-action answer fold (shell + `file.read.into-var`) maps a deferred/absent answer back to `no`, the answer today's headless responder gave, so no transition or guard changes and `--auto` keeps today's routing. The auto-skip guards (`profile=auto` + `idea_approved`/`design_approved`, recommendation file) are untouched, so `--auto` still accepts exactly the recommendation it accepted before. |
| `config/workflows/wayfinder-resolution.yaml:41,171` | `approve` becomes an evidence gate over `verify`, unpaused; `approval=auto` still routes around it, and the answer fold keeps an absent answer on the `failed` edge. |
| `config/workflows/wrapup-pipeline.yaml:135,474` | `branch-cleanup` becomes an evidence gate over `doc-sync`, unpaused; it stays consent-only (no git op) and both answers route to `done`. |
| `config/workflows/wrapup-pipeline.yaml:273` | `doc-sync` declares the resolved task list as an `inputs` entry — `task-resolve` writes it through `spur task wrapup resolve`, so the static scan cannot see the production (R3). |
| `packages/app/src/workflow/composition-lint.ts` | `SELF_CONTAINED_STAGE_ALLOWANCES` is now empty: the three reviewed entries (`idea-pipeline::discovery`, `idea-pipeline::feature-create`, `wrapup-pipeline::doc-sync`) died with the declarations above. |
| `plugins/sp/commands/dev-idea.md`, `plugins/sp/commands/dev-plan.md` | driver references reduce to the three moves — `spur workflow run` → perform the returned work item → `spur workflow continue` — with `--agent inline` mapped to `executor=host` and no inline-driver mechanics (R4). |

`pr-review` (all shell) and `history-anatomy` already ran on the engine with declared `expectFile`s; they needed no change and validate clean against the same lint (R3 verified, not edited).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/tests/services/workflow-host-executor.test.ts:102 — host action cursor now suspends before same-state consumers; all shipped workflows self-contained lint pass |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 37 — (pass) task-pipeline evidence chain — the approval is a decision point (1236, D65 R5) > the review tail declares an evidence binding, never `mode: never` or a pause [0.03ms]; fresh targeted run exited 0 |
| R3 | MET | packages/app/src/workflow/actions/agent-run.ts and fleet-work-item.ts — all executor surfaces share action contracts, fleet members enforce answer capture/diff/capabilities before request completion; host pause regression passes |
| R4 | MET | plugins/sp/commands/dev-plan.md:50 and plugins/sp/commands/dev-idea.md:63 — both describe run/work/continue; fresh plugin tests passed |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R13 — Remaining workflows migrate and the inline bookkeeping surface is removed | MET | test | packages/app/tests/services/workflow-host-executor.test.ts:102 — host action cursor now suspends before same-state consumers; all shipped workflows self-contained lint pass; @run `.spur/run/d65-verifyall/app-tests.log` line 37 — (pass) task-pipeline evidence chain — the approval is a decision point (1236, D65 R5) > the review tail declares an evidence binding, never `mode: never` or a pause [0.03ms]; fresh targeted run exited 0; packages/app/src/workflow/actions/agent-run.ts and fleet-work-item.ts — all executor surfaces share action contracts, fleet members enforce answer capture/diff/capabilities before request completion; host pause regression passes; plugins/sp/commands/dev-plan.md:50 and plugins/sp/commands/dev-idea.md:63 — both describe run/work/continue; fresh plugin tests passed |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS
Confidence: HIGH

#### Per-Requirement Traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | packages/app/tests/services/workflow-host-executor.test.ts:102 — host action cursor now suspends before same-state consumers; all shipped workflows self-contained lint pass |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 37 — (pass) task-pipeline evidence chain — the approval is a decision point (1236, D65 R5) > the review tail declares an evidence binding, never `mode: never` or a pause [0.03ms]; fresh targeted run exited 0 |
| R3 | MET | packages/app/src/workflow/actions/agent-run.ts and fleet-work-item.ts — all executor surfaces share action contracts, fleet members enforce answer capture/diff/capabilities before request completion; host pause regression passes |
| R4 | MET | plugins/sp/commands/dev-plan.md:50 and plugins/sp/commands/dev-idea.md:63 — both describe run/work/continue; fresh plugin tests passed |

#### Acceptance Criteria Verification
| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R13 — Remaining workflows migrate and the inline bookkeeping surface is removed | MET | test | packages/app/tests/services/workflow-host-executor.test.ts:102 — host action cursor now suspends before same-state consumers; all shipped workflows self-contained lint pass; @run `.spur/run/d65-verifyall/app-tests.log` line 37 — (pass) task-pipeline evidence chain — the approval is a decision point (1236, D65 R5) > the review tail declares an evidence binding, never `mode: never` or a pause [0.03ms]; fresh targeted run exited 0; packages/app/src/workflow/actions/agent-run.ts and fleet-work-item.ts — all executor surfaces share action contracts, fleet members enforce answer capture/diff/capabilities before request completion; host pause regression passes; plugins/sp/commands/dev-plan.md:50 and plugins/sp/commands/dev-idea.md:63 — both describe run/work/continue; fresh plugin tests passed |


#### Findings

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | functional/SECUA/architecture | docs/design/workflow-execution-foundation.md:19 | Inline review completed; requirement and AC evidence is listed above; prior verification blockers are resolved | RESOLVED |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T23:13:56.819Z todo → wip (system)
- 2026-10-17T23:13:57.371Z wip → testing (system)
- 2026-10-17T23:14:02.827Z testing → done (system)

