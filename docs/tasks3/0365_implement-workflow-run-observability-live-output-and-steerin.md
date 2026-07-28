---
template: feature-impl
schema_version: 1
name: "Implement workflow run observability, live output, and steering foundations"
description: ""
status: done
type: task
profile: standard
feature_id: D1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0366"]
created_at: "2026-07-28T06:28:47.045Z"
updated_at: "2026-07-28T18:57:27.552Z"
---

## 0365. Implement workflow run observability, live output, and steering foundations

### Background
Implement the original request to make `spur workflow run` internally observable while long-running
workflow and `agent.run` actions are executing, and establish a safe steering model. This builds on
feature D1, task 0310's locked observability design, the existing
`WorkflowObservabilityEventMap`/`ObservableWorkflowAdapter`, and the two persisted dogfood runs listed
in References.

During both discovery actions, the parent exposed only `agent.run…` for 5–6 minutes: no resolved agent,
translated invocation, heartbeat, subprocess output, artifact progress, token/cost signal, or control
surface. The persisted trace later reported zero usage records and did not carry the continuation failure
reason. That is the concrete baseline this task must improve.

The task owns the end-to-end operator experience in explicit phases: audited event contracts and upstream
seams first; useful default human output and durable follow second; bounded streaming third; safe
in-process steering fourth. Cross-process steering is design-only until a durable, versioned control
channel exists. Machine-readable `--json` remains stable, and secrets must be redacted before any bus,
console, or durable trace projection.
### Requirements
- R1. Complete an emitter/subscriber/persistence audit for every workflow and agent lifecycle event,
  identifying missing correlation, timestamps, sequence/causation, error, invocation, usage, and control
  fields before widening schemas.
- R2. Give every event sufficient identity for deterministic correlation: `runId`, event id/sequence,
  timestamp, workflow/state/node, and `actionId` where applicable; finish/failure events must never emit an
  empty run id.
- R3. Widen the upstream engine seam so `agent.run`, shell, HITL, transition, heartbeat, output, finish,
  failure, and cancellation projections can carry redacted resolved metadata without coupling the engine
  to Spur action-side types or changing persistence semantics accidentally.
- R4. Make useful human progress the default: resolved agent/profile or model when known, translated
  invocation summary, state/action, elapsed time and timeout budget, transition/failure reason, and an
  explicit `unavailable` value for absent usage rather than fabricated zeroes.
- R5. Reconcile existing `--detail` decisions and compatibility with a single documented output contract:
  default rich progress, reduced routine output via `--quiet`/`--silent`, deeper diagnostics via
  `--verbose` or its compatible detail level, and byte-stable machine output under `--json`.
- R6. Redact secrets and bound payload size before emit/persist/render. Prompts, commands, environment
  values, streamed chunks, and steering notes require explicit policy and adversarial tests.
- R7. Emit periodic liveness for long actions and interim stdout/stderr for supported synchronous
  `agent.run` executions while retaining the buffered final answer contract and preventing slow consumers
  from blocking the child process.
- R8. Add a durable `workflow trace --follow` experience for detached/cross-process runs using persisted
  events or an equivalent replayable source; in-process EventBus delivery alone is insufficient.
- R9. Emit the same correlated agent lifecycle whether a workflow uses the `agent.run` action or invokes
  the `spur agent run` surface, without double-counting nested executions.
- R10. Define and implement bounded synchronous steering at safe boundaries with commands
  `continue`, `note`, `retry`, and `abort`; every request needs target identity, expected state/version,
  acknowledgement, idempotency, timeout/default behavior, and cancellation propagation.
- R11. Reject unsafe retry for non-idempotent or already-committed actions unless the workflow explicitly
  declares a retry policy. Steering must not mutate completed history or bypass objective guards.
- R12. Keep cross-process steering out of the runtime implementation until a durable authenticated,
  ordered, crash-recoverable control channel is designed and approved; record that protocol as a
  follow-up design deliverable.
- R13. Persist or export a replayable, schema-versioned trace under the established `.spur/runs/<domain>/`
  convention when file traces are enabled; never write run traces into definition roots.
- R14. Cover TTY, non-TTY, `--json`, synchronous, async, cancellation, backpressure, redaction, unavailable
  usage, and resume/failure paths with producer-driven tests and dogfood evidence.
- R15. Release all required `@gobing-ai/ts-*` changes, bump catalog pins, rebuild the bundled CLI, and
  prove Spur consumes the released behavior.
