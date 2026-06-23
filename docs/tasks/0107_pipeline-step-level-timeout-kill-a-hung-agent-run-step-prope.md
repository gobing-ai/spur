---
schema_version: 1
name: "Pipeline step-level timeout: kill a hung agent.run step (proper subprocess-killing timeout)"
status: todo
template: feature-impl
created_at: 2026-06-23T21:07:39.225Z
updated_at: 2026-06-23T21:07:39.228Z
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

<!-- Decision record — WHAT/WHY. Chosen approach + 1-line reason, rejected alternatives, key signatures (not bodies), invariants. ≤2 illustrative snippets MAX. -->

### Plan

<!-- Ordered checklist or table of implementation steps (not prose). The how-to-execute order within this one task. -->

### History
