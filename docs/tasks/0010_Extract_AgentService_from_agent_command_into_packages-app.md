---
name: Extract AgentService from agent command into packages-app
description: Extract AgentService from agent command into packages-app
status: Backlog
created_at: 2026-06-03T06:12:27.584Z
updated_at: 2026-06-03T06:12:27.584Z
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



### Solution



### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


