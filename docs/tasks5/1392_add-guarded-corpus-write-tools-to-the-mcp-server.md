---
schema_version: 1
name: Add guarded corpus write tools to the MCP server
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:33.330Z
updated_at: "2026-11-18T05:59:45.306Z"
feature_id: B92
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 8

dependencies: ["1379", "1376"]
---

## 1392. Add guarded corpus write tools to the MCP server

### Background

The embedded MCP server (`apps/server/src/modules/mcp/index.ts:31-88`, dispatcher `:116-147`) exposes two task reads and three workflow tools. Corpus writes still need bash plus the CLI. The server already holds the write seams:
- `ctx.taskService()`
- `ctx.transitionTask()`, which wraps the shared `transitionTaskGuarded` (`context.ts:593-611`)
- `ctx.featureService()` plus `FeatureCheckService` (the same call as the HTTP `feature.check` handler, `modules/feature/handlers.ts:77-90`)
- `ctx.ruleService()`

**Refine corrections (2026-11-17)**
- "five write tools mirroring the CLI flags" → there is no `spur task transition` verb. Status changes go through `task update --status`, which also covers section, field, tag and assignee writes (`apps/cli/src/commands/task/update.ts:93-146`). → `sp_task_update` covers section, field and tags writes, `sp_task_transition` covers status only, and a status key in `sp_task_update` is refused with a pointer to `sp_task_transition`.
- `task create` does model-backed ready preparation by default (`create.ts:89-101`). A server tool must not dispatch an agent. → `sp_task_create` is always a backlog capture (`--skip-ready` semantics), and its result says so.
- `RuleService.evaluate` always writes formatted text to `context.output` (`rule-service.ts:335-352`), and it accepts an arbitrary rule `file` and `fixMode: auto`, which writes to source files. → Add an opt-in `emit: false` to `RuleEvaluateOptions` so MCP gets only the structured result. `sp_rule_run` accepts `preset`, `rule`, `failOn` and `fixMode` (`none` or `suggest`) only: no `file`, no `auto`.
- "refuse identically" → the CLI uses the lifecycle adapter's YAML guard when it can be resolved, and the in-process check gate only otherwise (`update.ts:296-320`). The server always uses the in-process gate (`context.ts:617`). The verdict gate lives in `transitionTaskGuarded` for both. → Parity is asserted on the done-verdict denial (the feature's example) and on the structural gate against the CLI with `--no-lifecycle`. The text of the adapter-path denial is out of scope.
- `forceDone`/`reason` is an operator override channel. Exposing it as a typed agent tool defeats the point of B92. → Not exposed. Forced closes stay a CLI action.
- Gateway task 1383 R1 lists "the five `sp_*` built-ins". → The write tools must also appear in the gateway root list once 1383 lands (R6).

### Requirements

- [ ] R1. Add descriptors and dispatcher cases for five tools:
  - `sp_task_create`: `title`, `featureId?`, `parentWbs?`, `template?`, `requirements?`, `plan?`. It calls `taskService().create`, never runs ready-prep, and returns `wbs`, `filePath`, `warnings` and `readiness: "skipped"`.
  - `sp_task_update`: `wbs` plus exactly one of `section` + `content`, `field` + `value`, or `addTags`/`removeTags`. It calls `updateSection`, `updateField` or `updateTags`. `field: "status"` is refused.
  - `sp_task_transition`: `wbs`, `to`. It calls `ctx.transitionTask({ wbs, toStatus: canonicalStatusOrRaw(to) })`.
  - `sp_feature_check`: `id`, `as?`, `strict?`. It uses `FeatureCheckService.check` with the same folders as the HTTP handler.
  - `sp_rule_run`: `preset?` (default `recommended-pre-check`), `rule?`, `failOn?`, `fixMode?` (`none` or `suggest`). It returns `findings`, `fixes`, `exitCode` and `ruleCount`.
- [ ] R2. Each input schema sets `additionalProperties: false` with enums for closed values, and the dispatcher adds no validation beyond those schemas (F41 transport parity). Service errors, including `GuardDeniedError`, come back as MCP tool errors carrying the service's code and message.
- [ ] R3. Add `emit?: boolean` (default `true`) to `RuleEvaluateOptions`. With `emit: false`, `evaluate` writes nothing to `context.output` and the returned result is unchanged.
- [ ] R4. Refusal parity:
  - `sp_task_transition` to `done` without a PASS verdict and `spur task update <wbs> --status done --json` both return code `GUARD_DENIED` with the same message, and the task file is byte-identical afterwards.
  - The same holds for a structural-gate denial against the CLI run with `--no-lifecycle`.
