---
schema_version: 1
name: "Upstream: add AbortSignal support to ProcessExecutor for process-group signal forwarding"
status: done
template: review
created_at: 2026-06-24T22:55:48.629Z
updated_at: 2026-06-25T03:37:07.982Z
feature_id: B1
---

## 0118. Upstream: add AbortSignal support to ProcessExecutor for process-group signal forwarding

### Background
Follow-up from task 0116 dogfood findings. P2-1 (process-group signal forwarding for spawned agent subprocesses) requires upstream changes in two `@gobing-ai/ts-*` packages before Spur can wire process signal handlers.

The upstream source code lives in `~/xprojects/ts-libs/` for these `@gobing-ai/ts-*` packages. Edit files in that folder as needed. Robin will handle the release after all changes pass tests.

#### Review Findings

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2 | `@gobing-ai/ts-runtime` (`ProcessExecutor`) | `ProcessExecutor.run()` spawns child processes via `execa` without `cancelSignal` (AbortSignal) support. When the parent spur process is killed (SIGTERM/SIGINT), agent subprocesses continue running orphaned. | Add `signal?: AbortSignal` to `ProcessOptions`. Forward to execa's `cancelSignal` option. |
| P2 | `@gobing-ai/ts-ai-runner` (`AiRunner`) | `AiRunner.runPromptCommand()` doesn't accept or forward an `AbortSignal` to the underlying `ProcessExecutor`. Spur's `AgentService` can't pass a signal to kill agent subprocesses on parent termination. | Add `signal?: AbortSignal` to `runPromptCommand` options. Thread through to `ProcessExecutor.run()`. |
| P2 | `@gobing-ai/spur-app` (`AgentService`, `AgentRunActionRunner`) | Once upstream packages ship `AbortSignal` support, Spur needs to wire it: create an `AbortController` in `AgentService.executeRun()` or `AgentRunActionRunner.execute()`, register `process.on('SIGTERM')` + `process.on('SIGINT')` handlers that call `controller.abort()`, and pass the signal through the run chain. | Wire `AbortController` → `signal` through `AgentService.run()` → `AiRunner.runPromptCommand()` → `ProcessExecutor.run()`. Register process signal handlers to trigger abort. |

These three changes form a vertical: ts-runtime (lowest) → ts-ai-runner (middle) → spur-app (highest). Implement in dependency order.

**Reference:** [Dogfood report](docs/dogfood/2026-06-24-dev-run-0116-auto-dogfood.md) — task 0116 dogfood, P2-1 finding.
### Plan
- [ ] **P2-1a** `@gobing-ai/ts-runtime`: Add `signal?: AbortSignal` to `ProcessOptions` interface, forward to execa as `cancelSignal` option in `ProcessExecutor.run()`
- [ ] **P2-1b** `@gobing-ai/ts-ai-runner`: Add `signal?: AbortSignal` to `runPromptCommand` options, thread through to `ProcessExecutor.run()`
- [ ] **P2-1c** `@gobing-ai/spur-app`: Wire `AbortController` → `signal` through `AgentService.run()` → `AiRunner.runPromptCommand()` → `ProcessExecutor.run()`. Register `process.on('SIGTERM')` / `process.on('SIGINT')` handlers to trigger `controller.abort()`
- [ ] Verify: `bun run check` passes in both `ts-libs/` and `spur-new/`
- [ ] Re-review the changed code
### Solution
| File:line | What / Why |
|-----------|-------------|
| `ts-libs/packages/runtime/src/process-executor.ts:19-29` | Added `signal?: AbortSignal` to `ProcessOptions` interface |
| `ts-libs/packages/runtime/src/process-executor.ts:123-134` | Threaded `signal` through `buildExecaOptions()` → execa's `cancelSignal` |
| `ts-libs/packages/runtime/src/process-executor.ts:440-462` | Added `cancelSignal` to execa options in `buildExecaOptions` |
| `ts-libs/packages/ai-runner/src/ai-runner.ts:29-34` | Added `signal?: AbortSignal` to `AgentRunOptions` interface |
| `ts-libs/packages/ai-runner/src/ai-runner.ts:137-145` | Threaded `signal` through `invoke()` → `processExecutor.run()` |
| `packages/app/src/services/agent-service.ts:276-289` | Wired `AbortController` in `executeRun()`: creates controller, registers `SIGTERM`/`SIGINT` handlers, passes `controller.signal` to `runPromptCommand()`, cleans up in `finally` block |
### Testing
| Req | Status | Evidence |
|-----|--------|----------|
| P2-1a: ts-runtime `ProcessOptions.signal` → execa `cancelSignal` | **MET** | `process-executor.ts:30` — `signal?: AbortSignal` field; `process-executor.ts:464` — `cancelSignal: opts.signal` in execa options; `process-executor.ts:133` — threaded through `runUntraced` |
| P2-1b: ts-ai-runner `AgentRunOptions.signal` → `processExecutor.run()` | **MET** | `ai-runner.ts:35` — `signal?: AbortSignal` field; `ai-runner.ts:147` — `options.signal` threaded to `processExecutor.run()` in `invoke()` |
| P2-1c: spur-app `AbortController` wiring | **MET** | `agent-service.ts:276` — `new AbortController()`; `agent-service.ts:279-280` — `process.on('SIGTERM'/'SIGINT')` handlers; `agent-service.ts:284` — `signal: controller.signal` passed to `runPromptCommand()`; `agent-service.ts:289-290` — `process.off` cleanup in `finally` block |

Coverage: 99.07% lines, 99.54% funcs (spur-new); ts-libs gate passes (1516 tests, 0 fail).

**Verdict: PASS** — all three requirements MET with concrete `file:line` evidence. SECU review: no findings (S ✓, E ✓, C ✓, U ✓).
### Review
Post-implementation reflection — filled after the first fix round.

**What went right:** Three-package vertical implemented bottom-up (ts-runtime → ts-ai-runner → spur-app). Each layer adds one `signal?: AbortSignal` field and threads it to the next. The ts-libs changes are minimal (+8 lines across 2 files); the spur-app wiring adds `AbortController` with SIGTERM/SIGINT handlers and proper cleanup in a `finally` block.

**Remaining:** None. All gates pass: typecheck (7 workspaces), 1786 tests (0 fail), 22 pre-check rules, 2 post-check rules.

**Back-issues:** None surfaced.

**P1–P4 findings:** None — no P1, P2, P3, or P4 issues surfaced in this implementation round.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| — | — | No new findings | — |
### References

- [Dogfood report](docs/dogfood/2026-06-24-dev-run-0116-auto-dogfood.md) — task 0116 dogfood, P2-1 finding
- [Task 0116](docs/tasks/0116_0110-auto-dogfood-findings-fix-dev-dogfood-arg-placement-wor.md) — parent task

### History

- 2026-06-25T02:09:05.858Z backlog → wip (system)
- 2026-06-25T03:37:02.792Z wip → testing (system)
- 2026-06-25T03:37:07.982Z testing → done (system)
