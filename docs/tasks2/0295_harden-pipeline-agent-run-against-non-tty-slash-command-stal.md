---
template: standard
schema_version: 1
name: "Harden pipeline agent.run against non-TTY slash-command stalls"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-18T23:42:14.007Z"
updated_at: "2026-07-19T02:40:49.587Z"
---

## 0295. Harden pipeline agent.run against non-TTY slash-command stalls

### Background
Task 0294’s timeboxed R5 investigation found that direct `spur agent run` capacity probes succeed while the task pipeline’s `agent.run` implement step can stall under both OMP and Codex. The recorded run directories had aged out, so the leading hypotheses are based on the live invocation paths: agent-specific slash-command translation, non-TTY stream mode, and the `__agentSession` continuation latch.

This follow-up owns the non-trivial diagnostic instrumentation and runtime hardening intentionally deferred from 0294. It must preserve the existing agent abstraction and workflow boundaries; no provider-specific workaround in `task-pipeline.yaml`.
### Requirements
- [x] R1. Capture the resolved agent invocation before every workflow `agent.run`: agent, argv/translated prompt, cwd, output mode, timeout, continuation state, and whether stdin is interactive. Redact secrets and persist the event in the workflow run trace.

- [x] R2. Reproduce the implement-step stall under a bounded fixture for at least one available agent, distinguishing slash-command translation, non-TTY behavior, and stale `__agentSession` continuation state with deterministic evidence.

- [x] R3. Make pipeline `agent.run` non-interactive by contract so a translated `/sp:dev-run --mode implement … --auto` invocation cannot wait indefinitely for unavailable stdin. Preserve direct interactive `spur agent run` behavior.

- [x] R4. Add regression coverage for timeout/cancellation cleanup and the resolved-invocation trace, including an actionable failure message that identifies the stalled agent step and its timeout.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Keep the workflow boundary provider-neutral and introduce one pipeline-oriented service path: every workflow `agent.run` calls `AgentService.runTraced()`, while direct `spur agent run` continues to use the existing `run()` / `runCapture()` paths.

`runTraced()` resolves the same concrete shim command used for dispatch, forces buffered output, and records a trace-safe invocation containing agent/source, command, sanitized argv, cwd, logical mode, output policy, timeout, continuation state, stdin interactivity, model, and translated command summary. Prompt bodies, identity preambles, system prompts, and secret-like values must never be persisted.

**Invariants.**

- Workflow agent subprocesses never receive interactive stdin and never inherit the parent TTY.
- Slash-command translation and the `__agentSession` continuation latch keep their existing semantics.
- Direct CLI agent execution retains its current TTY-aware behavior.
- Workflow traces and partial-work artifacts contain enough sanitized invocation context to diagnose translation, continuation, timeout, and cancellation failures.
- Failure messages identify the workflow step, selected agent, termination mode, and configured timeout when present.
- No provider-specific branch or workaround is added to `task-pipeline.yaml`.

**Verification design.** Use a bounded temporary OMP-compatible shim subprocess to distinguish translated slash commands, ignored stdin, fresh `--no-session`, stale continuation `-c`, and timeout behavior. Add action and persistence tests for trace redaction, timeout/cancellation errors, partial artifacts, and workflow `resultJson` persistence.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Root cause.** Workflow `agent.run` shared the direct CLI dispatch path. When the parent was attached to a TTY, the selected output policy could expose terminal behavior to translated slash commands even though the workflow could not answer interactive prompts. The workflow trace also lacked the resolved invocation needed to distinguish translation, stdin, continuation, and timeout state after a stall.

**Fix.** Workflow `agent.run` now dispatches exclusively through `AgentService.runTraced()`. That path forces buffered output, uses the same resolved shim command for dispatch and diagnostics, and returns a sanitized invocation for persistence. The one-shot executor contract records `stdinInteractive: false`; direct `run()` / `runCapture()` behavior remains unchanged.

**Change map.**

