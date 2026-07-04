---
template: feature-impl
schema_version: 1
name: "Observabilities board module v1: system_events persistence, Events + Inbox tabs"
description: ""
status: wip
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P1
tags: ["approach-c", "board", "server", "web"]
dependencies: []
created_at: "2026-07-03T23:35:28.253Z"
updated_at: "2026-07-04T04:13:23.884Z"
---

## 0189. Observabilities board module v1: system_events persistence, Events + Inbox tabs

### Background

Cycle position P1 (decisions D2/D4/D5, docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). The operator's strategy is Observabilities-first: this module becomes the debugging window used while building the rest of the cycle's infrastructure (job queue, inbox IPC, team supervision).

Current state: the server already has a working SSE stream at `/api/events/planning` (`apps/server/src/modules/events/index.ts`) emitting task/feature created/updated/transitioned events from the EventBus — but events are EPHEMERAL: nothing persists them, so there is no history. The web board has a proven auto-discovery module system (`apps/web/src/modules/`, contract in `docs/help/how_to_add_a_new_ui_module.md`; `task-kanban` is the reference implementation). The `inbox_messages` table exists with `TeamService` (packages/app) over it.

v1 scope (D4): module shell + System Events tab + Inbox Messages tab ONLY. The Jobs tab ships with the job-queue task (feature A2) and the Process List tab with team supervision (feature G2) — the shell must expose a tab-extension contract so those land without touching this module's core. Event history (D5): a new capped `system_events` table written by an EventBus tap in the server; insert-time cap pruning in v1, handed off to the scheduler as its first consumer when feature A2 lands.

Dependency note: none — this task rides entirely on shipped infrastructure. The P2 job-queue task consumes this task's `system_events` pruning hand-off.

