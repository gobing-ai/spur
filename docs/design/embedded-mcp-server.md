---
kind: design
title: "Embedded MCP 2.0+ server in spur self serve"
status: accepted
created_at: 2026-11-17
updated_at: 2026-11-23
related:
  - docs/features/B9_embedded-mcp-2-0-server-in-spur-serve.md
  - docs/design/configuration-contracts.md
  - docs/design/project-gateway.md
  - docs/design/cli-contracts.md
tags: [mcp, server, protocol, agent]
---

# Embedded MCP 2.0+ server in spur self serve

Accepted under [ADR-152](../00_ADR.md#adr-152-spur-serve-embeds-a-stateless-mcp-20-server-that-delegates-to-spur-app-services).
Implemented by feature B9, tasks 1370–1374.

## 1. Boundary

`spur self serve` exposes one agent-facing MCP endpoint: `POST /mcp`, mounted by `mcpModule`
(`apps/server/src/modules/mcp/`, registered in `apps/server/src/modules/registry.ts`) only when
`server.mcp.enabled` is true — off mounts no route at all, like the A2A listener. The adapter
(`apps/server/src/modules/mcp/protocol.ts`) is transport-only: it parses and serializes, then
dispatches over an injected handler registry that `mcpModule` backs with `@gobing-ai/spur-app`
services. Stdio-only clients connect through the `spur mcp` CLI bridge
(`apps/cli/src/commands/mcp.ts`), which is also transport-only.

## 2. Config

| Key | Env var | Default |
| --- | --- | --- |
| `server.mcp.enabled` | `SPUR_MCP_ENABLED` | `false` |
| `server.mcp.authEnv` | `SPUR_MCP_AUTH_ENV` | — (NAME of the variable holding the bearer token; required when `enabled` is true — enabling without it fails the config load; the value is read at request time, never stored) |
| `server.mcp.namespace` | `SPUR_MCP_NAMESPACE` | — (optional project namespace matching `/^[a-z][a-z0-9]{1,15}$/`; invalid value fails config load naming the variable and grammar) |

Mirrors `server.a2a` end to end (`packages/config/src/index.ts` schema + `superRefine`;
`ServerBootConfig.mcp` in `apps/server/src/server-config.ts`).

**Namespace resolution (task 1380):** `resolveMcpNamespace` in `packages/app/src/services/mcp-namespace.ts`
resolves the project namespace once when `McpDispatcher` constructs:
1. `server.mcp.namespace` (`SPUR_MCP_NAMESPACE`), if configured (`source: 'config'`).
2. Otherwise, the `name` field of the single depth-1 `plugins/*/plugin.json` manifest if that
   `name` matches `/^[a-z][a-z0-9]{1,15}$/` (`source: 'plugin-manifest'`). Zero manifests, multiple
   manifests, nested-only manifests (`plugins/<group>/<name>/plugin.json`), or an invalid `name`
   all resolve to `none` (`namespace: null`).
3. `server/discover` includes `namespace` in its result when non-null and omits it when `null`.

## 3. Protocol contract (stateless MCP 2.0+ only)

- **Version floor.** `Mcp-Protocol-Version` must be a `YYYY-MM-DD` value ≥ `2026-07-28`
  (`MIN_MCP_PROTOCOL_VERSION`). Missing, malformed, or older → `400 PROTOCOL_VERSION_UNSUPPORTED`
  (checked before body parse). Legacy versions (`2024-11-05`, `2025-03-26`, `2025-11-25`) are
  rejected, never negotiated.
- **Stateless transport.** Every request is a self-contained `POST /mcp`. Non-POST →
  `405 STATEFUL_TRANSPORT_UNSUPPORTED` with `Allow: POST`; an `Mcp-Session-Id` header → `400`.
  No session store, no persistent SSE; responses are `application/json`, or one request-scoped
  `text/event-stream` frame when the request's `Accept` asks for it.
- **Method/target addressing.** Method comes from the `Mcp-Method` header or a JSON-RPC 2.0 body
  `method`; target name from `Mcp-Name` (or `params.name` / `params.uri`). Supported methods:
  `server/discover` (negotiated version + capability surface), `tools/list`, `tools/call`,
  `resources/list`, `resources/read`.
- **Auth.** `Authorization: Bearer <token>` where `<token>` is the current value of the environment
  variable `server.mcp.authEnv` names. Missing/wrong → `401` with
  `WWW-Authenticate: Bearer realm="spur-mcp"`; unset token variable at request time fails closed
  (`500`, no challenge).
- **Hop and caller headers (task 1446 R1).** `X-Spur-Mcp-Via` (`direct` | `gateway` | `stdio`;
  absent or invalid → `direct`) and `X-Spur-Actor` (client identity, sanitized to
  `^[A-Za-z0-9._:@-]{1,64}$`, otherwise dropped). The adapter parses both once per request into
  `McpRequestMeta` (`protocol.ts`) and hands them to every registry call; a registry that ignores
  the optional argument behaves exactly as before. `spur mcp` sends `stdio` plus the
  `initialize.params.clientInfo.name` it cached (`X-Spur-Actor`), and the gateway's root `/mcp`
  sends `gateway` plus the actor it received, so a project ledger attributes the caller either way.
  The actor is the only header value that reaches a payload — never the raw header.

## 4. Tools and resources

`tools/list` advertises 41 built-in `sp_*` tools, each one call into an existing `@gobing-ai/spur-app`
service (no CLI spawn, no second workflow state machine). Built-ins always carry the `sp`
namespace (task 1379, breaking rename, no alias period): a call to an old unprefixed name is
refused with `tool "<name>" was renamed to "<sp-name>"`. Names use `[a-z0-9_]` — deliberately
narrower than the MCP 2026-07-28 spec allows, which SHOULD-permits `A-Z a-z 0-9 _ - .` (see
[Tool Names](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names));
the restriction is chosen on purpose for greppability and collision safety. Three read-only
`spur://` resources:
`spur://tasks/{wbs}`, `spur://features/{id}`, `spur://context/{name}` — single-path-segment
confinement: traversal is refused, an unknown feature id is an error (not empty), an unknown scheme
is refused.

**Where the catalog lives (task 1445 R7).** `apps/server/src/modules/mcp/index.ts` owns the
protocol wiring (`McpDispatcher`, `callTool` telemetry, resources) and composes
`TOOL_DESCRIPTORS` and one `TOOL_HANDLERS` map from the per-domain modules — `tools-task.ts`,
`tools-feature.ts`, `tools-workflow.ts`, `tools-rule.ts`, `tools-decision.ts`,
`tools-coordination.ts`, `tools-builder.ts`, `tools-self.ts` — each exporting `{ descriptors,
dispatch }`. Argument readers, the annotation pair, the inline-section bridge and the error shims
live once in `tools-shared.ts`. `BUILTIN_TOOL_NAMES` and `MCP_BUILTIN_TOOL_NAMES`
(`packages/app/src/services/mcp-builtin-tools.ts`) stay in parity by test.

### 4.1 Built-in catalog, by domain

| Domain | Tools |
| --- | --- |
| Task | `sp_task_show`, `sp_task_list`, `sp_task_create`, `sp_task_update` (+ `append`), `sp_task_transition`, `sp_task_check`, `sp_task_sections`, `sp_task_deps`, `sp_task_preflight`, `sp_task_batch_plan` |
| Feature | `sp_feature_check`, `sp_feature_show`, `sp_feature_list`, `sp_feature_create`, `sp_feature_update`, `sp_feature_transition`, `sp_feature_sync`, `sp_feature_refresh` |
| Workflow | `sp_workflow_status`, `sp_workflow_run`, `sp_workflow_continue`, `sp_workflow_list`, `sp_workflow_show`, `sp_workflow_validate`, `sp_workflow_cancel` |
| Rule | `sp_rule_run`, `sp_rule_list`, `sp_rule_validate` |
| Decision | `sp_decision_list`, `sp_decision_show`, `sp_decision_status`, `sp_decision_run` |
| Coordination | `sp_agent_status`, `sp_message_send`, `sp_message_inbox`, `sp_message_reply` |
| Builder | `sp_builder_check_deps`, `sp_builder_show_branches` |
| Self | `sp_self_status`, `sp_self_search`, `sp_self_actions` |

The CLI-only boundary (task 1445 Design table), with no tool by construction: `task --force-done` /
`--provenance-bypass` / `migrate` / `record` / `verdict`; `feature move` / `feature verify`;
`workflow clean` / `workflow promote-*`; `rule --fix-mode auto` and an arbitrary `--file`; decision
evidence file paths (the inline `evidence` string only); `agent start|stop|loop`; builder `bump-ver` /
`drop-tags` / `publish` / `build-*`; `self serve|install|uninstall|init|maintain|migrate` and any
shell execution, including running a resolved action; gateway-daemon status (a CLI-local probe).
Per-tool CLI parity: `plugins/sp/skills/spur-cli/references/mcp-tools.md`.

**Corpus write tools (task 1392).** Five more built-ins make the corpus rules hold by
construction: each is one call into an existing guarded service, and each schema sets
`additionalProperties: false` with enums for closed values.

| Tool | Seam | Deliberately absent vs the CLI |
| --- | --- | --- |
| `sp_task_create` | `TaskService.create` | ready-prep (a server tool never dispatches a model), dedupe flags |
| `sp_task_update` | `section`+`content` → `updateSection` (with `append`), `field`+`value` → `updateField`, `addTags`/`removeTags` → `updateTags` | `status` (the enum has no such value), `--from-file` (content is inline) |
| `sp_task_transition` | `ctx.transitionTask` → `transitionTaskGuarded` | `forceDone`, `reason` |
| `sp_feature_check` | `FeatureCheckService.check` with the HTTP handler's folders | none |
| `sp_rule_run` | `RuleService.evaluate({ emit: false })` | `file` (presets and rule ids only), `fixMode: auto`, `stopOnFirst`, `verbose` |

The schema is enforced at the dispatcher before any service runs, so an undeclared argument is
refused rather than ignored. A guard refusal travels with the code the CLI reports
(`GUARD_DENIED: <same message>`, both surfaces calling the same function), and `RuleService.evaluate`
gained `emit?: boolean` so a programmatic caller gets the result with nothing written to stdout.
At the gateway root each built-in also requires the `project` selector (task 1383), which the
gateway adds when it re-advertises `TOOL_DESCRIPTORS`.

The server resolves planning folders against the served project root. Corpus operations use
that root even when the server process was started from another working directory.

**Workflow tools (task 1381, enriched task 1447).** `tools/list` additionally advertises every workflow that declares
`metadata: { mcp: { expose: true } }`, named `<namespace>_<workflow>` (lowercase, non-alphanumerics
mapped to `_`), described by the workflow's own `description`, with `additionalProperties: false`.
When `metadata.mcp.params` is omitted, every declared `vars` entry becomes an optional string
property carrying its default (legacy behavior). When `metadata.mcp.params` is present, it acts as
a typed allowlist (`string` | `number` | `boolean`, optional `description`, `enum`, `required`):
only declared params are advertised and accepted, arguments are validated against the typed schema
and stringified before `WorkflowService.run(file, { vars })`, and every undeclared var keeps its
YAML default. A `params` key absent from `vars` refuses the workflow with `reason: 'invalid-params'`.
Workflow annotations remain frozen (`{readOnlyHint: false, destructiveHint: false, idempotentHint: false}`).
Roots are the workflow layers — project, registered `workflows.paths`, shared. The gateway uses the
same inventory and schema without starting a project.

**Manifest tools (task 1447).** Projects with a resolved namespace may also declare CLI-backed MCP
tools in `plugins/<namespace>/mcp-tools.yaml` (strict Zod schema in
`packages/app/src/services/mcp-manifest-tools.ts`, mirrored by `apps/cli/schemas/mcp-tools.schema.json`).
Each entry declares `name` (`^[a-z][a-z0-9_]{0,47}$`, exposed as `<namespace>_<name>`),
`description`, all three `annotations` booleans, optional typed `params`, a fixed `command` argv
with no placeholders, per-param `args` fragments (`{value}` as one discrete element for
string/number; no `{value}` for boolean flags), `output` (`text` | `json`, default `text`), and
`timeoutMs` (`1000..120000`, default `30000`). `resolveProjectMcpTools` combines workflows and
manifests so built-ins and exposed workflows win collisions (`builtin-collision` / `duplicate`);
schema or fragment errors emit `invalid-manifest` and refuse the offending entry or file without
throwing. Execution runs via `NodeProcessExecutor` (no shell), validates arguments before spawn
(including a 1024-char limit and a leading-`-` option-injection guard on non-enum strings), blanks
the `server.mcp.authEnv` variable from `childProcessEnv()`, enforces a 1 MiB stdout cap, and
reports `origin: 'manifest'` in `mcp.tool.called` / `mcp.tool.failed` and the Board McpTab.

**Tool annotations (task 1421 R2).** Every advertised descriptor — the 41 built-ins and every
exposed workflow tool — carries the three MCP hints. Reads are `{readOnlyHint: true,
destructiveHint: false, idempotentHint: true}` — the show/list/check/preflight/plan/status/trace/
search/resolve tools (`sp_task_show`, `sp_task_list`, `sp_task_check`, `sp_task_preflight`,
`sp_task_batch_plan`, `sp_feature_check`, `sp_feature_show`, `sp_feature_list`, `sp_rule_run`,
`sp_rule_list`, `sp_rule_validate`, `sp_workflow_status`, `sp_workflow_list`, `sp_workflow_show`,
`sp_workflow_validate`, `sp_decision_list`, `sp_decision_show`, `sp_decision_status`,
`sp_agent_status`, `sp_message_inbox`, `sp_builder_check_deps`, `sp_builder_show_branches`,
`sp_self_status`, `sp_self_search`, `sp_self_actions`); writes
(`sp_task_create`/`update`/`transition`/`sections`/`deps`, `sp_feature_create`/`update`/`transition`/
`sync`/`refresh`, `sp_workflow_run`/`cancel`/`continue`, `sp_decision_run`, `sp_message_send`/`reply`)
and workflow-derived tools are `{false, false, false}` — cancel stops a run but deletes nothing, so
the pair stays two-valued. No tool deletes, so `destructiveHint` is always `false` but always
present — a client renderer never has to guess a missing hint.

**Error codes (task 1421 R1).** The `mcp.tool.failed` event carries one of three codes. Every
argument-validation failure is `invalid_arguments`, and the classification is a CLASS, not a message
shape: the validators, `requiredString`, the map-of-strings and array checks, the declared-schema
violation and the workflow-tool argument checks all throw `InvalidArgumentsError`
(`apps/server/src/modules/mcp/protocol.ts`, raised from `tools-shared.ts` and
`index.ts`), and the emit site maps `instanceof` to the code. A new
validator message therefore cannot silently degrade to `tool_error`. An unknown or renamed tool name
stays `unknown_tool`, and a service's own failure stays `tool_error`.

**Call telemetry (task 1446 R1/R2).** `mcp.tool.called` and `mcp.tool.failed` add `origin`
(`built-in` | `workflow` | `unknown`), `access` (`read` | `write`, from the descriptor's
`readOnlyHint`), `via` and `actor` — so `ProtocolUsage.byActor` attributes a caller instead of
reading `unknown` for every row. Three diagnostic-tier, metadata-only events record protocol
discovery, once per request and keyed on the request's method: `mcp.server.discovered`
(`server/discover`), `mcp.tools.listed` (`tools/list`) and `mcp.resources.listed`
(`resources/list`). A status or Board catalog read (`catalog()`) carries no `meta` and therefore
emits nothing. `server/discover` calls `listTools` and `listResources` internally, so emitting per
registry method would double-count — the method, not the call, is the unit. Emission reuses
`emitEvent`, so a failing bus never fails the call it describes.

## 5. `spur mcp` stdio bridge

`spur mcp [--cwd <path>] [--url <mcpUrl> | --gateway]` reads NDJSON from stdin and writes JSON-RPC
replies to stdout. Stateless requests and replies pass through unchanged.
Headers always include `Mcp-Protocol-Version: 2026-07-28` and `Content-Type: application/json`;
`Authorization: Bearer` is attached only when the `server.mcp.authEnv` variable is set — unset is a
loud `CommandError`, never a silent unauthenticated call. URL resolution order: `--url` → the
cwd project's canonical gateway prefix (`http://localhost:<gateway.port><prefix>/mcp` for every
registered local entry, independent of gateway liveness) → direct `server.port` only when no local
prefix can be derived (unregistered project). `--gateway` targets the gateway root at
`server.gateway.port` and reads the bearer from the variable named by `server.gateway.mcp.authEnv`.
Both commands use the same env-derived configuration.

