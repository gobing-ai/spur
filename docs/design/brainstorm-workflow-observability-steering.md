# Brainstorm: Workflow observability, traceability, live output, and steering for `spur workflow run`

**Date:** 2026-07-27

## Overview

`spur workflow run` currently emits a run-start plan preview and a live per-step progress stream
to the CLI, backed by `EventBus<WorkflowObservabilityEventMap>` and the pure `renderStepLine` /
`renderRunPlan` reporters (task 0114). Task 0310 then locked a two-line verbosity model
(`[agent.run] omp(zai) => /sp:dev-run 0302 --auto --next` then `✓ agent.run (18m 33s)`) plus a
`--detail` enum, a liveness heartbeat, an async `--follow` trace, and a token-cost slot — all built
on a widened `saveActionStart` engine seam that carries invocation data.

This idea asks to go further on five axes simultaneously: (1) tiered output semantics with a
stable `--json` machine mode, (2) richer lifecycle/execution events from `agent.run` and
`spur agent run`, (3) streaming interim agent output, (4) bounded interactive steering
(continue / note / retry / abort), and (5) an event-payload audit for correlation, redaction,
persistence, backpressure, cancellation, and cross-process transport. The work explicitly builds
on 0310 and the 0114 observability foundation.

The tension that dominates design choice: three of the five axes (streaming, steering,
cross-process transport) require seams that do not yet exist — the non-interactive buffered-mode
contract (R3) blocks streaming; HITL exists as `hitl.*` actions but not as an in-flight steering
protocol; the observability bus is in-process only and its `saveActionFinalize` hook has a known
`runId: ''` gap. The approaches below differ mainly in how much engine seam they widen and how they
phase steering separately from baseline observability.

## Approaches

### Approach 1: Tiered output + widened observability seam, steering deferred ⭐ Recommended

**Description:** Reconcile and extend the 0310 model with the idea's tiered naming. Ship the
observability half now (tiered flags, richer correlated events, payload audit, persistence fixes)
and explicitly defer steering + streaming to a follow-on that depends on a durable control channel.
Keep `--json` byte-stable as the machine contract; layer `--quiet` / `--silent` / `--verbose` as
pure suppression/depth filters on the human renderer, and treat the 0310 `--detail` enum as the
*content-shape* axis orthogonal to the *verbosity* axis. Widen `saveActionStart` to carry
invocation data (agent, input, command) per 0310; fix the `saveActionFinalize` `runId` gap; add
`workflow.hitl.*` events to the observability map so the CLI can render gate transitions.

**Trade-offs:**
- **Pros:**
  - Ships a coherent, testable observability slice without a new transport or mode change.
  - Honors the R3 non-interactive contract — no streaming risk this phase.
  - The `--detail` vs `--quiet/--verbose` orthogonality is the cleanest reconciliation of 0310 and
    the idea; machines keep `--json`, humans get tiered prose.
  - Payload audit (correlation, redaction, persistence, backpressure) lands *before* steering, so
    the control channel is built on audited primitives.
  - `needs_design: true` — but the design is mostly a seam-widening + event-map extension, not a
    new subsystem.
- **Cons:**
  - Does not deliver streaming interim agent output (the highest-DX ask) this phase.
  - Steering is deferred; operators still use `spur workflow continue` (paused HITL) and
    `spur workflow cancel` (SIGTERM) as the only control surfaces.
  - Two verbosity taxonomies (`--detail` content + `--quiet/--verbose` depth) is one more concept
    than either alone; requires clear docs.

**Implementation Notes:**
- **Flag reconciliation:** `--json` = machine mode (unchanged, byte-stable). `--quiet` suppresses
  the per-step progress lines (keeps final summary). `--silent` suppresses everything but errors.
  `--verbose` adds diagnostics: transition triggers, durations, invocation data, token cost.
  `--detail <enum>` (from 0310) shapes *what* an action line shows (minimal / invocation / full);
  default `minimal`. `--quiet` + `--verbose` are mutually exclusive; `--json` overrides all.
- **Engine seam:** widen `saveActionStart(runId, node, kind, invocation?)` so `WorkflowActionStartedEvent`
  carries `{agent?, input?, command?}` — the 0310 invocation slot. This is a ts-dual-workflow-engine
  interface change; coordinate via a released semver bump or `bun link` while validating.
- **Finish-event correlation:** thread `runId` through `saveActionFinalize` (currently `''`) so
  consumers don't need a join. Either widen the persistence hook signature or look up via `actionId`
  inside the adapter — prefer widening to avoid an adapter-side DB hit per finish.
- **HITL on the observability bus:** add `workflow.hitl.ask` / `workflow.hitl.response` /
  `workflow.hitl.note` to `WorkflowObservabilityEventMap` so the CLI can render gate prompts and
  responses as first-class lifecycle lines, not just `context.events` noise.
- **Payload audit (this phase):** correlation (runId+actionId+at on every event), redaction (reuse
  `ActionRedactor` for `invocation.input` when it may carry secrets), persistence (events are
  derived from the persistence adapter — keep it the source of truth), backpressure (event bus is
  in-process; document that consumers must not block). Cancellation and cross-process transport
  are *scoped out* of this phase and noted as prerequisites for steering.

