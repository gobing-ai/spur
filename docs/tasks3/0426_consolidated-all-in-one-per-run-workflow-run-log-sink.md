---
template: feature-impl
schema_version: 1
name: "Consolidated all-in-one per-run workflow run log sink"
description: ""
status: wip
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["workflow", "observability", "log", "sink"]
dependencies: []
created_at: "2026-08-04T17:25:04.906Z"
updated_at: "2026-08-04T19:29:21.387Z"
---

## 0426. Consolidated all-in-one per-run workflow run log sink

### Background

Feature D2 — the producer for the consolidated run log. Builds the read-only WorkflowObservabilityBus subscriber that writes `.spur/run/<RUNID>.log` from run creation to terminal status, subsuming the current `RunOutputSink` (which today writes only agent output to `.spur/run/<RUNID>-output.log`). One cohesive module (packages/app observability + agent-run/steering wiring), so kept as one task despite covering most core scenarios.

Implements: R1 — workflow run writes a single all-in-one log at .spur/run/RUNID.log covering creation to terminal status; R2 — the all-in-one log captures the run's foreground rendering; R3 — the all-in-one log captures every child agent's stdout and stderr; R4 — the all-in-one log captures steering commands consumed from stdin; R5 — --async runs write their narration to the all-in-one log; R10 — the all-in-one log never leaks prompt bodies or shell command text; R11 — the all-in-one log stays bounded with an explicit truncation marker; R12 — an unwritable .spur/run directory degrades the log, never the run.

Rubric: E3 D2 L1 C1 R1 = 8 → decompose (parent scored 14); kept whole on cohesion (single observability module).

