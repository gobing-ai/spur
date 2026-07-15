---
template: meta
schema_version: 1
name: "Coordinate upstream ProcessExecutor registry for full process watch list (ts-runtime / ts-ai-runner)"
description: ""
status: done
type: meta
profile: standard
feature_id: M1
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-07-15T05:35:35.523Z"
updated_at: "2026-07-15T22:54:16.776Z"
---

## 0264. Coordinate upstream ProcessExecutor registry for full process watch list (ts-runtime / ts-ai-runner)

### Background
M1 explicitly accepts upstream work: the target Processes watch list scope is "all processes created via ProcessExecutor", not only the current supervisor-tracked ones.

This requires enhancements in the ts-libs repo (`@gobing-ai/ts-runtime` primarily, possibly ts-ai-runner) to expose a registry or observable of every `run` / `runStreaming` invocation.

This meta task coordinates the interface definition, metadata needs, and cross-repo tracking.
### Requirements
R1. Define (in this repo or as a shared ADR note) the minimum metadata a ProcessExecutor registry entry should carry (agentId or label, pid, command/args, start time, source: 'supervisor' | 'one-shot', optional team association, exit info).

R2. Open or reference the corresponding work item in ~/xprojects/ts-libs.

R3. In the Spur side, prepare the ProcessesTab (0262) and any service layer to be able to consume the future richer list.

R4. Keep the current supervisor list as a solid v1 while the upstream lands.
### Acceptance Criteria
```gherkin
@core
Scenario: Minimum metadata contract is defined
  Given the need for a full ProcessExecutor registry
  When the coordination is complete
  Then a clear minimum set of fields is documented (id/label, pid, command/args, timestamps, source, optional team/agent association, exit info)

@core
Scenario: Upstream work item is created and linked
  Given this meta task
  When coordination finishes
  Then a work item exists in ~/xprojects/ts-libs referencing this task + M1 requirements

@core
Scenario: Spur side is prepared for consumption
  Given ProcessesTab and related services
  When the registry lands upstream
  Then there are clear extension points / TODOs (no blocking changes in v1)

@edge
Scenario: v1 remains useful without upstream
  Given only supervisor processes are tracked today
  When viewing the Processes tab (0262)
  Then the current list continues to work and is clearly labeled as v1
```
### Q&A
**Q: Why is this a meta task instead of a normal implementation task?**

A: The real changes are in a different repository (`~/xprojects/ts-libs`). This task owns the Spur-side requirements, interface definition, and cross-repo tracking.

**Q: Do we need to implement the registry in Spur?**

A: No. Spur consumes it. We only prepare the consumer side (comments, possible adapter) and define what we need.

**Q: How detailed should the metadata spec be?**

A: Start with the minimum viable list in R1. The ts-libs side can propose refinements; we negotiate via the linked ticket.

**Q: Should we change the current supervisor list or /api/team/processes now?**

A: No. Keep v1 stable. This task only adds forward-looking notes.

**Q: What if the upstream never happens?**

A: v1 (supervisor list) remains useful. The watch list goal in M1 is still partially met; full "all ProcessExecutor" is explicitly future work.
### Design
**Upstream registry coordination (meta)**

This is a coordination/meta task. The actual implementation lives in `~/xprojects/ts-libs` (primarily `@gobing-ai/ts-runtime` ProcessExecutor, possibly ts-ai-runner).

Current state in Spur:
- SupervisorService maintains its own in-memory registry of supervised processes (started via `runStreaming` for agent loops).
- `/api/team/processes` + ProcessesTab (0262) only see supervisor-tracked entries today.
- One-shot runs (planning, agent run, etc.) go through ProcessExecutor but are not centrally observable for the board.

Needed upstream enhancement:
- Make ProcessExecutor (or a thin wrapper / registry service) expose a list/subscription of **all** invocations.
- Each entry should carry enough metadata for the watch list + future filtering/grouping.

Proposed minimal shape for a registry entry (to be refined in the ts-libs work item):
```ts
interface ProcessExecution {
  id: string;                 // unique execution id
  label?: string;             // e.g. "agent:alpha-claude"
  command: string;
  args: string[];
  pid?: number;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  source: 'supervisor' | 'one-shot' | 'other';
  teamId?: string;            // optional, for grouping
  agentId?: string;           // when applicable
  // future: tags, workDir, etc.
}
```

Integration options in ts-runtime:
- Add a `ProcessRegistry` (or make ProcessExecutor itself queryable).
- Provide `listExecutions()` + optional subscription / EventEmitter for new starts/exits.
- Keep it lightweight; no requirement to persist across spur serve restarts for v1.

Spur-side consumption (preparation only):
- ProcessesTab v1 stays on supervisor list.
- Add a comment / extension point: "TODO (0264): switch data source or merge in full registry when available".
- Optionally introduce a thin `ProcessInventory` adapter in packages/app that can later accept the richer source.
- No behavior change for 0262/0263 in this task.