**Confidence:** HIGH — builds directly on the 0114/0310 seams already in the tree.
**Sources:**
- `packages/app/src/workflow/observability.ts` (WorkflowObservabilityEventMap, ObservableWorkflowAdapter) | **Verified:** 2026-07-27
- `packages/app/src/workflow/step-reporter.ts` (renderStepLine, renderRunPlan) | **Verified:** 2026-07-27
- `docs/tasks2/0310_decide-the-verbosity-model-for-spur-workflow-run-output.md` (locked design) | **Verified:** 2026-07-27
- `docs/design/workflow-observability.md` (0114 design) | **Verified:** 2026-07-27

### Approach 2: Observability + streaming, steering still deferred

**Description:** Everything in Approach 1, plus a new `mode: 'streamed'` dispatch path in
`AgentService` that emits interim agent output onto the observability bus as
`workflow.agent.output` events (new event type), while keeping the R3 non-interactive contract
intact by streaming *only* when the run is synchronous + human-facing (`--json` off, not `--async`).
The CLI renders streamed chunks under `--verbose`; under default verbosity they are suppressed to
avoid noise.

**Trade-offs:**
- **Pros:**
  - Delivers the single highest-DX ask: seeing what the agent is doing while it runs.
  - Still no steering — the control channel is the hard dependency, not streaming.
  - Streaming is gated on human + sync, so `--json` byte-stability and the `--async` worker path
    are untouched.
- **Cons:**
  - Requires an `AgentService` mode change (new `streamed` mode) or a parallel `runStreaming`
    method; this is a real `@gobing-ai/ts-ai-runner` seam, not a Spur-only change.
  - Interim agent output is unstructured text — `workflow.agent.output` events are high-volume and
    need backpressure handling this phase, not deferred. The audit can't punt it.
  - Streaming couples the observability bus to subprocess stdout plumbing; a stuck pipe could stall
    the run. Needs careful unbuffering + timeout.

**Implementation Notes:**
- New event: `workflow.agent.output { runId, actionId, chunk, stream: 'stdout'|'stderr', at }`.
- `AgentRunActionRunner` chooses `runStreaming` when `human && !json && !async`; else `runTraced`.
- Backpressure: bounded ring buffer per action; drop oldest with a `dropped` counter event.
- This approach forces the payload audit to address volume + backpressure *now*, not later.

**Confidence:** MEDIUM — the seam is plausible but the `ts-ai-runner` streaming API is not verified.
**Sources:**
- `packages/app/src/workflow/actions/agent-run.ts` (runTraced, buffered mode R3) | **Verified:** 2026-07-27

### Approach 3: Full stack — observability + streaming + in-process steering

**Description:** Approaches 1 + 2, plus a bounded in-process steering protocol: the observability bus
carries `workflow.steering.request` / `workflow.steering.response` events, and a new
`spur workflow steer <run-id>` command (separate process) writes a steering intent file + signals
the live run, which polls a steering queue between actions. Steering intents: `continue`, `note`
(append a note to the run), `retry` (re-run the last failed action), `abort` (cancel). Cross-process
transport is a `.spur/run/<runId>.steering.jsonl` queue the live run tails.

**Trade-offs:**
- **Pros:**
  - Delivers the complete idea in one pass.
  - The file-based steering queue is the durable control channel the idea asks for; it also
    unlocks future cross-process steering.
- **Cons:**
  - Largest blast radius: new engine events, new CLI command, new cross-process file protocol, new
    `ts-ai-runner` streaming mode — all in one task. Violates "phase steering separately from
    baseline observability" (an explicit idea constraint).
  - The steering queue is a new transport with its own audit surface (cancellation, ordering,
    stale intents, crash recovery). Designing it *well* needs its own design summary, not a
    sub-section here.
  - Risk of shipping a half-tested control protocol under schedule pressure.

**Implementation Notes:**
- Steering queue: append-only JSONL; live run polls on a liveness timer (reuses 0310 heartbeat).
- `retry` requires the action runner to be idempotent or to accept a re-run; not all actions are.
- This is explicitly the approach the idea warns against: steering must be phased separately and
  cross-process steering must wait for a durable control channel.

**Confidence:** LOW — too much surface for one pass; the idea itself says to phase this.

## Recommendations

**Take Approach 1 this phase.** It reconciles the 0310 `--detail` enum with the idea's
`--quiet/--silent/--verbose/--json` naming as two orthogonal axes (content shape vs suppression
depth), widens the observability seam to carry the 0310 invocation data, fixes the
`saveActionFinalize` `runId` gap, and lifts `workflow.hitl.*` onto the observability bus — all
without touching the R3 non-interactive contract or introducing a new transport. It performs the
payload audit *before* adding streaming or steering, so those follow-ons build on audited
primitives.