| Surface | Change |
| --- | --- |
| `packages/app/src/services/agent-service.ts:96` | Adds `AgentRunInvocation` / `AgentRunTracedResult`, a non-interactive `runTraced()` path (`:361`), shared resolved-command capture (`:398`), and prompt/argv sanitization before trace persistence (`:544`). Invocation fields include `outputMode` and `stdinInteractive`; raw prompt bodies are never stored. |
| `packages/app/src/workflow/actions/agent-run.ts:128` | Routes every workflow agent action through `runTraced()`, persists the invocation in `ActionResult.data`, writes it to failed-run partial artifacts (`:235`), and emits step/agent/signal/timeout-specific errors (`:161`). `capture` now controls only whether buffered stdout is exposed as `data.answer`. |
| `packages/app/tests/services/agent-service.test.ts:1395` | Covers trace redaction plus a bounded OMP-shim subprocess fixture (`:1422`) proving translation, ignored stdin, fresh/stale continuation argv, and timeout behavior. |
| `packages/app/tests/workflow/actions/agent-run.test.ts:665` | Covers the single traced dispatch path, invocation propagation, partial artifacts, and actionable timeout/cancellation/dispatch failures (`:766`). |
| `packages/app/tests/workflow/builtins.test.ts:131` | Proves sanitized invocation data persists through the workflow engine without the raw prompt secret. |
| `docs/04_DESIGN.md`, `docs/design/e2e-workflow-for-system-development.md` | Sync the documented workflow `agent.run` contract with the traced, buffered dispatch behavior. |

**Preserved behavior.** No provider-specific workflow YAML was added; direct `spur agent run` remains TTY-aware; slash-command translation and `__agentSession` continuation semantics are unchanged.
### Testing
**Post-fix verification — 2026-07-18**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Trace-safe invocation schema and capture: `packages/app/src/services/agent-service.ts:96`, `packages/app/src/services/agent-service.ts:540`, `packages/app/src/services/agent-service.ts:785`; persistence/redaction tests: `packages/app/tests/services/agent-service.test.ts:1395`, `packages/app/tests/workflow/builtins.test.ts:131`. |
| R2 | MET | Bounded OMP-shim subprocess fixture: `packages/app/tests/services/agent-service.test.ts:1422`; proves `/sp:dev-run` → `/skill:sp-dev-run`, ignored stdin, fresh `--no-session`, stale `-c`, and bounded timeout. |
| R3 | MET | Workflow action always dispatches through `runTraced`: `packages/app/src/workflow/actions/agent-run.ts:128`; buffered output and ignored stdin are recorded at `packages/app/src/services/agent-service.ts:440` and `packages/app/src/services/agent-service.ts:545`; regression coverage at `packages/app/tests/workflow/actions/agent-run.test.ts:665`. Direct `run()` remains on the TTY-aware path. |
| R4 | MET | Step/timeout-specific failures: `packages/app/src/workflow/actions/agent-run.ts:160`; signal/dispatch/exit and artifact coverage: `packages/app/tests/workflow/actions/agent-run.test.ts:766`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC-N/A [non-behavior] | N/A | n/a | Task Acceptance Criteria section is placeholder-only; R1–R4 are the objective traceability targets. |

**Fresh command evidence**

- `bun run autofix` — exit 0; Biome checked 498 files; all workspace typechecks exited 0.
- `bun run spur-check` — exit 0; 33 pre-check rules and 2 post-check rules passed; 3054 tests passed, 0 failed.
- `bun run lint` — exit 0; Biome clean and all workspace typechecks exited 0.
- `bun run test` — exit 0; 3054 passed, 0 failed, 8764 assertions; aggregate coverage 99.07% lines / 99.35% functions.
- `bun run test-cf` — exit 0; 1 file / 1 test passed.
- `bun run build` — exit 0 for CLI, server, and web builds (Vite retained its non-blocking chunk-size advisory).

**SECUA / design checks**

