---
schema_version: 1
name: "Task-pipeline gate efficiency: detached execution and affected-scope test selection"
status: done
template: feature-impl
created_at: 2026-11-10T07:34:38.988Z
updated_at: "2026-11-10T19:52:56.009Z"
feature_id: H16

priority: P1
ac_altitude: task-local
estimate_hours: 16
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1322-verdict.json
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

- [x] R1. Detached gate execution: the task pipeline's gate step runs in the background with its log
   persisted under `.spur/run/<wbs>-gate.log`; the driver resumes via a completion signal
   (workflow trace/follow, engine event, or inbox notification), not hand polling.
- [x] R2. Tiering: the light check tier (biome changed-scope, per-workspace typecheck, related tests)
   runs between implement phases; the full gate runs once at the quality boundary, reusing a PASS
   check receipt at the same proof digest per the sp-spur-check contract.
- [x] R3. Affected-scope selection: derive scope from the change set (git status/diff) plus the workspace
   dependency graph and select test files under affected workspaces for light/phase tiers; fall
   back to the full suite when the change crosses a shared package or cannot be mapped.
- [x] R4. A failing detached gate surfaces the failure with the log path in the step result; selected-scope
   runs record the selection rationale (files + reason) in the check receipt.

### Acceptance Criteria

- [x] AC1 — (req: R1; R3): Running a task pipeline whose gate step exceeds 5 minutes keeps the driver session free of
  sleep/poll tool calls, with gate output reachable at the persisted log path.
- [x] AC2 — (req: R4): A failing detached gate marks the gate step failed with the log path in the step result and
  the pipeline pauses for remediation as it does today.
- [x] AC3 — (req: R3): The light tier runs between phases and the full gate exactly once per task at the quality
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

- [x] P1. Add affected-scope selection to `packages/app/src/services/quality-gate.ts`: changed-file
  → workspace mapping, fallback rules, selection rationale into the check receipt.
- [x] P2. Wire tiering into the gate step: light tier on recheck visits, full gate at the quality
  boundary with same-digest receipt reuse (existing contract).
- [x] P3. Persist gate output to `.spur/run/<wbs>-gate.log` and include the path in gate failure
  step results.
- [x] P4. Update `plugins/sp/skills/spur-dev` execution references: bounded wait only, no
  sleep/poll loops (cross-cutting.md already carries the rule; align execution-workflow.md).
