---
schema_version: 1
name: Downstream MCP tool registration manifest (mcp-tools.yaml) and enriched workflow exposure across sp, cc, and kk
status: todo
template: feature-impl
created_at: 2026-11-24T05:27:44.333Z
updated_at: "2026-11-24T05:39:50.878Z"
feature_id: B91

dependencies: ["1445", "1446"]
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 12
---

## 1447. Downstream MCP tool registration manifest (mcp-tools.yaml) and enriched workflow exposure across sp, cc, and kk

### Background

Spur currently exposes only two kinds of MCP tools in `apps/server/src/modules/mcp/index.ts`:
1. Hardcoded `sp_*` built-ins (`TOOL_DESCRIPTORS` + `MCP_BUILTIN_TOOL_NAMES` in `packages/app/src/services/mcp-builtin-tools.ts`, expanded in task `1445`).
2. Opt-in workflow tools (`packages/app/src/services/mcp-workflow-tools.ts`, B91 task `1381`), where any workflow YAML declaring `metadata.mcp.expose: true` becomes `<namespace>_<workflow_name>` via `WorkflowService.run`.

This leaves three gaps for downstream projects (`/Users/robin/xprojects/superskill` (`cc`) and `/Users/robin/xprojects/knowledge-kit` (`kk`)) and for Spur's own `sp` plugin (`plugins/sp/`):
- **CLI/service-backed downstream tools have no declarative registration seam:** `superskill` has an empty `.spur/workflows/` directory and exposes its capabilities as CLI verbs (`superskill doctor`, `superskill skill|agent|command|hook|magent`, `superskill install`), while `knowledge-kit` has both workflows (`plugins/kk/workflows/`) and CLI verbs (`kk content`, `kk wiki`, `kk store`, `kk plugin`, `kk schedule`). Wrapping fast synchronous CLI reads/checks inside `WorkflowService.run` creates unnecessary workflow run rows and artifacts, while `ADR-152` / `ADR-012` forbid importing arbitrary downstream JS/TS into `spur-server`.
- **Coarse workflow tool schemas:** `workflowToolDescriptor` currently maps every top-level `vars` entry to an optional `string` property with hardcoded `readOnlyHint: false` and no `required`, `enum`, `boolean`/`number` types, or per-parameter descriptions.
- **Spur itself does not dogfood the downstream registration mechanism:** `config/workflows/` declares zero `metadata.mcp.expose: true` workflows and `plugins/sp/` registers no project-owned MCP tools through the same contract.

**Parallel coordination note:** Tasks `1445` (expanding built-in `sp_*` tools) and `1446` (MCP telemetry and `McpTab.tsx` per-tool counters) are being implemented concurrently by another coding agent. This task depends on `1445` and `1446` so its `origin` vocabulary, telemetry hooks, and `MCP_BUILTIN_TOOL_NAMES` collision checks integrate cleanly after they land.

**Refine corrections (2026-11-23)**

