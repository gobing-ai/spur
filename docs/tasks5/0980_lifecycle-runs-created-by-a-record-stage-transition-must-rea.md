---
schema_version: 1
name: Lifecycle runs created by a record-stage transition must reach a terminal status
status: done
template: feature-impl
created_at: 2026-09-27T07:11:01.671Z
updated_at: "2026-09-28T03:00:49.040Z"
feature_id: D3

ac_numbering: task-local
ac_altitude: task-local
priority: P1
estimate_hours: 3
---

## 0980. Lifecycle runs created by a record-stage transition must reach a terminal status

### Background

After the record stage of the 0965 run, the worktree DB held two orphaned lifecycle runs with **zero** child rows (`action_runs`/`phase_runs` 0):

```text
run_a5efe61b-…|task-lifecycle|running
run_3965776f-…|feature-lifecycle|running
```

The task had already moved `todo → wip` (pipeline `command.gate`, `--no-lifecycle`), then `testing` via `spur task record 0965 --solution-from-diff --transition testing`, and finally `done` (`--no-lifecycle`). Nothing closed either lifecycle run, and `task_run_links` was empty. The driver had to finalize both by hand (`--close --status failed --reason interrupted`) before WT-4a provenance persistence could run — the record-less rows also triggered the `persist-out` ENOENT in 0979.

Task 0622 R2 (feature D3) already required "lifecycle workflows reach a terminal state, and stop orphan accumulation recurring"; two fresh orphans in one run is that recurrence. Note `spur task record --transition` exposes no `--no-lifecycle` equivalent, so the FSM's own transition verb is the creator here.

**Refine corrections (2026-09-27)**

- A lifecycle row running while its task is at testing is expected; the defect is a row left running after the pipeline's later done transition bypasses lifecycle bookkeeping.
- The observed feature-lifecycle row may legitimately remain running while its feature is nonterminal; this task addresses the task-lifecycle row created by record.

### Requirements

- [x] R1. The task pipeline does not create a second task-lifecycle run when its record stage moves the task to testing. It still performs the target-aware testing gate.
- [x] R2. Standalone `spur task record --transition testing` retains its lifecycle behavior. A pipeline run that later marks the task done with `--no-lifecycle` leaves no new record-less lifecycle run behind.
- [x] R3. A regression test covers the pipeline's record and done commands and checks both task status and lifecycle-run rows.

### Acceptance Criteria

