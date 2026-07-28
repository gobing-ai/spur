# Workflow run observability

**Area:** `spur workflow run`, `spur workflow trace`, workflow/agent lifecycle events.
**Status:** implemented (tasks 0114, 0310, 0365).
**Authority:** derived; CLI shapes are indexed by `04_DESIGN §1`; ADR-035 owns the control-plane boundary.

## Runtime contract

The workflow database is the replay authority. `ObservableWorkflowAdapter` mirrors successful persistence
writes to `WorkflowObservabilityBus`; the bus is a low-latency, read-only in-process projection, never a
command channel. Human foreground rendering and optional JSONL tracing consume that projection. Detached
following polls persisted run, phase, transition, and action rows.

Canonical workflow lifecycle events use envelope version 1:

| Field | Contract |
|---|---|
| `schemaVersion` | `1`; breaking payload changes increment it |
| `eventId` | unique UUID for deduplication |
| `sequence` | monotonic within the producing run projection |
| `runId` | non-empty; an uncorrelated finish event is suppressed |
| `workflowName` | present after run creation when known |
| `at` | ISO timestamp |
| `actionId` | required on action start/finish |

Canonical agent lifecycle events use the same schema/version/identity fields plus a non-empty
`executionId`; workflow dispatches also carry the persisted action row's `actionId`. A retry retains the
outer `actionId` and creates a new `executionId`, preventing an attempt from being double-counted as a
second workflow action.

Released upstream seams consumed by Spur:

- `@gobing-ai/ts-runtime@0.4.14`: `ProcessOptions.onOutput` tees stdout/stderr without changing the buffered
  result contract.
- `@gobing-ai/ts-ai-runner@0.4.14`: `AgentRunOptions.onOutput` and
  `{runId, executionId, actionId?}` correlation.
- `@gobing-ai/ts-dual-workflow-engine@0.4.14`: persisted `ActionRunContext.actionId` reaches action runners.

Resolved action options cross the engine's optional `saveActionStart(..., options?)` seam. Engine
persistence ignores that argument. Spur projects an allow-list (`agent`, `model`, `timeoutMs`, invocation
summary) before emitting; prompt bodies and shell commands never enter the bus.

## Producer/subscriber/persistence audit (0365)

| Producer | Canonical projection | Subscribers | Durable source/export |
|---|---|---|---|
| Adapter run start/finalize | workflow envelope, name/status | CLI, trace writer, board-capable bus | `workflow_runs`; optional JSONL |
| Adapter phase | workflow envelope, phase/status | CLI, trace writer | `phase_runs`; optional JSONL |
| Adapter transition | workflow envelope, from/to/trigger | full-detail CLI, trace writer | `transition_runs`; optional JSONL |
| Adapter action start | persisted action identity, node/kind, safe declared metadata | CLI, trace writer | `action_runs`; optional JSONL |
| Adapter action finish | correlated action identity, duration/outcome/error, `usage: unavailable` | CLI, trace writer | updated `action_runs`; optional JSONL |
| Agent service dispatch | resolved agent/model/invocation, execution correlation | direct server bus or workflow bus | optional JSONL in workflow runs |
| Runtime output callback | bounded redacted stdout/stderr chunks | async bounded relay → workflow bus | optional JSONL |
| Agent lifecycle timer/finish | elapsed/budget, outcome/signal/reason, `usage: unavailable` | CLI, trace writer | optional JSONL |
| Engine shell/HITL actions | adapter action lifecycle; engine-native HITL events remain available to server consumers | CLI action lines; server lifecycle bus | action rows/system events |
| Steering controller | targeted ack/nack with actor, version, operation, redacted note/reason | CLI, trace writer | optional JSONL |
| `workflow cancel` / Ctrl-C | persisted terminal reason and/or correlated agent cancellation | trace/follow and lifecycle consumers | run metadata/action rows; optional JSONL |

Engine-native node/action/HITL events remain transport facts for server consumers. The adapter action
projection is the canonical operator lifecycle, so the foreground renderer does not subscribe to both and
does not double-count the same action. Shell and HITL prompts are represented by their redacted action
lifecycle; prompt content remains deliberately absent.

## Human output modes

`--json` is a separate machine mode and wins over human flags.

