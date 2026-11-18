---
schema_version: 1
name: Emit MCP tool, resource and auth.denied events
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:15.946Z
updated_at: "2026-11-18T05:36:40.336Z"
feature_id: J94
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 4

dependencies: ["1375"]
---

## 1376. Emit MCP tool, resource and auth.denied events

### Background

The embedded MCP endpoint (B9, ADR-152) emits no system event. A tool call, a resource read and a refused request are visible only as HTTP responses, and the single `logger.warn` (`apps/server/src/modules/mcp/index.ts:270`) covers only the unset-token mount case. The event catalog (`packages/app/src/services/event-names.ts`) has no `mcp.*` or `auth.*` entry. A cataloged name gets a presenter, a payload policy and a persisted row through the tap (`registerSystemEventTap`, `apps/server/src/serve.ts:1056`).

**Refine corrections (2026-11-17)**
- "error code" in R2 → `McpDispatcher` throws plain `Error`s (`mcp/index.ts:137,144,154,161`) with no code → the event records `errorCode: 'tool_error'` | `'unknown_tool'` | `'invalid_arguments'`, derived at the emit site, plus the redacted message.
- "Board presenter" → the presenter record `SYSTEM_EVENT_PRESENTERS` is typed `Record<SystemEventName, …>` (`event-names.ts:439`), so a presenter is mandatory per catalog name and is authored here, not in 1378.
- `auth.denied` covers both surfaces, so this task wires `onDenied` on A2A too, not only MCP.

### Requirements

- [ ] R1. Catalog `mcp.tool.called`, `mcp.tool.failed`, `mcp.resource.read` (source `mcp`) and `auth.denied` (source `api`) in `event-names.ts`, each with an event-specific presenter in `SYSTEM_EVENT_PRESENTERS`.
- [ ] R2. Around `McpDispatcher.callTool` (`mcp/index.ts:116`), emit `mcp.tool.called` on success or `mcp.tool.failed` on throw. Payload: `tool`, `argKeys` (sorted key names), `durationMs`, `outcome` (`ok` | `error`), `errorCode` and `error` on failure, and `runId` / `wbs` when the arguments or result carry them.
- [ ] R3. Around `McpDispatcher.readResource` (`mcp/index.ts:151`), emit `mcp.resource.read` with `uri`, `durationMs`, `outcome` and `errorCode` on failure.
- [ ] R4. Wire `bearerGuard`'s `onDenied` (from 1375) on both the MCP and A2A mounts to emit `auth.denied` with `surface` (`mcp` | `a2a`), `reason` (`missing` | `mismatch` | `unset`) and `path`.
- [ ] R5. No payload carries an argument value, header or token. `mcp.tool.failed.error` passes through the `redacted` payload policy.

Out of scope: A2A message/cancel events (1377), Board browser proof (1378), per-request access logs.

### Acceptance Criteria

- [ ] AC1 — Every MCP tool call and resource read emits a 5W1H event (req: R1, R2, R3, R5)
- [ ] AC2 — Refused authentication is observable without leaking the token (req: R4, R5)

Test layer: real `createServerContext` app, tap and `SystemEventDao` (no mock of `mcpModule` or the bus), in `apps/server/tests/mcp-e2e.test.ts` and `apps/server/tests/modules/a2a/routes.test.ts`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:36:40.336Z

- **Source for `auth.denied`?** Closed: `api`, since it is a transport refusal shared by both surfaces.
- **Error codes?** Closed: three codes derived at the emit site. No error-class refactor unless matching proves fragile.

### Design

**WHAT.** Add `'mcp'` to `SystemEventSource` and four entries to the base catalog:

| name | source | payloadPolicy |
| --- | --- | --- |
| `mcp.tool.called` | `mcp` | `metadata-only` |
| `mcp.tool.failed` | `mcp` | `redacted` |
| `mcp.resource.read` | `mcp` | `metadata-only` |
| `auth.denied` | `api` | `metadata-only` |

Use `baseEvent(name, source, renderer)` with renderer = source. The presenters follow the `api.request.error` presenter (`event-names.ts:1715`): `fields` plus a `summary` such as `[mcp] sp_task_show ok 12ms`. Emit with `this.ctx.eventBus().emit(name, payload)` inside `McpDispatcher`. Time each call with `performance.now()` around the existing switch, and rethrow after emitting so the protocol error path (`protocol.ts`) is unchanged.

`errorCode` mapping at the emit site:
- the switch `default` (unknown name) → `unknown_tool`;
- a `requiredString`/`stringMap` throw → `invalid_arguments`;
- anything else → `tool_error`.

Give the argument-validation throws a tagged error class only if a message-prefix test proves fragile. Otherwise match on the existing message prefixes.

**WHY.** Emitting in the dispatcher keeps `protocol.ts` transport-only (ADR-152). Key names show *what kind* of call it was without the secret risk of values. `auth.denied` reuses the `api` source because it is a transport-level refusal, not an MCP semantic.

**Anti-patterns.** Don't emit from `protocol.ts`. Don't record `args` values, the `Authorization` header or the token. Don't add a second bus or table.

**Handoff.** 1377 adds `'a2a'` to `SystemEventSource` and its own entries in the same file. Sequence after this task to avoid a merge conflict. 1378 proves the Board rendering. 1398 (I61) aggregates these names.

### Plan

- [ ] Step 1 (test first, R2–R5): in `apps/server/tests/mcp-e2e.test.ts`, attach the tap to the real context the way `apps/server/tests/upstream-system-events-wiring.test.ts:61-63` does. Assert one row per case via `SystemEventDao.query({ name })`: a successful tool call, a failing call, an unknown tool, a resource read, and a 401. Assert that no argument value or token appears in `payload_json`.
- [ ] Step 2 (R1): add the catalog entries and presenters. `packages/app/tests/services/event-names.test.ts` must stay green, and its exhaustiveness checks cover the presenters.
- [ ] Step 3 (R2/R3): wrap `callTool` and `readResource`.
- [ ] Step 4 (R4): pass `onDenied` emitters on both mounts. Add an A2A 401 row assertion in `apps/server/tests/modules/a2a/routes.test.ts`.
- [ ] Step 5: run the focused server and app tests, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
