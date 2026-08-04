---
template: issue
schema_version: 1
name: "Fine-tune workflow execution progress logging and step reporter CLI UX"
description: "Umbrella task to address workflow execution CLI logging friction: omit redundant run ID prefixes, hide unavailable agent/model metadata on non-agent actions, render note messages and shell commands, include subprocess PID and exit codes, omit usage unavailable noise, and format state transitions."
status: done
type: issue
profile: standard
feature_id: D
parent_wbs: null
priority: P2
tags: ["workflow", "logging", "cli", "ux", "step-reporter", "umbrella"]
dependencies: []
created_at: "2026-08-03T17:59:17.973Z"
updated_at: "2026-08-04T00:49:34.206Z"
---

## 0421. Fine-tune workflow execution progress logging and step reporter CLI UX

### Background

Observation of `spur workflow run .spur/workflows/idea-pipeline.yaml` revealed several progress logging UX friction points in `packages/app/src/workflow/step-reporter.ts`:

1. **Redundant Run ID Prefix:** Every line prepends `[run 36fcb2e6-4541-4f83-9c9f-a58e489dfdc3]`, duplicating the run ID printed at run start across 30+ lines and consuming ~40 chars of horizontal terminal width.
2. **`agent=unavailable · model=unavailable` Noise:** Non-agent actions (`note`, `shell`, `hitl.confirm`, `file.read.into-var`) display `agent=unavailable · model=unavailable` by default.
3. **`start/note` Renders `=> unavailable`:** `note` actions display `=> unavailable` instead of showing the note message/hint.
4. **`start/shell` Indiscriminate Redaction:** Shell actions render `=> [shell command redacted]` for all shell invocations regardless of sensitivity.
5. **Missing Subprocess PID & Exit Codes:** Agent execution heartbeats lack subprocess `pid` metadata, and finish events display `agent done` / `agent failed` without exit status code details (`exit 0`, `exit 1`).
6. **`usage unavailable` Boilerplate:** Non-agent actions (`note`, `shell`) output `· usage unavailable` on every completion event.
7. **Hidden State Transitions:** State transition events `↪ from → to` are suppressed in standard (`invocation`) detail mode and only show in `--detail full`.
8. **Sub-agent Output Visual Indentation:** Sub-agent stdout/stderr chunks use flat margin alignment instead of indented visual hierarchy under their parent `agent.run` action block.
9. **Missing Shell Action Output Streaming:** `shell` actions run process execution silently without streaming stdout/stderr output chunks to the observability bus during execution.
10. **Suppressed Failure Output Details:** When `shell` or `agent.run` actions complete or fail, stdout/stderr output snippets or error messages are dropped from the finish event (`projectResult`), leaving the operator with only a pass/fail mark instead of showing *what happened during execution*.

### Requirements

- [ ] R1. Omit 36-char GUID run ID prefix `[run <runId>]` in single-run CLI progress output (or condense to `[run shortId]` in multi-run mode).
- [ ] R2. Omit `agent=` and `model=` metadata key-value pairs when `agent === 'unavailable'` or when action `kind` is non-agent (`note`, `shell`, `hitl.confirm`, `file.read.into-var`).
- [ ] R3. Render note message string (truncated to ~70 chars) for `note` actions instead of `=> unavailable`.
- [ ] R4. Render actual shell command string (sanitized and truncated to ~80 chars) for `shell` actions instead of `=> [shell command redacted]`.
- [ ] R5. Include subprocess PID in agent execution heartbeat/start lines, and log exit status code on completion (`exit 0`, `exit 1`).
- [ ] R6. Omit `· usage unavailable` for non-agent actions; display token usage metrics only when data exists.
- [ ] R7. Render state transition lines `↪ from → to` in standard `invocation` detail mode.
- [ ] R8. Indent child agent stderr/stdout stream lines and heartbeats with 2-space padding under parent `agent.run` action boundary.
- [ ] R9. Stream shell action stdout/stderr output chunks to the observability bus during execution (under `--detail invocation` / `full`).
- [ ] R10. Capture and display stdout/stderr output snippets or error output in action finish events when shell or agent actions fail or finish, showing what happened during execution.

