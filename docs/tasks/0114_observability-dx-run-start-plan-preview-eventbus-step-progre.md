---
schema_version: 1
name: "Observability DX — run-start plan preview + EventBus step progress"
status: done
template: feature-impl
created_at: 2026-06-24T03:52:29.297Z
updated_at: 2026-06-25T21:02:33.987Z
feature_id: H2
parent_wbs: "0109"
priority: P2
tags: ["observability", "dx", "eventbus", "design"]
---

## 0114. Observability DX — run-start plan preview + EventBus step progress

### Background

Covers 0109 R6 — the largest, least-bounded item (flagged for possible further split). implement steps run 5-9 min (300-530s measured) with NO progress signal — looks hung. The ObservableWorkflowAdapter EventBus exists but is unconsumed. Two parts: (a) RUN-START PLAN PREVIEW — at spur workflow run start, emit a concise plan of the states/steps about to run (leverage the dry-run transition walk) so the operator sees the round's plan; (b) STEP PROGRESS — consume the EventBus (workflow.action.started/finished) to surface a heartbeat/status on long agent.run steps. CLI-side now; the board consumes the same events later. Include a short DX design note for the broader observability surface.

### Requirements
<!-- Reviewed 2026-06-25 against current code after the H2 sp-plugin enhancements. Implemented via dogfood 0114. -->

- [x] R1. **Run-start plan preview.** On a synchronous `spur workflow run` (no `--async`), prints the states/nodes the run will attempt — built from the parsed workflow DEFINITION (not WorkflowRunResult, which has no step list — Design corrected). Gated `--no-plan`; suppressed under `--json`/`--async`. Advisory only.
- [x] R2. **Step progress via the existing EventBus.** CLI constructs an `EventBus<WorkflowObservabilityEventMap>`, passes it via `WorkflowAppServiceContext.observabilityBus`, and subscribes a reporter to `workflow.phase`/`action.started`/`action.finished` — live `▶`/`→`/`✓` lines on long steps.
- [x] R3. **Async-run blind spot — decided + documented.** Resolution (a): async stays output-less (detached, ignored stdio); operator uses `spur workflow trace <run-id>`. Stated in help text + the DX note. A log-tailing async path is a deliberate follow-up.
- [x] R4. **DX design note** — `docs/design/workflow-observability.md`, indexed from `04_DESIGN §0`.
- [x] R5. **Validate.** `bun run lint` green; real synchronous runs show preview + live progress (verified on `basic.yaml` dry-run + a real shell-action run); `--json` byte-identical (asserted); reporter unit tests (event→line, def→plan) + CLI integration tests cover the behavior.
### Acceptance Criteria
<!-- BDD acceptance criteria — derived from R1–R5 (system-tone Given/When/Then). -->

```gherkin
Feature: Workflow observability DX — run-start plan preview + step progress

  @core
  Scenario: R1 — Synchronous run prints a plan preview before executing
    Given a valid workflow file and a synchronous `spur workflow run` (no --async, no --json)
    When the run starts
    Then a concise preview of the states/steps the run will attempt is printed before the first state executes
    And the preview is derived from the existing dry-run transition walk
    And the run's outcome and exit code are unchanged by the preview

  @core
  Scenario: R2 — Long steps surface live progress via the EventBus
    Given a synchronous workflow run whose context provides a WorkflowObservabilityBus
    When an action starts and later finishes within a state
    Then a per-step progress line is printed on workflow.action.started and workflow.action.finished
    And the agent.run blind spot no longer runs silent

  @core
  Scenario: R5 — JSON output is unchanged by observability
    Given `spur workflow run --json`
    When the run executes
    Then no preview or progress lines are emitted
    And the JSON envelope is byte-identical to the pre-change output

  @edge
  Scenario: R3 — Async runs do not attempt in-process progress
    Given `spur workflow run --async` (detached child with ignored stdio)
    When the run is started
    Then no in-process progress is attempted
    And the operator is directed to `spur workflow trace <run-id>`

  @edge
  Scenario: R1 — Preview can be suppressed
    Given a synchronous run invoked with --no-plan
    When the run starts
    Then no plan preview is printed
    And the run executes normally
```
### Q&A
Resolved during the 2026-06-25 pre-implementation review (verified against current code):

