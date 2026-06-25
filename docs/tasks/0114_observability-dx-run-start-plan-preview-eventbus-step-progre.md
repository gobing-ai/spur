---
schema_version: 1
name: "Observability DX — run-start plan preview + EventBus step progress"
status: todo
template: feature-impl
created_at: 2026-06-24T03:52:29.297Z
updated_at: 2026-06-25T20:21:45.698Z
feature_id: H2
parent_wbs: "0109"
priority: P2
tags: ["observability", "dx", "eventbus", "design"]
---

## 0114. Observability DX — run-start plan preview + EventBus step progress

### Background

Covers 0109 R6 — the largest, least-bounded item (flagged for possible further split). implement steps run 5-9 min (300-530s measured) with NO progress signal — looks hung. The ObservableWorkflowAdapter EventBus exists but is unconsumed. Two parts: (a) RUN-START PLAN PREVIEW — at spur workflow run start, emit a concise plan of the states/steps about to run (leverage the dry-run transition walk) so the operator sees the round's plan; (b) STEP PROGRESS — consume the EventBus (workflow.action.started/finished) to surface a heartbeat/status on long agent.run steps. CLI-side now; the board consumes the same events later. Include a short DX design note for the broader observability surface.

### Requirements
<!-- Reviewed 2026-06-25 against current code after the H2 sp-plugin enhancements. Findings in Q&A; approach in Design. -->

- [ ] R1. **Run-start plan preview.** On a synchronous `spur workflow run` (no `--async`), before the first state executes, print a concise preview of the states/steps the run will attempt — reuse the existing `--dry-run` transition walk (`WorkflowService.run` with `dryRun:true` already produces the walk; do not build a second walker). Gate behind a `--plan`/`--no-plan` flag (default on for human output, suppressed under `--json` and `--async`). The preview is advisory — it must never mutate the run or alter exit codes.
- [ ] R2. **Step progress via the existing EventBus.** Wire a `WorkflowObservabilityBus` into the CLI's `WorkflowAppServiceContext.observabilityBus` (the seam already exists at `workflow-service.ts:477`; the `ObservableWorkflowAdapter` is built and tested — this is consumption, not new emission). Subscribe a CLI reporter to `workflow.action.started` / `workflow.action.finished` (and optionally `workflow.phase`) to print a per-step heartbeat/line so long `agent.run` steps (the measured 5–9 min blind spot) show liveness. Reporter is CLI-side and board-reusable (same event contract).
- [ ] R3. **Async-run blind spot — decide and document, don't silently leave it.** `spur workflow run --async` spawns a detached `Bun.spawn` with `stdio: ['ignore','ignore','ignore']`, so an in-process bus reporter CANNOT surface there. Either (a) keep async output-less and point the operator at `spur workflow trace <run-id>` (already the printed hint), making R2 explicitly a SYNCHRONOUS-run feature; or (b) have the detached child write progress to a run log file the parent/`trace` can tail. Pick one (recommend (a) for this task — (b) is a larger follow-up), and state the scope boundary in the Design + the preview/progress help text.
- [ ] R4. **DX design note** for the observability surface direction (CLI now → board/SSE later over the same `WorkflowObservabilityEventMap`): where the bus is constructed, the reporter contract, the sync-vs-async boundary (R3), and what the board will reuse. In `docs/design/<slug>.md` indexed from `04_DESIGN`, per the constitution.
- [ ] R5. **Validate.** `bun run lint` green; a real synchronous pipeline run shows the plan preview (R1) AND live per-step progress with no 5–9 min silent gap (R2); `--json` output is unchanged (preview/progress suppressed); tests cover the preview formatter and the reporter's event→line mapping (assert on emitted lines, not timing).
### Acceptance Criteria

<!-- System-tone Given/When/Then (what the SYSTEM does), or a `- [ ]` checklist for sub-tasks. Drives UAT and L4 coverage. -->

### Q&A
Resolved during the 2026-06-25 pre-implementation review (verified against current code):

