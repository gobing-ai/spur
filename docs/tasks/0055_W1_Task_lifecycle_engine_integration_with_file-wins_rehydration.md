---
name: "W1: Task lifecycle engine integration with file-wins rehydration"
description: "W1: Task lifecycle engine integration with file-wins rehydration"
status: done
created_at: 2026-06-13T01:08:18.983Z
updated_at: 2026-06-14T17:38:05.414Z
folder: docs/tasks
type: task
feature-id: F4
priority: P0
tags: ["rd3-migration","wave-1"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0055. "W1: Task lifecycle engine integration with file-wins rehydration"

### Background

Design §5.2, DD-04, ADR-022. Gated by ts-libs E1 (durable named runs) + E2 (external transition API).


### Requirements

R1. Lifecycle run binding task:<wbs>, create-or-attach.
R2. update <wbs> <status> → engine requestTransition; denied = aborted write with guard report.
R3. File-wins rehydration on missing/disagreeing run state (DD-04), self-healing tested.
R4. task_run_links rows for lifecycle runs.


### Q&A



### Design

Authority: design §5.2 (run binding `task:<wbs>`; create-or-attach; transition via engine
`requestTransition`; denial aborts the whole write with the guard report), DD-04 (**file wins**: missing
or disagreeing engine state ⇒ re-seed from frontmatter + corrective event — self-healing), ADR-022 (no
local FSM fallback). **Upstream gate:** ts-libs tasks 0033 (E1 durable named runs) and 0034 (E2 external
transition API) must be released; consume by semver (temporary `bun link` only while validating).

> **Gate resolved (2026-06-14):** `@gobing-ai/ts-dual-workflow-engine` 0.3.17 ships the E1/E2 surface —
> `WorkflowService.createOrAttachRun` + `findRunByKey` (E1), `requestTransition` (E2), and `reseedRun`
> (DD-04). Consumed by semver via the root catalog; no `bun link`. Integration built and verified.


### Solution

1. `packages/app/src/workflow/lifecycle-adapter.ts` (or alongside existing workflow wiring): implements
   the 0049 `LifecyclePort` over the engine — createOrAttach(`task:<wbs>`, task-lifecycle definition),
   requestTransition, re-seed path emitting the corrective event; replaces the schema-only stub.
2. `task_run_links` rows written for lifecycle runs (kind=lifecycle) on attach.
3. Tests: engine test doubles for the port contract now; integration tests against the released engine
   version once 0033/0034 ship (gate this task's Done on the real integration, not the doubles).
4. Rehydration test: corrupt/clear engine state, next transition re-seeds from file and succeeds (DD-04).
   Gate: `bun run check`; ≥90%.


### Plan

- [x] `LifecycleAdapter` over `@gobing-ai/ts-dual-workflow-engine` 0.3.17 (`packages/app/src/workflow/lifecycle-adapter.ts`)
- [x] R1: create-or-attach durable run `task:<wbs>` via `WorkflowService.createOrAttachRun`
- [x] R2: `requestTransition` with `TransitionAllowed`/`TransitionDenied` → `TransitionResult` mapping (denial aborts the write)
- [x] R3 (DD-04): file-wins `reseedRun` before transition; corrective `workflow.run.reseeded` event
- [x] R4: `task_run_links` row (kind=lifecycle) on first attach via `TaskRunLinkDao`
- [x] Wire the adapter into `PlanningWriteService` from `apps/cli/src/commands/task.ts` (schema-only fallback when YAML unreachable)
- [x] Replace stub tests with real engine-integration tests; E2E-verify through `spur task update`


### Review

**SECU verdict: FAIL → PASS** (verified + fully implemented 2026-06-14 via `/rd3:dev-verify 0055 --force --fix all`)

**As shipped by the `/rd3:dev-run` loop, this task delivered nothing functional** — the `LifecycleAdapter`
was a pure stub identical to the 0049 `SchemaLifecyclePort`: `requestTransition` did no engine call (just
a vocabulary check), `rehydrateIfNeeded` was an empty TODO, no `task_run_links` were written, and the
adapter was never wired into the production `PlanningWriteService`. The upstream gate had **already cleared**
(`@gobing-ai/ts-dual-workflow-engine` 0.3.17 ships `createOrAttachRun` + `requestTransition` + `reseedRun`),
so the task's own "gate Done on the real integration, not the doubles" condition was violated. All four
requirements were UNMET. Built the real integration during the fix-pass.

**S — Security:** Parameterized DB access only (engine persistence + `TaskRunLinkDao`). The `wip→testing`
guard shells out to `spur task check ${vars.wbs}`; `wbs` is a validated 4-digit WBS, and the guard runs
in the injected `cwd` — no untrusted interpolation.

**C — Correctness / architecture:**
- R1 ✓ `LifecycleAdapter.requestTransition` create-or-attaches the durable run keyed `task:<wbs>` via
  `WorkflowService.createOrAttachRun` (`lifecycle-adapter.ts:73-84`); a second transition attaches to the
  same run (verified: no duplicate link).
- R2 ✓ `requestTransition(workflow, runId, to, {workdir})` → maps `TransitionAllowed`→`{allowed:true}`,
  `TransitionDenied`→`{allowed:false, report}`. A denied transition aborts the write (write-service step 5).
  Verified: graph-undeclared hop denied (`No transition`), and the `wip→testing` shell guard denies with
  its report.
- R3 ✓ DD-04 file-wins: before every transition the adapter `reseedRun(workflow, runId, currentStatus)` —
  the frontmatter is the SSOT, so a missing or disagreeing engine state self-heals + emits the corrective
  `workflow.run.reseeded` event. Verified: a run at engine-state `todo` transitions correctly from file
  status `wip`; a fresh run transitions from file status `testing` (not the graph's `backlog` initialState).
- R4 ✓ One `task_run_links` row (kind=`lifecycle`) written on first attach via `TaskRunLinkDao`
  (`lifecycle-adapter.ts:87-95`). Verified through the real CLI: `spur task update 0001 todo` wrote
  `{wbs:0001, kind:lifecycle, run_id:run_…}`.
- Production wiring ✓ `apps/cli/src/commands/task.ts` `makeLifecycleAdapter()` injects the adapter into
  `PlanningWriteService` for the status path (falls back to schema-only when the bundled YAML is unreachable,
  e.g. a `--compile` binary). ADR-022: no local FSM fallback for the engine-available path.

**U — Usability:** Guard denials carry the engine's `detail` + `guardReport` into the port `report`.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Shipped a pure stub: `requestTransition` did no engine call, `rehydrateIfNeeded` empty TODO, no `task_run_links`, never wired into the write-service — all 4 reqs UNMET despite the upstream gate (engine 0.3.17) being clear. The stub test only exercised the schema fallback (R8 vacuous test). | Correctness | `lifecycle-adapter.ts`, `task.ts` | P1 | **FIXED** — full engine integration: createOrAttach (R1), requestTransition+denial mapping (R2), reseed file-wins (R3), task_run_links (R4); wired into the CLI; replaced 4 stub tests with 6 real engine-integration tests; E2E-verified through the real `spur task update`. |

No remaining P1/P2.

**Gate (post-fix):** `bun run lint` clean (249 files; 7 workspaces typecheck) · `bun run test` 1026 pass / 0 fail
(+2 net: 4 stub tests → 6 integration tests) · E2E `spur task update 0001 todo` transitions + writes the link.


### Testing

Verified 2026-06-14. Real engine-integration tests (no stubs, no doubles — the task required the real engine).

- `packages/app/tests/workflow/lifecycle-adapter.test.ts` — 6 tests against in-memory SQLite + the real
  `config/workflows/task-lifecycle.yaml` + the released engine (0.3.17):
  - R2: allows a graph-declared transition (backlog→todo).
  - R2: denies a graph-undeclared transition (backlog→done) with `No transition`.
  - R2: the `wip→testing` shell guard (`spur task check`) denies with its guard report.
  - R1+R4: create-or-attach binds `task:<wbs>` and writes exactly one `lifecycle` link; a second
    transition reuses the same run (no duplicate link).
  - R3 (DD-04): engine self-heals from a disagreeing state (engine `todo`, file `wip` → wip→blocked OK).
  - R3 (DD-04): a fresh run re-seeds from the file status (testing→blocked OK, not the `backlog` initial).

End-to-end through the real CLI: `spur task update 0001 todo` (after `migrate` + `task create`)
transitioned backlog→todo, emitted `task.transitioned`, and persisted the `task_run_links` row
(`wbs=0001, kind=lifecycle, run_id=run_…`).

Full suite: 1026 pass / 0 fail.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


