---
schema_version: 1
name: "MCP tool call observability: enrich mcp.* events, capture gateway per-tool telemetry, and render per-tool call counters in McpTab"
status: done
template: feature-impl
created_at: 2026-11-24T04:02:50.638Z
updated_at: "2026-11-24T06:49:12.201Z"

feature_id: A82
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 8
done_forced: "false"
done_reason: unforced close
---

## 1446. MCP tool call observability: enrich mcp.* events, capture gateway per-tool telemetry, and render per-tool call counters in McpTab

### Background

Currently MCP tool observability has four concrete gaps:
1. **Limited `mcp.*` event catalog and payload metadata (`packages/app/src/services/event-names.ts:423-425,1974-2026`, `apps/server/src/modules/mcp/index.ts:335-362`):**
   - Only `mcp.tool.called`, `mcp.tool.failed`, and `mcp.resource.read` exist.
   - `mcp.tool.called` and `mcp.tool.failed` record `tool`, `argKeys`, `durationMs`, `outcome`, `errorCode`, `wbs`, and `runId`, but omit tool `origin` (`built-in` vs `workflow`), `access` (`read` vs `write`), transport `via` (`direct` vs `gateway` vs `stdio`), and caller `actor` / client identity (so `ProtocolUsage.byActor` in `packages/domain/src/analytics/protocol-usage.ts:39-44` degrades to `system` / `unknown`).
   - Protocol discovery and catalog reads (`server/discover`, `tools/list`, `resources/list`) emit no events, so operators cannot tell when an agent connected and discovered the catalog vs. invoked tools.
2. **Gateway-routed MCP calls lack per-tool counters and pre-upstream failure events (`packages/app/src/services/project-gateway.ts:460-492,840-974`):**
   - The gateway only increments a single aggregate `{ calls, failures, authDenials, lastCall }` bucket across all `/mcp` POST requests (`countMcp(response.status)`), with no breakdown by `method` (`tools/list` vs `tools/call`) or `tool` name.
   - When a gateway `tools/call` fails before reaching the project upstream (unknown/ambiguous `project`, namespace collision, missing project token, or unreachable upstream), no `mcp.tool.failed` event is recorded in any project ledger and no per-tool failure counter is incremented.
3. **`ProtocolToolUsage` lacks `lastCalledAt` (`packages/domain/src/analytics/protocol-usage.ts:16-30`):**
   - `ProtocolToolUsage` computes `calls`, `failures`, `failureRate`, `p50Ms`, `p95Ms`, and `durationUnmeasured`, but does not track `lastCalledAt: string | null`.
4. **`McpTab.tsx` Tools table lacks per-tool call counters (`apps/web/src/modules/integrations/McpTab.tsx:77-118`):**
   - The main **Tools** catalog table (`data-testid="integrations-mcp-tools"`) only renders `Tool | Origin | Access | Schema`. Call counts live in a separate "Tool latency" table below that omits any tool with 0 calls in the window, making it harder to scan call volume and health per registered tool in one place.

**Refine corrections (2026-11-23)**