- **Q: Does the EventBus / adapter still need building?** No. `packages/app/src/workflow/observability.ts` already defines `ObservableWorkflowAdapter` and emits SIX event types (`workflow.run.started/finalized`, `workflow.phase`, `workflow.transition`, `workflow.action.started/finished`), and it has 6 passing tests. The Background's "built but unconsumed" is correct — R2 is **consumption + wiring**, not emission. (Background overstated the work; Requirements rewritten accordingly.)
- **Q: Where is the consumption gap?** `WorkflowService` already reads `this.ctx.observabilityBus?.()` and wraps persistence in `ObservableWorkflowAdapter` when a bus is present (`workflow-service.ts:477-478`). The CLI's service context **never sets `observabilityBus`**, so no bus is ever constructed. The fix is: construct a `WorkflowObservabilityBus` in the CLI run path, pass it via the context, and subscribe a reporter.
- **Q: Do we need to build a new dry-run walker for R1's preview?** No. `spur workflow run --dry-run` already walks transitions without executing actions (`workflow.ts:98`, `WorkflowService.run({dryRun:true})`). The preview is a presentation pass over that existing walk.
- **Q: Why does the run "look hung"? Is it only missing events?** Two distinct causes. (1) Synchronous runs emit no per-step signal because no bus is wired (R2 fixes this). (2) `--async` runs spawn a DETACHED `Bun.spawn` with `stdio: ['ignore','ignore','ignore']` (`workflow.ts:119-126`) — output is discarded by design; an in-process bus reporter cannot reach a detached child. R2 therefore applies to SYNCHRONOUS runs; async observability is its own concern (R3).
- **Q: Scope of async progress?** Out of scope here. Resolution: async stays output-less and directs the operator to `spur workflow trace <run-id>` (already printed). A log-tailing path for async is a deliberate follow-up, not this task — recorded in R3 so it isn't silently dropped.
- **Q: Risk of preview/progress polluting machine output?** Must be suppressed under `--json` (and async). The preview/progress are human-DX only; `--json` envelope shape is unchanged (R5 asserts this).
### Design
**Chosen approach: consume the existing observability seam from the CLI; build nothing in the engine or adapter.** The `ObservableWorkflowAdapter` + `WorkflowObservabilityEventMap` already exist and are tested; the only missing pieces are (1) a CLI-constructed bus, (2) a CLI reporter subscribed to it, and (3) a preview pass over the existing dry-run walk. Rejected: adding a new "for-each progress" mechanism or a second walker (duplicates working code; violates R2/R3 of the simplicity rules).

**Seam (already present):**
`WorkflowAppServiceContext.observabilityBus?: () => WorkflowObservabilityBus` → `WorkflowService.run` wraps persistence in `ObservableWorkflowAdapter` when set (`workflow-service.ts:477`). The CLI just needs to provide the factory.

**Wiring (new, CLI-side):**
- Construct an `EventBus<WorkflowObservabilityEventMap>` (ts-infra) in the synchronous `workflow run` path; pass it through the service context.
- Subscribe a small reporter (pure function `event → line`, injectable for tests) to `workflow.action.started` / `workflow.action.finished` (+ `workflow.phase` for state changes). It writes via `context.output`, gated off under `--json`/`--async`.

**Preview (R1):**
Reuse `run({dryRun:true})` to obtain the transition walk, format it as a short "this round will: precheck → implement → … → done" line, print before the live run starts. One formatter, unit-tested on the walk result.

**The sync/async boundary (the key invariant):**
Progress + preview are **synchronous-run features**. `--async` detaches with ignored stdio (`workflow.ts:119`), so no in-process consumer can observe it — async users get `spur workflow trace <run-id>` as the documented path. This boundary is stated in help text and the DX note so it is not mistaken for a bug.

**Key signatures (not bodies):**
```
type StepReporter = (e: WorkflowActionStartedEvent | WorkflowActionFinishedEvent | WorkflowPhaseEvent) => string | null;
function renderRunPlan(walk: WorkflowRunResult /* dryRun */): string;
```

**Invariants:** observability never mutates the run or changes exit codes; `--json` output byte-identical to today; the board later subscribes to the same `WorkflowObservabilityEventMap` with no CLI changes.
### Plan

<!-- Ordered checklist or table of implementation steps (not prose). The how-to-execute order within this one task. -->

### History
