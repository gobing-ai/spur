---
schema_version: 1
name: Aggregate tools and route calls across projects
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:25.889Z
updated_at: "2026-11-18T05:45:53.249Z"
feature_id: K41
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 6

dependencies: ["1382", "1381"]
---

## 1383. Aggregate tools and route calls across projects

### Background

Fronting each project with its own MCP endpoint means one agent configuration per project. With 1382's root `/mcp`, the gateway can list every local project's tools and route each call to the owning `spur serve` at `/<prefix>/mcp`. The handler already has what this needs: `localEntries()` filters out remote entries (`packages/app/src/services/project-gateway.ts:365-371`), `ensureUpstream` starts or adopts a project with in-flight de-duplication (`:347-363`), and `dial` tries both loopback families (`:426-445`, `LOOPBACK_FAMILIES` at `:167`).

**Refine corrections (2026-11-17)**
- "tools/list fans out to local entries" (through each upstream) → that would start every registered project (13 local entries in the current registry) on every `tools/list` → the listing is computed from each local project's files instead: `resolveMcpNamespace` (1380) plus `resolveExposedWorkflowTools` (1381). Only `tools/call` starts a project.
- "upstream calls reuse the gateway proxy dial path" → `dial` and `ensureUpstream` are closures inside `createGatewayHandler` → the gateway registry is built inside that closure (exposed through an injected adapter callback) so it shares the de-duplicated start path. `dial` itself is not duplicated.
- "forwards with that project token" → there is no per-project token store. Gateway-spawned serves inherit the gateway env, so the project token is the value of the variable named by the gateway env's `SPUR_MCP_AUTH_ENV`. A hand-started serve with a different token answers 401, which is surfaced as a tool error naming the remedy.
- R4 "exclude remote entries with diagnostics" → exclusion is already inherent in `localEntries()`, and 1382 R3 owns the diagnostics → dropped here along with its AC line (still covered by 1382 AC2).
- `project` argument identity was unspecified → names are not unique (the registry holds `knowledge-kit` twice: one remote, one local) → `project` takes a local entry's prefix segment or a name that matches exactly one local entry.

### Requirements

- [ ] R1. Gateway `tools/list` returns the five `sp_*` built-ins once, each input schema extended with a required `project` string, plus every local project's exposed workflow tools under that project's manifest namespace. No project is started for a list.
- [ ] R2. A namespace resolved for two or more local projects is reported in discover `diagnostics` (`namespace-collision`, naming the projects). Its workflow tools are left out of the list, and a call to one is refused, naming the projects.
- [ ] R3. `tools/call` resolves the target (a `sp_*` tool through its `project` argument, a workflow tool through its namespace), starts the project through the shared `ensureUpstream` and POSTs the JSON-RPC call to `/<prefix>/mcp` via `dial`, with `Authorization: Bearer <project token>`. The upstream result body is returned unchanged. `project` is stripped before forwarding.
- [ ] R5. An unknown or ambiguous `project`, a missing project token, or an upstream 401/5xx each produce a tool error naming the cause and the remedy. Token values never appear.

Out of scope: resources at the gateway root (`resources/list` returns `[]`), remote forwarding, and caching.

### Acceptance Criteria

- [ ] AC1 — tools/list aggregates local projects by namespace (req: R1, R2)
- [ ] AC2 — tools/call routes to the owning project and starts it on demand (req: R3, R5)

Test layer: a real gateway listener with real fixture serves started on demand (no handler mocks).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:45:53.249Z

- **Fan out to upstreams for listing, or read files?** Closed: read files, so listing never starts a project.
- **Per-project tokens?** Closed: use the gateway-env project token for now. A per-project token map is deferred until a project needs a distinct token.
- **Resources at the gateway root?** Deferred: an empty list until an agent needs cross-project resources.

### Design

**WHAT.** Inside `createGatewayHandler`, build `gatewayRegistry: McpGatewayRegistry`, a structural copy of `McpHandlerRegistry` declared in `packages/app`, and hand it to `deps.mcp` (1382), whose signature changes to `(req, registry) => Promise<Response>`. Each call recomputes from `localEntries()`:

```ts
interface RouteEntry { entry: ProjectEntry; prefix: string; namespace: string | null; tools: ExposedWorkflowTool[] }
```

`callTool` maps to the upstream JSON-RPC as `{ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments } }` and uses the same MCP protocol-version header the server adapter requires (`MIN_MCP_PROTOCOL_VERSION`; pass it in from `apps/server`). The project token is read from `deps.projectMcpToken()`, a new dep that `apps/server` composes from the env.

**WHY.** File-based listing keeps `tools/list` cheap and side-effect free, which matters because agents call it on connect. Building the registry inside the closure is the only way to reuse `ensureUpstream`'s de-duplication without exporting mutable state.

**WHERE.** `packages/app/src/services/project-gateway.ts` (registry and routing) and `apps/server/src/gateway.ts` (adapter callback, token dep, protocol version).

**Anti-patterns.** Don't start projects in `tools/list`. Don't keep a gateway-side cache or state. Don't rewrite upstream results. Don't log the token.

**Dependencies.** 1382 (root mount, registry seam, discover), 1381 (`resolveExposedWorkflowTools`), 1380 (`resolveMcpNamespace`) and 1379 (`sp_*` names).

### Plan

- [ ] Step 1 (test first, R1–R3): build an e2e with two fixture projects with distinct manifest namespaces, each exposing one workflow, behind a real gateway. Assert the merged `tools/list` (built-ins once, with a required `project`), a `sp_task_show` call routed by `project`, and a workflow-tool call that starts the stopped project, with the result returned unchanged.
- [ ] Step 2 (R2/R5): add a third fixture that shares a namespace (collision diagnostics and refusal), plus unknown-`project`, missing-token and upstream-401 cases.
- [ ] Step 3: implement the registry inside the handler closure and the adapter/token deps in `startGateway`.
- [ ] Step 4: run the gateway and mcp e2e tests (`(cd apps/server && bun test tests/mcp-e2e.test.ts)` plus the new gateway e2e), then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