1. **ADR-152 conflict.** ADR-152 lists "CLI-spawning per call" as a rejected alternative, and it says built-in tools delegate to `@gobing-ai/spur-app` with "no CLI spawn" (`docs/00_ADR.md:3013,3028`). Command-backed manifest tools spawn a process on every call. That is acceptable only as an explicit amendment: the spawn path is limited to operator-authored, project-local manifests, which is the same trust level as workflow `shell` actions (ADR-012: local plugins are operator-trusted, and sandboxing is out of scope). Built-ins still never spawn. The amendment is now part of R6.
2. **Cross-repo scope removed (old R6).** Adding `plugins/cc/mcp-tools.yaml` in `superskill` and adding manifests or workflow opt-ins in `knowledge-kit` belongs to those repositories. It breaks the one-writer-per-tree and commit-per-task rules (AGENTS.md). Both repos already resolve a single namespace: `superskill/plugins/cc/plugin.json` → `cc`, and `knowledge-kit/plugins/kk/plugin.json` → `kk` (only `kk` has a `plugin.json`). Once this lands, each repo can adopt the contract in a follow-up task of its own. The title still says "across sp, cc, and kk", and the CLI cannot rename a task, so read the title as `sp` plus a contract that `cc` and `kk` can consume.
3. **Workflow `readOnlyHint` override removed (old R3).** Task 1421 R2 froze workflow tools as write and non-idempotent, because a run creates run rows (`packages/app/src/services/mcp-workflow-tools.ts:196-198`). A workflow that declares itself read-only would be lying to clients. Only parameter typing and descriptions are enriched.
4. **Typed workflow vars must be stringified.** `callWorkflowTool` rejects any argument that is not a string (`apps/server/src/modules/mcp/index.ts:319-323`), and `WorkflowService.run` takes `Record<string,string>`. Typed parameters are validated against the enriched schema and then converted with `String(value)`.
5. **`.spur/mcp-tools.yaml` override dropped (YAGNI).** All three target repos keep a `plugins/<ns>/` directory. A second, merged location would add precedence rules that nothing needs yet.
6. **`NodeProcessExecutor` already exists in the server.** It comes from `@gobing-ai/ts-runtime`, and `apps/server/src/context.ts:760` builds one on the shared `processRegistry()`. It runs `{command, args}` without a shell. The child environment reuses the workflow `shell` helper `childProcessEnv()` (`packages/app/src/workflow/actions/child-env.ts:17`) and additionally blanks the variable named by `server.mcp.authEnv`, so a tool never inherits the MCP bearer token.
7. **Collision precedence.** The existing workflow resolver refuses both sides of a duplicate. For manifest tools, the reserved set is the built-in names plus the resolved workflow tool names, so on a clash the workflow tool, which is the existing surface, wins and the manifest entry is refused.
8. **`spur workflow validate` is not a manifest surface.** It filters exposure issues to the workflow file being validated (`packages/app/src/services/workflow-inspect-ops.ts:441-443`). Manifest issues surface through `McpDispatcher.catalog().exposureIssues` → `IntegrationsService` → the Board, which is the 1438 R1 path.
9. **Dogfood narrowed.** `idea-pipeline` is an HITL front-half pipeline that `sp_workflow_run` can already reach. One workflow (`history-anatomy`: `mode` enum and `recompute` boolean, `config/workflows/history-anatomy.yaml:60-68`) plus one manifest tool proves both paths. `sp_history_anatomy` and `sp_plugin_smoke` do not collide with any of 1445's 41 built-ins.
10. **Dependencies.** 1445 (built-in name set) and 1446 (`origin` vocabulary and per-tool telemetry) are still `todo`. This task adds the value `'manifest'` to 1446's `origin` union, so both must land first. The `L4.prerequisite-not-done` check reports this only as a warning.
11. **Exposing every workflow var is unsafe for `history-anatomy`.** The legacy descriptor advertises every `vars` key. That would let an MCP caller set `spurBin`, the executable the workflow runs, and `output`, a write path (`history-anatomy.yaml:40-44`). A declared `metadata.mcp.params` is therefore an allowlist. Legacy opt-ins that declare no params keep today's all-vars behavior, unchanged for compatibility.

### Requirements

- [ ] R1. Define the manifest contract `plugins/<namespace>/mcp-tools.yaml` as a Zod schema in `packages/app/src/services/mcp-manifest-tools.ts`. Top level: `schema_version: 1` and `tools[]`. Each tool has:
  - `name`, matching `^[a-z][a-z0-9_]{0,47}$` and exposed as `<namespace>_<name>`;
  - `description`;
  - all three `annotations` booleans, required;
  - optional `params`, a map of `{type: string|number|boolean, description?, enum?, default?, required?}`;
  - `command`, a fixed non-empty argv with no placeholders;
  - `args`, giving each param an argv fragment;
  - `output` (`json|text`, default `text`);
  - `timeoutMs` (1000–120000, default 30000).
  Unknown keys are rejected (strict).
- [ ] R2. Resolution and validation. `resolveManifestTools` reads `plugins/<namespace>/mcp-tools.yaml` for the resolved namespace. A missing file means no tools and no issue. It records `McpExposureIssue`s, never throwing, for:
  - a parse or schema failure: `reason: 'invalid-manifest'`, with the whole file refused;
  - a param without an `args` fragment, or a fragment whose `{value}` rule is wrong: `invalid-manifest`, with that entry refused;
  - a collision with a built-in: `builtin-collision`;
  - a collision with a workflow tool, or a duplicate inside the manifest: `duplicate`.
  Refused entries never appear in `tools/list` and are never callable.