- "`byActor` degrades to `system` / `unknown`" → it degrades to `unknown` only (`packages/domain/src/analytics/protocol-usage.ts:210`, `row.actor ?? 'unknown'`); the `system_events.actor` column is filled from a payload `actor` field (`packages/app/src/services/system-event-tap.ts:165-174`) → R1 sets payload `actor`, no tap change.
- "`mcp-client-name` header" → not an MCP standard header; the standard client identity is `initialize.params.clientInfo.name`, which only the stdio bridge sees (`apps/cli/src/commands/mcp.ts:82-95`) → the bridge caches it and forwards `X-Spur-Actor`; direct HTTP clients may send `X-Spur-Actor` themselves; otherwise actor stays null (`unknown`). `mcp-client-name` dropped.
- Missing seam not named by the task: `McpHandlerRegistry.callTool(name, args)` (`apps/server/src/modules/mcp/protocol.ts:70-80`) never sees the request, so headers cannot reach the dispatcher → Design adds an optional `meta` parameter to the registry methods, parsed once in `handleMcpHttpRequest`.
- "`server/discover` emits no event" → also `server/discover` calls `listTools()` + `listResources()` (`protocol.ts:219-222`), so emitting inside `listTools` alone would double-count → events keyed on `meta.method`, and the status read (`catalog()`, no `meta`) emits nothing.
- "emit `mcp.tool.failed` in a project ledger for gateway-refused calls" → the gateway owns no project ledger; its sink is `GatewayDeps.onEvent` → JSONL (`apps/cli/src/commands/self/serve.ts:138`) → R3 records gateway refusals as `GatewayEvent` `mcp.call.failed` + per-tool counters, not a ledger row.
- Gateway aggregate `failures` counts HTTP status ≥400 only (`packages/app/src/services/project-gateway.ts:477-485,1081`); per-tool counters count a thrown `callTool` instead, so tool errors returned in a 200 envelope are counted too.

### Requirements

- [x] R1. `mcp.tool.called` / `mcp.tool.failed` payloads gain `origin` (`'built-in' | 'workflow'`), `access` (`'read' | 'write'`, from `annotations.readOnlyHint`), `via` (`'direct' | 'gateway' | 'stdio'`) and `actor` (sanitized `X-Spur-Actor`, else omitted so the ledger actor stays null); catalog `fields` list them. Unknown tools record `origin: 'unknown'` and no `access`.
- [x] R2. Diagnostic-tier, metadata-only catalog events `mcp.server.discovered` `{namespace, via, actor?, durationMs}`, `mcp.tools.listed` `{toolCount, builtinCount, workflowCount, namespace, via, actor?, durationMs}`, `mcp.resources.listed` `{resourceCount, via, actor?, durationMs}`, emitted once per protocol request by method; board status reads emit none.
- [x] R3. Gateway root `/mcp`: forwards `X-Spur-Mcp-Via: gateway` and the sanitized inbound `X-Spur-Actor` upstream on `tools/call`; keeps per-tool `{calls, failures, lastCall}` counters (cumulative since gateway start) for every routed `tools/call`, including calls refused before an upstream (missing/unknown/ambiguous `project`, collision, missing token, unreachable, 401); emits `GatewayEvent` `kind: 'mcp.call.failed'` `{name: <tool>, prefix?, reason}` for each refusal; exposes counters as `mcpActivity.byTool` on `GET /api/health` and `integrationsActivitySchema.byTool` (optional).
- [x] R4. `ProtocolToolUsage.lastCalledAt: string | null` (max `occurred_at` over called + failed rows per tool in the window) in `packages/domain/src/analytics/protocol-usage.ts` and `integrationsToolUsageSchema` in `packages/contracts/src/integrations.ts`.
- [x] R5. `McpTab.tsx` main Tools table (`data-testid="integrations-mcp-tools"`) columns become `Tool | Origin | Access | Calls | Failures | p50 / p95 | Last call | Schema`, joined from `usage.tools` by name (uncalled → `0`, `0`, `—`, `—`); the Tools card header shows a total-calls badge; usage rows for tools not in the catalog stay visible in the existing latency table, which is otherwise removed.

**Out of scope:** A2A event enrichment; a new ledger table or rollup; windowing gateway `byTool` by `mcpSince`; MCP `initialize` support on the HTTP server; any new CLI flag (`spur mcp --actor` is not added).

### Acceptance Criteria

