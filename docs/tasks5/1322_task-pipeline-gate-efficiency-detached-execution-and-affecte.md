---
schema_version: 1
name: "Task-pipeline gate efficiency: detached execution and affected-scope test selection"
status: todo
template: feature-impl
created_at: 2026-11-10T07:34:38.988Z
updated_at: "2026-11-10T16:31:02.321Z"
feature_id: H16

priority: P1
ac_altitude: task-local
estimate_hours: 16
---

## 1322. Task-pipeline gate efficiency: detached execution and affected-scope test selection

### Background

KK history analysis since spur 0.4.30 (2026-11-10) identified gate handling as the largest
task-implementation wall-time sink. Implement sessions ran the full-repo gate (`bun run gate`,
~4,799 tests) 11 times in one window at 1,089–1,117s per invocation (~90 minutes), then waited
synchronously: 20 `sleep` calls totaling 88 minutes plus 28 poll loops (`for i in $(seq 1 40); do
… sleep 30; done`, up to 20 min). Idle was 38.4% and unattributed 39.9% of a 303,438s wall span;
LLM time was only 12.7%. The gate step runs in the driver's foreground and always executes the
whole suite regardless of which files a task touched, so multi-phase tasks pay the full price
repeatedly.

### Requirements

- [ ] R1. Detached gate execution: the task pipeline's gate step runs in the background with its log
   persisted under `.spur/run/<wbs>-gate.log`; the driver resumes via a completion signal
   (workflow trace/follow, engine event, or inbox notification), not hand polling.
- [ ] R2. Tiering: the light check tier (biome changed-scope, per-workspace typecheck, related tests)
   runs between implement phases; the full gate runs once at the quality boundary, reusing a PASS
   check receipt at the same proof digest per the sp-spur-check contract.
- [ ] R3. Affected-scope selection: derive scope from the change set (git status/diff) plus the workspace
   dependency graph and select test files under affected workspaces for light/phase tiers; fall
   back to the full suite when the change crosses a shared package or cannot be mapped.
- [ ] R4. A failing detached gate surfaces the failure with the log path in the step result; selected-scope
   runs record the selection rationale (files + reason) in the check receipt.

### Acceptance Criteria

- [ ] AC1 — (req: R1; R3): Running a task pipeline whose gate step exceeds 5 minutes keeps the driver session free of
  sleep/poll tool calls, with gate output reachable at the persisted log path.
- [ ] AC2 — (req: R4): A failing detached gate marks the gate step failed with the log path in the step result and
  the pipeline pauses for remediation as it does today.
- [ ] AC3 — (req: R3): The light tier runs between phases and the full gate exactly once per task at the quality
  boundary, verified on a mid-size monorepo fixture.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-10T16:30:40.376Z

- Q: Why not a detached engine gate primitive? A: The engine already bounds gate spawns and owns
  run state; detaching adds a second process supervisor for the same work. The measured waste is
  suite cost and driver waiting, both addressed without FSM changes.
- Q: Is affected-scope safe for a shared monorepo? A: Only for light/phase tiers; any
  shared-package change falls back to the full suite, and the feature/quality boundary keeps the
  full-repo pass as required evidence.
- Q: Dependencies? A: None. All changes are inside spur's own services and plugin docs.

### Design

**Decision: keep `command.gate` synchronous but shrink its cost; move wait-asynchrony to the driver,
not the engine.** The quality gate is a `command.gate` step in `config/workflows/task-pipeline.yaml`
(backed by `packages/app/src/services/quality-gate.ts`, `qualityGateCmd` default
`${spurBin:-spur} self exec check`). The engine already runs it as a managed process with
`gateTimeoutMs` per-spawn bounds; the waste is (a) full-repo suite cost and (b) drivers sleeping
while they wait. Rebuilding the gate as a detached engine primitive would duplicate existing
process management, so the design keeps the engine contract and changes what the gate runs and how
long the driver waits.

1. **Affected-scope selection** lives in the quality-gate service: read the change set
   (`git status --porcelain` + diff against the run base sha recorded by precheck at
   `.spur/run/<wbs>-base.sha`), map changed files to workspaces via the Bun workspace graph,
   select test files under affected workspaces for the light tier. Shared-package changes
   (`packages/*`) or unmappable paths fall back to the full suite.
2. **Tier discipline**: the gate step already distinguishes recheck visits (`recheckProbeCmd`);
   extend that to a light tier (changed-scope biome + per-workspace typecheck + affected tests)
   for gate visits before remediation, and require the full gate exactly once at the quality
   boundary, reusing a PASS check receipt at the same tree digest.
3. **Wait discipline**: pipeline docs and the driver prompt replace sleep-polling with the bounded
   wait the engine already exposes (step status via run record; no new notification channel).
   The gate log path `.spur/run/<wbs>-gate.log` is included in the gate step result on failure so
   remediation reads evidence without re-running.

Out of scope: a new detached gate daemon, engine FSM changes, and any change to the
`check-receipt.json` schema.