Cross-repo tracking:
- Create (or reference) a work item in the ts-libs repo.
- Use this task + M1 as the Spur-side requirement spec.
- Possible shared ADR or interface sketch in a common place.

Trade-offs / scope:
- Full "all processes" is explicitly upstream (not in Spur monorepo).
- v1 watch list remains supervisor-focused and useful immediately.
- Metadata list in R1 is the contract; ts-libs team can propose adjustments.
- Avoid over-specifying implementation details here (that's for the ts-libs ticket).

Files / artifacts touched by this task (meta):
- This task file (coordination notes)
- Possibly a short note or interface sketch in docs/ or a new `docs/upstream/` if desired
- Comments in ProcessesTab.tsx and related service files (non-breaking)
- (Out of scope for this task: actual code changes in ts-libs)

This task is complete when:
- The interface needs are written down (here or in ts-libs ticket).
- A ts-libs work item exists and is referenced.
- Spur side has clear "when ready" hooks.
### Plan
1. Document the required registry shape and metadata (this task's Design + R1).
2. Create or link the ts-libs work item (reference M1 + this task).
3. Add non-breaking preparation in Spur:
   - Comments / TODOs in ProcessesTab.tsx (and any service that will consume the list).
   - Optional: thin adapter interface sketch (can be in a follow-up).
4. Update this task with links and status.
5. (Optional) Add a short coordination note in M1 or docs if it adds value.
6. Verify: task check passes, no breakage to existing v1 paths.
7. Close coordination when ts-libs ticket is accepted (or this task marked ready).
### Solution
| File | Lines | What / Why |
|------|-------|------------|
| `@gobing-ai/ts-runtime@0.4.10` | — | Upstream ProcessRegistry released (catalog pin). |
| `apps/server/src/context.ts:385` | 385–393, 429 | Shared `processRegistry()`; supervisor `NodeProcessExecutor({ registry })`; AgentService injects same registry. |
| `packages/app/src/services/supervisor-service.ts:160` | 159–161 | Tag `source:'supervisor'` + `agentId` on runStreaming for registry. |
| `packages/app/src/services/agent-service.ts:115` | 115, 140, 324 | Optional `processRegistry` on context; wire into NodeProcessExecutor. |
| `apps/server/src/modules/team/index.ts:50` | 38–72 | GET `/api/team/processes` adds `executions` + `executionsCount`. |
| `apps/web/src/modules/teams/ProcessesTab.tsx:62` | 62–95, 182 | Unified watch list (`buildWatchRows`); header + registry rows. |
### Testing
**Verify run (re-audit after Spur consumption):** 2026-07-15 — ts-runtime **0.4.10** released; Spur wired consumer.

**Upstream (ts-libs `@gobing-ai/ts-runtime@0.4.10`)**
- `ProcessRegistry` + `InMemoryProcessRegistry` / `createInMemoryProcessRegistry()`
- `NodeProcessExecutor` optional `registry` + `source`/`teamId`/`agentId` on options

**Spur consumption (this monorepo)**
- Shared registry: `ServerContext.processRegistry()` → inject into supervisor + AgentService executors
- Supervisor tags `source: 'supervisor'` + `agentId` on `runStreaming`
- `GET /api/team/processes` returns `processes` (supervisor) + `executions` (registry snapshot)
- ProcessesTab unified watch list (supervisor controls + other registry rows, de-duped)

**Commands**
- `bun test apps/server/tests/modules/team/index.test.ts apps/server/tests/context.test.ts apps/web/tests/modules/teams/components.test.tsx packages/app/tests/services/supervisor-service.test.ts` → green
- `tsc --noEmit` for packages/app, apps/server, apps/web → clean

**Coverage:** N/A for React `.tsx` per monorepo gate; server/app paths covered by targeted suites.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 metadata contract | MET | Design + ts-runtime `ProcessExecution` |
| R2 upstream work item | MET | Released `@gobing-ai/ts-runtime@0.4.10` |
| R3 Spur prepared + consuming | MET | context + team module + ProcessesTab |
| R4 v1 supervisor remains | MET | `processes` array still supervisor-controlled; controls intact |

**Acceptance Criteria:** all MET (contract, upstream release, Spur hooks + live API, v1 path preserved).
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: M1 (Teams Processes watch list)
- Related Spur: 0262 (ProcessesTab v1)
- Upstream: `@gobing-ai/ts-runtime@0.4.10` — `ProcessRegistry` / `createInMemoryProcessRegistry`
- Catalog pin: root `package.json` workspaces.catalog `"@gobing-ai/ts-runtime": "^0.4.10"`
### History
- 2026-07-15T22:02:51.758Z todo → wip (system)
- 2026-07-15T22:02:53.199Z wip → testing (system)
- 2026-07-15T22:02:54.626Z testing → done (system)
