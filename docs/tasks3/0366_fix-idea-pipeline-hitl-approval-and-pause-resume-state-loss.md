---
template: issue
schema_version: 1
name: "Fix idea-pipeline HITL approval and pause/resume state loss"
description: ""
status: todo
type: issue
profile: standard
feature_id: D
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-07-28T06:28:47.106Z"
updated_at: "2026-07-28T16:27:50.371Z"
---

## 0366. Fix idea-pipeline HITL approval and pause/resume state loss

### Background
Dogfooding `/sp:dev-idea --auto` against a real workflow-observability proposal exposed a correctness
failure in the newly shipped I1 idea-evaluation taste gate. The operator approved the generated idea
evaluation, but the run could not transition beyond `idea-eval`.

Two persisted runs reproduce the defect. In the first, interactive approval completed, the state
persisted as `paused`, and explicit continuation immediately failed at `idea-eval`. In the second, a
rerun with `profile=auto` and `idea_approved=true` still entered the unconditional prompt/pause;
continuation returned `status=failed`, `reason=no-passing-transition`, and `transitionsTaken=0`.

No feature or decomposed tasks were created. Discovery nevertheless ran twice for 5–6 minutes with no
heartbeat or interim output and left `docs/design/brainstorm-workflow-observability-steering.md`
untracked after failure.

This task owns the correctness and recovery defects required before the original observability idea can
be planned safely: preservation of effective variables and HITL answers across pause/resume, functional
pre-approval bypasses, actionable failure traces, and deterministic handling of pre-feature discovery
artifacts. It must use upstream `@gobing-ai/ts-dual-workflow-engine` support where the defect belongs;
do not add a Spur-only state shim that creates a second source of truth.
### Requirements
- R1. Persist the effective run-variable snapshot—workflow defaults, `--vars` overrides, and action
  `setVars` mutations—at a resumable boundary and restore it before evaluating transitions.
- R2. Preserve a completed `hitl.confirm` response such as `__hitlAnswer=yes` across `paused → running`
  so continuation evaluates the intended approve/reject/cancel edge.
- R3. Preserve all non-HITL run overrides across resume, including `idea`, `profile`, `design`,
  `idea_approved`, `design_approved`, `featureId`, and future declared vars.
- R4. Make `--auto --idea-approved` and `--auto --approve-taste` bypass their pre-approved taste gates
  without rendering a prompt or persisting an avoidable pause; apply the same rule to design approval.
- R5. Keep interactive non-pre-approved taste gates default-deny and resumable; a restart or continuation
  must not rerun discovery or create a duplicate feature.
- R6. Define `workflow continue --yes` unambiguously: it bypasses the CLI resume confirmation, while the
  persisted workflow HITL answer remains the transition input.
- R7. Persist and expose terminal failure reasons such as `no-passing-transition` in `workflow trace`
  human and JSON timelines, not only in the transient command result.
- R8. Give discovery artifacts created before feature allocation explicit run provenance and a
  deterministic retain/cleanup policy on reject, cancel, failure, and retry; never silently overwrite a
  prior run's useful report.
- R9. Add producer-driven integration coverage using real `hitl.confirm`, run-level `--vars`, an action
  `setVars` mutation, pause, process-equivalent resume, and guarded transitions. An `always`-guard pauser
  test alone is insufficient.
- R10. Release the upstream engine fix, bump Spur's catalog dependency, rebuild the linked/bundled CLI,
  and prove behavior against the consumed package rather than only an upstream working tree.
- R11. Preserve backward compatibility for existing workflow records whose state snapshots predate the
  variable payload; fail loudly only when a genuinely required value cannot be reconstructed.
- R12. Re-dogfood `/sp:dev-idea --auto` through idea approval and design approval, proving one discovery
  execution, one feature allocation, and successful continuation to the expected next gate.