- [ ] R3. Safe execution. `buildManifestArgv(tool, args)` validates the arguments before any spawn:
  - unknown keys, wrong types, values outside `enum`, and missing required params raise `InvalidArgumentsError` → `invalid_arguments`;
  - string values longer than 1024 characters, or starting with `-` on a param without `enum`, are refused (option-injection guard).
  The argv is `command` followed by the fragments of the supplied params (or their `default`s), in declaration order. `{value}` is replaced by one argv element. A boolean fragment has no `{value}` and is appended only when the value is `true`. The dispatcher runs it through `NodeProcessExecutor` (no shell) with `cwd = ctx.cwd`, the env from `childProcessEnv()` with the `server.mcp.authEnv` variable blanked, and the tool's `timeoutMs`. Result handling:
  - exit 0 + `json` → the parsed stdout;
  - exit 0 + `text` → `{stdout}`;
  - non-zero exit, timeout, stdout over 1 MiB, or unparseable JSON → a tool error carrying the last 2000 characters of stderr.
- [ ] R4. Typed workflow params. `metadata.mcp.params` is an optional map from a declared `vars` key to `{type, description?, enum?, required?}`. It feeds `workflowToolDescriptor` (typed properties, a `required` array, descriptions) and `callWorkflowTool`, which validates and then stringifies. When `params` is present it is an allowlist: only the declared vars are advertised and accepted, and every other var keeps its YAML default. Workflows with only `metadata.mcp.expose: true` produce exactly today's descriptor and behavior. A `params` key that is not in `vars` → an `invalid-manifest`-style issue (`reason: 'invalid-params'`), and the workflow is refused. Workflow annotations stay frozen (1421 R2).
- [ ] R5. Wiring. One resolver, `resolveProjectMcpTools`, combines the workflow and manifest tools and their issues, and feeds:
  - `McpDispatcher.listTools`, `catalog()`, and dispatch (`apps/server/src/modules/mcp/index.ts`);
  - the gateway's `mcpRoutes` (`packages/app/src/services/project-gateway.ts:774-799`), so that name routing (`:889`) finds manifest tools;
  - Integrations status.
  Manifest calls go through the same `callTool` telemetry wrapper with `origin: 'manifest'`, extending 1446's union, so the Board McpTab Origin column shows `manifest`.
- [ ] R6. Dogfood and docs:
  - `plugins/sp/mcp-tools.yaml` exposes `sp_plugin_smoke` (`["bun","run","plugin-smoke"]`, read-only, idempotent, `timeoutMs: 120000`, `output: text`);
  - `config/workflows/history-anatomy.yaml` opts in with typed `params` covering only `mode` (enum `daily|ad-hoc`, `history-anatomy.yaml:31`), `date`, `since`, `until`, `focus` and `recompute` (boolean). `output` and `spurBin` are deliberately left out (see correction 11);
  - add `apps/cli/schemas/mcp-tools.schema.json`, generated from or kept in parity with the Zod schema;
  - update `docs/design/embedded-mcp-server.md` (manifest tools section) and `docs/design/workflow-composition-contract.md` (`metadata.mcp.params`);
  - add an ADR-152 amendment recording the scoped spawn path (correction 1).

**Out of scope:** manifests in `superskill` and `knowledge-kit` (follow-up tasks in those repos); a `.spur/mcp-tools.yaml` override; workflow annotation overrides; sandboxing (ADR-012); MCP resources from manifests.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a valid manifest tool is listed with its typed schema and annotations (req: R1, R5)
  Given a fixture project with namespace `zz` and a `plugins/zz/mcp-tools.yaml` declaring `echo` with a string param `msg` (required) and a boolean param `loud`
  When `tools/list` is called on the project's serve
  Then `zz_echo` is listed with `inputSchema.properties.msg.type = "string"`, `required: ["msg"]`, `additionalProperties: false`, and the declared annotations
  And `catalog().exposureIssues` is empty
  # packages/app/tests/services/mcp-manifest-tools.test.ts, apps/server/tests/modules/mcp-module.test.ts

