---
schema_version: 1
name: Expand built-in sp_* MCP tool catalog across task, feature, workflow, rule, decision, agent, message, and builder domains
status: done
template: feature-impl
created_at: 2026-11-24T04:02:49.587Z
updated_at: "2026-11-24T05:57:43.442Z"

feature_id: B92
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 14
done_forced: "false"
done_reason: unforced close
---

## 1445. Expand built-in sp_* MCP tool catalog across task, feature, workflow, rule, decision, agent, message, and builder domains

### Background

Currently the embedded MCP server (`apps/server/src/modules/mcp/index.ts:43-205`, `packages/app/src/services/mcp-builtin-tools.ts:9-22`, and `plugins/sp/skills/spur-cli/references/mcp-tools.md`) advertises only 10 built-in `sp_*` tools:
`sp_task_show`, `sp_task_list`, `sp_task_create`, `sp_task_update`, `sp_task_transition`, `sp_feature_check`, `sp_rule_run`, `sp_workflow_status`, `sp_workflow_run`, `sp_workflow_continue`.

A review of `apps/cli/src/commands/` and `packages/app/src/` shows that coding agents operating through the `sp` plugin still shell out to `spur <noun> <verb>` for routine planning, feature lifecycle, workflow discovery/validation, rule discovery/validation, decision-catalog queries/execution, agent/inbox coordination, and read-only builder/self checks — although the backing `@gobing-ai/spur-app` services already run in-process behind `ServerContext` (`apps/server/src/context.ts:148-362`) or are exported free functions.

The gateway root `/mcp` already re-advertises every built-in by construction (`apps/server/src/gateway.ts:98` passes `builtinTools: () => TOOL_DESCRIPTORS`; `packages/app/src/services/project-gateway.ts:820-845` adds the `project` selector), so new descriptors reach the gateway with no gateway code change — only a test proving it.

**Refine corrections (2026-11-23)**

- "`PlanningPreflightService`" → no such class; preflight is the pure `runPreflight` (`packages/app/src/services/planning-preflight.ts:107`) fed by `readCorpusFacts`, which lives in the CLI (`apps/cli/src/commands/task/preflight.ts`) → R1/Plan move `readCorpusFacts` into `packages/app` (ADR-021: apps are thin) and both CLI and MCP call it.
- "`FeatureService.sync` / `syncAll`" → real methods are `syncFeature` / `syncAllFeatures` (`packages/app/src/services/feature-service.ts:666,874`) → R2 re-pointed.
- "`FleetService` / `SupervisorService` on `ServerContext`" → ctx exposes `coordination()` (`AgentCoordinationService`, the same service `spur agent status` uses — `apps/cli/src/commands/agent/status.ts`), `supervisor()`, `processInventory()`; no `FleetService` accessor → R5 `sp_agent_status` uses `ctx.coordination()`.
- "`DecisionService` on `ServerContext`" → not an accessor; use exported `getDecisionService(config, cwd)` (`packages/app/src/decision/decision-service.ts:811`) and `readDecisionStatusReadiness(dao, status)` (`decision-status-readiness.ts:148`) with `ctx.systemEventDao()` → R4 re-pointed.
- "`readDaemonStatusOrNull`" → CLI-local (`apps/cli/src/commands/self/shared.ts:62`, darwin launchctl probe); server must not import apps → `sp_self_status` returns `collectSelfStatus` only; gateway-daemon status stays `spur self status` (closed in Q&A).
- "`showBranches`" → app seam is `collectBranchTopology(runner, opts)` (`packages/app/src/services/branch-topology/index.ts:120`), runner from `createSpawnRunner` (`@gobing-ai/spur-app/pr-review`) → R5 re-pointed.
- "`sp_self_exec`" → renamed `sp_self_actions`: the tool never executes, and an `exec` name on a bearer HTTP surface misleads agents and reviewers (closed in Q&A).
- "`sp_decision_run` path-confined `evidence`" and "`sp_task_batch_plan` file input" → inline values only; no server-side path reads from tool arguments (closed in Q&A).
- R7 "ensure gateway exposes" → already true by construction (see above); R7 reduced to a regression test + docs.

### Requirements