### Acceptance Criteria
```gherkin
Feature: Fine-tune workflow execution progress logging and step reporter CLI UX

  @core
  Scenario: R1 & R2 — Non-agent actions omit run ID and unavailable agent/model metadata
    Given a workflow run emits a start/note or start/shell action event
    When renderStepLine formats the progress event for standard CLI output
    Then the line does not repeat the 36-character run GUID prefix
    And agent=unavailable and model=unavailable are omitted

  @core
  Scenario: R3 — Note actions render the note message
    Given a workflow action of kind note is started with message "Idea pipeline start"
    When renderStepLine formats the action started event
    Then the output displays "→ start/note => Idea pipeline start"

  @core
  Scenario: R4 — Shell actions render sanitized command summaries
    Given a workflow action of kind shell is started with command "mkdir -p .spur/run"
    When renderStepLine formats the action started event
    Then the output displays "→ start/shell => mkdir -p .spur/run"

  @core
  Scenario: R5 — Agent heartbeats show PID and finish events log exit status
    Given a real agent execution has spawned a subprocess
    When the agent execution lifecycle emits a heartbeat or finish event
    Then the emitted event carries the subprocess pid supplied by the runtime rather than a test-injected value
    And the rendered heartbeat line includes "pid=<pid>" for that subprocess
    And completion lines explicitly report the exit status code (e.g., exit 0)

  @core
  Scenario: R6 — Usage unavailable boilerplate is hidden for non-agent actions
    Given a non-agent shell or note action finishes
    When renderStepLine formats the finish event
    Then "· usage unavailable" is omitted from the line

  @core
  Scenario: R7 & R8 — Transitions render in standard mode and child outputs are indented
    Given a workflow transition event from discovery to idea-eval occurs
    When renderStepLine formats the transition event
    Then "↪ discovery → to idea-eval" renders in invocation mode
    And sub-agent stdout/stderr chunks are indented by 2 spaces

  @core
  Scenario: R9 & R10 — Shell and agent.run stream stdout/stderr output and show failure details
    Given a shell action or agent.run action produces stdout or stderr output
    When the action streams output or finishes with a failure
    Then stdout and stderr output chunks are streamed to the progress view
    And failure finish lines include the stdout/stderr output snippet explaining what happened
```
### Q&A

- **Q: Should `[run <id>]` be completely removed or configurable?**  
  *A:* In single-run CLI mode (the 99% default), `[run <id>]` is redundant because `Run: <id>` is already printed in the header box. When running in multi-run or verbose mode (`--detail full`), short 8-char prefixes (`[ac350c4c]`) can be enabled.

### Design

- **Primary file:** `packages/app/src/workflow/step-reporter.ts`
- **Helpers:** Add `sanitizeCommand(cmd: string, maxLen?: number): string` and `formatActionInvocation(event: WorkflowActionStartedEvent): string`.
- **Test coverage:** `packages/app/tests/workflow/step-reporter.test.ts`.

### Plan

1. Update `renderStepLine` in `step-reporter.ts` for R1 (prefix handling) and R2 (metadata filtering).
2. Implement R3 (note message extraction) and R4 (command sanitization/truncation).
3. Implement R5 (PID and exit status reporting) and R6 (conditional usage display).
4. Enable R7 (transition lines in `invocation` mode) and R8 (2-space indentation).
5. Update and add unit tests in `packages/app/tests/workflow/step-reporter.test.ts`.

### Root Cause

`packages/app/src/workflow/step-reporter.ts` used hardcoded string templates (`[run ${event.runId}] ... · agent=${agent} · model=${model} => ${invocation} · usage ${usage}`) without checking if metadata was `unavailable` or if `invocation` was a note message or shell command string.

### Solution
Reworked workflow CLI progress rendering to eliminate the redundant run-id prefix, hide unavailable metadata on non-agent actions, render note/shell payloads, surface subprocess pid + exit status, omit usage-unavailable boilerplate, and stream live shell output chunks. Implementation landed in the CLI, observability, and workflow action layers.

