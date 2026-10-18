---
schema_version: 1
name: wrapup-pipeline stops changing feature status and validates tasks with one typed gate
status: done
template: feature-impl
created_at: 2026-10-18T05:10:06.872Z
updated_at: "2026-10-18T19:32:22.769Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - wrapup
  - breaking

dependencies: ["1246", "1247"]
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1249-verdict.json
---

## 1249. wrapup-pipeline stops changing feature status and validates tasks with one typed gate

### Background

wrapup-pipeline (config/workflows/wrapup-pipeline.yaml, 780 lines) passed 101 of 160 runs since 2026-09. It failed at task-resolve→failed (25) and feature-transition→failed (11). task-pipeline's done close already performs record, the residual sweep and feature sync. Covers feature scenarios R5, R6 and R7. Design: docs/design/workflow-consolidation.md §3.3, ADR-142.

**Refine correction (2026-10-18, depth ready).**

- The typed resolver already exists. `spur task wrapup resolve` (apps/cli/src/commands/task/wrapup.ts) runs `resolveTasks` (packages/app/src/workflow/wrapup/steps.ts:136). It writes `<runId>-wrapup-tasks.json`, `<runId>-wrapup-resolve.status` (PASS/FAIL) and a reason file. On a validation FAIL it **exits 0**; only an empty `__runId` exits 1.
- The YAML wraps the verb in a shell with a `|| printf FAIL` fallback (lines 175-180). It then runs the drift probe, a `file.read.into-var` and route-reason (181-221). The filed R2 ("introduce a typed resolver") is therefore restated: the gap is the shell wrapper and the exit contract, not the resolver.
- `command.gate` derives PASS/FAIL/BLOCKED from the exit code alone and writes its `resultFile` (packages/app/src/workflow/actions/command-gate.ts:22-30). Under today's exit-0-on-FAIL contract it would overwrite the step's FAIL with PASS, so the exit contract must change with it.
- The feature write path has more parts than the two states:
  - the `feature`/`featureGateCmd` vars;
  - `preflightFeature` (steps.ts:241, the 1033 R2 pre-flight inside resolve);
  - `classifySync` and `runFeatureTransition` (steps.ts:535, 599);
  - the `feature-transition` op and `--feature`/`--feature-gate-cmd` flags on `spur task wrapup` (wrapup.ts:11, 51-52);
  - metrics-record's three-way routing on `$feature` (YAML lines 690-712).
- The filed R3 (no repeat of record/sweep/sync) is met once R1 lands. wrapup never ran record or the sweep. It is folded into R1.
- `/sp:dev-wrapall --feature` selects tasks *and* advances the feature (plugins/sp/skills/spur-dev/references/dev-operations.md:509-511). Selection stays; advancing goes.

### Requirements

- [x] R1. Remove the feature write path and leave no wrap-up state that writes task or feature status:
  - the `feature-transition` and `feature-verify` states and their edges;
  - the `feature` and `featureGateCmd` vars;
  - `preflightFeature`, `classifySync` and `runFeatureTransition`;
  - the `feature-transition` op and the `--feature`/`--feature-gate-cmd` flags of `spur task wrapup`.

  metrics-record routes PASS → branch-cleanup (merge=true) or done.
- [x] R2. task-resolve validates with one `command.gate` (`spur task wrapup resolve`, resultFile `<runId>-wrapup-resolve.status`), not a shell wrapper. `resolveTasks` exits 1 on a validation FAIL and keeps writing its reason file. A crash or timeout reads BLOCKED and routes to `failed`. A validated `[]` still routes to `skipped`.
- [x] R3. doc-sync, learnings-validate/append/repair, doc-tripwire, metrics-record and branch-cleanup keep their order, artifacts and outcomes:
  - doc-sync is one `agent.run` through the run's executor;
  - learnings-validate, learnings-append and repair are unchanged;
  - doc-tripwire, metrics-record and branch-cleanup are unchanged.

  The drift probe and route-reason remain.
