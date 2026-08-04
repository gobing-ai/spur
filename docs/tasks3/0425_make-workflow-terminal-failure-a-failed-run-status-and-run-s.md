---
template: feature-impl
schema_version: 1
name: "Make workflow terminal failure a failed run status and run-scope shared .spur/run artifacts"
description: ""
status: done
type: task
profile: standard
feature_id: F5
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-04T07:17:48.317Z"
updated_at: "2026-08-04T17:53:47.438Z"
---

## 0425. Make workflow terminal failure a failed run status and run-scope shared .spur/run artifacts

### Background
Two defects surfaced by the 2026-08-04 comprehensive review of `config/workflows/*` (ADR-044).
Both fail **silently and in the unsafe direction**, and both live at the engine/CLI seam rather
than in any individual workflow YAML — patching the ten YAML files would paper over them.

#### B1 — a pipeline that routes to `failed` reports success

`StateMachineDriver` finalizes every declared terminal state through `lifecycle.done()`:

```ts
// node_modules/@gobing-ai/ts-dual-workflow-engine/src/state-machine.ts:127
if (terminal.has(current.id) || outbound.length === 0) {
    return await lifecycle.done(current.id, transitionsTaken);
}
```

So a `task-pipeline` run whose verify verdict is FAIL correctly routes `verify → failed`, and then
reports `status: "done"`, `finalState: "failed"` — and `apps/cli/src/commands/workflow.ts:393`
(`setExitCode(result.status === 'done' ? 0 : 1)`) exits **0**. Every batch driver, CI wrapper and
`&&` chain reads exit codes; a fail-closed pipeline that exits 0 is a silent-success hazard exactly
where the design took the most care to be fail-closed. Affects all seven pipelines that declare a
`failed` and/or `cancelled` terminal.

#### B2 — shared `.spur/run/` artifacts collide across concurrent runs

Artifact paths that are not entity-scoped are fixed strings, so two concurrent runs of the same
workflow share one status file and one attempt counter — one run's red gate can satisfy the other's
PASS guard:

| Workflow | Colliding paths |
| --- | --- |
| `basic.yaml` | `.spur/run/basic-gate.status`, `.spur/run/basic-fix-attempt` |
| `feature-dev.yaml` | `.spur/run/feature-dev-precheck.status` |
| `planning-pipeline.yaml` | `.spur/run/plan-precheck.status` |
| `idea-pipeline.yaml` | the whole `.spur/run/idea-*` set (eval report, needs-design, retry counters, batch sentinels) |

`idea-pipeline` already archives and resets these at `start`, which is an admission that the paths
are singleton-only. `/sp:dev-parallel` is safe today only because it fans out `task-pipeline`, whose
artifacts are `<wbs>`-scoped — a property nothing declares or enforces.

`__runId` is already injected into every run's vars by `WorkflowAppService.run()` (task 0366 R8) and
survives pause/resume via the effective-vars snapshot, so B2 needs no new plumbing.
### Requirements
- [x] R1. The workflow schema partitions terminal states into success and failure outcomes. Chosen
  shape is an authoring decision (`failureStates: [...]` alongside `terminalStates`, or a per-state
  `outcome: success|failure`); it must be declarative configuration, not driver logic (ADR-022), and
  must be backward compatible — a workflow declaring no failure terminals behaves exactly as today.
- [x] R2. `StateMachineDriver` finalizes a failure terminal via `lifecycle.fail()` (not
  `lifecycle.done()`), so `WorkflowRunResult.status`, the persisted run row, the
  `workflow.run.failed` event and the CLI exit code all agree. `reason` carries the terminal state
  identity. The engine lives in `@gobing-ai/ts-dual-workflow-engine`; prefer fixing it upstream in
  `~/xprojects/ts-libs/` over a Spur-side workaround (AGENTS.md deps rule).
- [x] R3. `config/workflows/*.yaml` declare their failure terminals: `failed` and `cancelled` in
  `task-pipeline`, `docs-pipeline`, `wayfinder-resolution`, `planning-pipeline`, `idea-pipeline`;
  `failed` in `basic`, `feature-dev`. `wrapup-pipeline`'s `skipped` and `task-lifecycle` /
  `feature-lifecycle`'s `cancelled` stay **success** terminals — they are legitimate outcomes, not
  failures.
- [x] R4. Non-entity-scoped `.spur/run/` artifact paths in `basic.yaml`, `feature-dev.yaml`,
  `planning-pipeline.yaml` and `idea-pipeline.yaml` are `${vars.__runId}`-scoped, with `__runId: ""`
  declared in each workflow's `vars` (undeclared vars throw at interpolation). Entity-scoped paths
  (`.spur/run/<wbs>-*`) are unchanged.