**step-reporter.ts** — `runPrefix` condenses a 36-char run GUID to its first 8 chars when shown (`[run 36fcb2e6]`) and returns `''` under `showRunId: false`; the run id is printed once in the CLI header, so single-run lines no longer repeat it (R1) (`packages/app/src/workflow/step-reporter.ts:54-62`). `renderActionHeartbeat` routes through the same prefix. Agent started/heartbeat lines render ` · pid=<n>` from the producer chain below (R5) (`:83`, `:92`); heartbeat gained the 2-space child indent (R8) (`:80`). Agent finished lines always report exit status (` · exit 0` / ` · exit 1`) when known (R5) (`:98`). Non-agent action.finished lines omit ` · usage unavailable`; usage shows only when real (R6) (`:113-115`). R2/R3/R4/R7 renderer branches guard against `unavailable` metadata, render note/shell invocation, and render transitions for non-minimal detail (R7) (`:121-142`). `workflow.action.output` events render as 2-space-indented `stdout>`/`stderr>` child lines under the action block (R9) (`:103-107`).

**workflow/actions/shell.ts** (new) — `StreamingShellActionRunner` (kind `shell`) replaces the engine's buffered runner via `registerSpurBuiltins`. It uses `ProcessExecutor.runStreaming` (Bun.spawn) so stdout/stderr chunks stream to the observability bus (`workflow.action.output`) as they arrive (R9), with bare `command` lines run via `/bin/sh -c` to preserve shell semantics (`:49`). Decoded output is accumulated into `ActionResult.data` so the buffered finish result stays authoritative for failure snippets (R10) (`:114-120`).

> **Shell semantics are load-bearing.** The bare-`command` → `/bin/sh -c` split mirrors the engine's `ShellActionRunner` exactly (see `ShellActionRunner.execute` in the `@gobing-ai/ts-dual-workflow-engine` package's `src/host.ts`). An earlier revision of this runner spawned the bare command as a single executable, which fails with a null exit code for any command line containing a space (`sleep 30`, `bun run test`). Both paths are pinned by regression tests — see task 0423 RC2.

**workflow/observability.ts** — added `WorkflowActionOutputEvent` + `'workflow.action.output'` bus channel (`:107-130`); `bounded` redacts secret patterns and caps chunk length (`:141-145`). Broadened `projectResult` so stdout/stderr snippets flow into the finish event (R10) (`:183-191`).

> **Known limitation — action-level usage has no producer.** `projectResult` returns `usage: 'unavailable'` on every path (`packages/app/src/workflow/observability.ts:194`), so R6's "show usage when the data is real" branch (`packages/app/src/workflow/step-reporter.ts:113-115`) is currently unreachable for `action.finished` events. R6 is still satisfied — non-agent actions have no token usage to show, and the boilerplate is correctly omitted — but nothing yet flows a real per-action usage figure. Agent-level usage is separate and does flow, via `event.usage` (`packages/app/src/workflow/step-reporter.ts:101`).

**Subprocess pid — the R5 producer chain.** The renderer seam alone was not enough: nothing set `pid`, so real runs never showed it. Closing that needed one upstream addition plus local wiring.

- `@gobing-ai/ts-runtime@0.4.17` adds an optional `onSpawn?: (pid: number) => void` to `ProcessOptions`, invoked with the live `execa` subprocess pid the moment the child is spawned. The resolved `ProcessResult` cannot carry this — execa@9 resolves only after exit, when the pid is already historical. The same change also records the pid against the process-registry entry for buffered runs, which previously appeared pid-less in the Processes tab.
- `packages/app/src/services/agent-service.ts:238-262` — `PidObservingProcessExecutor` injects that hook at the single place Spur constructs the executor. `AiRunner` owns the `run()` options for an agent dispatch, so the hook cannot be threaded through the call site; subclassing here avoids a second upstream change to `ts-ai-runner`. A caller-supplied `onSpawn` is composed with, not replaced.
- `packages/app/src/services/agent-service.ts:545,558,608` — the sink is assigned once the lifecycle exists (the lifecycle spans the whole escalation chain, so it is built after the runner); until then a spawn simply has no observer.
- `packages/app/src/observability/agent-execution.ts:128-136,246` — `setPid` records it and `makeEvent` stamps it onto *every* subsequent event, so started/heartbeat/output/finished all carry it without each call site remembering. Non-integer or non-positive values are rejected, and `pid` stays absent when a dispatch never reports one.

**workflow/builtins.ts** — `registerSpurBuiltins` accepts optional `processExecutor` and registers `StreamingShellActionRunner` after `createDefaultWorkflowEngineHost`, overriding the engine's `shell` runner by kind (`:56-57`).