- [x] R4. The definition is at most 250 lines including comments.
- [x] R5. `/sp:dev-wrap`, `/sp:dev-wrapall` and the dev-operations wrap/wrapall rows stop passing `feature`. `--feature` on wrapall only selects tasks and names `spur feature sync <id>` as the follow-up. The spur-cli tasks.md `wrapup <op>` row drops the removed op and flags.

Out of scope:
- The drift-probe and route-reason logic.
- The doc-sync prompt.
- Learnings shape rules.
- task-pipeline.
- Historical docs/plans.
- The broader skill sweep (1252).

### Acceptance Criteria

- [x] AC1 — wrapup-pipeline never changes feature status (req: R1, R5)
- [x] AC2 — wrapup-pipeline validates its task list with one typed gate (req: R2)
- [x] AC3 — wrapup-pipeline keeps doc sync, the doc tripwire, metrics and the branch cleanup pause (req: R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-18T05:48:21.900Z

- Q: Introduce an `EMPTY` resolve status for the skip edge? A: No. The skip already keys on the validated capture length (`jq length … -eq 0`). That is the only skip proof, and a new status value adds a second one.
- Q: Convert drift-probe and route-reason to `command.gate` too? A: No. They are routing glue that already fails safe. The line budget comes from deleting the feature path and condensing comments.
- Q: Keep a deprecated `--feature` on `spur task wrapup` for old callers? A: No. The verb is workflow-internal (tasks.md:54), and its only caller is this YAML. A seeded old wrapup-pipeline copy is the 1251/1252 seeded-copy note.

### Design

Chosen: wrap-up owns post-task knowledge work only, and feature state belongs to feature-lifecycle (ADR-142). The forward hop is `feature sync` from task-pipeline's done close (1247). The resolver keeps its status-file protocol, and only its exit code becomes the gate signal.

Rejected:
- A soft feature-transition: it was the second-largest failure edge and a second writer.
- A combined `resolve+route` op: it widens a working verb for no failure-rate gain.

Invariant: a wrap-up run never changes any task or feature status.

File targets:
- config/workflows/wrapup-pipeline.yaml — the rewrite, version "12". Bundle copies via `bun run --filter @gobing-ai/spur build:bundle`.
- packages/app/src/workflow/wrapup/steps.ts:
  - `resolveTasks` `writeFail` returns `exitCode: 1`;
  - delete `preflightFeature`, `classifySync` and `runFeatureTransition`, and the `feature-transition` member of `WRAPUP_STEP_OPS`.
- packages/app/src/workflow/pipeline-steps.ts and packages/app/src/index.ts — drop the removed exports.
- apps/cli/src/commands/task/wrapup.ts — drop the op and the `--feature`/`--feature-gate-cmd` options and their help lines.
- packages/app/src/services/feature-sync-suppression.ts:6 — the comment names only the task-pipeline caller.
- Tests:
  - packages/app/tests/workflow/wrapup-pipeline.test.ts;
  - packages/app/tests/workflow/wrapup/steps.test.ts;
  - apps/cli/tests/commands/task/wrapup.test.ts;
  - apps/cli/tests/script-absorption-pr5-parity.test.ts plus fixtures/script-absorption-pr5/cases.ts — remove the feature-transition cases and flip the FAIL exit expectation.
- plugins/sp/commands/dev-wrap.md, dev-wrapall.md, plugins/sp/skills/spur-dev/references/dev-operations.md:495-511, execution-batch.md:464-486, 653, plugins/sp/skills/spur-cli/references/tasks.md:54.

Anti-patterns:
- No new `spur task wrapup` op.
- No new var.
- Do not weaken doc-tripwire or the 1147 scope checks.
- Do not touch packages/app/src/services/feature-transition.ts; it serves `feature update`, not wrap-up.

Handoffs:
- 1247 is the forward feature hop.
- 1248 owns the branch-cleanup operator pause on host runs.
- 1252 sweeps the remaining docs/03, satellites and the CHANGELOG `BREAKING CHANGE` (removed `--feature` var).

Execution budget: about 8h. Persisted artifacts: the YAML, steps.ts, tests and skill diffs. requireDiff: yes.

### Plan

- [x] Write the failing E2E in packages/app/tests/workflow/wrapup-pipeline.test.ts: wrap a done task of a fixture feature, and assert the feature status is unchanged and the run ends `done`.
- [x] Write the failing gate cases: malformed list, unknown WBS and non-done task → `failed` via exit 1; empty list → `skipped`; crash → BLOCKED → `failed`.
- [x] Add a line-count assertion (≤250) and an assertion that no state id or var named `feature*` exists.
- [x] Change `resolveTasks` to exit 1 on FAIL, delete the feature-path steps and op, and update the CLI flags and help.
- [x] Rewrite wrapup-pipeline.yaml to the reduced shape, with task-resolve as a `command.gate`.
- [x] Update dev-wrap, dev-wrapall, dev-operations, execution-batch and spur-cli tasks.md.
- [x] Run build:bundle, then the targeted tests (packages/app wrapup tests, apps/cli task/wrapup + parity), then `bun run spur-check`.

### Solution

1249 removes wrap-up's feature write path and replaces the task-resolve shell wrapper with one typed gate (ADR-142, docs/design/workflow-consolidation.md §3.3). The interrupted prior pass had already written most test changes; this pass finished the source, the YAML and the docs, and corrected three defects it left behind.

**Workflow definition — `config/workflows/wrapup-pipeline.yaml` (rewritten; `version: "12"`; 248 lines, within R4's 250)**

- R1: deleted the `feature-transition` and `feature-verify` states, their edges and the `feature`/`featureGateCmd` vars. `metrics-record` now routes PASS → `branch-cleanup` (merge=true) or `done` (`config/workflows/wrapup-pipeline.yaml:244-246`). No state id or var starts with `feature`.
- R2: `task-resolve` validates through ONE `command.gate` on `spur task wrapup resolve` with `resultFile: .spur/run/<runId>-wrapup-resolve.status` and `softFail: true` (`config/workflows/wrapup-pipeline.yaml:68-74`). The exit code is the signal: the FAIL and BLOCKED edges precede the route edges (`config/workflows/wrapup-pipeline.yaml:226-231`), a validated `[]` still routes to `skipped`, and a crash/timeout reads BLOCKED → `failed`.
- The `route-reason` writer no longer clobbers a recorded gate outcome: it writes FAIL only when the gate wrote PASS (`config/workflows/wrapup-pipeline.yaml:88`). Without this, a route-reason failure overwrote the gate's BLOCKED token and the crash case read FAIL.
- R3: doc-sync, learnings-validate/append/repair, doc-tripwire, metrics-record and branch-cleanup keep their order, artifacts and outcomes; the drift probe and route-reason remain.

**App — `packages/app/src/workflow/wrapup/steps.ts`**

- `resolveTasks`'s `writeFail` returns `exitCode: 1` (`packages/app/src/workflow/wrapup/steps.ts:147`) — the gate's FAIL signal.
- Deleted `preflightFeature`, `classifySync`, `runFeatureTransition`, their result types and the `feature-transition` member of `WRAPUP_STEP_OPS` (`packages/app/src/workflow/wrapup/steps.ts:602`); `WrapupStepsEnv` dropped `feature`/`featureGateCmd`.
- `packages/app/src/workflow/pipeline-steps.ts:48-52` — dropped the removed re-exports.
- `packages/app/src/services/feature-sync-suppression.ts:5` — the comment now names only the task-pipeline `record` caller.

**CLI — `apps/cli/src/commands/task/wrapup.ts:7-46`** — the op list dropped feature-transition and the option block dropped the two feature flags; the usage env list is now `__runId`, `tasks`, `mode`, `spurBin`.

**R5 docs** — `plugins/sp/commands/dev-wrap.md`, `plugins/sp/commands/dev-wrapall.md` (description, `--feature` = selection only plus a `spur feature sync <id>` follow-up, vars snippet), `plugins/sp/skills/spur-dev/references/dev-operations.md` §14/§15, `plugins/sp/skills/spur-dev/references/execution-batch.md` §3.3c and its 0411 row and the feature-lifecycle done-boundary sentence, `plugins/sp/skills/spur-cli/references/tasks.md:54`, and `docs/help/cmd_task.md` — the CLI-doc parity surface where the removed flags were also documented (its parity test fails without the update).

**Tests** — completed and corrected the prior pass's changes:

- `packages/app/tests/workflow/wrapup-pipeline.test.ts` — the 1249 E2E table (done/malformed/unknown-wbs/unfinished-task/empty/crash → done/failed/skipped, with the PASS/FAIL/BLOCKED token, the unchanged feature file and the `command.gate` action row), version 12, the `command.gate` shape pin, the ≤250-line and no-`feature*` pins. Corrected a wrong `shells[1]` → `shells[2]` index for the supersession check and replaced the stale `0783 R5` assertion (`cannot convert a failed sync into`, which R1 deletes) with the new truth.
- `packages/app/tests/workflow/wrapup/steps.test.ts` — resolve FAIL now exits 1 in all three places (the prior pass missed the shape-table case).
- `apps/cli/tests/script-absorption-pr5-parity.test.ts` — the usage-line divergence now spans the whole line, including the changed env suffix.
- `apps/cli/tests/fixtures/script-absorption-pr5/cases.ts` — the feature-transition and preflight cases removed.

**Deliberate deviations and residuals**

- Plan step 7 runs `bun run spur-check` (the task's own Plan) even though `sp-code-implementation` prefers leaving the full gate to the pipeline's `test` hop. Both failures it reports are pre-existing and reproduce at HEAD (see Testing).
- `plugins/sp/skills/spur-dev/references/execution-worktree-setup.md:212` still names the deleted `preflightFeature`. It is outside this task's declared file targets, so it is left for 1252 (the broader skill sweep).
- Implement scope-guard risk (not introduced here): the task's Design lists its file targets in prose, so `extractTaskScopeAllowlist` (`packages/app/src/workflow/actions/agent-run.ts:2168`) yields only `command.gate`/`agent.run` — every real changed file reads as out-of-scope on a subprocess dispatch. The host-executor surface returns before that guard (`packages/app/src/workflow/actions/agent-run.ts:512-564`), so an inline run is unaffected; a subprocess run of this WBS needs `--vars '{"implementScopeGuard":"off"}'`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | config/workflows/wrapup-pipeline.yaml:245-246 (metrics-record routes PASS → branch-cleanup merge=true / done; no feature-transition/feature-verify states or feature/featureGateCmd vars anywhere in the file); packages/app/src/workflow/wrapup/steps.ts:602 (WRAPUP_STEP_OPS lacks feature-transition; preflightFeature/classifySync/runFeatureTransition deleted); packages/app/src/workflow/pipeline-steps.ts:38-52 (re-exports dropped); apps/cli/src/commands/task/wrapup.ts:7-46 (op list and --feature/--feature-gate-cmd flags removed) |
| R2 | MET | config/workflows/wrapup-pipeline.yaml:68-74 (one command.gate on `spur task wrapup resolve`, resultFile <runId>-wrapup-resolve.status, softFail); packages/app/src/workflow/wrapup/steps.ts:147 (writeFail returns exitCode: 1, reason file still written first); packages/app/src/workflow/actions/command-gate.ts:29-33 (exit≠0/1 → BLOCKED); config/workflows/wrapup-pipeline.yaml:226-228 (FAIL and BLOCKED edges → failed precede the [] → skipped edge); tests pass: 86/86 packages/app, 39/39 apps/cli |
| R3 | MET | config/workflows/wrapup-pipeline.yaml:94-138 (doc-sync one agent.run + unchanged scope/supersession checks), :140-172 (learnings-validate/append/repair unchanged), :174-183 (doc-tripwire unchanged), :185-205 (metrics-record, branch-cleanup hitl.confirm unchanged); order preserved in transitions config/workflows/wrapup-pipeline.yaml:237-248; drift probe and route-reason remain at config/workflows/wrapup-pipeline.yaml:76-91 |
| R4 | MET | wc -l config/workflows/wrapup-pipeline.yaml = 248 ≤ 250 |
| R5 | MET | plugins/sp/commands/dev-wrap.md:2 and plugins/sp/commands/dev-wrapall.md:17 (--feature = selection only + spur feature sync follow-up; feature var dropped from the vars snippet); plugins/sp/skills/spur-dev/references/dev-operations.md:492-513 (wrap/wrapall rows drop feature passing); plugins/sp/skills/spur-dev/references/execution-batch.md:115-116,465-486,652; plugins/sp/skills/spur-cli/references/tasks.md:54 (wrapup row drops feature-transition op and both flags); docs/help/cmd_task.md:23,324-336 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — wrapup-pipeline never changes feature status (req: R1, R5) | MET | test | No state or var writes feature status: config/workflows/wrapup-pipeline.yaml:54-248 (no feature* state/edge/var); start-state note config/workflows/wrapup-pipeline.yaml:57-60; E2E asserts the fixture feature file is unchanged and the run ends done — packages/app/tests/workflow/wrapup-pipeline.test.ts (86/86 pass) |
| AC2 — wrapup-pipeline validates its task list with one typed gate (req: R2) | MET | test | config/workflows/wrapup-pipeline.yaml:68-74 single command.gate; steps.ts:147 exit 1 on FAIL; malformed/unknown-wbs/non-done → failed, [] → skipped, crash → BLOCKED → failed covered in packages/app/tests/workflow/wrapup-pipeline.test.ts and apps/cli/tests/commands/task/wrapup.test.ts (1249 case: validation failure exits 1, removed feature op refused) |
| AC3 — wrapup-pipeline keeps doc sync, the doc tripwire, metrics and the branch cleanup pause (req: R3, R4) | MET | test | Order/artifacts/outcomes preserved per R3 evidence rows; branch-cleanup stays hitl.confirm consent-only (config/workflows/wrapup-pipeline.yaml:194-205); 248 lines ≤ 250 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

# Review — 1249 wrapup-pipeline stops changing feature status and validates tasks with one typed gate

Dimensions: functional traceability + SECUA + architecture (focus all), --auto.

## Findings

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | packages/app/src/workflow/wrapup/spur-command.ts:16-20 | `childEnv` doc comment still named the removed `featureGateCmd` and `$feature`/`--feature` as its example. No behavior; a stale reference to symbols R1 deleted, not a requirement gap — R1 targets status-writing state, not comments. | FIXED |
| P4 | packages/app/src/workflow/wrapup/steps.ts:2 | Module header still read "deterministic wrap-up capture, metrics and feature sync" — same stale-reference class as the `childEnv` row, in a file R1 already rewrote. | FIXED |
| P4 | plugins/sp/skills/spur-dev/references/execution-worktree-setup.md:210-214 | Carried residual (declared in Solution, deferred to 1252 by design): still names the deleted `preflightFeature`. Outside this task's declared file targets. | DEFER(1252) |

No P1–P3 findings. SECUA: the only `sh -c` surface (`docTripwireCmd`,
config/workflows/wrapup-pipeline.yaml:48) is unchanged and trusted-config-only; the diff is
dominantly deletion (338+/1669-), removing the feature write path without touching
packages/app/src/services/feature-transition.ts (out-of-scope file verified untouched).
Architecture: the rewrite honors ADR-142 — wrap-up owns post-task knowledge work only;
feature state moved to feature-lifecycle (1247 forward hop).

## Verification run in this review

- (cd packages/app && bun test tests/workflow/wrapup-pipeline.test.ts tests/workflow/wrapup/steps.test.ts) → 86 pass, 0 fail
- (cd apps/cli && bun test tests/commands/task/wrapup.test.ts tests/script-absorption-pr5-parity.test.ts) → 39 pass, 0 fail
- bunx biome check on the changed source files → clean
- wc -l config/workflows/wrapup-pipeline.yaml → 248 (≤ 250, R4)
- rg for `feature-transition|featureGateCmd|preflightFeature|classifySync|runFeatureTransition`
  over the YAML, workflow sources, CLI command and R5 doc surfaces → only the stale
  spur-command.ts comment (P4 above) and the out-of-scope services/feature-transition.ts export.
- apps/cli/config bundle copy of wrapup-pipeline.yaml is in sync with config/ (build:bundle ran).

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | PASS | config/workflows/wrapup-pipeline.yaml:245-246 (metrics-record routes PASS → branch-cleanup merge=true / done; no feature-transition/feature-verify states or feature/featureGateCmd vars anywhere in the file); packages/app/src/workflow/wrapup/steps.ts:602 (WRAPUP_STEP_OPS lacks feature-transition; preflightFeature/classifySync/runFeatureTransition deleted); packages/app/src/workflow/pipeline-steps.ts:38-52 (re-exports dropped); apps/cli/src/commands/task/wrapup.ts:7-46 (op list and --feature/--feature-gate-cmd flags removed) |
| R2 | PASS | config/workflows/wrapup-pipeline.yaml:68-74 (one command.gate on `spur task wrapup resolve`, resultFile <runId>-wrapup-resolve.status, softFail); packages/app/src/workflow/wrapup/steps.ts:147 (writeFail returns exitCode: 1, reason file still written first); packages/app/src/workflow/actions/command-gate.ts:29-33 (exit≠0/1 → BLOCKED); config/workflows/wrapup-pipeline.yaml:226-228 (FAIL and BLOCKED edges → failed precede the [] → skipped edge); tests pass: 86/86 packages/app, 39/39 apps/cli |
| R3 | PASS | config/workflows/wrapup-pipeline.yaml:94-138 (doc-sync one agent.run + unchanged scope/supersession checks), :140-172 (learnings-validate/append/repair unchanged), :174-183 (doc-tripwire unchanged), :185-205 (metrics-record, branch-cleanup hitl.confirm unchanged); order preserved in transitions config/workflows/wrapup-pipeline.yaml:237-248; drift probe and route-reason remain at config/workflows/wrapup-pipeline.yaml:76-91 |
| R4 | PASS | wc -l config/workflows/wrapup-pipeline.yaml = 248 ≤ 250 |
| R5 | PASS | plugins/sp/commands/dev-wrap.md:2 and plugins/sp/commands/dev-wrapall.md:17 (--feature = selection only + spur feature sync follow-up; feature var dropped from the vars snippet); plugins/sp/skills/spur-dev/references/dev-operations.md:492-513 (wrap/wrapall rows drop feature passing); plugins/sp/skills/spur-dev/references/execution-batch.md:115-116,465-486,652; plugins/sp/skills/spur-cli/references/tasks.md:54 (wrapup row drops feature-transition op and both flags); docs/help/cmd_task.md:23,324-336 |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 (feature scenario R5 — wrapup-pipeline never changes feature status) | PASS | code + test | No state or var writes feature status: config/workflows/wrapup-pipeline.yaml:54-248 (no feature* state/edge/var); start-state note config/workflows/wrapup-pipeline.yaml:57-60; E2E asserts the fixture feature file is unchanged and the run ends done — packages/app/tests/workflow/wrapup-pipeline.test.ts (86/86 pass) |
| AC2 (feature scenario R6 — validates its task list with one typed gate) | PASS | code + test | config/workflows/wrapup-pipeline.yaml:68-74 single command.gate; steps.ts:147 exit 1 on FAIL; malformed/unknown-wbs/non-done → failed, [] → skipped, crash → BLOCKED → failed covered in packages/app/tests/workflow/wrapup-pipeline.test.ts and apps/cli/tests/commands/task/wrapup.test.ts (1249 case: validation failure exits 1, removed feature op refused) |
| AC3 (feature scenario R7 — keeps doc sync, the doc tripwire, metrics and the branch cleanup pause) | PASS | code + test | Order/artifacts/outcomes preserved per R3 evidence rows; branch-cleanup stays hitl.confirm consent-only (config/workflows/wrapup-pipeline.yaml:194-205); 248 lines ≤ 250 |

Confidence: MEDIUM

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)
- 2026-10-18T19:21:06.779Z todo → wip (system)
- 2026-10-18T19:32:19.500Z wip → testing (system)
- 2026-10-18T19:32:22.760Z testing → done (system)