- [x] R5. Post-mortem debuggability is preserved: an operator can still locate a finished run's
  artifacts without reading the DB (documented convention, and/or a stable `latest` pointer). This
  is the one benefit the current fixed paths actually provide; do not lose it silently.
- [x] R6. Reader contract updated in lockstep: `plugins/sp/skills/spur-cli/references/workflows.md`
  and `.../workflows/operations.md` currently instruct readers to assert `status === 'done' AND
  finalState === <expected>`. Once R2 lands, `status` alone is authoritative for pass/fail; the
  guidance must say so rather than leaving two contradictory rules in circulation.
### Acceptance Criteria
```gherkin
Scenario: R1/R2 — a pipeline routing to its failure terminal reports a failed run
  Given a state-machine workflow that declares "failed" as a failure terminal
  When a run transitions into "failed"
  Then the WorkflowRunResult status is "failed" and finalState is "failed"
  And the persisted run row status is "failed"
  And a workflow.run.failed event is emitted carrying the terminal state as the reason

Scenario: R1 — workflows without a declared failure terminal are unaffected
  Given a state-machine workflow that declares only terminalStates
  When a run reaches any terminal state
  Then the run status is "done" exactly as before the change

Scenario: R2 — the CLI exit code agrees with the run status
  When "spur workflow run <pipeline>" lands in a failure terminal
  Then the process exits non-zero
  And "--json" output reports status "failed"

Scenario: R3 — legitimate non-failure terminals stay successful
  When a wrapup-pipeline run resolves an empty task list and reaches "skipped"
  Then the run status is "done" and the process exits 0

Scenario: R4 — concurrent runs of one workflow do not share gate artifacts
  Given two concurrent runs of basic.yaml with different quality-gate outcomes
  When both runs write their gate status and fix-attempt counters
  Then each run reads back only its own values
  And neither run's transition is decided by the other run's artifact

Scenario: R6 — the documented reader contract matches the implementation
  When the spur-cli workflow references describe how to judge a run
  Then they state that "status" is authoritative for pass/fail
  And no reference still instructs readers to treat a "failed" finalState as a done run
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Seam choice

Both defects are fixed at the **engine/schema seam**, not per-YAML.

For B1 the per-YAML alternative — give every `failed` state an `onEnter` shell that exits non-zero —
does produce a failed run, and was deliberately rejected in ADR-044: it conflates "the run reached
its declared failure terminal" with "an action broke", discards the terminal state's identity and
the `reason` string, and adds a shell hop to ten files that must then never drift. Which terminals
mean failure is workflow *configuration* (ADR-022 "orchestration is configuration"), so it belongs
in the schema.

#### R1/R2 — failure terminals

```yaml
terminalStates: [done, failed, cancelled]
failureStates: [failed, cancelled]     # ⊆ terminalStates; absent ⇒ today's behavior
```

Driver change is one branch at `state-machine.ts:127`:

```ts
if (terminal.has(current.id) || outbound.length === 0) {
    return failure.has(current.id)
        ? await lifecycle.fail(current.id, transitionsTaken, `terminal:${current.id}`)
        : await lifecycle.done(current.id, transitionsTaken);
}
```

`lifecycle.fail()` already writes `savePhase(..., 'failed')` + `finalizeRun(..., 'failed')` and
emits `workflow.run.failed`, and `WorkflowService.stampFailureReason` already persists `reason` into
`metadata_json` — so `workflow trace` surfaces `terminal:failed` with no extra work. Validation must
reject a `failureStates` entry that is not in `terminalStates`.

Engine ownership: `@gobing-ai/ts-dual-workflow-engine` is an external package under
`~/xprojects/ts-libs/`. Fix upstream, release, bump the catalog pin — a `bun link` only while
validating (AGENTS.md deps rule). The schema copy at
`apps/cli/schemas/state-machine-workflow.schema.json` moves in the same change.

#### R4 — run-scoped artifacts

Mechanical: declare `__runId: ""` in each affected workflow's `vars` (the engine throws on an
undeclared `${vars.X}`), then rewrite the fixed path segments:

| Before | After |
| --- | --- |
| `.spur/run/basic-gate.status` | `.spur/run/${vars.__runId}-basic-gate.status` |
| `.spur/run/basic-fix-attempt` | `.spur/run/${vars.__runId}-basic-fix-attempt` |
| `.spur/run/feature-dev-precheck.status` | `.spur/run/${vars.__runId}-feature-dev-precheck.status` |
| `.spur/run/plan-precheck.status` | `.spur/run/${vars.__runId}-plan-precheck.status` |
| `.spur/run/idea-*` | `.spur/run/${vars.__runId}-idea-*` |

`__runId` is injected by `WorkflowAppService.run()` and restored on resume from the effective-vars
snapshot, so paths stay stable across a HITL pause. A direct `spur workflow run` of a file always
gets one (`opts.runId ?? crypto.randomUUID()`); guard the `""` default so a bare-engine invocation
degrades to today's unprefixed name rather than writing `-basic-gate.status`.

Once paths are run-scoped, `idea-pipeline`'s archive-and-reset block in `start` becomes dead weight
and should be deleted in the same change — it exists only to work around the collision.

#### R5 — debuggability

Run-scoped names cost the `cat .spur/run/idea-eval-report.md` reflex. Cheapest replacement is a
per-workflow `latest` symlink written by the first artifact step; if that proves fiddly under
concurrency, document `spur workflow trace <runId>` as the entry point and accept the loss. Decide
during implementation — do not drop R5 silently.
### Plan
1. **Upstream engine (R1/R2)** — in `~/xprojects/ts-libs/packages/dual-workflow-engine`: add
   `failureStates` to the schema + `StateMachineWorkflowDef` type, validate `failureStates ⊆
   terminalStates`, branch `lifecycle.fail` at `state-machine.ts:127`. Unit tests: failure terminal
   → `status: failed`; no `failureStates` → unchanged; invalid subset → validation error. Release,
   bump the pin in the root `workspaces.catalog`.
2. **Schema copy** — mirror `failureStates` into `apps/cli/schemas/state-machine-workflow.schema.json`.
3. **Declare failure terminals (R3)** — `config/workflows/*.yaml` per R3's split. Re-run
   `spur workflow validate` on all ten.
4. **Exit-code check (R2)** — confirm `apps/cli/src/commands/workflow.ts` needs no change (it
   already keys off `result.status`); add a CLI test that a failure-terminal run exits non-zero.
5. **Run-scope artifacts (R4)** — declare `__runId`, rewrite paths per the Design table, delete
   `idea-pipeline`'s now-dead archive/reset block. Re-validate + dry-run each touched workflow.
6. **Debuggability (R5)** — implement the chosen pointer, or document `spur workflow trace` as the
   entry point in `docs/help/cmd_workflow.md`.
7. **Reader contract (R6)** — update `plugins/sp/skills/spur-cli/references/workflows.md` and
   `.../workflows/operations.md`; check `plugins/sp/tests/skill-structure.test.ts` for assertions
   that pin the old wording.
8. **Concurrency regression test (R4)** — two concurrent `basic.yaml` runs with opposite gate
   outcomes; assert each reads back only its own artifacts.
9. `bun run autofix && bun run spur-check`, `bun run test`, `bun run test-cf`.
### Solution
**Upstream** `@gobing-ai/ts-dual-workflow-engine@0.4.18` (ts-libs): optional `failureStates` on schema/type/validate; `StateMachineDriver` finalizes failure terminals via `lifecycle.fail` with `reason: terminal:<id>`; shell guards honor run `workdir` (relative `.spur/run/*`). Catalog pin: `package.json` `workspaces.catalog["@gobing-ai/ts-dual-workflow-engine"]` → `^0.4.18` (no bun-link).

**Schema copy:** `apps/cli/schemas/state-machine-workflow.schema.json:16` — `failureStates` array (wired through `apps/cli/src/config/embedded-schemas.ts:19`).

**R3 — failure terminals declared**
- `config/workflows/task-pipeline.yaml:46` — `failureStates: [failed, cancelled]` (same split on docs/wayfinder/planning/idea)
- `config/workflows/basic.yaml:22` — `failureStates: [failed]` (same on feature-dev)
- wrapup / task-lifecycle / feature-lifecycle — no `failureStates` (`skipped`/`cancelled` stay success)

**R4 — run-scoped artifacts**
- `config/workflows/basic.yaml:34` — `__runId: ""`; paths at `basic.yaml:47,58,76,104` use `${vars.__runId}-basic-*`
- `config/workflows/feature-dev.yaml` / `planning-pipeline.yaml` / `idea-pipeline.yaml:67,85` — same `__runId` prefix pattern; idea start archive/reset removed

**R2 exit (already correct):** `apps/cli/src/commands/workflow.ts:393` — `setExitCode(result.status === 'done' ? 0 : 1)`.

**R5/R6 docs**
- `docs/help/cmd_workflow.md:122` — status authoritative; `.spur/run/<runId>-*` + `spur workflow trace`
- `plugins/sp/skills/spur-cli/references/workflows.md:125` — harness-loop reader contract
- `plugins/sp/skills/spur-cli/references/workflows/operations.md:96` — validate-and-dry-run + run output contract
- `plugins/sp/skills/spur-cli/references/workflows/authoring-workflows.md:49` — `failureStates` in state-machine shape

**Tests**
- `apps/cli/tests/commands/workflow.test.ts:318` — failure terminal exit + JSON status
- `apps/cli/tests/commands/workflow.test.ts:341` — absent failureStates still `done`
- `apps/cli/tests/commands/workflow.test.ts:399` — concurrent run-scoped gate isolation
- `packages/app/tests/workflow/idea-pipeline-definition.test.ts:92` — run-scoped idea paths / no archive
- `plugins/sp/tests/skill-structure.test.ts:510` — planning `__runId`-prefixed expectFile
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | engine schema.ts:50 config.ts:54; apps/cli/schemas/state-machine-workflow.schema.json:16; workflow.test.ts:341 |
| R2 | MET | state-machine.ts:114-133 lifecycle fail; workflow.ts:393; workflow.test.ts:318; smoke fail-term exit=1 |
| R3 | MET | task-pipeline.yaml:46 basic.yaml:22; wrapup no failureStates; wrapup empty smoke skipped done |
| R4 | MET | basic.yaml:34,47 idea-pipeline.yaml:67,85; workflow.test.ts:399; idea-archive removed |
| R5 | MET | docs/help/cmd_workflow.md:122-132 runId glob + workflow trace |
| R6 | MET | workflows.md:132-137 operations.md:96-100 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1/R2 — a pipeline routing to its failure terminal reports a failed run | MET | test | apps/cli/tests/commands/workflow.test.ts:318 + smoke fail-term |
| Scenario: R1 — workflows without a declared failure terminal are unaffected | MET | test | apps/cli/tests/commands/workflow.test.ts:341 + smoke legacy |
| Scenario: R2 — the CLI exit code agrees with the run status | MET | test | apps/cli/tests/commands/workflow.test.ts:318 |
| Scenario: R3 — legitimate non-failure terminals stay successful | MET | command | wrapup-pipeline tasks=[] → status=done finalState=skipped exit=0 |
| Scenario: R4 — concurrent runs of one workflow do not share gate artifacts | MET | test | apps/cli/tests/commands/workflow.test.ts:399 |
| Scenario: R6 — the documented reader contract matches the implementation | MET | static-ref | plugins/sp/skills/spur-cli/references/workflows.md:132-137 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECUA disposition (focus=all):** PASS — no blockers or majors. Residual risk is operational (F5 ship AC title drift; empty-`__runId` bare-engine path prefix).

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | `config/workflows/basic.yaml:34` (`__runId: ""` default) | Bare-engine runs without CLI injection still produce `.spur/run/-basic-gate.status` style names (empty prefix). CLI always injects UUID via `WorkflowAppService.run`. | Accept: documented in Design; production path is CLI-injected. Follow-up only if bare-engine becomes a supported entry. |
| P4 | `spur task check 0425` L4.uncovered-task-scenario | Task AC scenario titles are not yet mirrored on feature F5 AC (DD-09 subset warnings). Implementation is correct; process/doc drift only. | Advisory: align F5 feature AC titles in a docs pass — out of scope for this code task. |

**Functional:** R1–R6 MET with re-read file:line + fresh tests/smokes this turn (see Testing).
**Architecture:** Engine/schema seam matches Design (ADR-044); no Spur-side lifecycle.fail workaround.
**Residual risk:** Low — depends on published 0.4.18 pin remaining in catalog; re-link would reintroduce validation skew.
### References
- `docs/00_ADR.md` — **ADR-044** (this task's decision record); ADR-043 + its 2026-08-04 amendments
  (fleet reliability pass; advisory-steps-must-be-soft).
- Engine: `node_modules/@gobing-ai/ts-dual-workflow-engine/src/state-machine.ts:127` (terminal →
  `lifecycle.done`), `run-lifecycle.ts:274-301` (`done` / `fail`), `service.ts:154-192`
  (`resumeRun` effective-vars restore), `action-step.ts:118-131` (only the last onEnter action's
  `setVars` propagates).
- CLI: `apps/cli/src/commands/workflow.ts:393` (`setExitCode(result.status === 'done' ? 0 : 1)`);
  schema `apps/cli/schemas/state-machine-workflow.schema.json`.
- Service: `packages/app/src/services/workflow-service.ts:402-428` (`__runId` injection),
  `:580-586` (`stampFailureReason`).
- Reader contract: `plugins/sp/skills/spur-cli/references/workflows.md:125`,
  `.../workflows/operations.md:98,138,148`.
- Workflows: `config/workflows/*.yaml` (surfaced via the `.spur/workflows` symlink; seeded to
  `.spur/workflows/` by `apps/cli/src/config/scaffold-manifest.ts:43-53`).
- Sibling: task 0423 (pipeline-wait + `/bin/sh -c` guard) — same review lineage, feature D.
### History
- 2026-08-04T17:42:01.444Z todo → wip (system)
- 2026-08-04T17:42:34.461Z wip → testing (system)
- 2026-08-04T17:53:47.438Z testing → done (system)