### Requirements
- [x] R1. Write a single all-in-one log at `.spur/run/<RUNID>.log` covering the run from creation to terminal status, produced in-process by a read-only `WorkflowObservabilityBus` subscriber.
- [x] R2. Capture the run's foreground rendering into the log: plan preview, per-step progress lines, FSM transitions, and the final summary.
- [x] R3. Capture every child agent's stdout and stderr into the log (the current `RunOutputSink` chunk contract).
- [x] R4. Capture steering commands consumed from stdin into the log, note text redacted before the 1,024-char bound.
- [x] R5. Produce the log for `--async` detached runs via an in-process file write, independent of the nohup std-stream `/dev/null` redirect.
- [x] R6. Redaction holds end-to-end: prompt bodies become `[prompt N chars]`, shell commands `[shell command redacted]`, configured secrets `[REDACTED]` — the consolidated log is not a leak.
- [x] R7. Enforce bounded volume with an explicit truncation marker when a configured byte/line bound is hit; never silently cut.
- [x] R8. Best-effort writes: an unwritable `.spur/run/` dir or failing disk degrades the log, never the run.
- [x] R9. Subsume `<RUNID>-output.log` (fold its output into `<RUNID>.log`) and repoint the timed-out-implement runbook consumer to the new path in the same change.
### Acceptance Criteria
```gherkin
Feature: Consolidated all-in-one per-run workflow run log sink

  @core
  Scenario: R1 — workflow run writes a single all-in-one log at .spur/run/RUNID.log covering creation to terminal status
    Given a workflow run is started with spur workflow run
    When the run reaches a terminal status
    Then exactly one log file exists at .spur/run/RUNID.log for that run
    And that log file contains entries spanning from run creation to terminal status

  @core
  Scenario: R2 — the all-in-one log captures the run's foreground rendering
    Given a workflow run is started with spur workflow run
    When the run completes
    Then the log at .spur/run/RUNID.log contains the plan preview
    And the log contains per-step progress lines
    And the log contains the FSM transitions
    And the log contains the final summary

  @core
  Scenario: R3 — the all-in-one log captures every child agent's stdout and stderr
    Given a workflow run with at least one agent.run step that writes to stdout and stderr
    When the run completes
    Then the log at .spur/run/RUNID.log contains each child agent's stdout
    And the log contains each child agent's stderr

  @core
  Scenario: R4 — the all-in-one log captures steering commands consumed from stdin
    Given a workflow run is started with spur workflow run --steer
    When the operator sends steering commands via stdin during the run
    Then the log at .spur/run/RUNID.log contains each steering command consumed by the run

  @core
  Scenario: R5 — --async runs write their narration to the all-in-one log instead of discarding it
    Given a workflow run is started with spur workflow run --async
    When the detached worker runs to a terminal status
    Then the log at .spur/run/RUNID.log contains the run's foreground rendering
    And the log contains the child agents' output

  @edge
  Scenario: R10 — the all-in-one log never leaks prompt bodies or shell command text
    Given a workflow run whose agent prompts contain secret material and whose shell actions contain command text
    When the run completes
    Then the log at .spur/run/RUNID.log does not contain any prompt body
    And the log does not contain any shell command text

  @edge
  Scenario: R11 — the all-in-one log stays bounded with an explicit truncation marker
    Given a workflow run whose combined output exceeds the configured log byte or line limit
    When the run completes
    Then the log at .spur/run/RUNID.log is capped at the configured limit
    And a visible truncation marker is written at the truncation point

  @edge
  Scenario: R12 — an unwritable .spur/run directory degrades the log, never the run
    Given the .spur/run directory is unwritable
    When a workflow run is started with spur workflow run
    Then the run proceeds and reaches a terminal status
    And no RUNID.log file is written for that run
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Chosen approach: a read-only consolidated `WorkflowRunLogSink` subscribed to the existing `WorkflowObservabilityBus`, subsuming `RunOutputSink`.** The bus already carries every event the log needs (`workflow.run.started/finalized`, `workflow.phase`, `workflow.transition`, `workflow.action.started/finished`, `workflow.action.output` shell chunks, `workflow.agent` lifecycle, `workflow.steering` acks). The sink subscribes once at run creation and appends formatted lines to `.spur/run/<RUNID>.log` until terminal status. It replaces the per-agent.run `RunOutputSink` that today writes only agent output to `<RUNID>-output.log`.

Key decisions:

1. **Reuse existing redaction + rendering.** Event payloads are already redacted at the seam (`projectActionMetadata` → `[prompt N chars]` / `[shell command redacted]`, `bounded` → `[REDACTED]`; agent chunks already pass `redactAndBound`). Progress lines reuse `renderStepLine(event, { detail: 'full', showRunId: true })` so the log matches the human renderer (R2). Agent stdout/stderr reuse the RunOutputSink `[ts] stream: chunk` contract (R3). No new prompt or shell text enters the log (R6).
2. **Single file, in-process.** The sink is built in the CLI run path (where the per-run bus, runId, and rendered plan live) and closed in the run's `finally`. Because the detached `--async` worker re-enters the same synchronous run path (`SPUR_ASYNC_WORKER=1` → `workflow run --run-id`), the in-process sink writes `<RUNID>.log` independent of the nohup `/dev/null` std-stream redirect (R5).
3. **Bounds + best-effort inherited.** Volume is bounded by the existing `agent.output` config (`max-bytes` default 1 MiB, `max-lines` unbounded), with a visible truncation marker on the bound — never a silent cut (R7). Every write is best-effort; an unwritable `.spur/run/` degrades the log, never the run (R8).
4. **Steering capture.** The `workflow.steering` ack (already emitted by the CLI controller `onAck`) is appended as `[steer] <operation> …`, with the note text passed through `bounded(note, 1024)` — redacted and bounded before the 1,024-char bound (R4).
5. **Subsumption (R9).** The per-agent.run `RunOutputSink` and its `outputLog` threading are removed; `outputArtifactForRun`/`traceRun` repoint to `.spur/run/<RUNID>.log`. Verified: the runbook references no `-output.log` tail (only `-partial.md` salvage), so no runbook repoint is needed.

Invariants: the sink never mutates the run, never throws, never changes exit codes; `--json` output unchanged; the board keeps reading DB/system events, not the log file.
### Plan
1. **New module** — `packages/app/src/observability/workflow-run-log-sink.ts`: `WorkflowRunLogSink` (constructor `{ bus, dir, runId, planPreview?, maxBytes?, maxLines? }`) + `WorkflowRunLogConfig` type + `DEFAULT_RUN_LOG_MAX_BYTES`; subscribes to the bus, appends header/plan → progress (renderStepLine) → agent (RunOutputSink contract) → steering (bounded note) → summary; bounds + truncation marker + best-effort writes; `close()` unsubscribes + closes fd.
2. **Config** — keep `agent.output` schema; repurpose `resolveOutputLogConfig` (export from `workflow-service.ts` + app index) to return `WorkflowRunLogConfig`.
3. **CLI wiring** — in `apps/cli/src/commands/workflow.ts` run path: build the sink with the bus, `.spur/run`, runId, rendered plan (computed once, shared with the human preview), and config bounds; close it in `finally`.
4. **Remove per-agent.run sink** — `agent-run.ts` (drop `outputLog` param + sink creation; observer = bus emit only), `builtins.ts` (drop `outputLog` option), `workflow-service.ts` `createEngineService` (drop `outputLog`).
5. **Repoint artifact (R9)** — `outputArtifactForRun` → `.spur/run/<RUNID>.log`; CLI trace label "Agent output:" → "Run log:"; update affected tests.
6. **Tests** — replace `run-output-sink.test.ts` with `workflow-run-log-sink.test.ts` (header+plan, progress lines, agent chunks, steering redaction, bounds+truncation, unwritable dir); update agent-run/workflow-service/CLI tests for the new path.
7. **Gate** — `bun run lint`, `bun run test` (affected packages), `bun run check`; coverage ≥90% on the new module.
### Solution
Implemented the consolidated all-in-one per-run workflow run log (feature D2 / task 0426) as a read-only `WorkflowRunLogSink` on the existing `WorkflowObservabilityBus`, subsuming the per-agent.run `RunOutputSink`.

| File | Change |
|------|--------|
| `packages/app/src/observability/workflow-run-log-sink.ts:44` (new) | `WorkflowRunLogSink` — subscribes to `workflow.run.started/phase/transition/action.started/action.finished/action.output/agent/steering/run.finalized` and appends `.spur/run/<RUNID>.log` from run creation to terminal status. Header + plan preview written exactly once (duplicate `run.started` guard, `packages/app/src/observability/workflow-run-log-sink.ts:119`). Progress/transitions/action lifecycle via `renderStepLine(..., {detail:'full', showRunId:true})` (R2). Child-agent stdout/stderr via the RunOutputSink `[ts] stream: chunk` contract (R3). Steering acks with note redacted+bounded to 1024 (R4). Byte bound default 1 MiB + line bound + visible truncation marker (R7); best-effort writes, unwritable dir → inert (R8). `close()` unsubscribes + closes fd. |
| `packages/app/src/services/workflow-service.ts:836` | `resolveOutputLogConfig` now returns `WorkflowRunLogConfig` and is exported for the CLI sink builder; `outputArtifactForRun` (`packages/app/src/services/workflow-service.ts:857`) repoints to `.spur/run/<RUNID>.log` (R9); `createEngineService` no longer threads `outputLog` into builtins. |
| `packages/app/src/workflow/actions/agent-run.ts:153` | Removed `outputLog` ctor param + per-step `RunOutputSink`; the observer fans out only to `bus.emit('workflow.agent', event)`. No per-step artifact file. |
| `packages/app/src/workflow/builtins.ts` | Removed `outputLog` from `SpurWorkflowBuiltinsOptions` and stopped passing it to `AgentRunActionRunner`. |
| `packages/app/src/index.ts:395` | Exports `WorkflowRunLogSink`, `WorkflowRunLogConfig`, `DEFAULT_RUN_LOG_MAX_BYTES`, `resolveOutputLogConfig`. |
| `apps/cli/src/commands/workflow.ts:299` | Run path builds `WorkflowRunLogSink` with the bus, `.spur/run`, runId, rendered plan (computed once, shared with the human preview), and config bounds; closed in `finally` (`apps/cli/src/commands/workflow.ts:369`). The detached `--async` worker re-enters this path (`SPUR_ASYNC_WORKER=1` → `workflow run --run-id`), so the in-process sink writes `<RUNID>.log` independent of the nohup `/dev/null` redirect (R5). Trace label "Agent output:" → "Run log:" (`apps/cli/src/commands/workflow.ts:661`). |
| `config/rules/strict/runtime-boundaries.yaml:62` | Sync-FD allowlist entry repointed from `run-output-sink.ts` to `workflow-run-log-sink.ts`. |
| Tests | Replaced `run-output-sink.test.ts` with `workflow-run-log-sink.test.ts` (11 tests: header+plan-once, progress+transitions+summary, agent chunks, steering note redaction, no prompt/shell leak, byte+line truncation, unwritable dir, close idempotent+unsubscribe). `agent-run.test.ts` rewritten to assert `workflow.agent` bus fan-out. `workflow-service.test.ts` tests `resolveOutputLogConfig` provenance + repointed trace artifact. `workflow.test.ts` updated for the `.log` path + "Run log:" label. |

R9 runbook repoint: verified the timed-out-implement runbook (`plugins/sp/skills/spur-dev/references/execution-workflow.md`) references only `<RUNID>-<step>-partial.md`, not `-output.log` — no runbook change needed.
### Testing
**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Sink writes single `.spur/run/<RUNID>.log` from creation to terminal: header on run.started with duplicate-projection guard (`workflow-run-log-sink.ts:123`), final summary on run.finalized (`:148`). Tests `workflow-run-log-sink.test.ts:87` (single log + header) and `:109` (exactly-once). |
| R2 | MET | Foreground rendering via `renderStepLine(..., {detail:'full', showRunId:true})` (`workflow-run-log-sink.ts:132`) + plan preview written once (`:124`). Test `:124` (progress/transitions/summary). |
| R3 | MET | Child-agent stdout/stderr via the RunOutputSink chunk contract (`onAgent` `:153`); chunks redacted at source `agent-execution.ts:206`. Test `:163`. |
| R4 | MET | Steering note redacted+bounded: `bounded(note, 1024)` (`onSteering` `:146`; `observability.ts:144` SECRET_PATTERN). Test `:181`. |
| R5 | MET | Detached async worker re-enters the shared run path (`workflow.ts:50`/`:227` spawn `--run-id` with `SPUR_ASYNC_WORKER=1`, `:307` builds the sink in-process) — independent of nohup `/dev/null`. CLI test `apps/cli/tests/commands/workflow.test.ts:277` exercises the `--run-id` path to exit 0. |
| R6 | MET | Redaction end-to-end: prompts→`[prompt N chars]`, shell→`sanitizeCommand`, secrets→SECRET_PATTERN (`observability.ts:144`/`:150`). Test `:197` (no prompt/shell leak). |
| R7 | MET | Byte+line bounds with visible truncation marker (`append` bound check + marker `:203`). Tests `:226` (byte), `:241` (line). |
| R8 | MET | Best-effort: ctor try→fd undefined, append catches write errors. Test `:264` (unwritable dir degrades, never run). |
| R9 | MET | Subsumes `-output.log`: `RunOutputSink` + `outputLog` threading removed (agent-run observer bus-emit only `agent-run.ts:166`; builtins/service), `outputArtifactForRun` repointed, CLI label "Run log:". Service+agent-run tests 122 pass. |
| R10 | MET | No prompt/shell leak (R6 test `:197`); plan preview = node/state IDs only (`step-reporter.ts:169`). |
| R11 | MET | Bounded + truncation marker (R7 tests `:226`/`:241`). |
| R12 | MET | Unwritable `.spur/run/` degrades log, never run (R8 test `:264`). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario R1 | MET | test | `workflow-run-log-sink.test.ts:87`, `:109` |
| Scenario R2 | MET | test | `workflow-run-log-sink.test.ts:124` |
| Scenario R3 | MET | test | `workflow-run-log-sink.test.ts:163` |
| Scenario R4 | MET | test | `workflow-run-log-sink.test.ts:181` |
| Scenario R5 | MET | test+static | CLI `workflow.test.ts:277` (exercises `--run-id` re-entry); `workflow.ts:50/227/307` |
| Scenario R10 | MET | test | `workflow-run-log-sink.test.ts:197` |
| Scenario R11 | MET | test | `workflow-run-log-sink.test.ts:226`, `:241` |
| Scenario R12 | MET | test | `workflow-run-log-sink.test.ts:264` |

**Coverage:** `workflow-run-log-sink.ts` 100% line / 95% funcs (sole module under per-file gate). Affected suites run this turn: 11 (sink) + 122 (app agent-run/workflow-service) + 74 (CLI workflow) = **207 pass, 0 fail**.

**Checks:** tests-pass=pass (207/0); lint-clean=pass (biome check clean on 6 changed source files); design-conformance=pass (all 5 Design claims DONE — read-only bus sink, reuse redaction/rendering, single in-process file, bounds+best-effort, subsumption); cli-golden-path-present=pass (`workflow.test.ts:277` golden `workflow run --run-id` → exit 0).

**SECUA Review** (answer-file only, not a task section)

- P3 (advisory, defense-in-depth): `onAgent` `output` branch writes `event.chunk` verbatim, relying solely on upstream redaction (`agent-execution.ts:206` `redactAndBound`). The sink is a durable disk boundary; recommend re-applying `bounded(chunk)` there as belt-and-braces. Not blocking — source verified redacted this run, and the no-leak test (`:197`) guards it. No action taken under `--fix all` (minor/advisory, not a major finding).
- No P1/P2 findings.
### Review
Reviewed the implemented work for 0426 (sp-dev-review, independent of the pipeline's own review). Reviewed files: `packages/app/src/observability/workflow-run-log-sink.ts`, `workflow-service.ts` (resolveOutputLogConfig/outputArtifactForRun), `workflow/actions/agent-run.ts`, `workflow/builtins.ts`, `apps/cli/src/commands/workflow.ts`, plus the sink/agent-run/service/CLI tests.

**Functional traceability — PASS (R1–R12).**
- R1 single `<RUNID>.log` from creation to terminal: header on `workflow.run.started` (duplicate-started guard), final summary on `workflow.run.finalized`. Verified `workflow.ts:299` builds the sink unconditionally; `finally` at `:401` closes it.
- R2 foreground rendering: `renderStepLine(..., {detail:'full', showRunId:true})` for progress/transitions/action lifecycle; `renderRunPlan` preview shared with the human renderer.
- R3 agent stdout/stderr: `onAgent` output chunks written; chunks redacted+bounded at source (`agent-execution.ts:206` `redactAndBound`).
- R4 steering: `onSteering` applies `bounded(note, 1024)` — redacts secrets (SECRET_PATTERN) before the 1024-char bound. Correct.
- R5 async: detached worker re-enters the same run path (`SPUR_ASYNC_WORKER=1` → `workflow run --run-id`), so the in-process sink writes independent of nohup `/dev/null` redirect.
- R6/R10 redaction end-to-end: prompt bodies → `[prompt N chars]`, shell commands → `sanitizeCommand`+bounded (never copied), secrets → SECRET_PATTERN. `renderRunPlan` emits only node/state IDs — no command/prompt body reaches the header. No-leak test asserts.
- R7/R11 bounds: `append` enforces `maxBytes` (1 MiB) + optional `maxLines` with visible `TRUNCATION_MARKER`; never silent.
- R8/R12 best-effort: constructor `try` → fd undefined on unwritable dir; `append` catches write errors; run never affected. Tested.
- R9 subsumption: `RunOutputSink` + `outputLog` threading removed from agent-run/builtins/service; `outputArtifactForRun`/trace repoint to `.spur/run/<RUNID>.log`; CLI trace label "Agent output:" → "Run log:"; runtime-boundaries sync-FD allowlist repointed. Runbook verified to reference only `-partial.md`, not `-output.log`.

**SECUA findings.**
- P3 (defense-in-depth, non-blocking): `onAgent` `output` writes `event.chunk` verbatim, relying solely on upstream redaction (`agent-execution.ts:206`). The sink is a durable disk boundary; a future agent-service change emitting a raw chunk would leak into the persisted log undetected. Recommend the sink re-apply `bounded(chunk)` on the output branch as belt-and-braces. Low practical risk today (source verified redacted; no-leak test guards it).
- No P1/P2. No command-text or prompt-body leak path found in the sink or its wiring.

**Architecture — sound.** Cohesive single observability module; read-only bus subscriber (never mutates the run, never throws, never changes exit code); replaces per-agent.run file sink with one consolidated writer; exports added at the app index; no new FSM; `--json`/board paths untouched.

**Verification (run during this review):** `workflow-run-log-sink.test.ts` 11 pass / 100% line on the sink module; `agent-run.test.ts` + `workflow-service.test.ts` 122 pass; `apps/cli/tests/commands/workflow.test.ts` 74 pass; `biome check` clean on the 6 changed source files.

**Disposition:** APPROVE. Single P3 defense-in-depth suggestion; no blocking findings.
### References

D2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-04T19:15:32.129Z todo → wip (system)