```gherkin
Task-local criteria (`ac_altitude: task-local`, `ac_numbering: task-local`).

Scenario: AC1 — tool-call events carry origin, access, via and actor (req: R1)
  Given the MCP module with a stub event bus (`apps/server/tests/modules/mcp-module.test.ts`)
  When `sp_task_show` is called with `X-Spur-Mcp-Via: stdio` and `X-Spur-Actor: claude-code`, a workflow tool is called with no headers, and `X-Spur-Actor: "bad actor\n…"` is sent
  Then the events carry `{origin:'built-in', access:'read', via:'stdio', actor:'claude-code'}`, `{origin:'workflow', access:'write', via:'direct'}` with no actor, and the invalid actor is dropped (not stored)

Scenario: AC2 — discovery and list requests emit one lifecycle event each, status reads none (req: R2)
  Given the MCP module
  When `server/discover`, `tools/list` and `resources/list` are posted once each and the integrations status reads `catalog()`
  Then exactly one `mcp.server.discovered`, one `mcp.tools.listed` (counts match the catalog) and one `mcp.resources.listed` are emitted, nothing for `catalog()`, and the catalog entries are tier `diagnostic`

Scenario: AC3 — the stdio bridge forwards via and client identity (req: R1)
  Given `spur mcp` against a fake `/mcp` (`apps/cli/tests/commands/mcp.test.ts`)
  When the client sends `initialize` with `clientInfo.name: "codex"` then `tools/call`
  Then the forwarded `tools/call` request carries `X-Spur-Mcp-Via: stdio` and `X-Spur-Actor: codex`

Scenario: AC4 — gateway counts per tool, including refusals, and forwards headers (req: R3)
  Given the gateway with one reachable and one unreachable project (`packages/app/tests/services/project-gateway-mcp.test.ts`)
  When `sp_task_show` succeeds on the reachable project, fails on the unreachable one, and is called with an unknown `project`
  Then `mcpActivity.byTool.sp_task_show` is `{calls: 3, failures: 2, lastCall: <iso>}`, two `mcp.call.failed` gateway events are emitted without headers or argument values, and the upstream request carried `X-Spur-Mcp-Via: gateway`

Scenario: AC5 — tool usage reports lastCalledAt (req: R4)
  Given `system_events` rows for `sp_task_show` at t1 (called) and t2 > t1 (failed) (`packages/domain/tests/analytics/protocol-usage.test.ts`)
  When protocol usage is read for a window covering both
  Then `lastCalledAt` is t2, and the contract schema parses the result

Scenario: AC6 — the Tools table shows per-tool counters for every registered tool (req: R5)
  Given a status with tools A (called 3, 1 failed) and B (uncalled), and usage containing an unadvertised tool C (`apps/web/tests/modules/integrations/integrations-module.test.tsx`)
  When McpTab renders
  Then row A shows `3`, `1`, its p50/p95 and last call; row B shows `0`, `0`, `—`, `—`; the header badge totals calls; C remains visible in the unadvertised-usage table
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-24T04:48:38.096Z

- **Actor source?** Closed: `X-Spur-Actor` header, set by the stdio bridge from `initialize.params.clientInfo.name` and forwarded by the gateway; sanitized to `^[A-Za-z0-9._:@-]{1,64}$`, else dropped. No new CLI flag (public-surface consent not needed). `mcp-client-name` dropped (not a standard header).
- **Header plumbing?** Closed: optional `meta?: McpRequestMeta` (`{ method, via, actor }`) on `McpHandlerRegistry.listTools/listResources/callTool/readResource`, built once in `handleMcpHttpRequest`. Optional, so existing registries and tests compile unchanged.
- **Gateway success events?** Closed: no `GatewayEvent` per successful call (the upstream ledger already records it with `via: gateway`); only refusals emit `mcp.call.failed`. Counters cover both.
- **Gateway `byTool` window?** Closed: cumulative since gateway start, like the existing counters (restart resets). `ponytail:` comment names the ceiling; per-second buckets per tool only if operators ask for windowed gateway tool rates.
- **Latency table?** Closed: merged into the main Tools table; the separate table remains only for usage rows whose tool is not advertised.

### Design

#### MCP Tool Call Observability Architecture

**Frozen names.** Headers `X-Spur-Mcp-Via` (`direct|gateway|stdio`; absent/invalid → `direct`) and `X-Spur-Actor`. Type `McpRequestMeta { method: string; via: 'direct' | 'gateway' | 'stdio'; actor: string | null }` in `apps/server/src/modules/mcp/protocol.ts`. Payload fields `origin`, `access`, `via`, `actor`. Events `mcp.server.discovered`, `mcp.tools.listed`, `mcp.resources.listed` (`baseEvent(name, 'mcp', 'mcp', 'metadata-only', 'diagnostic')`). `GatewayEventKind` gains `'mcp.call.failed'`. `ProtocolToolUsage.lastCalledAt`. `IntegrationsActivity.byTool?: Record<string, { calls: number; failures: number; lastCall: string | null }>`.

**WHERE.**
1. `apps/server/src/modules/mcp/protocol.ts` — `handleMcpHttpRequest` builds `meta` from headers + JSON-RPC method and passes it to every registry call; `McpHandlerRegistry` methods take optional `meta`.
2. `apps/server/src/modules/mcp/index.ts` — `callTool(name, args, meta?)` derives `origin` (`TOOL_DESCRIPTORS` hit → `built-in`; exposed workflow → `workflow`; else `unknown`), `access` from the descriptor's `readOnlyHint`, and adds `via`/`actor` to both payloads. `listTools(meta?)` emits `mcp.server.discovered` when `meta.method === 'server/discover'`, `mcp.tools.listed` when `'tools/list'`; `listResources(meta?)` emits `mcp.resources.listed` only for `'resources/list'`. `catalog()` passes no meta → no events. Emission reuses `emitEvent` (never fails the call).
3. `packages/app/src/services/event-names.ts` — three catalog entries + `fields`/`summary`; `mcp.tool.*` fields gain `origin`, `access`, `via`, `actor`. Update `docs/design/event-tracking.md` catalog rows.
4. `apps/cli/src/commands/mcp.ts` — cache `clientInfo.name` from the stdio `initialize`; add `X-Spur-Mcp-Via: stdio` and `X-Spur-Actor` to every forwarded fetch.
5. `packages/app/src/services/project-gateway.ts` — gateway registry `callTool(name, args, meta?)` wraps routing in try/catch: increment `byTool[name].calls` always, `.failures` + `emit({kind:'mcp.call.failed', name, prefix, reason})` on throw; upstream fetch adds the two headers. `mcpActivity()` returns `byTool`. `packages/contracts/src/integrations.ts` adds optional `byTool`.
6. `packages/domain/src/analytics/protocol-usage.ts` — track max `occurred_at` per tool; contract schema adds `lastCalledAt`.
7. `apps/web/src/modules/integrations/McpTab.tsx` — `Map` join by name; header badge `sum(calls + failures)`.

**Anti-patterns.** Do not log header values other than the sanitized actor; never put argument values, query strings or bodies in a `GatewayEvent` (1384 R3). Do not emit lifecycle events from status/board reads. Do not add a ledger table or a second bus. Do not change existing `mcp.tool.*` field names (1445 and downstream analytics read them). Do not parse `clientInfo` on the HTTP server.

**Handoffs.** 1445 adds tools through the same `callTool` wrapper; this task's enrichment applies to them automatically — no ordering dependency. `docs/design/project-gateway.md` and `docs/design/embedded-mcp-server.md` gain the headers + `byTool` description.

**Concurrency.** Uncommitted operator edits exist in `docs/design/project-gateway.md`, `docs/features/A82_*.md` and `packages/app/src/services/project-gateway-html.ts`; commit or stash them before editing `project-gateway.md`, and do not touch the A82 feature file.

### Plan

0. Precondition: operator edits in `docs/design/project-gateway.md` are committed (see Concurrency).
1. Failing tests first for AC1–AC6 in the files named per scenario.
2. R1/R2: `McpRequestMeta` plumbing in `protocol.ts`; enrichment + lifecycle emission in `modules/mcp/index.ts`; catalog entries in `event-names.ts`.
3. R1 bridge: `apps/cli/src/commands/mcp.ts` headers (AC3).
4. R3: gateway counters, refusal events, forwarded headers; contract `byTool` (AC4).
5. R4: `lastCalledAt` in domain + contract (AC5).
6. R5: McpTab table merge + badge (AC6); browser-check `/spur-new/board/integrations`.
7. Docs: `event-tracking.md`, `embedded-mcp-server.md`, `project-gateway.md`.
8. `bun run spur-check`.

### Solution

Made MCP tool calls observable end to end: every call now carries its origin, access class, transport hop and sanitized caller; the protocol emits one diagnostic lifecycle event per list/discover request; the gateway keeps per-tool counters (refusals included) and forwards the hop/caller headers upstream; tool usage reports a last-call timestamp; and the Board's Tools table joins catalog rows with those counters.

| Requirement | Change | Anchor |
| --- | --- | --- |
| R1 | `McpRequestMeta` type plus the header parser (invalid `via` reads as `direct`, an unsanitized actor is dropped) | `apps/server/src/modules/mcp/protocol.ts:63` |
| R1 | Every registry method takes the optional meta the protocol adapter forwards | `apps/server/src/modules/mcp/protocol.ts:96` |
| R1 | `callTool` derives origin/access and puts via/actor on both the called and failed payloads | `apps/server/src/modules/mcp/index.ts:247` |
| R2 | `listTools` emits `mcp.server.discovered` or `mcp.tools.listed`, keyed on the JSON-RPC method | `apps/server/src/modules/mcp/index.ts:121` |
| R2 | Three diagnostic, metadata-only catalog events with their field lists and presenters | `packages/app/src/services/event-names.ts:428` |
| R1 | `mcp.tool.called` / `mcp.tool.failed` field lists gain origin, access, via and actor (no rename) | `packages/app/src/services/event-names.ts:1980` |
| R1 | stdio bridge caches `clientInfo.name` and forwards the hop and caller headers | `apps/cli/src/commands/mcp.ts:101` |
| R3 | Per-tool cumulative `{calls, failures, lastCall}` map behind the gateway registry | `packages/app/src/services/project-gateway.ts:481` |
| R3 | Gateway `callTool` counts every attempt, emits `mcp.call.failed` per refusal, forwards `gateway` + actor | `packages/app/src/services/project-gateway.ts:1063` |
| R3 | `mcpActivity.byTool` exposed on the health surface | `packages/app/src/services/project-gateway.ts:626` |
| R4 | `lastCalledAt` is the newest called-or-failed timestamp per tool in the window | `packages/domain/src/analytics/protocol-usage.ts:170` |
| R4 | Contract field for the new timestamp | `packages/contracts/src/integrations.ts:164` |
| R3 | Optional `byTool` on the integrations activity schema | `packages/contracts/src/integrations.ts:217` |
| R5 | Tools table joins catalog rows with usage by name and shows origin/access/counters/latency/last call | `apps/web/src/modules/integrations/McpTab.tsx:94` |
| R5 | One shared timestamp formatter for the joined rows and the summary tab | `apps/web/src/modules/integrations/helpers.ts:117` |
| Docs | Gateway counters and hop headers recorded in the design satellite | `docs/design/project-gateway.md:111` |
| Docs | Embedded server headers, meta plumbing and lifecycle events | `docs/design/embedded-mcp-server.md:68` |
| Docs | Integrations module surface updated for the joined Tools table | `docs/design/integrations-module.md:144` |
| Gate fix | The stdio bridge rejects a client name that cannot be a header value instead of dying | `apps/cli/src/commands/mcp.ts:47` |
| Gate fix | Regression test proving a control-character client name sends no actor header | `apps/cli/tests/commands/mcp.test.ts:107` |

No new CLI flag, noun or verb. No ledger table and no second event bus: the sanitized actor is the only header value that reaches an event payload, and argument values, query strings and bodies never do. `mcp.tool.*` field names are unchanged, so the 1445 catalog telemetry keeps parsing.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `McpRequestMeta` + header parse/sanitize `apps/server/src/modules/mcp/protocol.ts:71-88`, forwarded by the adapter at `protocol.ts:244,268,280,294`; `callTool` derives `origin`/`access` and appends `via`/`actor` to both payloads `apps/server/src/modules/mcp/index.ts:243-282` (`toolIdentity` at `:222-237`); catalog fields `packages/app/src/services/event-names.ts:1983-1991` + `:2014`; stdio bridge cache/forward `apps/cli/src/commands/mcp.ts:76-78,94,102`; unknown tool → `origin: 'unknown'`, no `access` (`index.ts:236`), asserted `apps/server/tests/modules/mcp-module.test.ts:1810-1818` |
| R2 | MET | Method-keyed emission `apps/server/src/modules/mcp/index.ts:121-145` (`mcp.server.discovered` / `mcp.tools.listed`, counts `toolCount`/`builtinCount`/`workflowCount`) and `index.ts:207-215` (`mcp.resources.listed`); three `metadata-only`/`diagnostic` catalog entries `packages/app/src/services/event-names.ts:426-431`; `catalog()` passes no meta → silent `apps/server/src/modules/mcp/index.ts:380-388`; verified one-event-per-method and tier/policy at `apps/server/tests/modules/mcp-module.test.ts:1882-1975`; catalog rows in `docs/design/event-tracking.md:374-378` |
| R3 | MET | Per-tool map `packages/app/src/services/project-gateway.ts:481` + `toolActivity()` `:515-524`; counted-before-routing and `mcp.call.failed` per refusal `:1059-1079`; refusal taxonomy via `McpCallRefusal` `:845-931`; forwarded headers `:960`; health surface `:626`; contract `packages/contracts/src/integrations.ts:213-220`; `GatewayEventKind` `:112`; verified `packages/app/tests/services/project-gateway-mcp.test.ts:398-518` (3 calls / 2 failures / two events / no request data / `x-spur-mcp-via: gateway`) |
| R4 | MET | `ProtocolToolUsage.lastCalledAt` `packages/domain/src/analytics/protocol-usage.ts:30-31`, max over called+failed in-window rows `:215-217`, emitted `:288`; contract `packages/contracts/src/integrations.ts:163-164`; verified `packages/domain/tests/analytics/protocol-usage.test.ts:193-213` incl. `integrationsToolUsageSchema.parse` |
| R5 | MET | Joined columns `apps/web/src/modules/integrations/McpTab.tsx:97-101` (headers) and `:118-133` (rows, `calls`/`failures`/`p50 / p95`/`formatWhen(lastCalledAt)`), total-calls badge `:63-67`, unadvertised-only latency table `:200-220`; shared formatter `apps/web/src/modules/integrations/helpers.ts:117-122` (duplicate removed from `SummaryTab.tsx`); verified `apps/web/tests/modules/integrations/integrations-module.test.tsx:602-651`; surface doc `docs/design/integrations-module.md:144` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — tool-call events carry origin, access, via and actor | MET | test | `apps/server/tests/modules/mcp-module.test.ts:1743` (5 tests: stdio+actor, invalid actor dropped, invalid `via`→`direct`, unknown tool→`origin: 'unknown'`+no access, workflow tool→`workflow`/`write`/no actor) |
| AC2 — discovery and list requests emit one lifecycle event each, status reads none | MET | test | `apps/server/tests/modules/mcp-module.test.ts:1882` (one event per method with matching counts, transport identity, `readMcpCatalog` emits nothing, tier `diagnostic` + policy `metadata-only`) |
| AC3 — the stdio bridge forwards via and client identity | MET | test | `apps/cli/tests/commands/mcp.test.ts:79` (initialize with `clientInfo.name: "codex"` → both headers on the forwarded `tools/call`; absent name → no actor, `X-Spur-Mcp-Via: stdio` at `:266`) |
| AC4 — gateway counts per tool, including refusals, and forwards headers | MET | test | `packages/app/tests/services/project-gateway-mcp.test.ts:445` (`{calls: 3, failures: 2, lastCall}` in `mcpActivity.byTool.sp_task_show`, two `mcp.call.failed` with no selector/headers/argument values, upstream `x-spur-mcp-via: gateway` + `x-spur-actor`), `:492` (out-of-charset actor dropped) |
| AC5 — tool usage reports lastCalledAt | MET | test | `packages/domain/tests/analytics/protocol-usage.test.ts:193` (t2 wins over t1, out-of-window row ignored, `integrationsToolUsageSchema.parse` round-trips) |
| AC6 — the Tools table shows per-tool counters for every registered tool | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:629` (row A `3`/`1`/`4ms / 9ms`/last call, row B `0`/`0`/`—`/`—`, badge `6 calls`, unadvertised `sp_retired_tool` retained while `sp_task_list` leaves that table) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewer: independent pass over task 1446's change set (sp-super-reviewer, fresh context). Verdict: PASS — R1–R5 and AC1–AC6 all MET with executable evidence the reviewer re-ran itself; no P1 or P2.