- [x] P5. Regression tests: two-workspace fixture selection, shared-package fallback, receipt
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

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Background gate run with persisted output: `logFile` option confined under `.spur/run/` via `resolveRunArtifactPath` (`packages/app/src/workflow/actions/command-gate.ts:172-181`), per-attempt capture into one step log (`packages/app/src/workflow/actions/command-gate.ts:221`), PASS persists the log and lands `data.logFile` in the step result (`packages/app/src/workflow/actions/command-gate.ts:244-256`); gate step declares `logFile: .spur/run/${vars.wbs}-gate.log` (`config/workflows/task-pipeline.yaml:546`); live output at the declared path (`.spur/run/1322-gate.log:1-2`); driver wait discipline is one bounded `--follow` plus one log read, never sleep/poll (`plugins/sp/skills/spur-dev/references/execution-workflow.md:157-161`, `plugins/sp/skills/spur-dev/references/cross-cutting.md:489-496`). |
| R2 | MET | Recheck visits triage through the affected-scope light tier before the probe/full chain — red fails the visit cheaply without minting a full receipt, green/fallback falls through to the single full gate (`packages/app/src/services/quality-gate.ts:1557-1591`); light receipt write guarded on tree identity so it cannot forge boundary state (`packages/app/src/services/quality-gate.ts:1028-1040`); same-digest PASS reuse live this run: `.spur/run/1322-gate.log:2` (`check.reused` — full-tier PASS receipt at git tree 8cb785d2...) and `.spur/run/1322-check-receipt.json:5` (tier full, inputDigest 8cb785d2...). |
| R3 | MET | Pure workspace graph (`packages/app/src/services/quality-gate.ts:527-560`), fs reader (`packages/app/src/services/quality-gate.ts:580-641`), `lightScope` refusal — shared package names its dependents, unmapped path refuses (`packages/app/src/services/quality-gate.ts:644-731`), change-set base fold reads the precheck's `.spur/run/<wbs>-base.sha` (`packages/app/src/services/quality-gate.ts:808-824`; live `.spur/run/1322-base.sha:1` = d7c0bc402...); selection rationale opens the light log (`packages/app/src/services/quality-gate.ts:931-935`), fallback exits BLOCKED naming the rationale; tests `packages/app/tests/services/quality-gate-affected-scope.test.ts:111-283` (fresh: 39 pass / 0 fail). |
| R4 | MET | Gate failure data carries the resolved log path (`packages/app/src/workflow/actions/command-gate.ts:281-293`; PASS `packages/app/src/workflow/actions/command-gate.ts:244-256`); selection rationale is the light log's opening lines with receipt rows pointing back (`packages/app/src/services/quality-gate.ts:931-935`, test `packages/app/tests/services/quality-gate-affected-scope.test.ts:215`); capture-less light gate logs why and writes no forged receipt (`packages/app/tests/services/run-storage.test.ts:981-988`); live failure surfaced and the FSM paused for remediation (`.spur/run/1322-failure-class.decision:3` — `value: fix`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/workflow/actions/command-gate.test.ts:556` — a passing gate persists the log and the success data carries the path; `packages/app/tests/workflow/actions/command-gate.test.ts:584` — retry attempts all land in the persisted log; wait discipline `plugins/sp/skills/spur-dev/references/execution-workflow.md:157-161`; declaration `config/workflows/task-pipeline.yaml:546`; live gate output reachable at the persisted path (`.spur/run/1322-gate.log:1-2`). |
| AC2 | MET | test | `packages/app/tests/workflow/actions/command-gate.test.ts:527` — a failing gate persists its output at the log path and carries the path in its data; source `packages/app/src/workflow/actions/command-gate.ts:281-293`; live this run: the gate failure marked the step failed with the log path and the pipeline paused for remediation (`.spur/run/1322-failure-class.decision:3` — `value: fix`). |
| AC3 | MET | test | Mid-size monorepo fixture (`packages/app/tests/services/quality-gate-affected-scope.test.ts:57` — `apps/leaf-app` depends on `packages/shared-lib`); `packages/app/tests/services/quality-gate-affected-scope.test.ts:302` — red light tier fails the recheck without paying the full chain, no full receipt minted; `:346` — green tier falls through: full gate runs, full receipt lands; `:373` — full-suite fallback falls through; triage ordering `packages/app/src/services/quality-gate.ts:1557-1591`; fresh run 39 pass / 0 fail; full gate exactly once with same-digest reuse live (`.spur/run/1322-gate.log:2`; `.spur/run/1322-test-gate.status:1` — PASS, 12584 tests across 815 files per `.spur/run/1322-remediate-receipt.md:87`). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1322 (visit 3 — post-remediation certification)
**Scope:** git diff d7c0bc402..f12ccef76 (commits 7a4de969a implement + f12ccef76 remediation; 10 files, +895/−21; verified unchanged at HEAD f12ccef76 this pass — the remediate hop changed no code: environmental disk-space fix only, caches purged)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | `readWorkspaceGraph` expands only `dir/*`-suffixed globs and literal dirs; a `workspaces: ["packages/**"]` declaration (yarn-classic shape) silently yields an empty graph, so `lightScope`'s shared-package refusal never fires for that repo shape — the R3 full-suite fallback is silently unavailable there (a shared-package change would be scoped to its own workspace's tests, missing dependents). The pipeline's once-per-task full gate at the quality boundary still certifies every PASS (recheck green/fallback falls through), and this repo's root declares the supported `apps/*`/`packages/*` shape, so 1322's own runs are unaffected; the supported-shape contract is documented at the reader. Hardening candidate: an unsupported glob shape should refuse the tier (fallback) instead of classifying nothing. | `packages/app/src/services/quality-gate.ts:580-641` | DEFER(hardening follow-up outside 1322's declared repo shape; contract-documented legacy behavior; boundary full gate still certifies every PASS) |
| 2 | P4 (advisory) | correctness | A deleted file in the change set (exists false, owner null) forces full-suite fallback, so deletions in leaf workspaces cannot use the light tier. Conservative and safe — deliberate refusal over mis-scoping. | `packages/app/src/services/quality-gate.ts:711-715` | ACCEPTED |
| 3 | P4 (advisory) | efficiency | `dependentsOf` scans `byName` linearly per changed file (O(workspaces×files) at selection time); negligible at monorepo scale (~20 workspaces) and kept pure/injectable for tests. | `packages/app/src/services/quality-gate.ts:545-553` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Background gate run with persisted output: `logFile` option confined under `.spur/run/` via `resolveRunArtifactPath` (`packages/app/src/workflow/actions/command-gate.ts:172-181`), per-attempt capture into one step log (`packages/app/src/workflow/actions/command-gate.ts:221`), PASS persists the log and lands `data.logFile` in the step result (`packages/app/src/workflow/actions/command-gate.ts:244-256`); gate step declares `logFile: .spur/run/${vars.wbs}-gate.log` (`config/workflows/task-pipeline.yaml:546`); live output at the declared path (`.spur/run/1322-gate.log:1-2`); driver wait discipline is one bounded `--follow` plus one log read, never sleep/poll (`plugins/sp/skills/spur-dev/references/execution-workflow.md:157-161`, `plugins/sp/skills/spur-dev/references/cross-cutting.md:489-496`). |
| R2 | MET | Recheck visits triage through the affected-scope light tier before the probe/full chain — red fails the visit cheaply without minting a full receipt, green/fallback falls through to the single full gate (`packages/app/src/services/quality-gate.ts:1557-1591`); light receipt write guarded on tree identity so it cannot forge boundary state (`packages/app/src/services/quality-gate.ts:1028-1040`); same-digest PASS reuse live this run: `.spur/run/1322-gate.log:2` (`check.reused` — full-tier PASS receipt at git tree 8cb785d2...) and `.spur/run/1322-check-receipt.json:5` (tier full, inputDigest 8cb785d2...). |
| R3 | MET | Pure workspace graph (`packages/app/src/services/quality-gate.ts:527-560`), fs reader (`packages/app/src/services/quality-gate.ts:580-641`), `lightScope` refusal — shared package names its dependents, unmapped path refuses (`packages/app/src/services/quality-gate.ts:644-731`), change-set base fold reads the precheck's `.spur/run/<wbs>-base.sha` (`packages/app/src/services/quality-gate.ts:808-824`; live `.spur/run/1322-base.sha:1` = d7c0bc402...); selection rationale opens the light log (`packages/app/src/services/quality-gate.ts:931-935`), fallback exits BLOCKED naming the rationale; tests `packages/app/tests/services/quality-gate-affected-scope.test.ts:111-283` (fresh: 39 pass / 0 fail). |
| R4 | MET | Gate failure data carries the resolved log path (`packages/app/src/workflow/actions/command-gate.ts:281-293`; PASS `packages/app/src/workflow/actions/command-gate.ts:244-256`); selection rationale is the light log's opening lines with receipt rows pointing back (`packages/app/src/services/quality-gate.ts:931-935`, test `packages/app/tests/services/quality-gate-affected-scope.test.ts:215`); capture-less light gate logs why and writes no forged receipt (`packages/app/tests/services/run-storage.test.ts:981-988`); live failure surfaced and the FSM paused for remediation (`.spur/run/1322-failure-class.decision:3` — `value: fix`). |