**services/workflow-service.ts** — `createEngineService` threads the CLI's `processExecutor` into `registerSpurBuiltins` (`:763-773`).

**apps/cli/src/commands/workflow.ts** — single-run `workflow run` passes `showRunId: false` (R1) (`:300`); subscribes `workflow.transition` for all non-minimal detail (R7) (`:306-309`); subscribes `workflow.action.output` to stream shell chunks live (R9) (`:334`).

**Not part of this task.** The working tree also carries a change to `config/workflows/idea-pipeline.yaml` (dropping `--strict` from four `ac-generate` transition guards). That is an unrelated pipeline-deadlock fix and belongs in its own commit — see the note in task 0423.
### Testing
**Verification run (2026-08-03)** — `bun run lint` clean (biome 592 files + all 7 workspaces
typecheck exit 0). Focused suites: `bun test tests/observability/agent-execution.test.ts
tests/workflow/step-reporter.test.ts tests/workflow/actions/shell.test.ts` → **40 pass / 0 fail**.
Full monorepo suite: **4422 pass / 24 fail / 4446 total**; all 24 failures are sandbox denials
(15× "Failed to listen at 127.0.0.1", 2× `EADDRINUSE`, 1× `::1`, 1× `EPERM mkdtemp` outside the
write allowlist) confined to port-binding and process-inventory suites — none touch workflow,
step-reporter, shell-runner, or agent-execution paths.

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 & R2 — Non-agent actions omit run ID and unavailable agent/model metadata | MET | test | `packages/app/tests/workflow/step-reporter.test.ts` "R1" (run GUID → 8 chars / omitted under `showRunId:false`), "R2" (no `agent=`/`model=`) |
| R3 — Note actions render the note message | MET | test | `packages/app/tests/workflow/step-reporter.test.ts` "R3" (`→ start/note => Idea pipeline start`) |
| R4 — Shell actions render sanitized command summaries | MET | test | `packages/app/tests/workflow/step-reporter.test.ts` "R4" (`→ start/shell => mkdir -p .spur/run`); `packages/app/src/workflow/observability.ts:175-181` `sanitizeCommand` |
| R5 — Agent heartbeats show PID and finish events log exit status | **MET** | test (end-to-end) | **PID now has a real runtime producer.** `@gobing-ai/ts-runtime@0.4.17` adds an `onSpawn` hook that publishes the live `execa` subprocess pid at spawn time (the resolved Result never carried it). `packages/app/src/services/agent-service.ts:238-262` `PidObservingProcessExecutor` injects that hook where Spur builds the executor and forwards the pid to `packages/app/src/observability/agent-execution.ts:128-136` `setPid`, which stamps it onto every subsequent event via `makeEvent` (`:246`). `packages/app/src/workflow/step-reporter.ts:83,92` then render ` · pid=<n>`. Proven end-to-end, not by injection: `packages/app/tests/observability/agent-execution.test.ts` spawns `/bin/sh -c 'echo $$'` so the child prints its own pid and the test asserts the reported pid **equals** it, plus a test that `onSpawn` fires while the child is still alive (during a `sleep 0.2`) so heartbeats can carry it. Exit status: `packages/app/src/services/agent-service.ts:753-756` forwards the real `result.exitCode`; `packages/app/src/workflow/step-reporter.ts:98` renders ` · exit N`. |
| R6 — Usage unavailable boilerplate hidden for non-agent actions | MET | test | `packages/app/tests/workflow/step-reporter.test.ts` "R6" (`✓ note/note (0s)` without usage). See the Solution's known-limitation note on action-level usage. |
| R7 & R8 — Transitions render in standard mode and child outputs indented | MET | test | `packages/app/tests/workflow/step-reporter.test.ts` "R7" (`↪ discovery → idea-eval` in invocation; null in minimal) + `apps/cli/src/commands/workflow.ts:306-309` non-minimal subscription; "R8" (2-space indent) |
| R9 & R10 — Shell and agent.run stream stdout/stderr and show failure details | MET | test | R9: `packages/app/tests/workflow/actions/shell.test.ts` (relays chunks to bus, `/bin/sh -c` semantics, direct-args form, failure exit, secret redaction) + `packages/app/tests/workflow/step-reporter.test.ts` "R9" (2-space `stdout>`/`stderr>` lines); R10: "R10" — failing finish includes snippet |

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/workflow/step-reporter.ts:54-62` `runPrefix` (8-char condense / omit); `apps/cli/src/commands/workflow.ts:300` `showRunId:false`; test "R1" |
| R2 | MET | `packages/app/src/workflow/step-reporter.ts:121-127` agent/model guarded against `unavailable`; test "R2" |
| R3 | MET | `packages/app/src/workflow/observability.ts:166-170` note invocation; `packages/app/src/workflow/step-reporter.ts:130`; test "R3" |
| R4 | MET | `packages/app/src/workflow/observability.ts:168` + `sanitizeCommand` at `packages/app/src/workflow/observability.ts:175-181`; test "R4" |
| R5 | **MET** | Producer: `packages/app/src/services/agent-service.ts:238-262` (`PidObservingProcessExecutor`, injects `onSpawn`) + `packages/app/src/services/agent-service.ts:545,558,608` sink wiring to the lifecycle. Carrier: `packages/app/src/observability/agent-execution.ts:128-136` `setPid` + `:246` `makeEvent` stamps `pid` on every event. Renderer: `packages/app/src/workflow/step-reporter.ts:83,92` `pid=`, `:98` `exit N`. Tests: `packages/app/tests/observability/agent-execution.test.ts` — real-pid contract (`echo $$` equality), liveness (fires before exit), sink wiring, caller-`onSpawn` composition, and absent/invalid-pid omission. |
| R6 | MET | `packages/app/src/workflow/step-reporter.ts:113-115` usage omitted when `unavailable`; test "R6" |
| R7 | MET | `packages/app/src/workflow/step-reporter.ts:138-142` transition renders in invocation; `apps/cli/src/commands/workflow.ts:306-309` CLI subscribes non-minimal; test "R7" |
| R8 | MET | `packages/app/src/workflow/step-reporter.ts:80,104-106` 2-space child indent; test "R8" |
| R9 | MET | `packages/app/src/workflow/actions/shell.ts:33` `StreamingShellActionRunner` → `runStreaming` → bus `workflow.action.output`; `packages/app/src/workflow/builtins.ts:56-57` registration overrides engine shell by kind; `apps/cli/src/commands/workflow.ts:334` CLI subscribes; `packages/app/src/workflow/step-reporter.ts:103-107` renders; tests `packages/app/tests/workflow/actions/shell.test.ts` + "R9" |
| R10 | MET | `packages/app/src/workflow/observability.ts:183-191` `projectResult` captures stderr/stdout snippet; `packages/app/src/workflow/step-reporter.ts:109-118` failure; test "R10" |

**Verdict: PASS** — all ten requirements MET. R5's subprocess-PID half, previously a renderer-only
seam with no producer, is now wired end-to-end through the `ts-runtime@0.4.17` `onSpawn` hook and
proven by a test that compares the reported pid against the child's own `echo $$` output, so a
fabricated or injected value cannot satisfy it.

Coverage: N/A for the renderer change (string formatting, no new branch-heavy runtime path);
behavioural assertions live in `packages/app/tests/workflow/step-reporter.test.ts`,
`packages/app/tests/workflow/actions/shell.test.ts`, and
`packages/app/tests/observability/agent-execution.test.ts` (40 pass / 0 fail this run).
### Review
**Functional Traceability** (sp:functional-review, Track B)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `step-reporter.ts:54-62` `runPrefix` — `''` under `showRunId:false`, else `runId.slice(0,8)`; `apps/cli/src/commands/workflow.ts:300` single-run passes `showRunId:false`; test `R1: condenses a 36-char run GUID to 8 chars, and omits it entirely when showRunId=false` |
| R2 | MET | `step-reporter.ts:121-127` `agentPart`/`modelPart` rendered only when present and `!=='unavailable'`; `observability.ts:152-159` `projectActionMetadata` sets agent/model only when non-empty; test `R2: non-agent actions omit agent=/model=` |
| R3 | MET | `observability.ts:168-170` note → `metadata.invocation = bounded(message, 80)`; engine `NoteActionRunner` reads `options.message` (`ts-libs/dual-workflow-engine/src/host.ts:121`); `step-reporter.ts:128-131` renders `=> message`; test `R3: note actions render the note message` |
| R4 | MET | `observability.ts:175-181` `sanitizeCommand` (whitespace-normalize, keyword redaction, `bounded(…, 80)`); `step-reporter.ts:128-131` renders invocation; test `R4: shell actions render a sanitized command summary` |
| R5 | PARTIAL | exit status MET end-to-end: `agent-service.ts:753-756` `lifecycle.finish` forwards real `result.exitCode`; `agent-execution.ts:176-178` emits `exitCode`; `step-reporter.ts:98` renders ` · exit N`; test `R5` exit rows. PID sub-condition MISSING a runtime producer: `agent-execution.ts:18` `pid?` seam + `step-reporter.ts:83,92` render `pid=` only when the event carries it, but `AgentExecutionLifecycle.start/heartbeat/finish` (`agent-execution.ts:130-190`) never set pid, and `AgentRunTracedResult` (`agent-service.ts:187-202`) does not expose one — real `spur workflow run` output never contains `pid=`. |
| R6 | MET | `step-reporter.ts:113-115` `usagePart` appended only when `result.usage !== 'unavailable'`; test `R6: non-agent finish omits usage unavailable; shows usage only when data exists` |
| R7 | MET | `step-reporter.ts:138-142` transition renders unless `detail === 'minimal'`; `workflow.ts:306-309` subscribes `workflow.transition` when `detail !== 'minimal'`; test `R7: transitions render in standard invocation mode` |
| R8 | MET | `step-reporter.ts:80,104-106` 2-space child indent on agent output/heartbeat and action-output lines under the parent block; tests `R8` + `R9` |
| R9 | MET | `actions/shell.ts:31-121` `StreamingShellActionRunner` → `runStreaming` (`:49-56`), bare command via `/bin/sh -c` (`:44-47`), emits `workflow.action.output` (`:85-97,108-118`); `builtins.ts:56-57` registration replaces engine's buffered `ShellActionRunner` by kind (`CapabilityRegistry.register` = `Map.set`, ts-runtime capability-registry.ts:23-27); `workflow.ts:334` CLI subscribes; `step-reporter.ts:103-107` renders indented `stdout>`/`stderr>`; tests `shell.test.ts` (9) + `R9` |
| R10 | MET | `observability.ts:183-191` `projectResult` projects stderr/stdout/error into `result.error` (bounded 120); `step-reporter.ts:109-118` renders snippet on finish; shell failure returns `error` + accumulated stdout/stderr (`shell.ts:119-121`); test `R10: failing finish lines include the stderr/stdout snippet` |

**SECUA Review** (sp:code-verification review mode)

- **C1 (P2, correctness / requirement gap):** R5 PID has no runtime producer — `pid=` is dead in real output. `AgentExecutionLifecycle` never populates `pid` (`agent-execution.ts:130-190`); `AgentRunTracedResult` has no pid field (`agent-service.ts:187-202`); the runner handle's `pipe.pid` (used by `supervisor-service.ts:201`) is not threaded through. Renderer seam + tests exist, but a real `workflow run` never emits `pid=`. Downgrades R5 to PARTIAL.
- **S1 (P3, security, advisory):** layered redaction is sound — `sanitizeCommand` keyword list + `bounded()` `SECRET_PATTERN` (`observability.ts:141`) catch `api-key`/`api_key`/`sk-…` forms; command env values are never projected. Residual: a secret value in an unkeyed position (e.g. `curl -d 'AKIA…'`) still lands in the invocation line. Low risk, pre-existing bounded-projection pattern.
- **E1 (P3, efficiency):** `StreamingShellActionRunner` accumulates stdout/stderr unboundedly (`shell.ts:76-78` `stdout += chunk`); a chatty command (e.g. `bun run test`) grows the finish `data` without a cap. Events are bounded, the accumulation is not — parity with the engine's buffered runner, but a `MAX_BUFFER` cap would bound memory.
- **C2 (P4, correctness):** every `workflow.action.output` event hardcodes `sequence: 0` (`shell.ts:88,109`), breaking the per-run monotonic sequence contract `envelope()` maintains. The reporter only reads stream/chunk today, but a consumer relying on ordering across action events gets constant 0s.
- **C3 (P4, usability):** `projectResult` maps a *successful* shell action's stdout into `result.error` (`observability.ts:186-191` `detail = error ?? stderr ?? stdout`) — a successful `bun build` renders `✓ shell (1s) · built ok`, duplicating the already-streamed output and reusing the failure field for success. Most valuable on failure; consider projecting the snippet only for non-ok actions.
- No blocking security or correctness issues beyond C1.

**Architecture** (sp:code-improvement)

- **A1 (P3, weak locality):** per-detail visibility split across two authorities — the renderer's detail branches (`step-reporter.ts`) and the CLI's subscription gates (`workflow.ts:306-309` transition gate). The R7 fix already moved transition gating into the renderer; fully unifying means subscribing all event kinds unconditionally and letting `renderStepLine`'s detail logic be the single gate (output subscription at `workflow.ts:334` is already unconditional).
- **A2 (P3, weak locality):** `SECRET_PATTERN` redaction duplicated across `observability.ts:141` (`bounded`) and `agent-execution.ts` (`redactAndBound`/`redactStreamingValue`) with divergent pattern sets. Extract one shared redaction util.
- **A3 (P2, wrong seam / portability):** `StreamingShellActionRunner` lives in spur's builtins and overrides the engine's `shell` runner by kind (`builtins.ts:56-57`); non-spur hosts keep the engine's buffered runner (`ts-libs/dual-workflow-engine/src/host.ts:94-96`) — no live streaming there. Moving the streaming runner into the engine host would give every consumer the R9 contract; spur-side override is the safe interim.

**Priority Findings**

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P2 | `packages/app/src/observability/agent-execution.ts:18` | R5 `pid` is a renderer-only seam — no runtime producer sets it; real runs never show `pid=` | Thread `pipe.pid` from the AiRunner dispatch into `AgentExecutionLifecycle.start`/`heartbeat` (or `AgentRunTracedResult.pid`) |
| P2 | `packages/app/src/workflow/actions/shell.ts:31` | Streaming shell runner exists only in the spur host; engine's buffered runner remains for non-spur consumers | Move streaming into the engine host (`host.ts:94-96`) or document the portability gap |
| P3 | `packages/app/src/workflow/actions/shell.ts:76-78` | Unbounded stdout/stderr accumulation in finish `data` | Cap accumulated bytes (e.g. last N KB) while streaming |
| P3 | `packages/app/src/workflow/observability.ts:141` | `SECRET_PATTERN` redaction duplicated across observability and agent-execution | Extract shared redaction util (A2) |
| P3 | `apps/cli/src/commands/workflow.ts:306` | Per-detail subscription gates split between CLI and renderer | Unify on renderer-only detail gating (A1) |
| P4 | `packages/app/src/workflow/actions/shell.ts:88,109` | Output-event `sequence` is constant 0, not per-run monotonic | Generate from the engine's per-run counter |
| P4 | `packages/app/src/workflow/observability.ts:186-191` | Success-path stdout projected into `result.error`; duplicate + mislabeled | Project snippet only on failure (R10 intent) |

**Verification (this run)** — `bun test packages/app/tests/workflow/step-reporter.test.ts packages/app/tests/workflow/actions/shell.test.ts`: 28 pass / 0 fail (34ms); full `bun run test`: 4439 pass / 0 fail (26.9s); `bun run lint` clean (biome 592 files + 7-workspace typecheck).

**Functional Verdict: PARTIAL** — R1-R4, R6-R10 MET; R5 PARTIAL (`@core`): exit-status half fully wired end-to-end, but the subprocess-PID half has no runtime producer, so `pid=` never appears in real CLI progress output.
### References

- `packages/app/src/workflow/step-reporter.ts`
- `packages/app/tests/workflow/step-reporter.test.ts`
- Issue report: workflow execution progress logging review

### History

- 2026-08-03: Created umbrella task 0421.
- 2026-08-03T20:56:35.632Z todo → wip (system)
- 2026-08-03T20:57:28.304Z wip → testing (system)
- 2026-08-03T22:37:28.746Z testing → wip (system)
- 2026-08-03T22:38:16.902Z wip → testing (system)
- 2026-08-04T00:49:34.206Z testing → done (system)