Approach 2 (streaming) is the right *next* task once Approach 1 lands and the `ts-ai-runner`
streaming seam is verified — it should not be rushed into the same task because it forces
backpressure handling that deserves its own design. Approach 3 is explicitly rejected for this
pass: the idea states "phase steering separately from baseline observability; defer
cross-process steering until a durable control channel exists." A future steering task should
design the `.spur/run/<runId>.steering.jsonl` control channel and the `spur workflow steer` command
as its own design summary, building on the audited event payloads from Approach 1.

## Design Summary

**Scope:** Improve internal observability, traceability, live output, and steering for
`spur workflow run`, building on task 0310 and the 0114 observability foundation.

**This phase (Approach 1) delivers:**

1. **Tiered output flags.** `--json` (machine, byte-stable, unchanged). `--quiet` (suppress
   per-step lines, keep final summary). `--silent` (errors only). `--verbose` (transitions,
   durations, invocation, token cost). `--detail <minimal|invocation|full>` (0310 content-shape
   axis; default `minimal`). `--quiet` and `--verbose` mutually exclusive; `--json` overrides all.
   The 0310 two-line model (`[agent.run] omp(zai) => …` / `✓ agent.run (18m 33s)`) is the
   `--detail invocation` rendering; default `minimal` keeps the current one-line `→ / ✓` shape.

2. **Widened observability seam.** `saveActionStart(runId, node, kind, invocation?)` carries
   `{agent?, input?, command?}` (0310 invocation slot). `WorkflowActionStartedEvent` gains an
   optional `invocation` field. This is a `@gobing-ai/ts-dual-workflow-engine` interface change —
   released via semver bump or `bun link` while validating, per AGENTS.md dep policy.

3. **Finish-event correlation fix.** Thread `runId` through `saveActionFinalize` so
   `WorkflowActionFinishedEvent.runId` is populated (currently `''`). Prefer widening the
   persistence hook signature over an adapter-side DB lookup per finish.

4. **HITL on the observability bus.** Add `workflow.hitl.ask`, `workflow.hitl.response`, and
   `workflow.hitl.note` to `WorkflowObservabilityEventMap` and bridge them from `context.events`
   (engine bus) to the observability bus, so the CLI renders gate prompts/responses as
   first-class lifecycle lines. `workflow.hitl.note` is already declared in
   `services/event-names.ts` but not wired — wire it.

5. **Payload audit (observability half only).** Document and enforce:
   - **Correlation:** every event carries `runId + at`; action events carry `actionId`.
   - **Redaction:** `invocation.input` may carry secrets — route through `ActionRedactor`.
   - **Persistence:** events are derived from the persistence adapter (source of truth); the bus
     is a read projection. Document this invariant.
   - **Backpressure:** in-process bus; consumers must not block. Note that streaming + steering
     will require bounded queues — out of scope this phase.
   - **Cancellation & cross-process transport:** explicitly scoped out; prerequisites for the
     steering follow-on.

**Explicitly deferred (not this phase):**
- Streaming interim agent output (needs `ts-ai-runner` `streamed` mode + backpressure design).
- Interactive steering (continue/note/retry/abort) — needs a durable control channel
  (`.spur/run/<runId>.steering.jsonl` or equivalent) designed as its own design summary.
- Cross-process steering transport.

**Engine/action boundary honored:** observability is a persistence-decorator seam, not an action
seam. Action `options` (agent, input, command) do NOT cross the engine boundary as action
arguments; they are captured at the `agent.run` runner and surfaced via the widened
`saveActionStart` invocation slot, then rendered from the event — not from action options.

**Self-review:** No placeholders. No contradictions with 0310 (orthogonal axes, not conflicting
naming). Scope creep contained — streaming and steering are named as deferred, not silently
included. `needs_design: true` because the work touches the engine persistence interface, the
observability event map, and cross-package (`ts-dual-workflow-engine`) contracts.

## Next Steps

1. Task: widen `saveActionStart` + `saveActionFinalize` signatures in
   `@gobing-ai/ts-dual-workflow-engine` (coordinate semver bump or `bun link`).
2. Task: extend `WorkflowObservabilityEventMap` with `workflow.hitl.*` and bridge from
   `context.events`; wire `workflow.hitl.note`.
3. Task: implement tiered flags (`--quiet` / `--silent` / `--verbose` / `--detail`) in the
   `spur workflow run` CLI and thread through `renderStepLine` / `renderRunPlan`.
4. Task: payload audit doc (`docs/design/workflow-observability-audit.md`) covering correlation,
   redaction, persistence, backpressure; mark cancellation + cross-process as deferred.
5. Future task (streaming): verify `ts-ai-runner` streaming API; design `workflow.agent.output`
   event + backpressure.
6. Future task (steering): design `.spur/run/<runId>.steering.jsonl` control channel +
   `spur workflow steer` command as its own design summary.

---

**Generated by:** sp:brainstorm
**Research delegation:** inline codebase reading (observability.ts, step-reporter.ts, agent-run.ts,
hitl-confirm.ts, workflow.ts CLI, task 0310, design/workflow-observability.md)