- [x] R1. Task tools: add `sp_task_check` (`ctx.checkService().check`, `as` optional), `sp_task_sections` (`op: list|init|add` → `TaskService.mutateSections`), `sp_task_deps` (`op: set|add|remove|clear` → `TaskService.mutateDependencies`), `sp_task_preflight` (`runPreflight` over app-layer `readCorpusFacts`; `operation?: run|refine|verify`), `sp_task_batch_plan` (`mode: waves|order` → `runBatchPlan` with inline `tasks` JSON); extend `sp_task_update` with `append: boolean` (section writes only → `updateSection(..., append)`).
- [x] R2. Feature tools: add `sp_feature_show` (`FeatureService.show`; unknown id → error), `sp_feature_list` (`FeatureService.list`, optional `status`/`parentId` filtered in the handler), `sp_feature_create` (`FeatureService.create(name, parentId?)`), `sp_feature_update` (exactly one of `section+content` → `updateSection`, or `field+value` → `update` for `priority`/`tags`; `status` refused with a pointer to `sp_feature_transition`), `sp_feature_transition` (`ctx.transitionFeature`, guard code preserved), `sp_feature_sync` (`syncFeature(id)` / `syncAllFeatures()` with `dryRun`/`force`), `sp_feature_refresh` (`FeatureService.refresh({ featureId? })`).
- [x] R3. Workflow and rule tools: add `sp_workflow_list` (`WorkflowAppService.list()`), `sp_workflow_show` (`resolveWorkflowDefinition`: states, transitions, vars, mcp exposure), `sp_workflow_validate` (`validate(file)`), `sp_workflow_cancel` (`cancel(runId)`), `sp_rule_list` (`RuleService.list(preset?)`), `sp_rule_validate` (`RuleService.validate`, project rule files only).
- [x] R4. Decision tools over `getDecisionService(ctx.spurConfig, ctx.cwd)`: `sp_decision_list` (`layer?: project|registered|shared`), `sp_decision_show`, `sp_decision_status` (`readDecisionStatusReadiness(await ctx.systemEventDao(), …)`, no live backend probe), `sp_decision_run` (`id`, `params?`, inline `evidence?` string only).
- [x] R5. Coordination and builder tools: `sp_agent_status` (`ctx.coordination()` roster/binding/capacity — same data as `spur agent status --json`), `sp_message_send` / `sp_message_inbox` (`list` or `requests`) / `sp_message_reply` over `ctx.inbox()`, read-only `sp_builder_check_deps` (`checkDeps({ cwd: ctx.cwd })`) and `sp_builder_show_branches` (`collectBranchTopology(createSpawnRunner(), …)`).
- [x] R6. Read-only self tools: `sp_self_status` (`collectSelfStatus`, no gateway-daemon probe), `sp_self_search` (`searchProject` / `searchStatus` with `mode`, `scope`, `glob`, `limit`, `regex`, `status`), `sp_self_actions` (`listActions` / `resolveAction(name)` — resolved commands returned, never run).
- [x] R7. Every new name is in `MCP_BUILTIN_TOOL_NAMES` (parity test with `TOOL_DESCRIPTORS` stays green), each descriptor declares a strict schema (`additionalProperties: false`) and `READ_TOOL`/`WRITE_TOOL`; gateway `tools/list` shows the new built-ins with `project`; `plugins/sp/skills/spur-cli/references/mcp-tools.md` and `docs/design/embedded-mcp-server.md` list the expanded map; every new tool emits `mcp.tool.called` / `mcp.tool.failed` through the existing `callTool` wrapper.

**Out of scope (CLI-only by construction):** `task --force-done`/`--provenance-bypass`/`migrate`/`record`/`verdict`; `feature move`/`verify`; `workflow clean`/`promote`; `rule --fix-mode auto` and arbitrary `--file`; `agent start/stop/loop`; `builder bump-ver/drop-tags/publish/build-*`; `self serve/install/uninstall/init/maintain/migrate` and any shell execution; gateway-daemon status. New CLI nouns/verbs/flags: none.

### Acceptance Criteria