Scenario: AC2 — invalid and colliding entries are refused with diagnostics (req: R2)
  Given a manifest with an unknown top-level key in one file, and in another file an entry named like a built-in, an entry named like an exposed workflow tool, two entries with the same name, and a param with no `args` fragment
  When the project's MCP tools are resolved
  Then the first file yields one `invalid-manifest` issue and no tools
  And the second yields `builtin-collision`, `duplicate` (the workflow tool stays listed), `duplicate`, and `invalid-manifest` issues
  And none of the refused names appears in `tools/list` or is callable
  # packages/app/tests/services/mcp-manifest-tools.test.ts

Scenario: AC3 — arguments bind as discrete argv elements and never reach a shell (req: R3)
  Given `zz_echo` with `command: ["printf", "%s"]` and `args: {msg: ["{value}"], loud: ["--loud"]}`
  When it is called with `msg: "a; rm -rf ~ $(id)"` and `loud: false`
  Then the executor receives `command: "printf"` and `args: ["%s", "a; rm -rf ~ $(id)"]` as one literal element, with no `--loud`
  And calls with `msg: "--evil"`, an unknown key, `loud: "yes"`, or a missing `msg` fail as `invalid_arguments` before any spawn
  # packages/app/tests/services/mcp-manifest-tools.test.ts (buildManifestArgv), apps/server/tests/modules/mcp-module.test.ts (stub executor)

Scenario: AC4 — execution results, failures and the environment are handled (req: R3)
  Given manifest tools backed by real commands in a temporary project
  When one exits 0 printing JSON (`output: json`), one exits 3 writing to stderr, and one exceeds `timeoutMs: 1000`
  Then the first returns the parsed object, and the second and third return tool errors whose message carries the exit code (or timeout) and the stderr tail
  And a tool printing `$<authEnv var>` sees an empty value even though the server process has it set
  # apps/server/tests/modules/mcp-module.test.ts

Scenario: AC5 — typed workflow params are advertised, validated and stringified, and legacy opt-ins are unchanged (req: R4)
  Given a workflow with `metadata.mcp: {expose: true, params: {mode: {type: string, enum: [daily, ad-hoc], required: true}, recompute: {type: boolean}}}`, and another with only `expose: true`
  When `tools/list` and `tools/call` run
  Then the first descriptor has the enum, the boolean type and `required: ["mode"]`; calling it with `recompute: true` runs the workflow with `vars.recompute === "true"`; `mode: "weekly"` fails `invalid_arguments`
  And the second descriptor equals today's all-optional-string shape, with annotations `{readOnlyHint:false, destructiveHint:false, idempotentHint:false}`
  And the first descriptor lists no undeclared var, and calling it with an undeclared var fails `invalid_arguments`
  And a `params` key that is not in `vars` refuses that workflow with an `invalid-params` issue
  # packages/app/tests/services/mcp-workflow-tools.test.ts, apps/server/tests/modules/mcp-module.test.ts

Scenario: AC6 — manifest tools reach the gateway and the Board with origin `manifest` (req: R5)
  Given two local projects behind the gateway, one of which has a manifest tool
  When gateway `tools/list` and `tools/call` run for that tool, and the Integrations status is read
  Then the tool is listed and routed to its owning project, the `mcp.tool.called` event carries `origin: 'manifest'`, and McpTab shows `manifest` in the Origin column
  # packages/app/tests/services/project-gateway-mcp.test.ts, apps/web/tests/modules/integrations-module.test.tsx

Scenario: AC7 — Spur dogfoods both paths and the contract is documented (req: R6)
  Given the spur-new repository at the task's HEAD
  When the source-local `spur serve` answers `tools/list`
  Then `sp_plugin_smoke` (manifest, readOnlyHint true) and `sp_history_anatomy` (workflow, typed `mode` and `recompute`, no `output` or `spurBin` property) are listed with no exposure issues
  And `apps/cli/schemas/mcp-tools.schema.json` validates `plugins/sp/mcp-tools.yaml`; `embedded-mcp-server.md`, `workflow-composition-contract.md` and the ADR-152 amendment describe the manifest, the params, and the scoped spawn path
  # apps/server/tests/modules/mcp-module.test.ts (repo-root inventory), docs review
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-24T05:39:43.776Z