- [ ] R5. `sp_task_update` with a status field, `sp_rule_run` with `file` or with `fixMode: "auto"`, and any `forceDone` argument are each rejected by the schema before reaching a service.
- [ ] R6. If 1383 has landed, the gateway root `tools/list` includes the five write tools with its required `project` argument. If not, 1383's built-in list is extended when it lands. Record this in the 1383 Q&A.
- [ ] R7. Update the tool table in `docs/design/embedded-mcp-server.md` §4 (ten tools, with the exclusions above).

### Acceptance Criteria

- [ ] AC1 — Corpus write tools delegate to the guarded services (req: R1, R2, R3, R6, R7)
- [ ] AC2 — Guards refuse identically on MCP and CLI (req: R4, R5)

Test layer: `apps/server/tests/mcp-e2e.test.ts` (real serve app through the gateway, CLI spawned for the parity side), plus a unit test for `emit`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:59:42.088Z

- **Separate `sp_task_transition` or a status field on update?** Separate. Status goes through the guarded transition seam, so mixing it into a generic field write would invite a bypass.
- **Expose `forceDone`?** No. It's an operator override; agents get a refusal and escalate.
- **Ready-prep on create?** No. A server tool never dispatches a model, and the agent refines explicitly afterwards.
- **`sp_rule_run` with arbitrary rule files or auto-fix?** No. Presets and rule ids are repo config. An arbitrary file path or source rewrite through a remote-callable tool is outside B92.
- **Lifecycle-adapter refusal text parity?** Out of scope. The server has no spawning adapter (`context.ts:617`). Parity covers the shared verdict gate and the in-process structural gate.

### Design

**WHAT.** Five new `TOOL_DESCRIPTORS` entries and `callTool` cases in `apps/server/src/modules/mcp/index.ts`, each one call into an existing `ServerContext` seam:

| Tool | Seam | Excluded vs CLI |
| --- | --- | --- |
| `sp_task_create` | `taskService().create` | ready-prep, dedupe flags (service default window applies) |
| `sp_task_update` | `updateSection` / `updateField` / `updateTags` | `status`, `assignee`, `--from-file` (content is inline) |
| `sp_task_transition` | `ctx.transitionTask` → `transitionTaskGuarded` | `forceDone`, `reason` |
| `sp_feature_check` | `FeatureCheckService.check` | none |
| `sp_rule_run` | `ruleService().evaluate({ emit: false, json: false })` | `file`, `fixMode: auto`, `stopOnFirst`, `verbose` |

Plus one option in `packages/app/src/services/rule-service.ts` (`emit`).

**WHY.** The tools are meant to make the corpus rules hold by construction. A schema that offers no override, no arbitrary rule file and no source-writing fix mode is that enforcement. The services already hold every guard, so the MCP layer stays a typed shell, and refusals match because they come from the same function.

**WHERE.**
- `apps/server/src/modules/mcp/index.ts`
- `packages/app/src/services/rule-service.ts`
- `apps/server/tests/mcp-e2e.test.ts` (parity and refusal cases)
- `packages/app/tests/` (the rule `emit` test)
- `docs/design/embedded-mcp-server.md` §4

**Anti-patterns.**
- Don't spawn the CLI.
- Don't reimplement guards or status canonicalization in the adapter.
- Don't log argument values (see 1376 R5).
- Don't expose operator overrides.

**Security.** Bearer-gated like the existing tools. An MCP token could already run `sp_workflow_run`, which starts agents, so these writes are not a privilege escalation.

### Plan

- [ ] Step 1 (test first, R4/R5): in `mcp-e2e.test.ts`, add:
  - a done-without-verdict parity case running MCP and the CLI against the same fixture tree, comparing code, message and file bytes;
  - a `--no-lifecycle` structural-gate parity case;
  - schema-refusal cases for `status`, `file`, `fixMode: auto` and `forceDone`.
- [ ] Step 2 (test first, R3): a unit test showing `evaluate({ emit: false })` writes nothing and returns the same result.
- [ ] Step 3 (R1/R2/R3): implement `emit`, then the descriptors and dispatcher cases.
- [ ] Step 4 (R6/R7): extend the gateway built-in list if 1383 has landed, and update §4.
- [ ] Step 5: `(cd apps/server && bun test tests/mcp-e2e.test.ts tests/modules/mcp-module.test.ts)`, `(cd packages/app && bun test tests/services/rule-service.test.ts)`, `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