| Mode | Plan | Phase/action | Live agent output | Heartbeat | Transition/correlation | Final summary |
|---|---:|---:|---:|---:|---:|---:|
| default (`--detail invocation`) | yes | rich | yes | every 30 s | no | yes |
| `--detail minimal` | yes | compact | no | no | no | yes |
| `--verbose` / `--detail full` | yes | rich | yes | every 30 s | yes | yes |
| `--quiet` | no | no | no | no | no | yes |
| `--silent` | no | no | no | no | no | no |
| `--json` | no prose | no prose | no prose | no prose | no prose | one existing JSON result |

`--quiet` conflicts with `--verbose`; `--silent` conflicts with both. `--no-plan` remains orthogonal.
Foreground action lines identify run, state/node, kind, declared agent/model, safe invocation summary,
timeout budget, duration, outcome, and `usage unavailable`. Once dispatch resolves the actual profile, the
agent-start event supersedes declared metadata and its heartbeat replaces the generic action heartbeat.

## Live output and backpressure

Agent execution remains buffered and non-interactive for workflow actions. The upstream output callback is
a tee: it observes chunks while the canonical final stdout/stderr remains available to capture,
`answerFile`, and response validation.

Spur redacts and truncates each callback chunk to 4,096 characters, then enqueues at most 64 pending chunks.
Per-stream carry protects configured secret values that span adjacent process chunks; the carry is flushed
through the same redactor at execution finish.
The child callback never awaits a terminal, EventBus, or file observer. Overflow increments a dropped count
and later emits explicit `dropped` telemetry. Observer exceptions are isolated from execution semantics.

## Durable follow and optional file traces

`spur workflow trace <run-id> --follow [--poll <ms>]` replays the persisted timeline and polls until the run
leaves `running`/`pending`. A changed action row is emitted again, exposing in-flight-to-terminal updates.
The command retries the initial lookup briefly to cover the detached-launch/create-row race. `--follow
--json` is rejected because follow is a human stream; ordinary `trace --json` remains the stable snapshot
DTO.

`spur workflow run --trace-file` appends the already-redacted bus projection to
`.spur/runs/workflow/<safe-run-id>.jsonl`. Each record has `traceSchemaVersion: 1`, an append-order
`traceSequence`, event type, and event envelope. Detached runs propagate the option to the child. Definition
roots remain read-only.

## Redaction and bounds

- Action metadata is allow-listed before bus emission.
- Raw prompt bodies become `[prompt N chars]`; shell commands become `[shell command redacted]`.
- Common secret shapes and configured secret environment values become `[REDACTED]`.
- Stream chunks are redacted before the 4,096-character bound and before queueing.
- Steering notes are redacted before the 1,024-character bound and before acknowledgement/state mutation.
- Other renderable strings are capped after redaction; result projection exposes only bounded error text
  and the explicit usage availability marker.

The policy is intentionally lossy. Reconstruction uses the workflow definition and protected agent
history, not the observability projection.

## Safe synchronous steering

`spur workflow run --steer` enables a local in-process controller and is rejected with `--json` or
`--async`. It reads `continue`, `note <text>`, `retry`, and `abort` from stdin. Each internally constructed
command carries a unique command ID, run/action target, expected state/version, actor, deadline, and
operation. Every submission produces an ack/nack; duplicate, stale, expired, mistargeted, unauthorized, and
unsafe-retry commands are rejected.

An `agent.run` opts into a post-attempt safe boundary:

```yaml
steeringBoundary: true
steeringTimeoutMs: 30000
retryPolicy:
  idempotent: true
  maxAttempts: 2
```

Boundary timeout defaults to `continue`, is a positive integer, and is capped at five minutes. Retry
attempts are capped at ten. `retry` is permitted only after a failed attempt and only with the explicit
idempotent policy; it never rewrites completed attempt history. Completed actions reject every steering
mutation. `abort` is also valid while the child is active and propagates through the runner's abort signal.
Direct `spur agent run` emits the same correlated execution lifecycle, but has no workflow-declared safe
retry boundary; its controls remain ordinary signal cancellation.

Cross-process steering is intentionally disabled. Its required durable protocol is a design-only follow-up:
[`workflow-steering-control-channel.md`](workflow-steering-control-channel.md).