### Acceptance Criteria
```gherkin
Feature: observable and steerable workflow execution

  Scenario: Rich progress is the human default
    Given a synchronous human workflow run containing agent.run
    When the action starts and remains active
    Then output identifies the run, state, action, resolved agent, and redacted invocation
    And periodic output reports elapsed time and timeout budget
    And completion reports duration, outcome, and usage or unavailable

  Scenario: Output modes remain composable and machine-safe
    Given the same workflow run
    When default, quiet or silent, verbose, and JSON modes are selected
    Then each human mode emits only its documented detail level
    And JSON remains a valid stable machine stream with no interactive or prose contamination

  Scenario: Interim output is streamed without losing the final answer
    Given a supported synchronous agent.run action emits stdout and stderr over time
    When live output is enabled by the selected human mode
    Then bounded redacted chunks appear before action completion
    And the action's buffered final answer and response validation remain correct
    And a slow terminal cannot deadlock or exhaust memory

  Scenario: Detached runs can be followed
    Given a workflow was started asynchronously in another process
    When the operator runs workflow trace with follow mode
    Then persisted events are replayed in order and new events continue to appear
    And following terminates with the run's final status and reason

  Scenario: Agent lifecycle correlation is complete
    Given execution enters through agent.run or spur agent run
    When start, output, heartbeat, finish, failure, or cancellation events are observed
    Then every event carries a non-empty run id and the required action or execution identity
    And nested execution is not double-counted

  Scenario: A secret never reaches an observability sink
    Given prompts, commands, environment values, output chunks, or steering notes contain known secrets
    When events are emitted, persisted, rendered, and followed
    Then all configured secrets are redacted before every sink
    And payload truncation cannot reveal the removed material

  Scenario: Bounded steering changes only a safe active run
    Given a synchronous run is paused at a declared steering boundary
    When the operator sends continue, note, retry, or abort with the expected state version
    Then the engine acknowledges exactly one request and performs the permitted transition
    And stale, duplicate, unauthorized, or unsafe-retry requests are rejected with a reason

  Scenario: Cancellation reaches the child process and trace
    Given an active agent subprocess
    When steering abort or Ctrl-C cancels the run
    Then cancellation propagates to the process group
    And partial output is finalized
    And the durable trace records who or what cancelled the run and the final reason
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Sequence the work by dependency and risk while keeping one end-to-end WBS:

1. **Event contract audit.** Inventory each producer, payload, subscriber, persistence path, and missing
   field. Define one versioned envelope with correlation, ordering, causation, redaction, and size limits.
2. **Upstream observability seam.** Widen `@gobing-ai/ts-dual-workflow-engine` with optional read-only
   action metadata and correct finish/failure run correlation. The engine owns lifecycle facts; Spur owns
   action-specific projection and redaction.
3. **Human renderer and durable follow.** Reconcile task 0310's `--detail` design with default-rich,
   quiet/silent, verbose, and frozen JSON behavior. Share a pure renderer between foreground run and
   `trace --follow`; add heartbeat/liveness without requiring high-volume output events.
4. **Streaming.** Add a tee-capable agent execution seam that forwards bounded redacted stdout/stderr
   chunks and still buffers the canonical answer. Use bounded queues and explicit dropped-chunk telemetry;
   never block child I/O on a terminal subscriber.
5. **Steering.** Implement only synchronous in-process steering at declared safe points. Model requests
   as commands, not passive observability events: command id, run/action target, expected version,
   operation, payload, deadline, actor, and ack/nack result. `retry` is policy-gated; `abort` shares the
   cancellation path.
6. **Cross-process control design.** Specify a durable ordered control channel separately before enabling
   remote steering. Observability remains read-only; do not turn the EventBus into an unaudited command bus.

The durable event log/database is the replay authority; the in-process bus is a low-latency projection.
Console and optional JSONL file output consume the same redacted envelope. Preserve
`ObservableWorkflowAdapter`'s mirror-without-changing-domain-persistence invariant.
### Plan
1. Complete and commit the workflow/agent event payload audit with producer-driven probes.
2. Finalize the output-mode compatibility table against task 0310 and feature D1; update the surface design
   before changing flags.
3. Implement, release, and consume the upstream engine correlation/metadata seam.
4. Enrich Spur event projections, redaction, durable traces, and pure rendering.
5. Ship default-rich foreground output, heartbeat, quiet/silent behavior, verbose diagnostics, and stable
   JSON tests.
6. Add `workflow trace --follow` with ordered replay and cross-process polling/subscription fallback.
7. Implement bounded live agent output with tee-to-buffer semantics and backpressure tests.
8. Implement safe synchronous steering commands and cancellation propagation; produce the separate
   cross-process steering protocol design without enabling it prematurely.
9. Update ADR/design/CLI docs in the same changes as public event and flag surfaces.
10. Run focused upstream suites, Spur autofix/spur-check/lint/test/test-cf/build, then dogfood foreground,
    detached-follow, streamed, steering, redaction, and cancellation scenarios.
### Solution
Implemented the complete observability, streaming, trace, and safe-steering slice with no deferred runtime
requirements:

- `packages/app/src/observability/agent-execution.ts:98` and
  `packages/app/tests/observability/agent-execution.test.ts:10` define and verify the shared versioned agent
  lifecycle, bounded asynchronous relay, liveness, explicit unavailable usage, observer isolation, and
  redaction—including configured secrets split across process chunks.
- `packages/app/src/services/agent-service.ts:594` and
  `packages/app/tests/services/agent-service.test.ts:1402` route direct and workflow dispatch through that
  lifecycle with upstream output/correlation/cancellation seams and no nested double count.
- `packages/app/src/workflow/actions/agent-run.ts:74`,
  `packages/app/src/workflow/builtins.ts:30`, `packages/app/src/services/workflow-service.ts:730`, and
  `packages/app/tests/workflow/actions/agent-run.test.ts:144` connect persisted action identity, per-attempt
  execution identity, live events, retry attempts, notes, and abort propagation to workflow execution.
- `packages/app/src/workflow/steering.ts:84` and
  `packages/app/tests/workflow/steering.test.ts:24` implement targeted/versioned/idempotent
  `continue|note|retry|abort` commands, actor/deadline validation, bounded policy, immutable completed
  history, safe retry policy, redacted acknowledgements, and deterministic timeout defaults.
- `packages/app/src/workflow/observability.ts:29`,
  `packages/app/src/workflow/step-reporter.ts:53`,
  `packages/app/tests/workflow/observability.test.ts:77`, and
  `packages/app/tests/workflow/step-reporter.test.ts:12` provide correlated workflow envelopes,
  allow-listed metadata, non-empty finish correlation, pure detail renderers, transitions, failure reasons,
  liveness, and explicit unavailable usage.
- `packages/app/src/workflow/trace-writer.ts:6` and
  `packages/app/tests/workflow/trace-writer.test.ts:10` add the append-only schema-v1 JSONL projection under
  `.spur/runs/workflow/`, covering every workflow, agent, and steering event.
- `apps/cli/src/commands/workflow.ts:118`, `apps/cli/src/index.ts:156`,
  `apps/cli/tests/commands/workflow.test.ts:299`, and `apps/cli/tests/commands/workflow.test.ts:468` ship
  default-rich human progress, quiet/silent/verbose/detail compatibility, byte-safe JSON, trace-file
  propagation, persisted `trace --follow`, local `--steer`, live fake-agent streaming, and mode conflicts.
- `packages/domain/src/dao/run-dao.ts:89`,
  `packages/app/src/services/workflow-service.ts:561`, and
  `packages/domain/tests/dao/run-dao.test.ts:209` keep failure-reason persistence behind the domain DAO.
- `packages/app/src/index.ts:10` exports the new application seams without bypassing package boundaries.
- `package.json:32` and `bun.lock:1` consume the released `@gobing-ai/ts-*` 0.4.14 catalog. Upstream releases
  provide `ProcessOptions.onOutput`, `AgentRunOptions.onOutput/correlation`,
  `ActionRunContext.actionId`, and Unix descendant process-group cancellation; the latter was dogfood-found,
  fixed, released, and then proven from the rebuilt Spur binary.
- `docs/00_ADR.md:844`, `docs/04_DESIGN.md:260`,
  `docs/design/workflow-observability.md:1`,
  `docs/design/workflow-steering-control-channel.md:1`, and `AGENTS.md:218` record ADR-035, public CLI/event
  contracts, redaction/backpressure bounds, and the intentionally design-only cross-process protocol.
- `docs/features/D1_workflow-run-observability-enriched-step-lines-fsm-transitions-async-follow.md:1`,
  `docs/features/INDEX.md:1`, and this task were synchronized through `spur feature/task` CLI verbs.

The bounded verification repair pass additionally fixed malformed steering deadlines, steering mutations
against completed actions, non-finite/unbounded steering policy values, output/heartbeat delivery order, and
cross-chunk secret disclosure. No runtime requirement remains deferred; cross-process steering remains
design-only exactly as R12 requires.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/design/workflow-observability.md:44 — producer/subscriber/persistence audit |
| R2 | MET | packages/app/src/workflow/observability.ts:29 and packages/app/src/observability/agent-execution.ts:8 — versioned correlated identities |
| R3 | MET | packages/app/src/services/agent-service.ts:616 and packages/app/src/workflow/observability.ts:234 — released output/correlation/action metadata seams consumed |
| R4 | MET | packages/app/src/workflow/step-reporter.ts:53 — resolved execution, elapsed/budget, outcome/reason, unavailable usage |
| R5 | MET | apps/cli/src/commands/workflow.ts:118 and apps/cli/tests/commands/workflow.test.ts:299 — composable human detail modes and stable JSON |
| R6 | MET | packages/app/src/observability/agent-execution.ts:145 and packages/app/tests/observability/agent-execution.test.ts:61 — bounded pre-sink redaction including split chunks |
| R7 | MET | packages/app/src/observability/agent-execution.ts:145 and packages/app/src/services/agent-service.ts:616 — bounded non-blocking tee with buffered final result |
| R8 | MET | apps/cli/src/commands/workflow.ts:633 and apps/cli/tests/commands/workflow.test.ts:1137 — persisted replay/follow to terminal status |
| R9 | MET | packages/app/tests/services/agent-service.test.ts:1402 — direct/workflow lifecycle parity and no double count |
| R10 | MET | packages/app/src/workflow/steering.ts:84 and packages/app/tests/workflow/steering.test.ts:24 — targeted/versioned commands, ack/nack, idempotency, timeout, cancellation |
| R11 | MET | packages/app/src/workflow/steering.ts:181 and packages/app/tests/workflow/steering.test.ts:90 — immutable completion and explicit idempotent retry gate |
| R12 | MET | docs/design/workflow-steering-control-channel.md:1 and apps/cli/src/commands/workflow.ts:151 — remote protocol design-only; detached steering rejected |
| R13 | MET | packages/app/src/workflow/trace-writer.ts:6 and packages/app/tests/workflow/trace-writer.test.ts:10 — schema-v1 append-only trace under .spur/runs/workflow |
| R14 | MET | bun run test — exit 0: 3760 tests, 11424 assertions, 99.18% lines; compiled dogfood PASS |
| R15 | MET | package.json:32 — released @gobing-ai/ts-* 0.4.14 catalog; publish run 30388111243 succeeded; rebuilt CLI dogfood PASS |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Rich progress is the human default | MET | test | apps/cli/tests/commands/workflow.test.ts:282 plus bun run test exit 0 |
| Output modes remain composable and machine-safe | MET | test | apps/cli/tests/commands/workflow.test.ts:299 and :443 plus compiled default/quiet/silent/verbose/JSON dogfood PASS |
| Interim output is streamed without losing the final answer | MET | test | apps/cli/tests/commands/workflow.test.ts:510 and packages/app/tests/observability/agent-execution.test.ts:41 |
| Detached runs can be followed | MET | test | apps/cli/tests/commands/workflow.test.ts:1137 plus compiled async trace-follow dogfood PASS |
| Agent lifecycle correlation is complete | MET | test | packages/app/tests/services/agent-service.test.ts:1402 and packages/app/tests/workflow/actions/agent-run.test.ts:144 |
| A secret never reaches an observability sink | MET | test | packages/app/tests/observability/agent-execution.test.ts:10 and :61; trace/file/console dogfood redaction PASS |
| Bounded steering changes only a safe active run | MET | test | packages/app/tests/workflow/steering.test.ts:24 and packages/app/tests/workflow/actions/agent-run.test.ts:144 |
| Cancellation reaches the child process and trace | MET | command | compiled cancellation dogfood settled in 0.83s with actor/outcome/signal/final reason in redacted trace; upstream runtime regression and publish run 30388111243 PASS |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/design/workflow-observability.md:44` inventories producer, projection, subscribers, and durable source. |
| R2 | MET | `packages/app/src/workflow/observability.ts:29`, `packages/app/src/workflow/observability.ts:282`, and `packages/app/src/observability/agent-execution.ts:8` define versioned identity and monotonic correlation. |
| R3 | MET | Released `ts-runtime`, `ts-ai-runner`, and `ts-dual-workflow-engine` 0.4.14 seams are consumed at `packages/app/src/services/agent-service.ts:616` and `packages/app/src/workflow/observability.ts:234`. |
| R4 | MET | `packages/app/src/workflow/step-reporter.ts:53` renders resolved execution, elapsed/budget, outcome, reason, and unavailable usage. |
| R5 | MET | `apps/cli/src/commands/workflow.ts:118` implements and validates default/quiet/silent/verbose/detail/JSON modes. |
| R6 | MET | `packages/app/src/observability/agent-execution.ts:145`, `packages/app/src/workflow/observability.ts:139`, and `packages/app/src/workflow/steering.ts:205` redact and bound before sink delivery. |
| R7 | MET | `packages/app/src/observability/agent-execution.ts:145` provides the bounded relay; `packages/app/src/services/agent-service.ts:616` tees it while retaining the buffered result. |
| R8 | MET | `apps/cli/src/commands/workflow.ts:633` replays/polls persisted timelines to terminal status. |
| R9 | MET | `packages/app/src/services/agent-service.ts:306` and `packages/app/src/services/agent-service.ts:388` share one lifecycle; `packages/app/tests/services/agent-service.test.ts:1402` proves parity/no double count. |
| R10 | MET | `packages/app/src/workflow/steering.ts:84` implements targeted commands, version checks, ack/nack, actor/deadline, idempotency, timeout, and cancellation. |
| R11 | MET | `packages/app/src/workflow/steering.ts:181` rejects completed-history mutation and `packages/app/src/workflow/steering.ts:194` policy-gates failed-attempt retries. |
| R12 | MET | `docs/design/workflow-steering-control-channel.md:1` is design-only; runtime rejects detached steering at `apps/cli/src/commands/workflow.ts:151`. |
| R13 | MET | `packages/app/src/workflow/trace-writer.ts:6` writes schema-v1 append-only traces only under `.spur/runs/workflow/`. |
| R14 | MET | Producer/CLI suites cover TTY-mode policy, machine modes, async follow, cancellation, pressure, redaction, unavailable usage, and failures; compiled dogfood covers the end-to-end surface. |
| R15 | MET | `package.json:32` consumes published 0.4.14 packages; upstream publish run `30388111243` succeeded and the rebuilt binary passed compiled dogfood. |