For legacy stdio clients, the bridge verifies access with `server/discover` before accepting
`initialize`, declares the tools capability, acknowledges pings and consumes
`notifications/initialized`. It wraps raw tool results as JSON text content for that connection.
The HTTP endpoint continues to accept stateless requests only.

## 6. Gateway interaction

`gatewayGuard` exempts `/<prefix>/mcp` from browser-origin CSRF checks alongside `/<prefix>/a2a` —
bearer-authenticated routes a cross-site simple request cannot produce. The host allowlist
(`isAllowedHost` → 421) still runs first for every path including `/mcp`; the exemption never
bypasses it.

## 7. Invariants

- `mcpModule` mounts only on `server.mcp.enabled === true`; default-off.
- Enabled without `authEnv` fails the config load — an enabled endpoint with no token can only
  reject everyone.
- Tool/resource execution delegates to `@gobing-ai/spur-app`; neither the adapter nor the bridge
  spawns the CLI or duplicates the workflow FSM.
- Legacy protocol versions and stateful transports are rejected explicitly, never negotiated.
- `spur mcp` adapts legacy framing at the stdio boundary. Tool and resource execution stay on the
  server, and `MCP_PROTOCOL_VERSION` in the bridge mirrors `MIN_MCP_PROTOCOL_VERSION`.

## 8. Proof

End-to-end integration tests through the gateway handler: `apps/server/tests/mcp-e2e.test.ts`
(discover, tools/call, resources/read, bearer 401 + challenge, legacy-version rejection, stdio
bridge round-trip, and the expanded task tools with their on-disk writes plus `mcp.tool.*`
rows). Module and adapter units: `apps/server/tests/modules/mcp-module.test.ts`,
`apps/server/tests/modules/mcp/protocol.test.ts`; per-domain composition checks:
`apps/server/tests/modules/mcp/tools-*.test.ts` (descriptors and handlers name the same tools);
bridge units:
`apps/cli/tests/commands/mcp.test.ts`; gateway catalogue and edge units:
`apps/server/tests/gateway-mcp.test.ts`, `packages/app/tests/services/project-gateway-edge.test.ts`.