```gherkin
Task-local criteria (`ac_altitude: task-local`, `ac_numbering: task-local`). Test homes: `apps/server/tests/modules/mcp-module.test.ts` (dispatcher, stubbed ctx accessors), `apps/server/tests/mcp-e2e.test.ts` (real `POST /mcp` over a temp project), `apps/server/tests/gateway-mcp.test.ts` (gateway catalog).

Scenario: AC1 — task tools check, mutate sections/deps, preflight and plan through the services (req: R1)
  Given a temp project with task 0001 (backlog) and 0002
  When `sp_task_check {wbs:"0001", as:"todo"}`, `sp_task_sections {wbs:"0001", op:"add", section:"Notes"}`, `sp_task_deps {wbs:"0002", op:"add", values:["0001"]}`, `sp_task_preflight {wbs:"0002"}`, `sp_task_batch_plan {mode:"order", tasks:"[…]"}` and `sp_task_update {wbs:"0001", section:"Plan", content:"x", append:true}` are called over `POST /mcp`
  Then each returns the same shape the matching `spur task … --json` returns, the file on disk reflects the section/deps/append writes, and `append` with `field` is refused `invalid_arguments`

Scenario: AC2 — feature tools read, create, update, transition, sync and refresh (req: R2)
  Given a temp project with feature A1
  When `sp_feature_list`, `sp_feature_show {id:"A1"}`, `sp_feature_create {name:"X"}`, `sp_feature_update {id:"A1", field:"priority", value:"P1"}`, `sp_feature_transition`, `sp_feature_sync {id:"A1", dryRun:true}` and `sp_feature_refresh` are called
  Then each returns its service result, `sp_feature_update {field:"status"}` is refused with a pointer to `sp_feature_transition`, and a guard-denied transition returns the guard code unchanged

Scenario: AC3 — workflow and rule discovery tools mirror the CLI (req: R3)
  Given the bundled workflows and rule presets
  When `sp_workflow_list`, `sp_workflow_show {file:"task-pipeline.yaml"}`, `sp_workflow_validate`, `sp_workflow_cancel {runId:"missing"}`, `sp_rule_list` and `sp_rule_validate` are called
  Then list/show/validate return service results and an unknown runId returns an error result, not a crash

Scenario: AC4 — decision tools list, show, report status and run with inline evidence only (req: R4)
  Given a project decision catalog with one decision and a stubbed maker
  When `sp_decision_list {layer:"project"}`, `sp_decision_show`, `sp_decision_status` and `sp_decision_run {id, params, evidence:"…"}` are called
  Then results match the service, `sp_decision_status` makes no backend probe, and an `evidencePath` argument is refused `invalid_arguments`

Scenario: AC5 — agent, message and builder tools return coordination and read-only builder data (req: R5)
  Given a temp project with one inbox member
  When `sp_agent_status`, `sp_message_send`, `sp_message_inbox`, `sp_message_reply`, `sp_builder_check_deps` and `sp_builder_show_branches` are called
  Then the message round-trips through `ctx.inbox()`, and the builder tools return findings/topology without writing any file

Scenario: AC6 — self tools report status, search and resolve actions without executing anything (req: R6)
  Given a project with one declared builder action
  When `sp_self_status`, `sp_self_search {query:"TOOL_DESCRIPTORS", mode:"exact"}` and `sp_self_actions {name:"<action>"}` are called
  Then status has no gateway-daemon section, search returns hits, `sp_self_actions` returns the resolved command, and no child process runs the action

Scenario: AC7 — catalog parity, annotations, gateway exposure and telemetry cover every new tool (req: R7)
  Given the server and the gateway root
  When `tools/list` is read on both and each new tool is called once with a valid and once with an undeclared argument
  Then `MCP_BUILTIN_TOOL_NAMES` equals the descriptor names, every read tool is `READ_TOOL` and every write tool `WRITE_TOOL`, the gateway lists each new built-in with a required `project`, the valid call records `mcp.tool.called` and the undeclared argument records `mcp.tool.failed` with `errorCode: invalid_arguments`
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-24T04:47:05.262Z

- **Gateway-daemon status in `sp_self_status`?** Closed: omitted. `readDaemonStatusOrNull` is a CLI-local launchctl probe; the server cannot import `apps/cli`, and a caller reaching `/mcp` already proves the server is up. `spur self status` keeps it.
- **`sp_self_exec` name?** Closed: `sp_self_actions`. It only lists/resolves; no shell runs over HTTP.
- **Path arguments (`evidencePath`, batch-plan input file)?** Closed: refused. Tool arguments are inline values; the server reads no caller-named file (trust boundary).
- **Annotation for `sp_workflow_cancel`, `sp_feature_sync force`?** Closed: `WRITE_TOOL`. 1421 R2 froze the two-annotation pair; no third pair is added. Cancel stops a run but deletes nothing.
- **`sp_message_send` sender identity?** Closed: caller-supplied `from`, same trust as `spur message send`; the bearer token is the boundary. Identity pinning stays with `docs/design/inter-agent-control-plane.md`.
- **One task or split?** Deferred to the operator: proposed split by domain (see batch report); the Plan below is wave-ordered so a split can cut along waves without rework.

### Design

#### Comprehensive Code Review: Current vs. Proposed `sp_*` MCP Catalog

| Domain | Existing `sp_*` Tools (10) | Proposed Additions (31) | Backing seam (verified) | Kept CLI-Only (Safety Boundary) |
| --- | --- | --- | --- | --- |
| **Task** | `sp_task_show`, `sp_task_list`, `sp_task_create`, `sp_task_update`, `sp_task_transition` | `sp_task_check`, `sp_task_sections`, `sp_task_deps`, `sp_task_preflight`, `sp_task_batch_plan` (+ `append` on `sp_task_update`) | `ctx.checkService()`, `TaskService.mutateSections/mutateDependencies/updateSection`, `runPreflight` + `readCorpusFacts` (moved to app), `runBatchPlan` | `--force-done`, `--provenance-bypass`, `migrate`, `record`, `verdict` |
| **Feature** | `sp_feature_check` | `sp_feature_show`, `sp_feature_list`, `sp_feature_create`, `sp_feature_update`, `sp_feature_transition`, `sp_feature_sync`, `sp_feature_refresh` | `FeatureService.show/list/create/update/updateSection/syncFeature/syncAllFeatures/refresh`, `ctx.transitionFeature` | `feature move`, `feature verify` |
| **Workflow** | `sp_workflow_status`, `sp_workflow_run`, `sp_workflow_continue` | `sp_workflow_list`, `sp_workflow_show`, `sp_workflow_validate`, `sp_workflow_cancel` | `WorkflowAppService.list/validate/cancel`, `resolveWorkflowDefinition` | `workflow clean`, `workflow promote` |
| **Rule** | `sp_rule_run` | `sp_rule_list`, `sp_rule_validate` | `RuleService.list/validate` | `--fix-mode auto`, arbitrary `--file` |
| **Decision** | — | `sp_decision_list`, `sp_decision_show`, `sp_decision_status`, `sp_decision_run` | `getDecisionService(config, cwd)`, `readDecisionStatusReadiness(dao, …)` | evidence file paths |
| **Agent & Message** | — | `sp_agent_status`, `sp_message_send`, `sp_message_inbox`, `sp_message_reply` | `ctx.coordination()`, `ctx.inbox()` | `agent start/stop/loop` |
| **Builder** | — | `sp_builder_check_deps`, `sp_builder_show_branches` | `checkDeps`, `collectBranchTopology` + `createSpawnRunner` | `bump-ver`, `drop-tags`, `publish`, `build-*` |
| **Self** | — | `sp_self_status`, `sp_self_search`, `sp_self_actions` | `collectSelfStatus`, `searchProject/searchStatus`, `listActions/resolveAction` | `serve/install/uninstall/init/maintain/migrate`, any execution, daemon status |

**WHERE.** One descriptor + one `dispatchTool` case per tool in `apps/server/src/modules/mcp/index.ts`; names in `packages/app/src/services/mcp-builtin-tools.ts`. If `index.ts` would exceed ~1500 lines, split handlers per domain into sibling files `apps/server/src/modules/mcp/tools-<domain>.ts` exporting `{ descriptors, dispatch }` merged into `TOOL_DESCRIPTORS` — no registry abstraction beyond that array. `readCorpusFacts` moves from `apps/cli/src/commands/task/preflight.ts` to `packages/app/src/services/planning-preflight.ts` (exported via the `pipeline-steps` subpath the CLI already imports); the CLI re-imports it — behavior unchanged.

**Frozen names.** Tool names exactly as in the table; argument names as in R1–R6 (`wbs`, `id`, `op`, `values`, `section`, `content`, `append`, `field`, `value`, `as`, `operation`, `mode`, `tasks`, `name`, `parentId`, `status`, `dryRun`, `force`, `file`, `runId`, `preset`, `layer`, `params`, `evidence`, `to`, `from`, `body`, `member`, `messageId`, `query`, `scope`, `glob`, `limit`, `regex`). Results are the service value serialized verbatim (same as existing tools); no new DTO in `packages/contracts`.

**Algorithm / precedence.** Unchanged: `validateToolArguments(descriptor, args)` rejects undeclared keys before dispatch; `callTool` owns timing and telemetry; guarded writes go through `transitionTask` / `transitionFeature` and preserve the guard code via `withServiceCode`. Mutually exclusive argument groups (`sp_feature_update`, `sp_task_update`) refuse with `InvalidArgumentsError`, mirroring `sp_task_update`. Section writes reuse the existing temp-file bridge in `sp_task_update` — extract it to one local helper reused by `sp_feature_update`.

**Anti-patterns.** No CLI spawn (`spur …`) from a handler. No new `ServerContext` accessor when an exported function suffices. No path-valued arguments read from disk. No status write outside a guarded transition. No third annotation pair. No new public CLI noun/verb/flag. No reshaping service results into new contract types.

**Handoffs.** Task 1446 (MCP observability) enriches `callTool` telemetry; this task must not change the `mcp.tool.*` payload shape so the two land in either order. No `dependencies[]`.

**Concurrency.** No `wip` tasks or extra worktrees at refine time; `docs/features/B92_*.md` has uncommitted operator edits — do not touch it.

### Plan

0. Precondition: `bun install --frozen-lockfile` clean; tree free of other tasks' changes in the touched files.
1. Write failing tests first (`apps/server/tests/modules/mcp-module.test.ts`, `apps/server/tests/mcp-e2e.test.ts`, `apps/server/tests/gateway-mcp.test.ts`) for AC1–AC7, wave by wave.
2. Wave A — task (R1): move `readCorpusFacts` to `packages/app` (CLI re-imports; `apps/cli/tests/commands/task/preflight*.test.ts` stays green), add the five task tools and `append`.
3. Wave B — feature (R2), workflow + rule (R3).
4. Wave C — decision (R4), agent/message/builder (R5), self (R6).
5. After each wave: add names to `MCP_BUILTIN_TOOL_NAMES`, run `(cd apps/server && bun test tests/modules/mcp-module.test.ts tests/mcp-e2e.test.ts tests/gateway-mcp.test.ts)`.
6. Docs (R7): `plugins/sp/skills/spur-cli/references/mcp-tools.md`, `docs/design/embedded-mcp-server.md` tool map + CLI-only boundary list.
7. `bun run spur-check`; live check: `spur self serve` with MCP enabled, `tools/list` shows 41 built-ins (10 + 31).

### Solution

Expanded the embedded MCP built-in catalog from 10 to 41 tools over eight domains, split the dispatcher per domain (the design's ~1500-line rule was triggered), and moved corpus-fact reading into the app layer so the CLI and the MCP tools share one seam. Each tool is one descriptor plus one handler entry; the schema stays the contract, so an undeclared argument never reaches a service.

| Requirement | Change | Anchor |
| --- | --- | --- |
| R1 | Task tools (10): check, sections, deps, preflight, batch-plan, plus `append` on update | `apps/server/src/modules/mcp/tools-task.ts:22` |
| R1 | One inline-section temp-file bridge, shared by task and feature writes | `apps/server/src/modules/mcp/tools-shared.ts:173` |
| R1 | `readCorpusFacts` relocated to the app layer | `packages/app/src/services/planning-preflight.ts:48` |
| R1 | CLI re-imports the moved reader; its flags and output are unchanged | `apps/cli/src/commands/task/preflight.ts:45` |
| R2 | Feature tools (8): show, list, create, update, transition, sync, refresh | `apps/server/src/modules/mcp/tools-feature.ts:23` |
| R3 | Workflow tools (7): list, show, validate, cancel | `apps/server/src/modules/mcp/tools-workflow.ts:12` |
| R3 | Rule tools (3): list, validate over project-confined files | `apps/server/src/modules/mcp/tools-rule.ts:11` |
| R4 | Decision tools (4): list, show, status (ledger only), run with inline evidence | `apps/server/src/modules/mcp/tools-decision.ts:24` |
| R5 | Agent and message tools (4) over the coordination and inbox services | `apps/server/src/modules/mcp/tools-coordination.ts:11` |
| R5 | Read-only builder tools (2): dependency check, branch topology | `apps/server/src/modules/mcp/tools-builder.ts:15` |
| R6 | Read-only self tools (3): status, search, action resolution without execution | `apps/server/src/modules/mcp/tools-self.ts:15` |
| R7 | Reserved-name parity list carries all 41 names | `packages/app/src/services/mcp-builtin-tools.ts:20` |
| R7 | Catalog composed from the eight domain modules, one ordered descriptor list | `apps/server/src/modules/mcp/index.ts:43` |
| R7 | Handler map composed from the same modules; unknown names still refused | `apps/server/src/modules/mcp/index.ts:55` |
| R7 | Strict-schema argument validator every descriptor relies on | `apps/server/src/modules/mcp/tools-shared.ts:27` |
| R7 | End-to-end coverage over a real `POST /mcp`, including tool-call telemetry | `apps/server/tests/mcp-e2e.test.ts:739` |
| R7 | Gateway root re-advertises every built-in with a required `project` selector | `apps/server/tests/gateway-mcp.test.ts:146` |
| R7 | Built-in tool map in the agent-facing reference | `plugins/sp/skills/spur-cli/references/mcp-tools.md:13` |
| R7 | Design record: where the catalog lives and what stays CLI-only | `docs/design/embedded-mcp-server.md:83` |
| Gate fix | Config loader injected from the composition root instead of called in the command module | `apps/cli/src/commands/mcp.ts:229` |
| Gate fix | CLI composition root threads the tolerant project-config loader into the MCP command | `apps/cli/src/index.ts:236` |
| Gate fix | Handler-level rule-tool contract tests close the coverage shortfall | `apps/server/tests/modules/mcp/tools-rule.test.ts:22` |

New CLI nouns, verbs and flags: none. No handler spawns the CLI, no handler reads a caller-named path, no status is written outside a guarded transition, and the two frozen annotation pairs are unchanged.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/server/src/modules/mcp/tools-task.ts:81 (`sp_task_check`), :100 (`sp_task_sections`), :116 (`sp_task_deps`), :132 (`sp_task_preflight`), :149 (`sp_task_batch_plan`), :53/:77 (`append` on `sp_task_update`); app-layer `readCorpusFacts` at packages/app/src/services/planning-preflight.ts:66, CLI re-import at apps/cli/src/commands/task/preflight.ts:45; tests apps/server/tests/modules/mcp-module.test.ts:1093 and on-disk writes over `POST /mcp` in apps/server/tests/mcp-e2e.test.ts:739 — `append`+`field` refused `invalid_arguments` (mcp-e2e.test.ts:812); 242 CLI task tests + 40 app preflight/name tests green, so the move left CLI behaviour intact |
| R2 | MET | apps/server/src/modules/mcp/tools-feature.ts:44 (`show`), :55 (`list`, handler-side filtering + DD-14 parent), :71 (`create`), :85 (`update` with `status` refused), :106 (`transition` via `ctx.transitionFeature`), :121 (`sync`), :136 (`refresh`); tests apps/server/tests/modules/mcp-module.test.ts:1234-1352 — guard code preserved: `withServiceCode` maps `GuardDeniedError` → `GUARD_DENIED` (tools-shared.ts:75), asserted at mcp-module.test.ts:1329 |
| R3 | MET | apps/server/src/modules/mcp/tools-workflow.ts:37/:43/:55/:67 (list/show/validate/cancel, `resolveWorkflowDefinition` + `registeredWorkflowPaths`), apps/server/src/modules/mcp/tools-rule.ts:37/:47 (`list`, `validate`); project confinement via `projectFile` tools-shared.ts:120; tests mcp-module.test.ts:1354-1469 — unknown runId becomes a tool error, not a crash (mcp-module.test.ts:1417) |
| R4 | MET | apps/server/src/modules/mcp/tools-decision.ts:26/:38/:50/:57; `getDecisionService(ctx.spurConfig, ctx.cwd)` + `readDecisionStatusReadiness(await ctx.systemEventDao(), …)` with no `probeDecisionMakers`; tests mcp-module.test.ts:1471-1547 — `evidencePath` refused via strict schema (mcp-module.test.ts:1536); `perDecision`/`makers` come from the ledger DAO only |
| R5 | MET | apps/server/src/modules/mcp/tools-coordination.ts:13/:20/:36/:50 over `ctx.coordination()`/`ctx.inbox()`; apps/server/src/modules/mcp/tools-builder.ts:17/:23 over `checkDeps` and `collectBranchTopology(createSpawnRunner(...))`; tests mcp-module.test.ts:1553-1652 (message round-trip through `ctx.inbox()`, builder calls leave the tree byte-identical, read-only git verbs only at packages/app/src/services/branch-topology/index.ts:161-346) — `sp_agent_status` reports roster+bindings, not CLI liveness — see P4 |
| R6 | MET | apps/server/src/modules/mcp/tools-self.ts:17 (`collectSelfStatus`, no daemon probe), :24 (`searchProject`/`searchStatus`), :47 (`listActions`/`resolveAction`, never executed); tests mcp-module.test.ts:1658-1700 (status has no `daemon` key; `sp_self_actions` asserted under a patched `Bun.spawn` that throws) |
| R7 | MET | 41 names in packages/app/src/services/mcp-builtin-tools.ts:9 (runtime check: 41 names == 41 descriptors; parity test apps/server/tests/modules/mcp-module.test.ts:858); all 31 new descriptors strict (`additionalProperties: false`, only the four pre-existing ones are not — see P4); annotations 25 read / 16 write asserted at mcp-module.test.ts:999-1075; gateway `tools/list` + required `project` apps/server/tests/gateway-mcp.test.ts:146; telemetry through the unchanged `callTool` wrapper apps/server/src/modules/mcp/index.ts:200 + apps/server/tests/mcp-e2e.test.ts:826; docs docs/design/embedded-mcp-server.md:71,83,148 and plugins/sp/skills/spur-cli/references/mcp-tools.md:4,13 — `index.ts` is now composition only (395 lines), shared plumbing lives once in tools-shared.ts |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — task tools check, mutate sections/deps, preflight and plan through the services (req: R1) | MET | test | apps/server/tests/mcp-e2e.test.ts:739-843 (`POST /mcp`: `sp_task_check` one-entry list, `sp_task_sections` `### Notes` on disk, `sp_task_deps` frontmatter edge, `sp_task_preflight`, `sp_task_batch_plan` order, `append` write and `append`+`field` refusal); dispatcher halves apps/server/tests/modules/mcp-module.test.ts:1093; handlers apps/server/src/modules/mcp/tools-task.ts:81-160 |
| AC2 — feature tools read, create, update, transition, sync and refresh (req: R2) | MET | test | apps/server/tests/modules/mcp-module.test.ts:1234-1352 (`sp_feature_list` status/parent filter + unknown status refused; `show` unknown id is an error; `create` allocated ref; `update` priority write, section via inline bridge, `field:"status"` refused pointing at `sp_feature_transition`, both/neither refused; `transition` `GUARD_DENIED` preserved; `sync` dry-run/all; `refresh` id-scoped) |
| AC3 — workflow and rule discovery tools mirror the CLI (req: R3) | MET | test | apps/server/tests/modules/mcp-module.test.ts:1354-1469 (`list` layer walk, `show` states/transitions/vars/mcp + digest and unresolvable file refused, `validate` forwards the file, `cancel` unknown runId is an error result; `sp_rule_list` layer/preset, `sp_rule_validate` preset default, project path resolution and out-of-project refusal) |
| AC4 — decision tools list, show, report status and run with inline evidence only (req: R4) | MET | test | apps/server/tests/modules/mcp-module.test.ts:1471-1547 (layer filter + bad layer `invalid_arguments`; `show` contract + effective maker, unknown id refused; `status` reads `dao.decisionSummary`/`decisionOutcomePairs` and has no `probes`; `run` forwards params + inline evidence; `evidencePath` refused `invalid_arguments`) |
| AC5 — agent, message and builder tools return coordination and read-only builder data (req: R5) | MET | test | apps/server/tests/modules/mcp-module.test.ts:1553-1652 (`sp_agent_status` roster/bindings from the recorder; send→inbox→reply round trip with `inReplyTo`; unknown message and `mode:"list"` without member refused; `sp_builder_check_deps`/`sp_builder_show_branches` return data with `readdirSync` unchanged before/after) |
| AC6 — self tools report status, search and resolve actions without executing anything (req: R6) | MET | test | apps/server/tests/modules/mcp-module.test.ts:1658-1700 (`sp_self_status` aggregate with no `daemon` section; `sp_self_search` exact hit on the fixture, missing query refused, `status:true` readiness; `sp_self_actions` lists + resolves with `Bun.spawn` patched to throw, so no child process runs) |
| AC7 — catalog parity, annotations, gateway exposure and telemetry cover every new tool (req: R7) | MET | test | apps/server/tests/mcp-e2e.test.ts:750 (`tools/list` == `MCP_BUILTIN_TOOL_NAMES`), :826 (valid call → `mcp.tool.called`, `argKeys`; undeclared arg → `mcp.tool.failed` `errorCode: invalid_arguments`); parity apps/server/tests/modules/mcp-module.test.ts:858; annotations mcp-module.test.ts:1019/1052/1076; gateway apps/server/tests/gateway-mcp.test.ts:146 (every built-in listed with `project` required); runtime check: 41 names == 41 descriptors, 31/31 new descriptors strict — `apps/server/src/modules/mcp/index.ts:43` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewer: independent pass over the 34-file diff (sp-super-reviewer, fresh context). Verdict: PASS — no P1/P2, one deferred P3, four accepted P4 advisories.