### Acceptance Criteria
```gherkin
Feature: resumable and pre-approvable idea-pipeline taste gates

  Scenario: Interactive approval survives pause and resume
    Given an idea-pipeline run entered idea-eval with a non-empty idea and profile auto
    And hitl.confirm returned yes
    When the paused run is continued in a new CLI invocation
    Then the run transitions from idea-eval to feature-create
    And the original idea and all effective run variables are available
    And discovery is not executed again

  Scenario: Explicit prior approval bypasses the idea gate
    Given profile is auto and idea_approved is true
    When discovery completes
    Then no idea-eval prompt is rendered
    And the run does not persist a paused idea-eval state
    And the next executed state is feature-create

  Scenario: Explicit taste approval bypasses both taste gates
    Given profile is auto and both idea_approved and design_approved are true
    When the run reaches each corresponding routing boundary
    Then neither idea-eval nor design-approval prompts
    And objective feature and batch checks still execute

  Scenario: Resume preserves action-set variables
    Given a real hitl.confirm action sets __hitlAnswer to yes
    And the workflow pauses after the action
    When the run resumes through persisted state
    Then a guard reading vars.__hitlAnswer passes
    And a guard reading a run-level override also passes

  Scenario: A failed continuation remains diagnosable
    Given no transition passes after resume
    When the operator reads workflow trace in human or JSON mode
    Then the persisted timeline names no-passing-transition
    And it identifies the run id, state, and transition count

  Scenario: Recovery does not duplicate side effects
    Given a paused or failed planning run is retried
    When the pipeline eventually passes the approval gate
    Then exactly one feature is created
    And each discovery artifact is attributable to one run
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Fix the state model at its authority rather than teaching each workflow to reconstruct lost values.

1. Extend the engine's persisted state snapshot (already JSON-bearing) with an optional effective-vars
   payload. Persist after action `setVars` merges and before a pause/final transition decision; restore it
   in both state-machine and transition-flow resume paths. Old snapshots without the field remain valid.
2. Keep variable persistence atomic with the state/transition snapshot where possible, so a crash cannot
   combine a new state with stale vars. Redact only when projecting observability; workflow control vars
   must remain exact in the local run store.
3. Add pre-approved routing edges before entering `idea-eval` and `design-approval`. Persisted vars still
   remain mandatory because normal interactive approval legitimately pauses and resumes.
4. Carry terminal reasons into the durable run/timeline projection used by `workflow trace`.
5. Namespace discovery artifacts by run id or attach equivalent provenance, then define explicit
   promotion/cleanup at feature creation and terminal rejection/failure.

The engine fix and the workflow routing fix are complementary: routing removes unnecessary pauses for
pre-approved runs; persisted vars make real pauses correct for every workflow.
### Plan
1. Encode the two observed run shapes as failing integration tests, including the exact
   `no-passing-transition` continuation result.
2. Add upstream engine regression tests for run overrides plus `ActionResult.setVars` across pause/resume.
3. Implement backward-compatible persisted variable snapshots and atomic restore in both workflow modes.
4. Release `@gobing-ai/ts-dual-workflow-engine`, bump the workspace catalog, install, and rebuild the CLI.
5. Move I1 pre-approval routing ahead of paused states and validate/dry-run the workflow definition.
6. Persist failure reasons in trace timelines and cover human plus JSON rendering.
7. Implement the discovery-artifact provenance/cleanup decision without deleting unrelated user files.
8. Run focused tests, full Spur gates, then dogfood `/sp:dev-idea --auto` through both taste gates.
9. Refresh feature I1 and record the regression task's final evidence.
### Root Cause
Verified against the consumed `@gobing-ai/ts-dual-workflow-engine@0.4.11` source:

- `StateMachineDriver.loop` initializes `vars` from `mergeVars(workflow.vars, options.vars)`.
- `WorkflowAppService.continuePaused` calls `resumeRun(workflow, runId, { workdir })` without the
  original run overrides.
- Action `setVars` values, including `__hitlAnswer`, live only in the driver's in-memory map and are not
  part of the persisted state snapshot loaded by resume.
- Resume skips the paused state's `onEnter`, so the lost HITL answer is not regenerated.
- `idea-pipeline.yaml` always routes `discovery → idea-eval`; its `idea_approved` guard is evaluated only
  from inside the already-entered paused state, so advertised prior approval cannot avoid the prompt/pause.
- The trace projection records only a terminal failed phase for continuation; the
  `no-passing-transition` reason appears in the command result but not the persisted timeline.

These combine into the observed failure: resume falls back to YAML defaults
(`idea_approved=false`, `profile=standard`, empty idea, no `__hitlAnswer`), every outgoing idea-eval guard
fails, and the run terminates with zero transitions.
### Solution
Cross-repo fix: upstream `@gobing-ai/ts-dual-workflow-engine` 0.4.11 → 0.4.12 (vars persistence), then Spur-side routing, observability, provenance, and integration coverage.

## Engine (upstream `ts-libs/packages/dual-workflow-engine`, released 0.4.12)

- **R1–R3, R11 — vars persistence across pause/resume.**
  - `src/persistence.ts`: added `loadLatestStateSnapshot(runId)` to the `WorkflowStateStore` interface.
  - `src/adapters/db-state-store.ts` + `src/adapters/in-memory-state-store.ts`: implement `loadLatestStateSnapshot` (reads `data_json` of the newest `workflow_states` row).
  - `src/run-lifecycle.ts`: `enter()`, `commitHop()`, `pause()` now accept a `vars` param; `pause()` writes a fresh snapshot whose `data_json` carries `effectiveVars` BEFORE `savePhase`, capturing `setVars` mutations from the paused state's own `onEnter` (e.g. `__hitlAnswer` from `hitl.confirm`).
  - `src/drivers/state-machine.ts` + `src/drivers/transition-flow.ts`: pass current `vars` at every lifecycle touchpoint.
  - `src/service.ts` `resumeRun()`: restores `effectiveVars` via new `extractEffectiveVars()`; merge strategy `mergeVars(persistedEffectiveVars, options.vars ?? {})` — caller wins as override. Old snapshots without `effectiveVars` fall back to `{}` (R11 backward compat).
  - Test: `tests/pause-resume-vars.test.ts` (4 tests).

## Spur monorepo

- **R4/R5 — pre-approval bypass (idea-pipeline.yaml).** Added `discovery → feature-create` edge guarded by `test "${vars.profile}" = auto && test "${vars.idea_approved}" = true`, declared BEFORE `discovery → idea-eval` so pre-approved runs skip the paused taste gate entirely. Same pattern already used by `system-design → design-approval`.
- **R6 — `continue --yes` help.** `apps/cli/src/commands/workflow.ts:221`: clarified option text — bypasses CLI resume confirmation; persisted workflow HITL answer remains the transition input.
- **R7 — trace failure reasons.** `packages/app/src/services/workflow-service.ts`: `stampFailureReason()` stamps `result.reason` into `runs.metadata_json` via `json_set`; called from both `run()` and `continuePaused()`. Surfaced in `workflow trace` human + JSON.
- **R8 — discovery artifact provenance.**
  - `workflow-service.ts` `run()`: injects `__runId` into workflow vars (`{ ...(opts.vars ?? {}), __runId: runId }`); survives pause/resume via R1–R3 effectiveVars.
  - `idea-pipeline.yaml`: declared `__runId: ""` in `vars:`; replaced blind `rm -f` of discovery artifacts with timestamped archive (`.spur/run/idea-archive/<timestamp>/`); discovery `agent.run` input instructs appending a `run_id`/`generated_at` provenance footer.
- **R9 — integration coverage.** `packages/app/tests/services/workflow-service.test.ts`: 5 new tests — `__runId` injection (shell-observable, no-vars default, caller-vars coexist) and pause/resume var persistence (`hitl.confirm` → `__hitlAnswer` survives resume through guarded transition; backward-compat degradation when `effectiveVars` stripped).

## Release / consumption (R10)

- Engine version 0.4.11 → 0.4.12 (8 lockstep `@gobing-ai/*` packages).
- Spur `package.json` catalog: all 8 entries bumped to 0.4.12.
- `.bun` dist hot-swapped; CLI bundle rebuilt (`apps/cli/spur.js`).

## Dogfood (R12)

- `idea-pipeline.yaml` validates clean.
- Dry-run `profile=auto,idea_approved=true`: `discovery → feature-create` taken directly (skips `idea-eval` pause); trace shows `failureReason: iteration-bound-exceeded` (R7 working).
- Dry-run `profile=standard,idea_approved=false`: correctly pauses at `idea-eval`.
### Testing
## Regression commands and outcomes

```bash
cd ~/xprojects/ts-libs/packages/dual-workflow-engine && bun test
```
**Result:** 334 pass, 0 fail. New file `tests/pause-resume-vars.test.ts` (4 tests) covers R1–R3 vars persistence across pause/resume.

```bash
cd packages/app && bun test
```
**Result:** 1043 pass, 0 fail (5 new tests in `workflow-service.test.ts`).

- `run — __runId injection (R8 of 0366)` (3 tests): shell action observes injected `__runId`; works with no caller vars; caller-provided vars coexist.
- `run — pause/resume var persistence (R9 of 0366)` (2 tests): `hitl.confirm` sets `__hitlAnswer` during paused state's `onEnter`; survives resume; downstream shell captures `__hitlAnswer|__runId|seedVar`; guarded transition (`test "${vars.__hitlAnswer}" = yes`) passes after resume. Backward-compat test strips `effectiveVars` from snapshot → guard fails gracefully with `reason: 'no-passing-transition'` (no crash).

- `workflow-service.test.ts` ~line 466: `surfaces terminal failure reason in trace entry (R7 of 0366)` — passes.
- Dogfood dry-run confirmed `failureReason: "iteration-bound-exceeded"` stamped in `workflow trace --json`.

```bash
cd packages/app && bunx tsc --noEmit
```
**Result:** clean (no errors).

```bash
bun run --filter @gobing-ai/spur build:bundle
```
**Result:** `spur.js` rebuilt (3.23 MB); `__runId` and `stampFailureReason` present in bundle.

- `spur workflow validate config/workflows/idea-pipeline.yaml` → valid.
- Dry-run `profile=auto,idea_approved=true` → `discovery → feature-create` (bypass works, R4/R5).
- Dry-run `profile=standard,idea_approved=false` → pauses at `idea-eval` (interactive path intact).

R1–R12 all addressed at the engine or Spur-service layer with real-action integration tests (not just `always`-guard pausers). Engine vars-persistence unit tests + Spur service-layer integration tests with `hitl.confirm`, shell guards, and run-level `--vars`.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature I1: `docs/features/I1_dev-idea-drop-design-force-path-idea-evaluation-taste-gate.md`
- Shipping task: `docs/tasks3/0364_ship-i1-remove-design-force-path-and-wire-idea-eval-taste-ga.md`
- Failing runs: `74dbd5e2-4124-4921-9256-6ba241174c9f`,
  `02b64ff0-a216-4780-aac2-65831cbfe768`
- Generated evaluation: `.spur/run/idea-eval-report.md`
- Orphaned discovery artifact: `docs/design/brainstorm-workflow-observability-steering.md`
- Spur resume seam: `packages/app/src/services/workflow-service.ts`
- Engine resume/variable seams:
  `packages/app/node_modules/@gobing-ai/ts-dual-workflow-engine/src/{service,state-machine,run-lifecycle}.ts`
- Workflow definition: `config/workflows/idea-pipeline.yaml`
### History
