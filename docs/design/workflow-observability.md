# Workflow Observability — Run-Start Plan Preview + Live Step Progress

**Area:** CLI workflow DX (`spur workflow run`) → board/SSE reuse later.
**Status:** implemented (task 0114, R6 of 0109).
**Authority:** derived — surface shapes in `04_DESIGN §1` (`spur workflow run` flags); decisions inherit ADR-022 (orchestration is configuration) and ADR-009 (dual-mode engine).

## Problem

A synchronous `spur workflow run` showed no per-step signal: `agent.run` steps run 5–9 min (300–530 s measured) with the terminal silent — operators could not tell a long step from a hung one. The `ObservableWorkflowAdapter` + `WorkflowObservabilityEventMap` already existed and were tested, but **nothing constructed a bus in the CLI**, so the events were never surfaced.

## Approach (consume, don't build)

Two CLI-side additions, zero engine/adapter change:

1. **Run-start plan preview** — before a synchronous run, parse the workflow definition (`loadWorkflowDef`) and print its declared states (`state-machine`) or nodes (`transition-flow`) in order: `plan: precheck → implement → … → done`. Built from the **definition**, not a run result.
2. **Live step progress** — construct an `EventBus<WorkflowObservabilityEventMap>` in the CLI, pass it via `WorkflowAppServiceContext.observabilityBus`, and subscribe a reporter to `workflow.phase` / `workflow.action.started` / `workflow.action.finished`. The reporter prints a phase header (`▶ <state> [<status>]`), an action entry (`→ <node>: <kind>…`), and an action close with outcome + duration (`✓ done (5m 20s)`).

The reporter is two **pure** functions in `packages/app/src/workflow/step-reporter.ts` (`renderRunPlan(def)`, `renderStepLine(event)`) — no I/O, unit-tested on events and defs, reusable by any future surface.

### Design correction (dogfood 0114)

The original task Design typed the preview as `renderRunPlan(walk: WorkflowRunResult)`. That is wrong: `WorkflowRunResult` is terminal (`{runId, workflowName, mode, status, finalState, transitionsTaken}`) and carries no step list. The dry-run's per-step detail exists only as persisted phase/action rows. The preview is therefore built from the parsed **definition** instead — simpler and needs no throwaway dry-run pass. Caught while implementing; the task Design was corrected.

## The sync/async boundary (key invariant)

Preview + progress are **synchronous-run features only**. `spur workflow run --async` spawns a detached `Bun.spawn` with `stdio: ['ignore','ignore','ignore']` — an in-process bus reporter cannot reach a detached child. Async runs stay output-less and direct the operator to `spur workflow trace <run-id>`. A log-tailing path for async observability is a deliberate, separate follow-up.

## Suppression rules

- `--json` → no preview, no progress; the JSON envelope is byte-identical to before (asserted in tests).
- `--async` → no in-process observability (boundary above).
- `--no-plan` → suppress the preview only; progress still streams.

## Board reuse (later)

The board (and any SSE/WS surface) subscribes to the **same** `WorkflowObservabilityEventMap` — the event contract is the seam. The CLI reporter and a future board consumer differ only in their sink (`context.output` vs a socket); the event shapes, names, and the `ObservableWorkflowAdapter` are shared with no CLI changes required.

## Files

- `packages/app/src/workflow/observability.ts` — the adapter + event map (pre-existing).
- `packages/app/src/workflow/step-reporter.ts` — `renderRunPlan` / `renderStepLine` (new, pure).
- `apps/cli/src/commands/workflow.ts` — bus construction, reporter subscription, preview print, `--no-plan` (new wiring).
