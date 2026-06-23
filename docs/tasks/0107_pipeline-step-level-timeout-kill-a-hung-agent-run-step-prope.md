---
schema_version: 1
name: "Pipeline step-level timeout: kill a hung agent.run step (proper subprocess-killing timeout)"
status: done
template: feature-impl
created_at: 2026-06-23T21:07:39.225Z
updated_at: 2026-06-23T22:46:00.120Z
feature_id: H2
priority: P2
tags: ["workflow", "pipeline", "timeout", "ts-ai-runner", "dogfood", "robustness"]
---

## 0107. Pipeline step-level timeout: kill a hung agent.run step (proper subprocess-killing timeout)

### Background

Dogfood finding (2026-06-23, round 4): running task 0106 through the pipeline, the `implement` agent.run step ran >440s and an outer 600s timeout killed the whole run mid-`test`, orphaning it. Issue 2 (orphaned runs) is FIXED by `spur workflow clean` (RunDao.listStaleRuns/finalizeStale + the CLI verb, landed with 0106). But Issue 1 — a single agent.run step with NO step-level timeout — remains: a hung/runaway agent can block the pipeline indefinitely, and the only recourse is killing the parent process (which orphans the run). ROOT CAUSE: the agent prompt path has no timeout. `ProcessExecutor.run` (ts-runtime) already accepts a `timeout` and emits exitReason='timeout', but the chain agent.run action → AgentService.run/runCapture → ts-ai-runner AiRunner.prompt does NOT thread one through — `PromptOptions` (ts-ai-runner/src/agents/shims.ts) has no `timeout` field (only DoctorRunner/AgentDetector probes do). So a proper fix that actually KILLS the runaway subprocess (not just Promise.race-abandons it, which would leak the process) requires an upstream ts-ai-runner change. Reference: packages/app/src/workflow/actions/agent-run.ts, packages/app/src/services/agent-service.ts, ~/xprojects/ts-libs/packages/ai-runner/src/agents/shims.ts (PromptOptions), ~/xprojects/ts-libs/packages/runtime/src/process-executor.ts (timeout already supported).

### Requirements

- [ ] R1. UPSTREAM (ts-ai-runner): add an optional `timeout` (ms) to `PromptOptions` and thread it through `AiRunner.prompt` → the agent shim's `getPromptCommand` execution → `ProcessExecutor.run({ timeout })` (which already supports it and reports exitReason='timeout'). On timeout, the subprocess is killed and a non-zero/timeout result returned — never an abandoned orphan. Add tests; bump + release ts-ai-runner; consume the new semver in Spur's catalog.
- [ ] R2. SPUR: add a `timeoutMs` option to the `agent.run` action (`packages/app/src/workflow/actions/agent-run.ts`), forwarded through `AgentService.run`/`runCapture` flags to the AiRunner timeout from R1. On timeout, return `ok:false` with a clear `error` ('agent.run timed out after <n>ms') so the step fails cleanly and the pipeline routes to `failed` (not a hang).
- [ ] R3. WORKFLOW: set a sensible default `timeoutMs` per agent.run step in `config/workflows/task-pipeline.yaml` (e.g. implement/test/review/verify each get a bound; overridable via a `${vars.stepTimeoutMs}` var). A timed-out step → step fails → pipeline `failed`, and `spur workflow clean` (already shipped) finalizes any residue.
- [ ] R4. Validate: a deliberately slow/hung agent step is killed at the timeout and the run reaches a terminal `failed` state (not stuck `running`); `spur workflow validate` + `bun run lint` green; unit-test the agent.run timeout path (mock a slow runCapture → assert timeout error + ok:false).
- [ ] R5. Doc sync: note the step-timeout option in 04_DESIGN §7.5 (task-pipeline) and the agent.run action surface; ADR amendment if the timeout default is a cross-cutting decision. Update 05_FEATURES §9.

### Acceptance Criteria

<!-- System-tone Given/When/Then (what the SYSTEM does), or a `- [ ]` checklist for sub-tasks. Drives UAT and L4 coverage. -->

### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
## Approach

**Spur-only — the ts-libs upstream is already done.** Investigation (dogfood R5) found that
`ts-ai-runner` **already supports a per-prompt, subprocess-killing timeout**: `AiRunner.invoke`
passes `timeout: options.timeout ?? this.defaultTimeout` to `ProcessExecutor.run` (ai-runner.ts:143),
and `runPromptCommand`/`runSlashCommand` accept `AgentRunOptions { cwd?, timeout? }`. `ProcessExecutor`
enforces it (`ProcessExitReason='timeout'`, kills the child). So the original R1 (add `timeout` to
`PromptOptions`, release ts-libs) is a **no-op** — there is nothing to change upstream.

The only gap is **Spur not forwarding a timeout**: `AgentService.executeRun` calls
`runner.runPromptCommand(agent, promptOptions, { cwd: cwd || undefined })` (agent-service.ts:274) —
it passes `cwd` but **not** `timeout`. Threading a timeout flag through closes the whole chain.

## Rationale

- **No upstream change** — the killing timeout already exists in `ts-ai-runner`/`ts-runtime`; adding a
  Spur-side passthrough is the entire fix. (Corrects 0107's original cross-repo assumption — flagged
  as a dogfood finding.)
