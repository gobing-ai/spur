# Workflow run observability

**Area:** `spur workflow run`, `spur workflow trace`, workflow/agent lifecycle events.
**Status:** built; D5 persisted progress projection accepted and shipped (ADR-070).
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

## D5 detailed progress projection

**Status:** built (ADR-070; task 0603).

`WorkflowProgressProjection` is an internal application DTO. It is derived on demand and is not a
new table or event payload:

```ts
interface WorkflowProgressProjection {
    schemaVersion: 1;
    runId: string;
    workflow: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
    definitionDigest: string | null;
    currentState: string | null;
    states: WorkflowStateProgress[];
    transitions: WorkflowTransitionProgress[];
    artifacts: WorkflowArtifactRef[];
    nextTransitions: WorkflowNextTransition[];
    diagnostics: WorkflowProgressDiagnostic[];
    projectedAt: string;
}

interface WorkflowStateProgress {
    state: string;
    visit: number;
    status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
    actions: WorkflowActionProgress[];
}

interface WorkflowActionProgress {
    actionKey: string;
    kind: string;
    stateEffect: 'read' | 'write' | 'may-write';
    evidenceEffect: 'none' | 'write';
    status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'ambiguous';
    attempts: WorkflowActionAttempt[];
}

interface WorkflowActionAttempt {
    actionRunId: string;
    status: string;
    ok: boolean | null;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
}

interface WorkflowTransitionProgress {
    from: string;
    to: string;
    trigger: string | null;
    at: string;
}

interface WorkflowNextTransition {
    from: string;
    to: string;
    trigger: string | null;
    eligibility: 'eligible' | 'blocked' | 'unknown';
}

interface WorkflowArtifactRef {
    kind: string;
    path: string;
}

interface WorkflowProgressDiagnostic {
    code:
        | 'definition-unavailable'
        | 'definition-digest-missing'
        | 'definition-drift'
        | 'orphan-row'
        | 'ambiguous-action';
    message: string;
}
```

The projection maps existing sources as follows:

| Projection field | Persisted/definition source |
|---|---|
| workflow, terminal status, launch definition digest | `runs` + merged `runs.metadata_json.definitionDigest` |
| state visits | resolved definition plus ordered `phase_runs`/transition history |
| taken edges and current state | ordered `transition_runs` plus run status |
| action attempts | ordered `action_runs` (`node`, `kind`, attempt id, timing, outcome) |
| action effect and pending actions | resolved definition plus the composition baseline |
| artifacts | existing run-linked artifact metadata; path and kind only |
| next transitions | outgoing resolved-definition edges whose guards are statically reportable |

Definition actions use `<state>:<onEnter|onExit>:<ordinal>` after extensions resolve. Existing
action rows do not carry that definition key, so the projector matches ordered rows by node/kind
within a state visit. Zero matches leave the definition action pending; more than one valid mapping
emits `ambiguous-action` and marks the action `ambiguous`. It never guesses or mutates stored rows.

### Definition digest persistence

The canonical digest is `sha256:<hex>` over UTF-8 canonical JSON of the loaded definition after
extensions resolve but before per-run vars are injected: object keys sorted recursively, array order
preserved, and no runtime values or secrets included. The persistence adapter computes it before the
first action and merges it into the run record:

```json
{
    "definitionDigest": "sha256:<hex>"
}
```

The merge is atomic and object-preserving. Existing `dryRun`, `failureReason`, `staleReason`, and
unknown keys remain unchanged; only `definitionDigest` is added. The existing replace-style
`RunDao.stampMetadata` contract is not used for this write and must be migrated to merge semantics
before D5 can ship. A continue/replay operation retains the launch digest. If the current resolved
definition differs, the projection emits `definition-drift`; it never overwrites the launch value.
Legacy rows without the key return `definitionDigest: null` plus `definition-digest-missing`.

### Launch source pinning (0784 R1)

Launches additionally record the resolved source in the same identity merge (one `json_set`, no
partial rows): `metadata_json.definitionSource = {path, layer, workdir}` — the absolute launched
file, the resolver layer (`project` | `bundled`), and the launch working directory. `RunDao.
stampRunIdentity` is conditional on an absent `definitionDigest`, so an attach/race can never
overwrite a stamped digest — or a legacy row's documented absence — with a later resolution.

Resume (`workflow continue`) honors the pin before any name-based lookup: it verifies the recorded
file still exists (a missing source refuses; no same-named replacement is resolved), requires
resolution to land exactly on the recorded path, and grounds checkpoint artifacts, git HEAD, and
the engine resume snapshot in the recorded `workdir`. Pre-pin rows resume by `workflow_name` with
an explicit degraded-identity warning (0784 R2). Consented definition drift merges
`resumeDefinitionDigest`/`resumeWorkflowVersion` alongside the immutable launch identity, and the
resume's `__definitionDigest` var carries the executed digest so proof bindings cannot read as the
launch digest.

### Snapshot and follow

The read-side follower uses the existing System Event ledger only as a wake-up channel:

```text
snapshot latest system-event sequence
  → query definition + workflow/phase/transition/action/artifact rows
  → return projection
  → follow system events strictly after the snapshot
  → on correlated workflow event, re-query persisted truth
  → on timeout or event gap, bounded poll and re-query
```

An event payload never advances projected state directly. Reconnect repeats snapshot-then-follow;
polling remains active at a bounded interval until the run is terminal. The same projection is
therefore returned after event loss, duplicate events, or process restart.

### Inline record-only journal

Inline task execution remains host-controlled. Its adapter may record run, phase, transition, and
action observations through the existing workflow persistence interface, but the adapter cannot
request transitions, execute actions, or infer success. The host owns execution; the journal owns
only idempotent observation writes. Inline and engine-driven runs therefore share projection rows
without creating a second controller.

### Contract fixtures

The implementation fixture matrix must cover:

- state machine and transition-flow definitions;
- repeated state visits and retry attempts;
- running, failed, cancelled, and clean terminal runs;
- definition digest drift, missing definition, orphan rows, and ambiguous action mapping;
- metadata merge preservation across `dryRun`, terminal failure, stale finalization, and unknown keys;
- event loss, duplicate wakeups, reconnect after snapshot, and poll-only convergence;
- engine-driven and inline record-only runs producing the same projection shape;
- artifact path-only projection and recursive secret redaction.

No public `spur workflow trace` JSON or human-output field changes in D5. A future public projection
requires explicit ADR-051 consent and a same-change `04_DESIGN` surface update.