- [x] AC1 — A pipeline record transition reaches testing without creating a task-lifecycle row (req: R1)
- [x] AC2 — Standalone record transitions retain lifecycle behavior (req: R2)
- [x] AC3 — The pipeline reaches done without a new running lifecycle orphan (req: R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The pipeline's `task record --transition testing` currently constructs a lifecycle adapter, while its later `task update done --no-lifecycle` bypasses that adapter. A lifecycle row created by the former therefore remains `running` after the pipeline finishes. A `running` lifecycle row while a task is genuinely at `testing` is expected; the defect is the completed pipeline's orphan.

Add `--no-lifecycle` to the existing `task record` verb and pass it to the existing `makeService(context, folder, noLifecycle)` seam. Use the flag only in `config/workflows/task-pipeline.yaml`'s record command. The task service still runs its target-aware check when no lifecycle adapter is present. Keep standalone record's default unchanged. Check feature-lifecycle rows separately: the record-stage feature sync can create them, but this task only changes the task transition it owns.

### Plan

- [x] Reproduce the pipeline sequence: `task record --transition testing` followed by `task update done --no-lifecycle`; confirm the task-lifecycle row is `running` after done.
- [x] Add `--no-lifecycle` to `task record` and the pipeline's record command, using the existing `makeService` flag.
- [x] Test the pipeline path and the unchanged standalone path, including target-aware guard denial.
- [x] Run focused task-service/CLI tests and `bun run spur-check`.

### Solution

The pipeline's record stage called `spur task record --transition testing` without `--no-lifecycle`, so the CLI built a lifecycle FSM and spawned a nested `task-lifecycle` run that outlived the pipeline as a `running` orphan (the wip and done hops already passed `--no-lifecycle`).

- `config/workflows/task-pipeline.yaml:773` — the record-stage transition passes `--no-lifecycle`; the post-downgrade re-record (`config/workflows/task-pipeline.yaml:816`) does the same to keep the no-nested-lifecycle invariant.
- `apps/cli/src/commands/task.ts:1187` — `task record` gains `--no-lifecycle`; with it and `--transition`, the handler builds the same inline `TaskCheckService` gate `task update` uses (`apps/cli/src/commands/task.ts:1203`), so the target-aware `--as <target>` check is not lost with the FSM.
- `packages/app/src/services/task-record.ts:88` — `RecordOptions.checkGate`.
- `packages/app/src/services/task-service.ts:1502-1513` — `record` runs the gate after its section writes and before the status write, only on a real status change to testing/done (same-status re-records skip it, as the adapter would).
- `packages/app/src/services/task-transition.ts:106` — `runTransitionCheckGate` extracted from `transitionTaskGuarded` and shared by both callers (one message format, 0808 R3).
- Standalone `task record` without the flag is unchanged: the lifecycle port owns the transition (R2).
- `docs/help/cmd_task.md:260` — flag documented.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:773` record transition passes `--no-lifecycle`; inline target-aware gate `packages/app/src/services/task-service.ts:1502-1513` via `packages/app/src/services/task-transition.ts:106`; tests `packages/app/tests/services/task-record.test.ts:1548` / `:1608` / `:1635` (125 pass fresh) |
| R2 | MET | standalone path unchanged `packages/app/tests/services/task-record.test.ts:1666`; done hop `config/workflows/task-pipeline.yaml:836` leaves no orphan `packages/app/tests/services/task-record.test.ts:1579` |
| R3 | MET | record + done pipeline sequence checks status and lifecycle rows `packages/app/tests/services/task-record.test.ts:1548` / `:1579`; CLI sequence `apps/cli/tests/commands/task.test.ts:2191` (191 pass fresh); YAML pins `plugins/sp/tests/task-pipeline-resilience.test.ts:265`, `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:408` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/task-record.test.ts:1548` |
| AC2 | MET | test | `packages/app/tests/services/task-record.test.ts:1666` |
| AC3 | MET | test | `packages/app/tests/services/task-record.test.ts:1579`; `apps/cli/tests/commands/task.test.ts:2191` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0980

**Scope:** working-tree diff (task file uncommitted; 11 files) — `apps/cli/src/commands/task.ts`, `packages/app/src/services/task-record.ts`, `packages/app/src/services/task-service.ts`, `packages/app/src/services/task-transition.ts`, `config/workflows/task-pipeline.yaml`, `docs/help/cmd_task.md`, 4 test files
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | architecture | Inline gate-construction block duplicated between the update and record actions (~10 lines each: resolvePlanningFolders + TaskCheckService + loadSectionMatrix + makeTaskLocator); a shared `makeInlineCheckGate(context)` helper would collapse it | `apps/cli/src/commands/task.ts:603-616`, `apps/cli/src/commands/task.ts:1204-1216` |
| 2 | P4 (advisory) | correctness | `task record --no-lifecycle --transition done` probes the gate once for done; the intermediate auto-walk hop to testing is not probed. No material loss (done requires `Solution+Testing+Review`, a superset of testing's set) and the pipeline's done hop uses `task update`, not record | `packages/app/src/services/task-service.ts:1510-1512` |
| 3 | P4 (advisory) | correctness | Pre-existing, not introduced here: when the lifecycle adapter is unavailable for a reason other than the flag, record still loses the guard silently; the update path warns and gates inline. Follow-up candidate | `apps/cli/src/commands/task.ts:607-616` vs `apps/cli/src/commands/task.ts:1204` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:773` — record args carry `--no-lifecycle`; `apps/cli/src/commands/task.ts:1194` — `makeService(..., options.lifecycle === false)` builds no adapter (`apps/cli/src/commands/task.ts:1736-1747` — `noLifecycle` skips `makeLifecycleAdapter`); target-aware gate retained: `apps/cli/src/commands/task.ts:1204-1216` + `packages/app/src/services/task-service.ts:1510-1512`; zero-row proof: `packages/app/tests/services/task-record.test.ts:1548` |
| R2 | MET | `apps/cli/src/commands/task.ts:1194` — flag defaults off so standalone keeps the adapter; `packages/app/tests/services/task-record.test.ts:1666` — lifecycle port records `wip→testing` with no checkGate; `packages/app/tests/services/task-record.test.ts:1579` — done hop leaves `runs=0, links=0` |
| R3 | MET | `apps/cli/tests/commands/task.test.ts:2191` — replays the pipeline's record→done commands, asserts status testing then done; `packages/app/tests/services/task-record.test.ts:1548-1704` — probes `runs` + `task_run_links` rows through a real sqlite adapter. Note: status assertions live in the CLI suite, lifecycle-row assertions in the service suite (the CLI test's comment cross-references it) — combined coverage satisfies the requirement |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/task-record.test.ts:1548` — testing reached, gate called exactly once for the target, `runs=0, links=0` |
| AC2 | MET | test | `packages/app/tests/services/task-record.test.ts:1666` — standalone record routes `wip→testing` through the lifecycle port |
| AC3 | MET | test | `packages/app/tests/services/task-record.test.ts:1579` + `apps/cli/tests/commands/task.test.ts:2191` — done reached, no new lifecycle rows |

##### Design Conformance

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | 5/5 claims DONE — flag on record verb (`apps/cli/src/commands/task.ts:1186-1189`), makeService seam reused (`apps/cli/src/commands/task.ts:1194`, `apps/cli/src/commands/task.ts:1736-1747`), flag in the pipeline's record command (`config/workflows/task-pipeline.yaml:773`, same-flow post-downgrade re-record `:816` — both are record commands, so the "record command only" scope holds), target-aware check retained without the adapter (`packages/app/src/services/task-service.ts:1510-1512`), standalone default unchanged (AC2 test). Feature-lifecycle rows correctly left out of scope per the Refine correction 2026-09-27 |

##### SECUA Summary

- **Security:** PASS — boolean flag only, no new input surface, pipeline args static (`config/workflows/task-pipeline.yaml:773`).
- **Efficiency:** PASS — gate built only when flag+transition (`apps/cli/src/commands/task.ts:1204`); `loadSectionMatrix` is promise-cached per project root (`packages/app/src/services/section-matrix-loader.ts:55`).
- **Correctness:** PASS — `options.lifecycle === false` is precise under commander `--no-lifecycle` (defaults true); gate scope (`testing`/`done`, real status change only) mirrors `transitionTaskGuarded` (`packages/app/src/services/task-transition.ts:173`); denial preserves the status (`packages/app/tests/services/task-record.test.ts:1608`); same-status re-record skips the gate (`packages/app/tests/services/task-record.test.ts:1635`); the `runTransitionCheckGate` extraction is behavior-preserving — body moved verbatim, `transitionTaskGuarded` now delegates (`packages/app/src/services/task-transition.ts:106`, `:175`).
- **Usability:** PASS — help text explains the orphan rationale (`apps/cli/src/commands/task.ts:1186-1189`), docs row added (`docs/help/cmd_task.md:260`), denial names the `--as <target>` probe and lists findings (`packages/app/src/services/task-transition.ts:117-122`).

##### Residual Risk

- The three P4 advisories above; none block.
- Feature-lifecycle rows are intentionally out of scope (Refine correction 2026-09-27): the record-stage feature sync can still create them while the feature is nonterminal — expected, not an orphan of the task transition this task owns.
- The pipeline YAML itself was not executed end-to-end this run; coverage is at the CLI, service, and yaml-assertion layers (`packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:411`, `plugins/sp/tests/task-pipeline-resilience.test.ts:266`).

##### Final Disposition

PASS — blocker/major-free. Fresh evidence this run: `packages/app/tests/services/task-record.test.ts` 92 pass / 0 fail; `task-pipeline-proof-chain` + `task-pipeline-resilience` 47 pass / 0 fail; `apps/cli/tests/commands/task.test.ts` 191 pass / 0 fail; `bun run spur-check` 9348 pass / 0 fail across 539 files (lint clean, typecheck pass) plus `test-post-check` 2/2 rules pass, exit 0.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T16:45:11.215Z backlog → todo (system)
- 2026-09-28T00:26:40.150Z todo → wip (system)
- 2026-09-28T00:52:40.692Z wip → testing (system)
- 2026-09-28T00:52:53.816Z testing → done (system)

