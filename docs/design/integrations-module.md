---
kind: design
title: "Integrations Board Module and MCP/A2A Protocol Fixes (A82)"
created_at: 2026-11-21
updated_at: 2026-11-22
related: [A82, A8, B9, G9, G91, I61, J94, K42, A81]
tags: [system, A82, web, mcp, a2a]
doc: design/integrations-module
owns: SURFACE + mechanism for the Integrations Board module, its status contract, and the A82 protocol fixes
authority: derived (ADR-148, ADR-151, ADR-152, ADR-133 win on conflict)
---

# Integrations Board Module and MCP/A2A Protocol Fixes (A82)

The Board gets one module, **Integrations**, that shows the agent-protocol surfaces a served
project exposes: project MCP, gateway-root MCP, A2A inbound and A2A outbound/cross-project. Before
the Board shows numbers, the protocol fixes below make those surfaces report the truth. Decision
records: ADR-148 (A2A, amended 2026-11-21), ADR-152 (MCP), ADR-151 (gateway), ADR-133 (icons).

## 1. Protocol fixes

| # | Surface | Today | Fix | Where |
| --- | --- | --- | --- | --- |
| F1 | MCP | `toolErrorCode` matches only `/ is required$\| must be a map of strings$/`, so "unknown argument", "must be one of", "must be a string/boolean/array" and `invalid_arguments: …` become `tool_error` | The validator throws a typed `InvalidArgumentsError`; `toolErrorCode` checks the type, not message text. `callWorkflowTool` throws the same type | `apps/server/src/modules/mcp/index.ts` |
| F2 | MCP | Tool descriptors carry no annotations | Each `TOOL_DESCRIPTORS` entry declares `annotations: { readOnlyHint, destructiveHint, idempotentHint }`. Read tools: show, list, feature_check, workflow_status. Write tools: create, update, transition, workflow_run, workflow_continue (`destructiveHint: false`; none deletes). `sp_rule_run` is read-only | same |
| F3 | A2A | The card route calls `authorize(c)`, which contradicts the route comment | The card route skips `authorize`. Every other route keeps it. The comment says that only the card is public | `apps/server/src/modules/a2a/index.ts` |
| F4 | A2A | `agentCard()` returns `skills: []` | Derive one skill per member from the declaration (`role` → id/name, `description`); a member with no role yields one default `general` skill | `apps/server/src/modules/a2a/projection.ts` |
| F5 | A2A | `remoteBranch(ctx)` runs git in `ctx.cwd` with its own rule. Today that is correct: A2A keys (`a2a:<instance>:<messageId>`) never match the lane key pattern, so drains run in the project tree | `remoteBranch(ctx, requestKey)` resolves the drain tree with the agent loop's own rule, `laneForRequestKey(ctx.cwd, declaration, requestKey) ?? ctx.cwd`, so the two cannot diverge. A regression lock, not a behavior change; A2A lane routing is out of scope | `apps/server/src/modules/a2a/index.ts` |
| F6 | A2A | Cancel calls `supervisor().stop(member.instanceId)`, which kills the whole member loop | Per-run cancel, §1.1 | a2a module + `packages/app` agent loop |

### 1.1 Per-run cancel (F6)

A member loop drains **one keyed request at a time**. Each keyed run owns a `runId`
(`agent-loop-service.ts`, 1076 R2) and announces it to the supervisor with the `[spur:run]` stdout
marker, so `SupervisorService.currentRunIds` knows which run is live. So "stop one run" means
interrupting the current drain while leaving the loop and the queue alone:

1. The server resolves the task's run as the newest coordination row for the message. If that row
   is not `running`, it answers `FAILED_PRECONDITION / TASK_NOT_CANCELABLE`, as it does today
   for queued tasks.
2. The server writes the cancel intent it already writes (`a2a-canceled-<messageId>`), then writes a
   **run-scoped cancel request**: a durable file `.spur/run/<runId>/cancel-requested`. This is a
   durable artifact, not stdin keystrokes, so it follows the coordination rule.
3. Each keyed drain in the agent loop owns an `AbortController` and a 1s poll for the file (the
   10s write-slot heartbeat is too slow for the bound). The signal reaches ts-runtime's process-group kill
   through `AgentService`. A warm turn spawns nothing, so it cannot be aborted: cancel reports
   `runStopped: false`. The
   drain settles as `canceled`, the loop clears its current run and claims the next request.
4. The server waits for the coordination row to leave `running`, up to a bound (default 10s). On timeout it
   answers 202 with `runStopped: false`. It never escalates to `supervisor().stop`.

`a2a.task.cancelled` keeps its payload and adds `runId`.

## 2. Status contract (always mounted, read-only)

`integrations.status` is an oRPC procedure: the contract lives in `packages/contracts`, the logic in
`packages/app` `IntegrationsService`, and the handler in `apps/server/src/modules/integrations/`. It
is mounted whether or not MCP or A2A is enabled, because "off" is an answer the Board must show.
It returns names and booleans and **never a token value**.

```ts
interface IntegrationsStatus {
    generatedAt: string;
    mcp: {
        enabled: boolean; path: '/mcp'; url: string | null;
        auth: { envName: string; tokenPresent: boolean };
        protocolVersion: string;
        tools: Array<{ name: string; origin: 'built-in' | 'workflow'; description: string;
            annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
            inputSchema: unknown }>;
        resources: Array<{ uriTemplate: string; description: string }>;
    };
    a2a: {
        enabled: boolean; basePath: '/a2a'; auth: { envName: string; tokenPresent: boolean };
        inbound: Array<{ member: string; role: string | null; cardUrl: string; writeFenced: boolean }>;
        outbound: Array<{ member: string; kind: 'a2a' | 'project'; target: string }>;
    };
    gateway: { served: false } | {
        served: true; namespace: string; rootMcpUrl: string;
        counters: { since: string; requests: number; status4xx: number; status5xx: number;
            upstreamRestarts: Record<string, number> } | null;   // gateway /api/health (1385)
        diagnostic?: string;
    };
}
```