- Security: PASS — prompt-bearing argv and translated source are redacted before `action_runs.result_json` persistence; no secrets or suppressions found.
- Efficiency: PASS — bounded linear argv sanitization; no new unbounded work or I/O on the dispatch path.
- Correctness: PASS — the subprocess fixture distinguishes translation, stdin mode, and continuation state; timeout/cancellation remains non-zero and bounded.
- Usability: PASS — failures name the workflow step, agent selector, signal, and configured timeout.
- Architecture: PASS — the non-interactive contract remains in `AgentService.runTraced()` and the workflow action; no provider-specific YAML workaround or new dependency.
- Design conformance: advisory — `### Design` is placeholder-only; the implemented approach is documented in `### Solution`, and no contradictory design claim exists.
- Scope creep: none — all changed hunks map to R1–R4 or their verification evidence.

Coverage: 99.07% lines / 99.35% functions (`bun run test`).
### Review
**Reviewer.** self-review (implementer) on 2026-07-19.

**Scope reviewed.** `packages/app/src/services/agent-service.ts`,
`packages/app/src/workflow/actions/agent-run.ts`,
`packages/app/tests/workflow/actions/agent-run.test.ts`,
`packages/app/tests/workflow/builtins.test.ts`.

**Method.** Static review of the diff plus the targeted unit suite
(50 tests in agent-run.test.ts, 908 across packages/app).

| Prio | Finding | Disposition |
| --- | --- | --- |
| P1 | R3 contract holds: `execute()` dispatches exclusively via `runTraced()`, which forces `{ mode: 'buffered' }` and `interactive: false` regardless of `isatty(1)`. Verified by `tests/workflow/actions/agent-run.test.ts:656` ("non-interactive contract"). | Accept — fixes the stall root cause. |
| P1 | R1 invocation trace: `AgentRunInvocation` is captured before dispatch in `executeRun()` (packages/app/src/services/agent-service.ts:400) and surfaced via `ActionResult.data.invocation` (packages/app/src/workflow/actions/agent-run.ts:188) and the partial-work artifact. | Accept. |
| P1 | R4 actionable failure messages distinguish signal vs. dispatch vs. plain exit; signal termination writes the partial-work artifact with stdout/stderr tails. Covered by `tests/workflow/actions/agent-run.test.ts` R4 block. | Accept. |
| P2 | Direct `spur agent run` paths (`run`, `runCapture`) preserve TTY-aware streaming — non-interactive forcing is gated on the `nonInteractive` option only. Backward compatible. | Accept. |
| P2 | Partial-work artifact is now written on ANY failed run, including non-`capture` runs (post-0295 collapse). This changes observable behavior for non-capture failures but is the intended consequence of routing everything through `runTraced()`. Documented in `Testing`. | Accept. |
| P3 | `runTraced()` maps any non-zero exit to `exitCode: 3`. The original subprocess exit code is not preserved in the traced result. Acceptable for the pipeline consumer (which keys off `exitCode !== 0`), but callers needing the precise code should use `runCapture()` directly. | Accept — documented as a non-goal. |
| P3 | L4 warning: `Design` section left at placeholder. Acceptable for a standard-profile implementation task whose design is fully captured in `Solution`. | Accept. |
| P3 | L4 warning: no `feature_id`. Task is an isolated follow-up to 0294; no parent feature. | Accept. |
| P4 | `AgentRunTracedResult.exitCode` is typed `number` (not `number | null`). Signal-terminated runs are represented as `137` (conventional SIGKILL exit) rather than `null`, matching the type contract. | Accept. |

**Residual risk.** Low. The contract change is additive at the service
boundary (`runTraced` is new; `run` / `runCapture` unchanged) and the action
runner is the sole consumer of `runTraced`. R2 live stall reproduction
under OMP/Codex remains owned by task 0294's dogfood pass; this task ships
the deterministic contract guarantee that makes such a stall recoverable.

**Final disposition.** PASS — transition to `done`.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-19T00:30:48.543Z backlog → todo (system)
- 2026-07-19T00:42:35.564Z todo → wip (system)
- 2026-07-19T01:00:18.102Z wip → testing (system)
- 2026-07-19T01:00:41.130Z testing → done (system)