| Severity | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P3 (minor) | `apps/cli/src/commands/mcp.ts:47` | The stdio bridge forwarded `clientInfo.name` verbatim as `X-Spur-Actor` after only a trim, so a name carrying an interior control character made the bridge's own `fetch` throw and the session die with a misleading "cannot reach" error. | FIXED in this run: the bridge now applies the same `^[A-Za-z0-9._:@-]{1,64}$` test the server uses and sends no actor header when the name fails it (`apps/cli/src/commands/mcp.ts:47`), with a regression test (`apps/cli/tests/commands/mcp.test.ts:107`). The tree was re-certified afterwards: `spur task gate 1446 light` PASS. |
| P4 | `docs/design/project-gateway.md:115` | The documented `mcp.call.failed` reason vocabulary reads as exhaustive but omits `not-routable`, `unknown-resource` and `tool-error`. | ACCEPTED — no behaviour is wrong, only the documented enum is short. |
| P4 | `packages/app/src/services/event-names.ts:2014` | `actor` is a displayed tooltip field on `mcp.tool.called` but retain-only on `mcp.tool.failed`, driven by the eight-field display cap. | ACCEPTED — payload and metadata keep every field; the ledger loses nothing. |

SECUA checks the reviewer performed on the diff: no argument values, bodies or query strings in any emitted payload; the actor is sanitized before storage and dropped (not escaped) when out of charset; a refusal emits exactly one `mcp.call.failed`; the Board `catalog()` read emits nothing; no new CLI flag, noun or verb; no `mcp.tool.*` field renamed.