- **Q: Does the EventBus / adapter still need building?** No. `packages/app/src/workflow/observability.ts` already defines `ObservableWorkflowAdapter` and emits SIX event types (`workflow.run.started/finalized`, `workflow.phase`, `workflow.transition`, `workflow.action.started/finished`), and it has 6 passing tests. The Background's "built but unconsumed" is correct — R2 is **consumption + wiring**, not emission. (Background overstated the work; Requirements rewritten accordingly.)
- **Q: Where is the consumption gap?** `WorkflowService` already reads `this.ctx.observabilityBus?.()` and wraps persistence in `ObservableWorkflowAdapter` when a bus is present (`workflow-service.ts:477-478`). The CLI's service context **never sets `observabilityBus`**, so no bus is ever constructed. The fix is: construct a `WorkflowObservabilityBus` in the CLI run path, pass it via the context, and subscribe a reporter.
- **Q: Do we need to build a new dry-run walker for R1's preview?** No. `spur workflow run --dry-run` already walks transitions without executing actions (`workflow.ts:98`, `WorkflowService.run({dryRun:true})`). The preview is a presentation pass over that existing walk.
- **Q: Why does the run "look hung"? Is it only missing events?** Two distinct causes. (1) Synchronous runs emit no per-step signal because no bus is wired (R2 fixes this). (2) `--async` runs spawn a DETACHED `Bun.spawn` with `stdio: ['ignore','ignore','ignore']` (`workflow.ts:119-126`) — output is discarded by design; an in-process bus reporter cannot reach a detached child. R2 therefore applies to SYNCHRONOUS runs; async observability is its own concern (R3).
- **Q: Scope of async progress?** Out of scope here. Resolution: async stays output-less and directs the operator to `spur workflow trace <run-id>` (already printed). A log-tailing path for async is a deliberate follow-up, not this task — recorded in R3 so it isn't silently dropped.
- **Q: Risk of preview/progress polluting machine output?** Must be suppressed under `--json` (and async). The preview/progress are human-DX only; `--json` envelope shape is unchanged (R5 asserts this).
### Design
**Chosen approach: consume the existing observability seam from the CLI; build nothing in the engine or adapter.** The `ObservableWorkflowAdapter` + `WorkflowObservabilityEventMap` already exist and are tested; the only missing pieces are (1) a CLI-constructed bus, (2) a CLI reporter subscribed to it, and (3) a preview built from the parsed workflow definition. Rejected: adding a new "for-each progress" mechanism (duplicates working code).

> **Design correction (2026-06-25, dogfood 0114).** The original plan said "reuse the dry-run walk" and typed the preview as `renderRunPlan(walk: WorkflowRunResult)`. **That signature is wrong:** `WorkflowRunResult` is a *terminal* shape — `{ runId, workflowName, mode, status, finalState, transitionsTaken, reason? }` — it carries **no list of states/steps**. The dry-run's step detail exists only as persisted phase/action rows (readable via the trace DAO), not in the return value. Corrected approach below: build the preview from the **parsed workflow definition's states** (`loadWorkflowDef` is already exported from `@gobing-ai/spur-app`), which is both simpler and more honest ("here are the states this workflow defines") and needs no throwaway dry-run pass.

**Seam (already present):**
`WorkflowAppServiceContext.observabilityBus?: () => WorkflowObservabilityBus` → `WorkflowService.run` wraps persistence in `ObservableWorkflowAdapter` when set (`workflow-service.ts:477`). The CLI just needs to provide the factory.

**Wiring (new, CLI-side):**
- Construct an `EventBus<WorkflowObservabilityEventMap>` (ts-infra, `new EventBus<…>()`, `.on(event, handler)`) in the synchronous `workflow run` path; pass it through the service context.
- Subscribe a small reporter (pure `event → line|null`, injectable for tests) to `workflow.action.started` / `workflow.action.finished` / `workflow.phase`. It writes via `context.output`, gated off under `--json` / `--async`.

**Preview (R1) — corrected:**
Parse the def via `loadWorkflowDef(file)`. For a `state-machine` def, list `states[].id` (mark `initialState` / `terminalStates`); for a `transition-flow` def, list `nodes[].id`. Format as a one-line "plan: precheck → implement → … → done". No dry-run needed.

**The sync/async boundary (the key invariant):**
Progress + preview are **synchronous-run features**. `--async` detaches with ignored stdio (`workflow.ts:119`), so no in-process consumer can observe it — async users get `spur workflow trace <run-id>` as the documented path.

**Key signatures (not bodies) — corrected:**
```
type StepLine = (e: WorkflowActionStartedEvent | WorkflowActionFinishedEvent | WorkflowPhaseEvent) => string | null;
function renderRunPlan(def: WorkflowDef): string;   // reads def.states / def.nodes — NOT WorkflowRunResult
```

