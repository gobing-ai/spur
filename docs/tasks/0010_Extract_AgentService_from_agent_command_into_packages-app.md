---
name: Extract AgentService from agent command into packages-app
description: Extract AgentService from agent command into packages-app
status: Done
created_at: 2026-06-03T06:12:27.584Z
updated_at: 2026-06-03T07:17:44.849Z
folder: docs/tasks
type: task
feature-id: F-4 app-services
priority: high
estimated_hours: 5
dependencies: ["0008"]
tags: ["refactor","architecture","app-services","agent"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0010. Extract AgentService from agent command into packages-app

### Background

Child of 0005. apps/cli/src/commands/agent.ts is 294 lines mixing CLI dispatch with application orchestration: runAgentList, runAgentDoctor, runAgentRun, resolveAgent/resolveAgentAuto/resolveAgentCurrent/resolveAgentExplicit, errorExit, handleRunOutput, plus the AgentRunDeps injection seam. This task relocates the orchestration into an AgentService class in packages/app and reduces agent.ts to a thin wrapper. The slash-command translation path depends on @gobing-ai/ts-ai-runner's slash-command export (present at the installed 0.2.9). Strict no-regression: parent R10 byte-identical output. Golden snapshots for agent list (plain + --json) captured at .tmp/golden-0005/.


### Requirements

R1: Create packages/app/src/services/agent-service.ts with an AgentService class. Constructor takes RuleServiceContext and optional AgentRunDeps per parent R3. R2: Public methods resolve(flags), run(prompt, flags), list(opts), doctor(args) returning structured results per parent R3.1-R3.3. R3: resolveAgent, resolveAgentAuto, resolveAgentCurrent, resolveAgentExplicit, handleRunOutput become private methods. R4: Export AgentService + AgentResolveResult from packages/app/src/index.ts (parent R8); preserve the AgentRunDeps injection seam for testability. R5: Rewrite apps/cli/src/commands/agent.ts as a thin wrapper, target <=80 lines (parent R6.2). R6: Migrate apps/cli/tests/commands/agent.test.ts (798 lines — the largest suite) to packages/app/tests/services/agent-service.test.ts, adapting dependency-injection mocks (parent R9.2). R7: Coverage >=85% line, >=90% function. R8: SPUR_AGENT env var works unchanged (parent R10.4). Acceptance: golden snapshot for 'agent list' (plain + --json) diff byte-identical; agent run/doctor behavior preserved via migrated tests; bun run lint+test pass; agent.ts <=80 lines.


### Q&A



### Design

- Scope: Extracted agent orchestration from apps/cli/src/commands/agent.ts (294→35 lines) into AgentService (packages/app/src/services/agent-service.ts, 308 lines).
- Key decision: AgentService takes context (cwd, env, output) plus optional AgentRunDeps — the dependency-injection seam preserved so tests can inject mock runner/detector/doctorRunner. resolve/run/list/doctor are public; resolveAgent* and handleRunOutput are private.
- Boundaries affected: agent.ts (thin wrapper, kept its 3-test dispatch stub), packages/app index (exports AgentService + AgentResolveResult + AgentRunDeps + output types), agent-service.test.ts (migrated 36-test DI suite).
- Risks: R10 byte-identical for agent list; agent run/doctor covered via injected-mock tests. Verified.


### Solution

AgentService extracted and wired. agent.ts is a 35-line dispatcher (≤80 met). AgentRunDeps injection seam retained for testability. Integration fix: agent-service.test.ts output-mock helpers were typed to AgentServiceOutput (was inferred () => void, mismatched the 1-arg write). Implemented by subagent (worktree), integrated onto main (d355d62).


### Plan

- [x] Capture golden snapshots for agent list (plain + --json)
- [x] Implement AgentService preserving AgentRunDeps injection
- [x] Rewrite agent.ts as thin wrapper (35 lines)
- [x] Migrate agent tests to packages/app/tests/services/agent-service.test.ts
- [x] Keep apps/cli/tests/commands/agent.test.ts dispatch stub
- [x] Verify byte-identical agent list; run gate


### Review

## Review — 2026-06-03 (dev-verify --force --fix all)

**Verdict: PASS**
**Scope:** `apps/cli/src/commands/agent.ts`, `packages/app/src/services/agent-service.ts`, `packages/app/src/index.ts`, and corresponding agent tests
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** current
**Gate:** `bun run check` → PASS; `test-cf`, `build`, pre-check, and post-check also PASS

### Phase 7 — SECU

One P3 efficiency finding was fixed during `--fix all`: `AgentService.run` used synchronous filesystem checks for `--cwd` validation. This is a CLI path, not a server hot path, but the fix is mechanical and keeps the service fully async. No remaining findings across Security, Efficiency, Correctness, or Usability. No secrets, unsafe browser sinks, command execution, broad `any`, unsafe casts, or empty catches remain in the audited source.

### Phase 8 — Requirements Traceability

- [x] **R1** AgentService class + context/injection seam → **MET** | `packages/app/src/services/agent-service.ts` defines `AgentService`, `AgentServiceContext`, and `AgentRunDeps`; injected runner/detector/doctor dependencies are accepted by public methods for testability.
- [x] **R2** public resolve/run/list/doctor methods → **MET** | `AgentService.resolve`, `AgentService.run`, `AgentService.list`, and `AgentService.doctor` cover the parent R3 surface.
- [x] **R3** former resolver/output helpers private → **MET** | `resolveAgent`, `resolveAgentAuto`, `resolveAgentCurrent`, `resolveAgentExplicit`, and `handleRunOutput` are private service methods.
- [x] **R4** public API exports service + result/seam types → **MET** | `packages/app/src/index.ts` exports `AgentService`, `AgentResolveResult`, `AgentRunDeps`, `AgentServiceContext`, and `AgentServiceOutput`.
- [x] **R5** CLI wrapper ≤80 lines → **MET** | `apps/cli/src/commands/agent.ts` is 35 lines.
- [x] **R6** agent tests migrated/adapted → **MET** | `packages/app/tests/services/agent-service.test.ts` contains the DI-heavy service suite; `apps/cli/tests/commands/agent.test.ts` keeps thin dispatch coverage.
- [x] **R7** coverage target ≥85% lines / ≥90% funcs → **MET** | focused agent test run reports `packages/app/src/services/agent-service.ts` at 100% lines / 100% funcs; full gate reports aggregate 99.46% lines / 100% funcs.
- [x] **R8** `SPUR_AGENT` current-agent behavior unchanged → **MET** | `AgentService.run` reads `this.ctx.env.SPUR_AGENT` for `--agent current`; migrated test asserts `doctorRunner.runOne('pi')`.
- [x] **Acceptance** golden output parity + gate → **MET** | `diff -ru .tmp/golden-0005 .tmp/after-0005` clean; `bun run check`, `bun run test-cf`, `bun run build`, `bun run test-pre-check`, and `bun run test-post-check` pass.

### Findings Fixed

| # | Title | Dimension | Location | Resolution |
|---|-------|-----------|----------|------------|
| 1 | Blocking filesystem checks in `--cwd` validation | Efficiency | `packages/app/src/services/agent-service.ts` | Replaced `existsSync`/`statSync` with async `stat()` via private `statCwd()` while preserving existing error messages and exit codes. |

### Post-fix Verdict

PASS. No P1/P2/P3/P4 findings remain, all task requirements are met, agent-list output parity is preserved, and all verification gates are green.

**Verdict: PASS** (dev-verify --force, 2026-06-03).

Phase 7 (SECU): no findings. agent-service.ts / agent.ts clean across all four dimensions; AgentRunDeps injection seam preserved.

Phase 8 (traceability): R3 (resolve/run/list/doctor) MET · R6.2 (agent.ts 35 ≤80) MET · R8 MET · R9.2 (tests migrated, DI mocks adapted) MET · R10.4 (SPUR_AGENT unchanged) MET · R10 (agent list byte-identical) MET. Coverage 100% / 100%.

`--fix all`: 0 actionable findings.


### Testing

- Command: bun run test; agent list diff vs golden
- Scope: AgentService.resolve/run/list/doctor + agent.ts dispatch
- Result: PASS. agent-service.ts coverage 100% line / 100% function. agent list byte-identical (plain + --json, exit 0). agent run/doctor verified via injected mocks.
- Evidence: diff .tmp/golden-0005 vs .tmp/after-0005 → agent_list, agent_list_json identical. 250/250 suite tests pass.
- Next action: none.
- Timestamp: 2026-06-03T07:17:26Z


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References