##### AC Traceability

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test+command | `packages/app/tests/workflow/actions/command-gate.test.ts:556` — a passing gate persists the log and the success data carries the path; `packages/app/tests/workflow/actions/command-gate.test.ts:584` — retry attempts all land in the persisted log; wait discipline `plugins/sp/skills/spur-dev/references/execution-workflow.md:157-161`; declaration `config/workflows/task-pipeline.yaml:546`; live gate output reachable at the persisted path (`.spur/run/1322-gate.log:1-2`). |
| AC2 | MET | test+command | `packages/app/tests/workflow/actions/command-gate.test.ts:527` — a failing gate persists its output at the log path and carries the path in its data; source `packages/app/src/workflow/actions/command-gate.ts:281-293`; live this run: the gate failure marked the step failed with the log path and the pipeline paused for remediation (`.spur/run/1322-failure-class.decision:3` — `value: fix`). |
| AC3 | MET | test+command | Mid-size monorepo fixture (`packages/app/tests/services/quality-gate-affected-scope.test.ts:57` — `apps/leaf-app` depends on `packages/shared-lib`); `packages/app/tests/services/quality-gate-affected-scope.test.ts:302` — red light tier fails the recheck without paying the full chain, no full receipt minted; `:346` — green tier falls through: full gate runs, full receipt lands; `:373` — full-suite fallback falls through; triage ordering `packages/app/src/services/quality-gate.ts:1557-1591`; fresh run 39 pass / 0 fail; full gate exactly once with same-digest reuse live (`.spur/run/1322-gate.log:2`; `.spur/run/1322-test-gate.status:1` — PASS, 12584 tests across 815 files per `.spur/run/1322-remediate-receipt.md:87`). |