- **Q: Does spawning a process on each call violate ADR-152?** Decided: amend the ADR rather than avoid spawning. The CLI spawn that ADR-152 rejected was about built-ins re-entering Spur's own CLI. Manifest commands are operator-authored project files, the same trust as workflow `shell` actions (ADR-012). Built-ins keep delegating in-process.
- **Q: Should the `superskill` (`cc`) and `knowledge-kit` (`kk`) manifests be written here?** Decided: no. Those repos own their files, and this task only ships the contract they consume. Proposed follow-ups: `superskill`: `cc_doctor`, `cc_<noun>_validate|evaluate`; `knowledge-kit`: `kk_store_*`, `kk_wiki_*`, plus `metadata.mcp` on selected workflows.
- **Q: Placeholders inside `command`, or per-param fragments?** Decided: `command` is fixed, and each param maps to an `args` fragment. There is no string interpolation, so a value can only ever be one whole argv element, and an optional param that is absent leaves no dangling flag.
- **Q: Values that start with `-`?** Decided: refused for free-form string params (option-injection guard). Params with an `enum` are exempt, because the operator enumerated their values.
- **Q: Can workflows override annotations?** Decided: no. They stay frozen by 1421 R2, because a run is always a write.
- **Q: Does a manifest tool or a workflow tool win a name clash?** Decided: the workflow tool, which is the existing surface. The manifest entry is refused as `duplicate`.
- **Q: Should the result be cached?** Decided: no. The resolver runs per call, as the stateless workflow path does.

### Design

#### Contract

```yaml
# plugins/<ns>/mcp-tools.yaml — params/args are illustrative; the real sp dogfood entry declares none
schema_version: 1
tools:
  - name: plugin_smoke              # exposed as <ns>_plugin_smoke
    description: Run the sp plugin install smoke check.
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    params:                         # optional → inputSchema.properties (+ required[])
      target: { type: string, enum: [claude, codex], description: Target agent }
      verbose: { type: boolean }
    command: [bun, run, plugin-smoke]   # fixed argv; no placeholders
    args:                               # one fragment per param, appended in params order when supplied/defaulted
      target: ["--target", "{value}"]   # string/number: exactly one element equal to "{value}"
      verbose: ["--verbose"]            # boolean: no {value}; appended only when true
    output: text                        # json | text (default text)
    timeoutMs: 120000                   # 1000..120000 (default 30000)
```

```yaml
# workflow opt-in (R4); omitting params = legacy behavior
metadata:
  mcp:
    expose: true
    params:
      mode: { type: string, enum: [daily, ad-hoc], required: true, description: Report mode }
      recompute: { type: boolean }
```

#### Modules and seams

| File | Change |
| --- | --- |
| `packages/app/src/services/mcp-manifest-tools.ts` (new) | Zod `manifestSchema` (strict), `ManifestTool`, `resolveManifestTools({namespace, projectRoot, fs, reserved})`, `manifestToolDescriptor`, pure `buildManifestArgv(tool, args) → string[]` |
| `packages/app/src/services/mcp-workflow-tools.ts` | `McpExposureReason` += `'invalid-manifest' \| 'invalid-params'`; parse `metadata.mcp.params`; `ExposedWorkflowTool.params?`; typed `workflowToolDescriptor`; new `resolveProjectMcpTools` = workflow resolve → manifest resolve with `reserved = MCP_BUILTIN_TOOL_NAMES ∪ workflowToolNames` → `{workflowTools, manifestTools, issues}` |
| `packages/app/src/index.ts` | Export the new symbols |
| `apps/server/src/modules/mcp/index.ts` | `exposedWorkflowTools()` → `exposedTools()` built on `resolveProjectMcpTools`; `listTools`/`catalog` add manifest descriptors; `dispatchTool` default case tries workflow, then manifest (`callManifestTool`); `callWorkflowTool` validates typed params and stringifies; `origin` = `'manifest'` in the telemetry wrapper |
| `apps/server/src/context.ts` | Reuse the existing `processRegistry()`-backed `NodeProcessExecutor` (`:760`); expose it on ctx if it is not reachable yet. No new executor type |
| `packages/app/src/services/project-gateway.ts:774-799` | `mcpRoutes` uses `resolveProjectMcpTools` and lists both descriptor kinds; routing `:889` is unchanged |
| `packages/contracts/src/integrations.ts`, `apps/web/src/modules/integrations/McpTab.tsx` | Add `'manifest'` to the origin enum and its label (after 1446) |
| `apps/cli/schemas/mcp-tools.schema.json` | JSON Schema that mirrors the Zod schema, with a parity test |
| `plugins/sp/mcp-tools.yaml`, `config/workflows/history-anatomy.yaml` | Dogfood (R6); rebuild `apps/cli/config/` via `build:bundle` |