### Plan

- [ ] P1. Add affected-scope selection to `packages/app/src/services/quality-gate.ts`: changed-file
  → workspace mapping, fallback rules, selection rationale into the check receipt.
- [ ] P2. Wire tiering into the gate step: light tier on recheck visits, full gate at the quality
  boundary with same-digest receipt reuse (existing contract).
- [ ] P3. Persist gate output to `.spur/run/<wbs>-gate.log` and include the path in gate failure
  step results.
- [ ] P4. Update `plugins/sp/skills/spur-dev` execution references: bounded wait only, no
  sleep/poll loops (cross-cutting.md already carries the rule; align execution-workflow.md).
- [ ] P5. Regression tests: two-workspace fixture selection, shared-package fallback, receipt
  rationale, failure-path log pointer.

### Solution

Design kept: `command.gate` stays synchronous; wait-asynchrony moves to the driver (bounded follow + persisted log), and cost shrinks via affected-scope light tiering (R1-R4).

| File:Line | Change |
| --- | --- |
| packages/app/src/services/quality-gate.ts:503 | `WorkspaceInfo`/`WorkspaceGraph` + `workspaceGraphFrom`/`dependentsOf` — pure workspace dependency graph (R3) |
| packages/app/src/services/quality-gate.ts:580 | `readWorkspaceGraph` — fs-backed graph reader over root `workspaces` globs (R3) |
| packages/app/src/services/quality-gate.ts:644 | `lightScope` graph param — shared-package/unmapped-path `fallback` refusal (R3) |
| packages/app/src/services/quality-gate.ts:808 | `readBaseSha` + `gitChangedFiles` base fold — `.spur/run/<wbs>-base.sha` change-set base (R3) |
| packages/app/src/services/quality-gate.ts:870 | `runDeferredGate` — BLOCKED note carries the fallback rationale (R3) |
| packages/app/src/services/quality-gate.ts:896 | `runLightGate` — graph-driven affected scope, selection rationale opens the log, base-sha diff (R3/R4) |
| packages/app/src/services/quality-gate.ts:1028 | light receipt write guarded on tree identity — `!capture.ok` writes no receipt and logs why (0976 R1 symmetry; R4) |
| packages/app/src/services/quality-gate.ts:1558 | `runQualityGate` recheck triage — affected-scope light tier before probe/full chain; red tier FAILs the visit without minting a full receipt, fallback falls through (P2/AC3) |
| packages/app/src/workflow/actions/command-gate.ts:79 | `logFile` step option — persisted step-log path (R1/R4) |
| packages/app/src/workflow/actions/command-gate.ts:171 | logFile confinement via `resolveRunArtifactPath` under `.spur/run/` (R1) |
| packages/app/src/workflow/actions/command-gate.ts:221 | per-attempt output capture into one step log (R1) |
| packages/app/src/workflow/actions/command-gate.ts:242 | PASS persists the log; `data.logFile` lands in the step result (AC1/AC2) |
| packages/app/src/workflow/actions/command-gate.ts:277 | FAIL persists the log with the outcome trailer (AC2) |
| config/workflows/task-pipeline.yaml:542 | gate step declares `logFile: .spur/run/<wbs>-gate.log` (R1/R4) |
| packages/app/tests/services/quality-gate-affected-scope.test.ts:1 | NEW — 15 tests: graph, fallback/refusal, selection evidence, base-sha change sets, both recheck-triage outcomes on a mid-size monorepo fixture (P5) |
| packages/app/tests/workflow/actions/command-gate.test.ts:524 | 24 `logFile` tests: confinement, PASS/FAIL persistence, `data.logFile` (P5) |
| packages/app/tests/services/run-storage.test.ts:981 | pinned expectation updated to the 1322 R4 contract: a capture-less light gate logs why and writes no receipt |
| plugins/sp/skills/spur-dev/references/cross-cutting.md:489 | tier discipline + persisted gate log / `data.logFile` guidance (P4) |
| plugins/sp/skills/spur-dev/references/execution-workflow.md:157 | gate steps: one bounded follow + one log read, never sleep/poll (P4) |

### Testing

- `cd packages/app && bun test tests/services/ tests/workflow/` → 5804 pass / 5 fail; the 5 failures are byte-identical to the pre-change baseline (stash-verified) and root-caused to the environment: the proto shim intercepts `bunx biome` and fails version detection inside /tmp fixtures (`proto::detect::failed`; the biome plugin is repo-local `file://.moon/plugins/biome.yml`).
- Targeted: `bun test tests/services/quality-gate-affected-scope.test.ts tests/workflow/actions/command-gate.test.ts tests/services/quality-gate-timeout.test.ts tests/services/quality-gate.test.ts tests/services/run-storage.test.ts` → all green (39 + 60 + 38 pass).
- `bun run typecheck` clean; `bunx biome check` clean on every touched file.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:02.321Z backlog → todo (system)

