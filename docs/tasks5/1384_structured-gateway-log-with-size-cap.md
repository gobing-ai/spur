---
schema_version: 1
name: Structured gateway log with size cap
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:27.369Z
updated_at: "2026-11-18T05:48:10.253Z"
feature_id: K42
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 3.5

---

## 1384. Structured gateway log with size cap

### Background

The gateway (`createGatewayHandler`, `packages/app/src/services/project-gateway.ts:335`) is stateless by ADR-151. Today a 502, a prefix collision or a guard refusal is visible only in the HTTP response. The only durable trace is launchd's raw stdout/stderr (`gatewayLogPaths`, `packages/app/src/services/gateway-daemon.ts:64`, darwin only) and each project's `.spur/run/serve-spawn.log`.

**Refine corrections (2026-11-17)**
- "under the gateway log directory" → only the darwin launchd daemon has one (`~/Library/Logs/spur`); a foreground `spur serve --gateway` on any OS has none → the path is composed in the CLI: `~/Library/Logs/spur/gateway.events.jsonl` on darwin, `~/.config/spur/logs/gateway.events.jsonl` elsewhere.
- "logger in project-gateway" → `packages/app` writes through injected seams, not direct IO → add `GatewayDeps.onEvent?(event)`; the JSONL sink is a small app service composed in `apps/cli/src/commands/serve.ts`.
- "upstream start/adopt/restart" → `deps.ensureUpstream` returns only a port (`project-gateway.ts:347-363`), so the gateway cannot tell start from adopt → events are `upstream.ensure` (ok/failed, with duration) and `upstream.restart` (the retry path at `:465-480`). The adopt distinction is dropped.
- "gateway MCP call" → the root `/mcp` does not exist yet (K41 1382/1383), and this task has no dependency on it → dropped here; proposed for 1383 to emit `mcp.call` through the same `onEvent`.

### Requirements

- [ ] R1. Emit one event per occurrence through `GatewayDeps.onEvent`: `upstream.ensure` (`outcome`, `ms`), `upstream.restart`, `proxy.unreachable` (dialed addresses, as listed in the 502 body), `route.collision` (prefix and identities), `guard.host` and `guard.csrf` (refusal status). Each event carries `ts`, `kind`, project `name`/`prefix` when known, and `reason`.
- [ ] R2. `createJsonlEventSink({ path, maxBytes = 5 MiB, fs })` appends one JSON line per event. When the next line would exceed `maxBytes`, it rotates to `<path>.1`, overwriting any earlier `.1`. A sink write failure never fails the request (report once on stderr, then drop).
- [ ] R3. Events never contain request headers, query strings or bodies; only the URL pathname is recorded.

Out of scope: multi-file retention, log shipping, the `mcp.call` event (1383) and the adopt/start distinction.

### Acceptance Criteria

- [ ] AC1 — Gateway failures and routing decisions are logged as structured lines (req: R1, R2, R3)

Test layer: the real gateway handler with a fixture registry and a real temp-dir sink (no handler mocks).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:48:08.411Z

- **Where is the log?** Closed: `~/Library/Logs/spur/gateway.events.jsonl` on darwin (next to the launchd logs) and `~/.config/spur/logs/gateway.events.jsonl` elsewhere.
- **Start vs adopt?** Dropped: `ensureUpstream` doesn't expose it. Revisit if a diagnosis needs it.
- **MCP calls?** Deferred to 1383, emitted through the same `onEvent`.

### Design

**WHAT.**

```ts
// packages/app/src/services/project-gateway.ts
export type GatewayEvent = { ts: string; kind: GatewayEventKind; name?: string; prefix?: string; path?: string; reason?: string; [k: string]: unknown };
export interface GatewayDeps { …; onEvent?: (e: GatewayEvent) => void }
// packages/app/src/services/gateway-event-log.ts
export function createJsonlEventSink(opts: { path: string; maxBytes?: number; fs: FileSystem }): (e: GatewayEvent) => void;
```

The emit points are the existing return sites: `gatewayGuard` (421 host, 403 CSRF), the collision 409, the `ensureUpstream` wrapper, `unreachable`, and the restart branch. The sink stats the file before each write and rotates when the line would cross the cap (`// ponytail: single rotation file; add retention if one file is too short`). `serve.ts --gateway` composes it next to `gatewayLogPaths` on darwin and under `~/.config/spur/logs` elsewhere.

**WHY.** Injection keeps the app layer IO-free and testable with a capturing array. JSONL plus a single rotation is greppable and bounded without adding a store, which keeps ADR-151 statelessness.

**WHERE.** `packages/app/src/services/project-gateway.ts`, the new `packages/app/src/services/gateway-event-log.ts`, `apps/cli/src/commands/serve.ts` and `docs/design/project-gateway.md` (log path, kinds, cap).

**Anti-patterns.** Don't log headers or query strings. Don't let sink IO block or fail the response path. Don't add a DB table.

**Handoff.** 1385's counters hook the same emit points; 1383 adds `mcp.call`.

### Plan

- [ ] Step 1 (test first, R1/R3): a gateway test with a capturing `onEvent` drives a host-guard refusal, a CSRF refusal, a collision, a failing `ensureUpstream` and an unreachable upstream. Assert one event of each kind, and no header, query or token in any of them.
- [ ] Step 2 (test first, R2): sink test on a temp dir with a small `maxBytes`. Lines stay valid JSON, rotation produces `.1`, the active file never exceeds the cap, and a failing fs never throws.
- [ ] Step 3: implement the events and the sink, then compose the sink in `serve.ts`.
- [ ] Step 4: update `docs/design/project-gateway.md`, run `(cd packages/app && bun test tests/services/project-gateway*.test.ts)`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