#### Execution path (`callManifestTool`)

1. `buildManifestArgv` validates the arguments and throws `InvalidArgumentsError` (→ `invalid_arguments`) before any spawn.
2. `env = childProcessEnv()`, then `env[config.server.mcp.authEnv] = ''` when set. The variable is blanked rather than deleted, because executor merge re-adds deleted keys (see the `child-env.ts:20` note).
3. `executor.run({command: argv[0], args: argv.slice(1), cwd: ctx.cwd, env, timeout: tool.timeoutMs})`.
4. On a non-zero exit or timeout, throw `Error("manifest tool <name> exited <code>: <stderr tail 2000>")`. If stdout exceeds 1 MiB, throw. For `json`, `JSON.parse(stdout)`, and throw `"manifest tool <name> returned invalid JSON"` on failure. For `text`, return `{stdout}`.

#### Anti-patterns (rejected)

- Never `import()` downstream JS/TS, `shell: true`, or `sh -c`.
- No string interpolation of `{value}` inside larger elements (`--x={value}` is not allowed).
- No manifest cache; the resolver runs per call, like workflows.
- No new public `spur` noun or verb. The manifest is a file contract, so no CLI surface consent is needed.
- Do not edit `superskill` or `knowledge-kit` from this task.

### Plan

0. Confirm that 1445 and 1446 are `done` and merged, and rebase. Read 1446's final `origin` union and the shape of `callTool`'s wrapper.
1. (R1, R2, R3) Write failing tests in `packages/app/tests/services/mcp-manifest-tools.test.ts`: schema strictness, the refusal matrix (AC2), and `buildManifestArgv` binding and guards (AC3). Then implement `mcp-manifest-tools.ts`.
2. (R4) Write failing tests in `packages/app/tests/services/mcp-workflow-tools.test.ts`: typed descriptor, allowlist, legacy parity, `invalid-params` (AC5 descriptor half). Then extend `mcp-workflow-tools.ts` and add `resolveProjectMcpTools`.
3. (R3, R4, R5) Write failing tests in `apps/server/tests/modules/mcp-module.test.ts`: list, call through a stub executor (AC1, AC3), real-process results, timeout and env blanking (AC4), typed workflow call stringification (AC5), `origin: 'manifest'` events. Then wire `McpDispatcher` and the ctx executor.
4. (R5) Gateway and Board: extend `project-gateway-mcp.test.ts` and `integrations-module.test.tsx` (AC6), then update `mcpRoutes`, the contract enum and McpTab.
5. (R6) Write `plugins/sp/mcp-tools.yaml` and the `history-anatomy.yaml` opt-in; add `apps/cli/schemas/mcp-tools.schema.json` plus a parity test; run the repo-root inventory test (AC7); run `bun run --filter @gobing-ai/spur build:bundle`.
6. (R6) Docs: the manifest section in `embedded-mcp-server.md`, `metadata.mcp.params` in `workflow-composition-contract.md`, and the ADR-152 amendment (scoped spawn path).
7. Gate: `bun run spur-check`, then `bun run build`. Manual check: `spur serve` + `spur mcp` → `tools/list` shows `sp_plugin_smoke` and `sp_history_anatomy`; call `sp_plugin_smoke`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [B91: MCP plugin-namespaced tools and opt-in workflow tools](../features/B91_mcp-plugin-namespaced-tools-and-opt-in-workflow-tools.md)
- Concurrent dependencies: Task `1445` (expanded `sp_*` built-ins) and Task `1446` (MCP tool call observability)
- Target downstream repositories: `/Users/robin/xprojects/superskill` (`cc`) and `/Users/robin/xprojects/knowledge-kit` (`kk`)
- Design docs: `docs/design/embedded-mcp-server.md`, `docs/design/workflow-composition-contract.md`, `docs/00_ADR.md` (`ADR-152`, `ADR-012`)

### History

- 2026-11-24T05:39:50.878Z backlog → todo (system)

