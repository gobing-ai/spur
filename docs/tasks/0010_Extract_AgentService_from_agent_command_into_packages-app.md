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