Functional Verdict: PASS

**SECUA findings**

| Priority | Dimension | Status | Evidence and disposition |
| --- | --- | --- | --- |
| P1 | Security | FIXED | Cross-chunk configured-secret disclosure was closed at `packages/app/src/observability/agent-execution.ts:145`; regression at `packages/app/tests/observability/agent-execution.test.ts:61`. |
| P2 | Correctness/Security | FIXED | Malformed deadlines, non-finite/unbounded policies, empty notes/IDs, and completed-action abort were rejected/capped at `packages/app/src/workflow/steering.ts:164`; regressions at `packages/app/tests/workflow/steering.test.ts:90` and `packages/app/tests/workflow/steering.test.ts:173`. |
| P2 | Correctness | FIXED | Queued output now drains before a later heartbeat so observer order agrees with event sequence at `packages/app/src/observability/agent-execution.ts:135`. |
| P3 | All | NONE | No unresolved minor finding after the repair pass. |
| P4 | Architecture | NONE | No speculative seam or structural follow-up is required for this task. |

**Architecture/deepening assessment**

No blocker, major, minor, or advisory deepening candidate remains. The new lifecycle, steering controller,
trace writer, pure renderer, CLI adapter, and domain DAO each own non-trivial behavior behind a narrow tested
surface. Dependency direction remains `apps/cli -> packages/app -> packages/domain` plus published
`@gobing-ai/ts-*` facades; cross-process control is deliberately not smuggled through the EventBus.