### Requirements
- [ ] R1 — New `_spur_cli_` migration adding `system_events` (id, event_name, occurred_at, actor, payload_json; indexed on occurred_at and event_name), schema owned by `packages/domain` and composed into `CLI_SCHEMA_SQL` (`packages/domain/src/migrations.ts`).
- [ ] R2 — Server EventBus tap: a subscriber registered at serve bootstrap persisting planning events (and future system events) to `system_events`; insert-time cap (constant, e.g. 10000 rows) pruning oldest-first; tap failures must never break event delivery to SSE consumers (log, don't throw).
- [ ] R3 — `GET /api/events/history` endpoint on the events server module with `name`, `since`, `limit` filters, newest first; oRPC contract in `packages/contracts` if the events surface is contract-bound, else documented Hono route consistent with the existing module style.
- [ ] R4 — Inbox read endpoint: `GET /api/messages/inbox?agent=<id>` plus an all-messages listing suitable for the tab (read-only; send/reply APIs belong to feature G1).
- [ ] R5 — Web module `observability` under `apps/web/src/modules/` exporting a `WebModule` (auto-discovered, zero manual wiring) with a tab layout; System Events tab = history from R3 + live append via the existing `/api/events/planning` EventSource; Inbox tab = message list with sender/recipient/timestamp/thread context.
- [ ] R6 — Tab extension contract: tabs declared as data (id, label, component) so A2 (Jobs) and G2 (Process List) add entries without modifying the shell component.
- [ ] R7 — Tests: DAO/tap tests against in-memory SQLite (cap enforcement, filter queries); server endpoint tests; web module discovery/registry test consistent with task-kanban's test approach.
- [ ] R8 — Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`; `spur serve` manually verified to render both tabs with live data.
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

  Scenario: Events tab renders history and live tail
    Given the board Observability module is open
    When the operator opens the System Events tab
    Then historical events render and newly fired events append without a page refresh

  Scenario: Inbox tab renders message history
    Given inbox_messages contains messages
    When the operator opens the Inbox Messages tab
    Then messages render with sender, recipient, timestamp, and reply-thread context

  Scenario: Module is auto-discovered by the board
    Given the observability module directory exports a WebModule
    When the board builds
    Then the module appears in the sidebar and routes without manual registry edits
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Three layers, built bottom-up: (1) domain — `system_events` schema + DAO in `packages/domain`; (2) server — an EventBus tap that persists events, a history endpoint, and an inbox read endpoint; (3) web — the `observability` module with a data-driven tab layout. Everything rides shipped infrastructure: the EventBus and SSE stream (`apps/server/src/modules/events/index.ts`), the module auto-discovery contract (`docs/help/how_to_add_a_new_ui_module.md`, reference impl `apps/web/src/modules/task-kanban/`), and `inbox_messages` + `TeamService`.

**Domain (R1).** New top-level migration `drizzle/000X_spur_cli_system_events.sql` (must carry the `_spur_cli_` marker or the migrator ignores it) + a `SYSTEM_EVENTS_SCHEMA_SQL` constant composed into `CLI_SCHEMA_SQL` (`packages/domain/src/migrations.ts` — follow the team-inbox precedent). Columns: `id` (pk), `event_name`, `occurred_at`, `actor` (nullable), `payload_json`; indexes on `occurred_at` and `event_name`. `SystemEventDao` (BaseDao pattern): `insert`, `prune(cap)`, `query({name?, since?, limit})` newest-first. Keep the DAO the sole SQL owner — apps/server never imports ts-db (architecture invariant).

**Server tap (R2).** Registered at serve bootstrap where `ServerContext` exists (Bun path; CF has no ctx — same gate the SSE module uses). Subscribe the SAME event-name list the SSE module subscribes — extract that list (`task.created|updated|transitioned`, `feature.created|updated|transitioned`) into a shared constant so 0190's job events and 0193's message events extend ONE list consumed by both tap and SSE. Persist inside try/catch with logger — a tap failure must never break event delivery. Cap: `SYSTEM_EVENTS_CAP` constant (10 000); insert-time prune (delete oldest beyond cap). The prune moves to a scheduled job when 0190 lands (its R4) — leave the insert-time path as backstop.

**Endpoints (R3, R4).** `GET /api/events/history?name=&since=&limit=` added to the events server module (plain Hono route, consistent with the existing SSE mount — the events surface is module-mounted, not oRPC-contract-bound; record this choice here as the answer to R3's either/or). New read-only `messages` server module: `GET /api/messages/inbox?agent=<id>` + `GET /api/messages?limit=` over `TeamService` constructed from `ctx` (write endpoints arrive with task 0193 — leave the module shaped for them).

**Web (R5, R6).** `apps/web/src/modules/observability/index.tsx` exports the `WebModule`; tabs declared as data in `tabs.ts` (`{ id, label, component }[]`) and the shell maps over the array — 0190 (Jobs) and 0195 (Process List) append entries without touching the shell component. Events tab: initial fetch from history API, then `EventSource('/api/events/planning')` appends live (reuse the kanban's SSE hook if extractable — check before writing a new one). Inbox tab: list with sender/recipient/timestamp, thread grouping by `in_reply_to`. All UI imports through `apps/web/src/ui.ts` (ADR-025; ui-import-seam rules gate).

**Testing (R7).** DAO: in-memory SQLite (`:memory:`, fresh adapter per test) — insert/query filters/cap enforcement. Tap: fake bus, assert persist + assert a throwing DAO does not break other subscribers. Endpoints: module-level tests like the existing task module's. Web: discovery/registry test consistent with task-kanban's.

**Risks / constraints.** `bun run test-cf` must stay green (tap and messages module no-op without ctx). Coverage bar: per-file ≥90% line+function. Payloads may contain long bodies — store payload_json as given but NEVER add message bodies to events you define later (0193 owns that rule).

**Decomposition guidance.** Natural two-way split if driven as subtasks: A = domain + tap + endpoints (R1–R4), B = web module (R5–R6). Create with `--parent 0189` if split.

**Dependencies.** None to start (first feature task of the cycle). Downstream consumers: 0190 (tab contract + prune hand-off + shared event-name list), 0193 (messages module + live tab), 0195 (tab contract).
### Plan
- [ ] Domain: migration SQL (`_spur_cli_` marker) + `SYSTEM_EVENTS_SCHEMA_SQL` composed into `CLI_SCHEMA_SQL` + `SystemEventDao` (insert/prune/query) + DAO tests against `:memory:` (R1).
- [ ] Extract the SSE module's event-name list into a shared constant (server-local) consumed by both the SSE mount and the new tap.
- [ ] Server tap at serve bootstrap: subscribe, persist via DAO, insert-time cap prune, try/catch + logger isolation; tests incl. failure isolation (R2).
- [ ] `GET /api/events/history` on the events module with name/since/limit, newest first; endpoint tests (R3).
- [ ] Read-only `messages` server module: inbox + list endpoints over TeamService; endpoint tests (R4).
- [ ] Web `observability` module: WebModule export + tabs-as-data shell; System Events tab (history fetch + SSE live append); Inbox tab (list + thread context); discovery test (R5, R6).
- [ ] Verify CF path: `bun run test-cf` green with tap/messages no-op (R8 partial).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R8).
- [ ] Manual: `spur serve`, open Observability, watch a `spur task update` land live in the Events tab; send a `spur message` and see it in the Inbox tab after refresh (live tail arrives with 0193).

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 0198 | system_events domain, server tap, history + inbox read APIs (0189 wave A) | todo |
| 0199 | Observability web module: shell, tabs contract, Events + Inbox tabs (0189 wave B) | todo |
<!-- END AUTO-GENERATED -->
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-04T04:13:23.884Z todo → wip (system)