- **Forward, don't reinvent** — a Spur-side `Promise.race` would *abandon* the subprocess (orphan),
  the half-fix the task warns against. Forwarding to the ts-libs timeout makes the executor **kill**
  the child — the proper solution.
- **Default + per-step override** — a pipeline-wide default with a `${vars.stepTimeoutMs}` override
  keeps long-but-legitimate steps (implement) from false-killing while bounding runaways.

## Key shapes

**Spur passthrough** (`agent-service.ts`): read a `timeout` flag, forward to `AgentRunOptions`:

```typescript
const timeoutMs = numberFlag(flags, 'timeout'); // new helper, undefined if unset
result = await runner.runPromptCommand(agent, promptOptions, {
    cwd: cwd || undefined,
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
});
```

**agent.run action** (`actions/agent-run.ts`): a `timeoutMs` option → `flags.timeout`. On a timed-out
run (`ProcessExecutor` returns non-zero/timeout exitCode), the existing non-zero path returns
`ok:false` with a clear error → the pipeline step fails → routes to `failed`.

**workflow** (`task-pipeline.yaml`): `timeoutMs: ${vars.stepTimeoutMs}` on each `agent.run`, with a
sensible `stepTimeoutMs` default in `vars`.

## Files

| File | Change |
|------|--------|
| `packages/app/src/services/agent-service.ts` | forward a `timeout` flag to `AgentRunOptions` (line 274); `numberFlag` helper |
| `packages/app/src/workflow/actions/agent-run.ts` | `timeoutMs` option → `flags.timeout`; clear timeout error message |
| `config/workflows/task-pipeline.yaml` | `timeoutMs: ${vars.stepTimeoutMs}` per agent.run + `stepTimeoutMs` default var |
| tests | `agent-service` timeout-forwarding + `agent-run` timeout-error path |
| `docs/04_DESIGN.md`, `05_FEATURES.md` | agent.run timeout surface + status |

## Invariants

- A timed-out agent step **kills the subprocess** (via ts-libs/ts-runtime) — never abandons it.
- A timed-out step → `ok:false` → pipeline `failed`; combined with `spur workflow clean` (0106),
  no orphaned runs result.
- **No ts-libs change** — Spur consumes the already-shipped timeout capability.
### Plan
- [ ] 1. **Confirm ts-libs needs no change** — verify `AiRunner.runPromptCommand`/`runSlashCommand` accept `AgentRunOptions.timeout` and `invoke` forwards it to `ProcessExecutor.run` (ai-runner.ts:143). Record in the task that R1 (upstream) is a no-op; ts-libs already ships the killing timeout. NO ts-libs edit.
- [ ] 2. **Spur passthrough (agent-service.ts)** — add a `numberFlag(flags, name)` helper; in `executeRun`, read a `timeout` flag and forward it to the `AgentRunOptions` passed to `runner.runPromptCommand` (line ~274): `{ cwd: cwd || undefined, ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}) }`.
- [ ] 3. **agent.run action (actions/agent-run.ts)** — add a `timeoutMs` option (asOptionalNumber) → set `flags.timeout`. Confirm the existing non-zero-exit path returns `ok:false` with a clear error; tune the message to name the timeout (`agent.run (<agent>) timed out / exited <code>`).
- [ ] 4. **workflow (task-pipeline.yaml)** — add `timeoutMs: ${vars.stepTimeoutMs}` to each `agent.run` step (implement/test/review/verify) and a `stepTimeoutMs` default in `vars` (e.g. a generous bound that still catches a true hang). Overridable per run via `--vars`.
- [ ] 5. **Tests** — `agent-service`: a mock runner asserts the forwarded `timeout` reaches `AgentRunOptions` when the flag is set, and is absent when unset. `agent-run`: a `timeoutMs` option sets `flags.timeout`; a timed-out (non-zero) runCapture → `ok:false` with the timeout error. Per-file ≥90% coverage.
- [ ] 6. **Validate** — `spur workflow validate config/workflows/task-pipeline.yaml` green; `bun run lint` green; a deliberately-slow agent step (mock or a real `sleep`-style prompt with a tiny timeout) is killed and the step fails → run reaches terminal `failed`, not stuck `running`. Combined with `spur workflow clean`, zero orphans.
- [ ] 7. **Doc sync** — `04_DESIGN.md §7.5`: agent.run `timeoutMs` option + the pipeline `stepTimeoutMs` default; `05_FEATURES.md §9` status. ADR amendment only if the timeout default is a cross-cutting decision (likely a one-line note, not a new ADR). Same commit.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/agent-service.ts:204` |
| `packages/app/src/services/agent-service.ts:277` |
| `packages/app/src/services/agent-service.ts:382` |
| `packages/app/src/workflow/actions/agent-run.ts:130` |
| `packages/app/src/workflow/actions/agent-run.ts:23` |
| `packages/app/src/workflow/actions/agent-run.ts:70` |
| `packages/app/tests/services/agent-service.test.ts:922` |
| `packages/app/tests/workflow/actions/agent-run.test.ts:214` |
### Testing

**Pipeline verify results**

- Verdict: PASS (from `.spur/run/0107-verdict.json`)


Full per-requirement trace: `.spur/run/0107-verify-answer.txt`

### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### History
- 2026-06-23T21:19:46.948Z todo → wip (system)
- 2026-06-23T22:34:39.881Z wip → testing (system)
- 2026-06-23T22:46:00.120Z testing → done (system)