Recorded residual risks: `via` collapses to `gateway` at the gateway hop by design; `X-Spur-Actor` is client-asserted for direct HTTP callers (accepted in the task Q&A); AC1's literal CR/LF header cannot travel through `fetch`, so the module test substitutes `bad actor!` and the transport-level variant is the P3 now fixed.

Verdict: PASS

### References

- Parent feature: [A82: Integrations Board module: MCP and A2A surfaces made visible, with protocol fixes](../features/A82_integrations-board-module-mcp-and-a2a-surfaces-made-visible-with-protocol-fixes.md) (cross-cutting with `J94: Agent-protocol observability` and `K41/K42: Gateway-root MCP & operational observability`)
- Design satellites: `docs/design/embedded-mcp-server.md`, `docs/design/event-tracking.md`, `docs/design/project-gateway.md`
- Implementation touchpoints: `packages/app/src/services/event-names.ts`, `apps/server/src/modules/mcp/index.ts`, `packages/app/src/services/project-gateway.ts`, `packages/domain/src/analytics/protocol-usage.ts`, `packages/contracts/src/integrations.ts`, `apps/web/src/modules/integrations/McpTab.tsx`

### History

- 2026-11-24T04:48:46.530Z backlog → todo (system)
- 2026-11-24T06:25:43.638Z todo → wip (system)
- 2026-11-24T06:49:10.388Z wip → testing (system)
- 2026-11-24T06:49:12.196Z testing → done (system)