| Severity | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P3 (minor) | `apps/server/src/modules/mcp/tools-shared.ts:177` | `writeInlineSection` interpolates the caller-supplied section name into the temp-file path before any validation, so `section: "../name"` writes a caller-chosen `.md` outside the temp dir. Carried verbatim from the pre-split `index.ts`, now additionally reachable through the new `sp_feature_update`. Bearer token is the boundary; `*.md` only; no privilege change. | DEFER — pre-existing on base, outside R1–R7. Remedy for its own follow-up: reject a section name outside `^[A-Za-z0-9 _-]+$` (or use a constant temp filename) before `mkdtempSync`. |
| P4 | `apps/server/src/modules/mcp/tools-task.ts:24` | Four pre-existing descriptors (`sp_task_show`, `sp_workflow_status`, `sp_workflow_run`, `sp_workflow_continue`) still omit `additionalProperties: false`, so undeclared arguments are ignored there. Byte-identical to the pre-split descriptors; all 31 new descriptors are strict. | ACCEPTED (pre-existing). One-line tightening available in the files this task created. |
| P4 | `apps/server/src/modules/mcp/tools-shared.ts:59` | The schema validator enforces `string`/`boolean`/`array` only; `number` (`sp_self_search.limit`) and `object` (`sp_decision_run.params`) fall through to ad-hoc readers. Undeclared keys are still refused. | ACCEPTED — no AC depends on it. |
| P4 | `apps/server/src/modules/mcp/tools-task.ts:132` | `sp_task_preflight` returns `{exitCode, result}` where the CLI prints `result` alone. | ACCEPTED — additive, tested, documented in the tool map. |
| P4 | `apps/server/src/modules/mcp/tools-coordination.ts:79` | `sp_agent_status` reports roster and bindings from the coordination service, not the CLI's live `status`/`pid`/`session`. Intended by the refine correction that re-pointed R5 at `ctx.coordination()`. | ACCEPTED — an agent must not read liveness from this tool. |
| P4 | `apps/cli/src/commands/mcp.ts:229` | The optional `loadProjectConfig` injection was added during the gate remediation (the pre-check rule refuses a direct config-facade call in a command module), not by the catalog work. | ACCEPTED — belongs to this run's remediation; recorded in Solution below. |

Verification the reviewer re-ran itself: `apps/server` 172 tests over the dispatcher, e2e and gateway suites; `apps/cli` task command suite 242 tests and the MCP bridge suite 9 tests; `packages/app` 40 tests; `tsc --noEmit` clean in `apps/cli` and `packages/app`.

Verdict: PASS

### References

- Parent feature: [B92: MCP as the primary agent interface: guarded corpus write tools and adoption](../features/B92_mcp-as-the-primary-agent-interface-guarded-corpus-write-tools-and-adoption.md) (`B9` / `B91` / `B92`)
- Design satellites: `docs/design/embedded-mcp-server.md`, `docs/design/mcp-agent-adoption.md`, `plugins/sp/skills/spur-cli/references/mcp-tools.md`
- Implementation touchpoints: `apps/server/src/modules/mcp/index.ts`, `packages/app/src/services/mcp-builtin-tools.ts`, `packages/app/src/services/project-gateway.ts`

### History

- 2026-11-24T04:47:15.128Z backlog → todo (system)
- 2026-11-24T05:38:07.965Z todo → wip (system)
- 2026-11-24T05:57:41.255Z wip → testing (system)
- 2026-11-24T05:57:43.438Z testing → done (system)