**Invariants:** observability never mutates the run or changes exit codes; `--json` output byte-identical to today; the board later subscribes to the same `WorkflowObservabilityEventMap` with no CLI changes.
### Plan
1. **Reporter module** — add `packages/app/src/workflow/step-reporter.ts`: pure `renderStepLine(event)` (action.started/finished/phase → line|null) + `renderRunPlan(dryRunResult)` formatter. Injectable, no I/O. Unit-test both (event→line mapping, plan formatting).
2. **Wire the bus in the CLI** — in `apps/cli/src/commands/workflow.ts` synchronous run path, construct an `EventBus<WorkflowObservabilityEventMap>` (ts-infra), pass it via `WorkflowAppServiceContext.observabilityBus`, and subscribe a reporter that writes lines through `context.output`. Gate off under `--json` and `--async`.
3. **Plan preview (R1)** — before the live `run()`, call `run({dryRun:true})` to get the transition walk, format via `renderRunPlan`, print it. Add `--plan`/`--no-plan` (default on for human, suppressed under `--json`/`--async`).
4. **Async boundary (R3)** — leave the detached `--async` path output-less; keep/clarify the `spur workflow trace <run-id>` hint. Add a one-line note in the command help that progress is a synchronous-run feature.
5. **Tests** — reporter unit tests (R5: assert lines emitted for sync, none for json); a plan-preview formatter test on a known dry-run walk. Assert on emitted lines, not timing.
6. **DX design note (R4)** — `docs/design/workflow-observability.md` (where the bus is built, reporter contract, sync/async boundary, board reuse), indexed from `04_DESIGN`.
7. **Validate** — `bun run lint` green; `bun run test` green; a real synchronous `spur workflow run` shows preview + live progress; `--json` byte-identical. Doc-sync `04_DESIGN` (workflow run flags) + `AGENTS.md` in the same commit.
### Solution

Implemented the observability DX as a CLI-side consumer of the existing (already-tested) `ObservableWorkflowAdapter` + `WorkflowObservabilityEventMap` — no engine or adapter change.

| File | Change |
|------|--------|
| `packages/app/src/workflow/step-reporter.ts:38-71` | New pure formatters: `renderStepLine(event)` (action.started → `→ node: kind…`, action.finished → `✓/✗ status (duration)`, phase → `▶ phase [status]`) and `renderRunPlan(def)` (lists `states[].id` / `nodes[].id` from the parsed definition). |
| `packages/app/tests/workflow/step-reporter.test.ts:1-72` | 7 unit tests — event→line mapping (incl. the 5m+ long-step case) and def→plan for both engine modes. |
| `packages/app/src/index.ts:163` | Export `renderRunPlan`/`renderStepLine`/`StepEvent`/`StepLineRenderer`. |
| `apps/cli/src/commands/workflow.ts:68-76` | `makeSvc` accepts an optional `WorkflowObservabilityBus`, wired via `WorkflowAppServiceContext.observabilityBus`. |
| `apps/cli/src/commands/workflow.ts:111` | New `--no-plan` flag (suppress preview only). |
| `apps/cli/src/commands/workflow.ts:160-195` | Synchronous human run: print def-based preview, construct `EventBus`, subscribe the reporter to phase/action.started/action.finished; all gated off under `--json`/`--async`. |
| `apps/cli/tests/commands/workflow.test.ts` | Updated 3 run-tests for the new preview/progress output; strengthened the `--json` test to assert R5 (no leak). |
| `docs/design/workflow-observability.md` | DX design note (approach, sync/async boundary, board reuse, the Design correction). |
| `docs/04_DESIGN.md:31,180-191` · `AGENTS.md:160` | Doc sync — satellite index + `spur workflow run` flags. |

Design correction recorded: the preview is built from the parsed workflow **definition**, not `WorkflowRunResult` (which has no step list) — caught during the dogfood implementation.

### Testing

Tests added and run as part of the dogfood implementation:

- **Unit (`packages/app/tests/workflow/step-reporter.test.ts`, 7 tests):** `renderStepLine` for action.started/finished/phase, the 5m+ long-step duration format (the blind-spot case), failed-action mark; `renderRunPlan` for state-machine and transition-flow defs. All assert on emitted strings, not timing (R5).
- **CLI integration (`apps/cli/tests/commands/workflow.test.ts`):** updated 3 run-tests for the new preview/progress output; strengthened the `--json` run-test to assert R5 — exactly one message (the JSON envelope), no `plan:`/`▶`/`→` leak.
- **Live verification:** a real synchronous `spur workflow run` on a shell-action workflow printed `plan: work → done`, `▶ work [running]`, `→ work: shell…`, `✓ done (0s)`; `--no-plan` suppressed the preview; `--json` stayed byte-clean.

Result: 947 app+cli tests pass (0 fail); `biome check . --error-on-warnings` + `typecheck` clean. `step-reporter.ts` coverage 100% funcs / 95.83% lines.

### Review

Implemented via dogfood (`/sp:dev-dogfood 0114`, report at `docs/dogfood/2026-06-25-implement-0114-dogfood.md`). The run surfaced 6 findings filed as task 0122 (review template) — none blocked this task.

Notable: the pre-implementation Design specified `renderRunPlan(walk: WorkflowRunResult)`, but that type carries no step list; corrected during implementation to build the preview from the parsed workflow definition. No back-issues remain in 0114's own scope. The two P2 process findings (verify loop must run `format`; dogfood protocol vs `### Review` L3 conflict) are tracked in 0122 for a follow-up fix round.

### History
- 2026-06-25T21:01:24.542Z todo → wip (system)
- 2026-06-25T21:01:24.880Z wip → testing (system)
- 2026-06-25T21:01:25.218Z testing → done (system)