- The catalog comes from the same `listTools()` and `RESOURCE_DESCRIPTORS` that `tools/list` and
  `resources/list` use, so the two cannot drift. `packages/app` cannot import the server module, so the
  handler passes the catalog to `IntegrationsService` through a port.
- `tokenPresent` comes from the server's existing `bearerEnv` + `requiredToken` pair (ADR-120 gateway
  underneath). The service receives only the boolean.
- Every caller-visible URL the status builds (`mcp.url`, `a2a.url`, `cardUrl`, `gateway.rootMcpUrl`)
  comes from the caller's own base, not the loopback address the gateway forwards to:
  `x-forwarded-host` + `x-forwarded-prefix` when both are present — the scheme comes from
  `x-forwarded-proto`'s first value, `https` only when it reads `https` (absent ⇒ `http`) —
  otherwise the request's own origin. It is the rule `cardOrigin()` already applies to the A2A card.
- `a2a.inbound` lists only receive-capable, enabled members: a member declared by `a2a`/`project`
  is an outbound peer, and `enabled: false` is omitted because the listener already answers it
  `404`. The A2A tab renders `cardUrl` as a link only while `a2a.enabled`.
- Gateway detection uses the forwarded prefix headers that `cardOrigin()` already reads. The
  counters come from the gateway's `/api/health` over loopback on `SPUR_GATEWAY_PORT` (default
  `3000`). If that read fails, the response carries `counters: null` plus a `diagnostic` string;
  the procedure itself still succeeds.

### 2.1 Activity

There is no new table and no new endpoint for aggregates. The Summary numbers (24h calls, error
rate, auth denials, per-member A2A counts) come from I61 `protocolUsageSummary(db, {since})`
(`packages/domain/src/analytics/protocol-usage.ts`), exposed as the `integrations.usage { since }`
procedure. Recent rows come from the existing `/api/events/history` with `prefix=mcp`, `a2a`
and `auth` (no trailing dot; `SYSTEM_EVENT_PREFIXES` in `packages/app/src/services/event-names.ts`).

## 3. Board module

`apps/web/src/modules/integrations/` follows DESIGN.md "Product UI — Module Shell" and the A81
module-kit (`components/module-kit/`): `ModuleShell` > `ModuleHeader` (ModuleIcon `plug`, title,
status chip, `TimeRangePresets` for the usage window) > `ModuleTabs` from an append-only `tabs.ts`.
It uses semantic tokens only. The `WebModule` `icon` field follows the current convention; the
emoji-vs-ADR-133 cleanup belongs to the Board maturity sweep (A83).

Beside the status chip the header names the served build — `server v<version> · up <uptime>`, or
`server identity unreadable` — from `GET /api/health` (`formatUptime` truncates to the two largest
units). That read is tolerant and runs on its own effect pass: a stale server behind a rebuilt
`dist/web` is exactly the case that must still name itself instead of failing the module, so a
failed identity read leaves the rest of the status visible (1437 R6).

| Tab | Content | Data |
| --- | --- | --- |
| Summary | One row per surface: state chip (`off` / `on` / `on · token unset` as error), endpoint URL, auth env name and whether it is set, 24h calls, error rate, last call, auth denials. Plus a gateway counters strip when served | status + usage |
| MCP | Tool table (origin badge, read/write badge, opens a schema drawer), `spur://` resource list, recent calls (tool, duration, outcome, errorCode), copyable client config snippet (URL + `${ENV}` placeholder) | status + events |
| A2A | Inbound member cards (card URL, write-fenced badge); A2A tasks (sender `a2a`) with run state → Projects › Inbox, read through `inbox.requests({ limit: 100, scope: 'all' })` so non-orchestrator tasks and outbound receipts are not dropped by the default orchestrator feed; outbound/cross-project receipts (G91); event rows → Observability › System Events (`ObservabilityNavIntent {tab:'system-events', eventName, runId}`; the seed applies `eventName` even when the intent carries no `runId`) | status + inbox + events |

States: a loading skeleton; an `EmptyState` when every surface is off, with the config keys that
enable each one; a `Diagnostic` with retry when `integrations.status` fails.

## 4. Verification

Two legs. The protocol leg is `scripts/commands/integrations-e2e.ts`, alongside the existing
`a2a-*-e2e.ts` scripts. It boots `spur self serve` with MCP and A2A enabled and one cold member whose
agent is a sleeping stub binary. It checks a bad-argument tools/call (F1), annotations (F2), an
unauthenticated card GET and message:send (F3, F4), send then cancel with `runStopped: true` (F6) and
no token in `integrations.status`. It writes `docs/reports/integrations-e2e-receipt.json` (stable name,
overwritten each run, as `a2a-serve-e2e` does). The Board leg is the heavy test
`apps/web/tests/modules/integrations-browser.heavy.test.ts`, which renders `/board/integrations` and
writes `docs/reports/integrations-e2e-summary-{light,dark}.png`.

## 5. Out of scope

Per-client identity, a new activity table, live SSE counters and gateway persistence (ADR-151).
Edge ACL for public cards (Cloudflare Zero Trust). Moving the other module shells to the kit
(Board maturity sweep, A83).