##### Fresh verification evidence (this pass — visit 3, post-remediation)

- Diff unchanged: HEAD = f12ccef76, `git diff d7c0bc402..f12ccef76` = same 10 files, +895/−21; remediation made zero code changes (environmental disk-space fix only, caches purged), so visit 2's PASS substance carries over intact.
- Anchor sweep this pass: every load-bearing citation re-resolved against HEAD — `packages/app/src/workflow/actions/command-gate.ts:170-186` (logFile confinement), `:221` (accumulated capture), `:244-256` (PASS persists log, `data.logFile`), `:279-294` (failure data carries path); `packages/app/src/services/quality-gate.ts:527-560`, `:545-553`, `:580-644`, `:710-716`, `:808-824`, `:930-936`, `:1027-1041`, `:1557-1591`; `config/workflows/task-pipeline.yaml:546`; cited test anchors in `packages/app/tests/workflow/actions/command-gate.test.ts` (`:527`, `:556`, `:584`, `:623`), `packages/app/tests/services/quality-gate-affected-scope.test.ts` (`:57`, `:215`, `:302`, `:346`, `:373`), `packages/app/tests/services/run-storage.test.ts:981-988`; doc anchors `plugins/sp/skills/spur-dev/references/execution-workflow.md:157-161` and `plugins/sp/skills/spur-dev/references/cross-cutting.md:489-496`; live artifacts `.spur/run/1322-gate.log:2`, `.spur/run/1322-check-receipt.json:5`, `.spur/run/1322-base.sha:1`, `.spur/run/1322-failure-class.decision:3`, `.spur/run/1322-test-gate.status:1`, `.spur/run/1322-remediate-receipt.md:87`.
- `bun test tests/services/quality-gate-affected-scope.test.ts tests/workflow/actions/command-gate.test.ts` (packages/app) → **39 pass / 0 fail** (157 expect calls), exit 0.
- `bun test tests/services/quality-gate-receipt.test.ts tests/services/run-storage.test.ts` (packages/app) → **77 pass / 0 fail** (341 expect calls), exit 0.
- Post-remediation full gate: PASS, 12584 tests across 815 files, 0 fail (`.spur/run/1322-test-gate.status:1`; `.spur/run/1322-remediate-receipt.md:87`), same-digest receipt reuse live (`.spur/run/1322-gate.log:2`; `.spur/run/1322-check-receipt.json:5` — tier full, inputDigest 8cb785d2…).

##### Residual risk

- The P3 glob-shape gap (finding 1) is carried as a deferrable hardening item; it does not affect this repo's runs (supported globs) nor the boundary guarantee (the full gate certifies every PASS).
- No security findings: the log path is confined to `.spur/run/` via `resolveRunArtifactPath` before dispatch (`packages/app/src/workflow/actions/command-gate.ts:170-186`, escape test `packages/app/tests/workflow/actions/command-gate.test.ts:623`), matching resultFile confinement; no secrets handling, no new process surface (no engine FSM change per the closed design decision).
- Section-level disposition summary for this task stays at the disposition-derived level (a PASS carrying one DEFER-ed P3 and two ACCEPTED P4s); the captured certification answer derives HIGH because every requirement and AC row is MET on executable test/command evidence.

**Next:** no action required on task 1322 — the P3 stays DEFERred as a hardening follow-up outside the declared repo shape; the task is ready for the done gate.

**Verdict:** PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:02.321Z backlog → todo (system)
- 2026-11-10T18:32:42.707Z todo → wip (system)
- 2026-11-10T19:49:40.946Z wip → testing (system)
- 2026-11-10T19:52:55.999Z testing → done (system)