**Disposition**

No unresolved review finding. The diff is large because the approved task is an end-to-end cross-package
slice plus its upstream release, but its concerns are separated by existing package seams and independently
tested. Review Verdict: PASS.
### References
- Feature D1: `docs/features/D1_workflow-run-observability-enriched-step-lines-fsm-transitions-async-follow.md`
- Locked design task: `docs/tasks2/0310_decide-the-verbosity-model-for-spur-workflow-run-output.md`
- Current design: `docs/design/workflow-observability.md`
- Approved brainstorm: `docs/design/brainstorm-workflow-observability-steering.md`
- Idea evaluation: `.spur/run/idea-eval-report.md`
- Dogfood runs: `74dbd5e2-4124-4921-9256-6ba241174c9f`,
  `02b64ff0-a216-4780-aac2-65831cbfe768`
- Spur observability: `packages/app/src/workflow/observability.ts`
- Pure renderer: `packages/app/src/workflow/step-reporter.ts`
- Agent action: `packages/app/src/workflow/actions/agent-run.ts`
- Workflow CLI: `apps/cli/src/commands/workflow.ts`
- Blocking correctness task: 0366
### History
- 2026-07-28T17:30:55.988Z todo → wip (system)
- 2026-07-28T18:55:47.937Z wip → testing (system)
- 2026-07-28T18:56:45.861Z testing → done (system)
