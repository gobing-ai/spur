---
template: feature-impl
schema_version: 1
name: "system_events domain, server tap, history + inbox read APIs (0189 wave A)"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: "0189"
priority: P1
tags: ["approach-c", "server", "subtask"]
dependencies: []
created_at: "2026-07-04T04:13:23.847Z"
updated_at: "2026-07-04T04:16:54.540Z"
---

## 0198. system_events domain, server tap, history + inbox read APIs (0189 wave A)

### Background

Wave A of parent 0189 (Observabilities v1) — read the parent's Background and Design first; it owns the full context and constraints. This slice delivers the data + server layers: the capped `system_events` table and DAO in `packages/domain` (new `_spur_cli_` migration), the EventBus tap registered at serve bootstrap (persisting the shared event-name list, failure-isolated), the `GET /api/events/history` endpoint on the events module, and the read-only `messages` server module (inbox + list over TeamService). Wave B (web module) consumes these APIs.

### Requirements
- [x] R1 — `system_events` migration (`_spur_cli_` marker) + `SYSTEM_EVENTS_SCHEMA_SQL` composed into `CLI_SCHEMA_SQL` + `SystemEventDao` (insert / prune(cap) / query name-since-limit newest-first) with `:memory:` tests. (Parent R1)
- [x] R2 — Shared event-name constant extracted from the SSE module; tap at serve bootstrap persists via the DAO, insert-time cap (constant 10000), try/catch + logger isolation — a tap failure never breaks other subscribers. (Parent R2)
- [x] R3 — `GET /api/events/history?name=&since=&limit=` on the events module, newest first, with endpoint tests. (Parent R3)
- [x] R4 — Read-only `messages` server module: `GET /api/messages/inbox?agent=` + `GET /api/messages?limit=` over TeamService; Bun-gated; endpoint tests. (Parent R4)
- [x] R5 — `bun run test-cf` green (tap + messages no-op without ctx); full gate green.
### Acceptance Criteria
```gherkin
Feature: Observabilities board module

  Scenario: Bus events persist to system_events
    Given spur serve is running on Bun
    When a task.updated event fires on the EventBus
    Then a system_events row is written with the event name, payload, and occurred_at timestamp

  Scenario: The event table stays within its cap
    Given system_events holds its maximum row count
    When a new event is persisted
    Then the oldest rows are pruned so the row count stays at or below the cap

  Scenario: Event history is queryable over the API
    Given persisted events exist
    When GET /api/events/history is requested with a since filter
    Then events newer than the filter return newest first
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0189's Design owns the full approach — this slice implements its **Domain**, **Server tap**, and **Endpoints** paragraphs verbatim: migration + `SYSTEM_EVENTS_SCHEMA_SQL` + `SystemEventDao` in `packages/domain` (follow the team-inbox migration precedent; `_spur_cli_` marker mandatory); shared event-name constant extracted from `apps/server/src/modules/events/index.ts`; failure-isolated tap at serve bootstrap (Bun path only); `GET /api/events/history` on the events module; read-only `messages` module over TeamService shaped for 0193's later write endpoints. Key invariants: apps/server never imports ts-db; tap errors log and never propagate; cap is a constant (10 000) with insert-time prune (0190 wave B takes over via the scheduler). Blocks: 0199 (consumes both APIs). Depends on: nothing.
### Plan
- [x] Migration SQL + schema constant + `SystemEventDao` (insert/prune/query) + `:memory:` tests (R1).
- [x] Shared event-name constant; tap at bootstrap with try/catch + logger isolation; failure-isolation test (R2).
- [x] `GET /api/events/history` with name/since/limit newest-first + endpoint tests (R3).
- [x] Read-only `messages` module (inbox + list) + endpoint tests (R4).
- [x] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R5).
### Solution

**R1 — Domain layer** (`packages/domain`)
- `drizzle/0006_spur_cli_system_events.sql` — new `_spur_cli_` migration; columns: `id INTEGER PK`, `event_name TEXT NOT NULL`, `occurred_at TEXT NOT NULL`, `actor TEXT`, `payload_json TEXT`; indexes on `(occurred_at DESC)`, `(event_name, occurred_at DESC)`.
- `packages/domain/src/migrations.ts` — `SYSTEM_EVENTS_SCHEMA_SQL` composed into `CLI_SCHEMA_SQL`; migration file registered in `CLI_MIGRATIONS` (length 6 → 7).
- `packages/domain/src/dao/system-event-dao.ts` (new) — `SystemEventDao` over `DbAdapter` raw SQL (follows `PlanningEventDao` pattern). Methods: `insert({eventName, occurredAt, actor?, payload?})`, `prune(cap)` deletes oldest-over-cap rows, `query({name?, since?, limit})` returns rows newest-first, `deleteAll()`. Returns `[]` on "no such table".
- Exported from `packages/domain/src/dao/index.ts` + `packages/domain/src/index.ts`.
- Tests: `packages/domain/tests/dao/system-event-dao.test.ts` (9 tests, `:memory:`) — insert/query ordering, name/since/limit filters, prune cap enforcement, missing-table safety, deleteAll.

**R2 — EventBus tap at serve bootstrap** (`apps/server`)
- `apps/server/src/modules/events/event-names.ts` (new) — extracts `PLANNING_EVENT_NAMES` (shared constant) previously inline in the SSE module.
- `apps/server/src/modules/events/system-event-tap.ts` (new) — `registerSystemEventTap(bus, dao, logger)` returns `{ unsubscribe, flush }` (`SystemEventTap`). Subscribes to every name in `PLANNING_EVENT_NAMES`; each handler wraps DAO insert in try/catch + logger — a single handler's failure never propagates to other EventBus subscribers. `SYSTEM_EVENTS_CAP = 10_000` constant; `dao.prune(CAP)` runs after each insert.
- `apps/server/src/serve.ts` — tap wired at Bun bootstrap, gated on `bootConfig.events.enabled`.
- Tests: `apps/server/tests/modules/events/system-event-tap.test.ts` (6 tests) — happy-path persist, cap enforcement, handler failure isolation (other subscribers still fire), unsubscribe, flush.

**R3 — Events history endpoint** (`apps/server`)
- `apps/server/src/context.ts` — added `systemEventDao(): Promise<SystemEventDao>` accessor (lazy cached promise) on `ServerContext`.
- `apps/server/src/modules/events/index.ts` — added `GET /api/events/history` (lines 123-150). Query params: `name` (optional filter), `since` (ISO filter on `occurred_at`), `limit` (default 100, clamped to [1, 500], non-numeric falls back to default). Returns `{ events, count }`; each event is `{ id, eventName, occurredAt, actor, payload }` (camelCase; `payload` parsed from JSON).
- Tests: `apps/server/tests/modules/events/history.test.ts` (5 tests) — empty, name filter, since filter, limit clamp, malformed limit falls back.

**R4 — Read-only messages module** (`apps/server`)
- `packages/app/src/services/team-service.ts` — added `listRecent(limit): Promise<RecentMessagesResult>` (newest-first) + exported `RecentMessagesResult` named type. `TeamServiceContext.output` made optional — `TeamService` never reads `ctx.output` (grep-confirmed); eliminates a fabricated noop sink on the server path. Existing callers (CLI, tests) still pass `output` unchanged.
- `packages/app/src/index.ts` — re-exports `RecentMessagesResult` type.
- `apps/server/src/context.ts` — added `teamService(): TeamService` accessor (lazy cached) and optional `env?: Record<string, string | undefined>` on `CreateServerContextOptions` for subprocess-aware services.
- `apps/server/src/modules/messages/index.ts` (new) — two endpoints, Bun-gated via `if (!ctx) return`:
  - `GET /api/messages/inbox?agent=<id>&limit=&offset=` — inbox for an agent.
  - `GET /api/messages?limit=` — recent messages across the team.
  - `parseLimit` helper: returns `fallback` for missing/non-numeric; clamps to `[0, 500]`. Default limit 50.
- `apps/server/src/modules/registry.ts` — registered `messagesModule` in builtins array.
- Tests: `apps/server/tests/modules/messages/index.test.ts` (6 tests, stub `ctx` via `as unknown as ServerContext` — no `any`), `packages/app/tests/services/team-service.test.ts` (+2 tests for newest-first ordering + limit clamping, 22 total pass).
- Test fixture updates: `apps/server/tests/modules/registry.test.ts` (expected list now includes `'messages'`), `packages/domain/tests/dao/migrations.test.ts` (CLI_MIGRATIONS length 6→7; upgrade-from-0000/0001 applied counts 4→5 / 5→6), `apps/server/tests/context.test.ts` (+`teamService()`, `systemEventDao()`, `planningFolders()` accessor tests).

**Invariants honored**
- apps/server never imports ts-db — all DB access through `packages/domain` DAOs.
- Migration filename carries `_spur_cli_` marker.
- All DAO DDL is idempotent (`CREATE TABLE IF NOT EXISTS`) and queries return `[]` on missing table.
- Tap failure isolation: per-handler try/catch + logger; a tap failure cannot break other EventBus subscribers.

### Testing

| Gate | Command | Result |
|---|---|---|
| Lint + typecheck | `bun run lint` | ✅ clean — biome + `tsc --noEmit` across all 7 workspaces |
| Full suite | `bun run test` | ✅ 2133 pass / 0 fail / exit 0 (155 files) |
| Cloudflare | `bun run test-cf` | ✅ 1 pass / 0 fail / exit 0 (workers runtime) |
| Build | `bun run build` | ✅ cli + server + web all built / exit 0 |

**Coverage gate** (`bunfig.toml`: lines ≥ 90%, functions ≥ 90% per file): all files clear. Notable new/changed files:
- `packages/domain/src/dao/system-event-dao.ts` — 100% / 100%
- `apps/server/src/modules/events/system-event-tap.ts` — 100% functions / 95.38% lines (uncovered: defensive error-path branches in flush)
- `apps/server/src/modules/events/index.ts` — 92.31% functions / 97.98% lines
- `apps/server/src/modules/messages/index.ts` — 100% / 100%
- `apps/server/src/context.ts` — 94.12% functions / 100% lines
- `packages/app/src/services/team-service.ts` — 100% / 100%

**New test files**: `system-event-dao.test.ts` (9), `system-event-tap.test.ts` (6), `history.test.ts` (5), `messages/index.test.ts` (6), +2 in `team-service.test.ts`. No test skipped, `.skip`'d, or commented out.
**Acceptance criteria (gherkin)**: all three scenarios exercised — bus-event persist (tap test), cap enforcement (dao prune test + tap test), since-filter newest-first (history endpoint test).

### Review

**P1 — Blockers**: none.
**P2 — High**: none.
**P3 — Medium**:
- `TeamServiceContext.output` was made optional — minor public API surface change in `packages/app`. Verified non-breaking: CLI's `CliContext` passes `output` (wider type satisfies optional), and tests pass `output: nullOutput()` (still valid). No other consumer relies on `output` being required.
**P4 — Low / residual risk**:
- `context.ts` has one uncovered function (94.12%) — the arrow `(db) => new SystemEventDao(db)` at the systemEventDao accessor, only reached when `systemEventDao()` is called AND `getDb()` resolves; caching tests short-circuit before resolution. Above the 90% threshold.
- Insert-time prune is O(n) on each insert (constant cap 10 000). Acceptable for Wave A volume; 0190 Wave B moves pruning to the scheduler per the parent design.
- `messages` module is Bun-only (`if (!ctx) return` on Workers). Per parent design — the inbox table isn't available in the Workers runtime.

**Final disposition**: ready for review. All five requirements (R1–R5) implemented and verified; full gate green.

### References

J

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
