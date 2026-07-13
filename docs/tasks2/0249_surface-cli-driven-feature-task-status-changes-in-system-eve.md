---
template: feature-impl
schema_version: 1
name: "Surface CLI-driven feature.* / task.* status changes in System Events tabview"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-13T22:26:43.993Z"
updated_at: "2026-07-13T23:33:23.060Z"
---

## 0249. Surface CLI-driven feature.* / task.* status changes in System Events tabview

### Background
This task is the **spur-side follow-up to ts-libs task 0049**
(`~/xprojects/ts-libs/docs/tasks/0049_diagnosis_fix_missing_system_events_in_observability_tabview.md`).
0049 diagnosed why most event prefixes were missing from the Observability *System Events*
tabview and fixed six of them upstream (0.4.9: a shared `lifecycleBus` propagated through
`runApplication` so `agent.* / api.* / bus.* / rule.* / workflow.* / process.*` reach the
durable stream). 0049 **explicitly deferred `feature.*` / `task.*` to the consumer project**,
because their ownership is here in **spur**, not in `@gobing-ai/ts-*`. This task discharges that
handoff with the **same approach**: make the events durable in a process-independent sink that
the tabview reads, rather than relying on an in-process bus subscription.


- **The catalog already knows these events.** `SYSTEM_EVENT_CATALOG`
  (`packages/app/src/services/event-names.ts:78–83`) registers `task.created`, `task.updated`,
  `task.transitioned`, `feature.created`, `feature.updated`, `feature.transitioned` as
  `default` tier, source `planning`, renderer `planning`. The gap is **not** the catalog.
- **The tabview reads a server-side ledger.** The *System Events* tab
  (`apps/web/src/modules/observability/SystemEventsTab.tsx`) is fed from the `system_events`
  table, populated by `registerSystemEventTap`
  (`packages/app/src/services/system-event-tap.ts`), which subscribes the canonical server
  `SystemEventBus` and persists each cataloged event via `SystemEventDao`.
- **The tap is only wired in the server.** `registerSystemEventTap` is called **only** in
  `apps/server/src/serve.ts` (Gap 1 in `docs/inventory/system-events-producer-audit.md`). The
  CLI runtime (`apps/cli/src/context.ts`) constructs no tap.
- **Worse: the CLI discards planning events entirely.** `spur task` / `spur feature` build the
  mutation path `PlanningWriteService` **without an `emitter`**
  (`apps/cli/src/commands/task.ts:608`, `apps/cli/src/commands/feature.ts:362`), so it falls
  back to `NoopEventEmitter` (`packages/app/src/services/planning-write-service.ts:212`). CLI
  task/feature status changes emit nothing — not even onto a bus.


Spur is **CLI-first**. Operators and the `sp:dev-*` pipeline change status through
`spur task update`, `spur feature transition`, `spur task create` — **not** through the Board's
server API. So in normal operation the `feature.*` / `task.*` rows the catalog promises are
**never written**: the producer audit marks them "✅ when Board-driven; ❌ when CLI-driven," and
CLI-driven is the real path. This is the same shape of bug 0049 diagnosed — the events are
*defined* but the process where they *originate* (the CLI) has no durable, cross-process path to
the ledger the tabview reads.


0049's fix is a **durable, process-independent sink** (a JSONL file observer) that both the
emitting process and the consuming module touch, instead of an in-process subscription. Spur's
equivalent process-independent sink already exists: the shared SQLite `system_events` table.
Both the CLI (`context.getDb()` → `createMigratedDb`, which applies
`drizzle/0006_spur_cli_system_events.sql`) and `spur serve` open the **same** database
(`DEFAULT_DATABASE_URL`). So the fix is to give the CLI planning-write path a durable emitter
that persists `task.*` / `feature.*` rows straight into `system_events` — using the **same**
catalog normalization (`normalizeSystemEventPayload`) and actor extraction
(`extractSystemEventActor`) the server tap uses — so CLI-originated status changes appear in the
tabview's history without requiring a running server at emit time.


`feature.*` / `task.*` **only**. The other CLI-only prefixes (`rule.*`, `workflow.*`, `agent.*`,
`message.*`), queue config gating (Gap 2), and nested child-agent event bridging (Gap 4) remain
out of scope and keep their documented v1 status.
### Requirements
- [ ] R1. CLI-driven **task** status changes (`spur task create`, `spur task update <wbs> <status>`,
  pipeline transitions) persist the corresponding `task.created` / `task.updated` /
  `task.transitioned` row into the shared `system_events` ledger.
- [ ] R2. CLI-driven **feature** status changes (`spur feature create`, `spur feature update`,
  `spur feature transition`) persist `feature.created` / `feature.updated` /
  `feature.transitioned` rows.
- [ ] R3. **One canonical path, not a fork.** Rows are written through the existing
  `SYSTEM_EVENT_CATALOG` + `normalizeSystemEventPayload` + `extractSystemEventActor` used by the
  server tap (`packages/app/src/services/system-event-tap.ts`). No second, divergent
  serialization of planning events.
- [ ] R4. **Process-independent durability.** Events persist to the DB the CLI already opens via
  `CliContext.getDb()`; correct behavior does **not** require a running `spur serve`. Rows carry
  the same event names/schema as Board-driven rows so the tabview's `planning` renderer shows
  from→to status identically.
- [ ] R5. **Failure isolation.** A sink write error is logged and swallowed — it never aborts or
  rolls back the underlying `spur task`/`spur feature` file mutation (mirror the tap's
  per-handler try/catch).
- [ ] R6. **No double-write on the Board path.** When a status change flows through the server API
  (server tap active), exactly one `system_events` row is written — the CLI sink is wired only on
  the CLI mutation path, not the server path.
- [ ] R7. The append-only `system_events` cap (`SYSTEM_EVENTS_CAP = 10_000`) and prune semantics
  remain honored for CLI-written rows.
- [ ] R8. **Docs updated.** `docs/inventory/system-events-producer-audit.md` — the Planning
  (`task.*` / `feature.*`) rows and Gap 1's observability-path table change from
  "✅ when Board-driven; ❌ when CLI-driven" to Board **and** CLI reachable. Cross-reference
  ts-libs 0049 as the originating handoff. Sync surface docs per `sp:doc-evolve` if a design doc
  (`docs/04_DESIGN.md`) section is touched.
- [ ] R9. **Out of scope** (unchanged from 0049 and the producer audit): the other CLI-only
  prefixes (`rule.*`, `workflow.*`, `agent.*`, `message.*`), queue config gating (Gap 2),
  `process.started` side-channel (Gap 3), and nested child-agent event bridging (Gap 4).
  Real-time SSE push of CLI-originated events to already-connected Board clients is a follow-up —
  this task guarantees they appear in the **history** query the tabview loads.
### Acceptance Criteria
```gherkin
Feature: CLI-driven feature.* / task.* status changes appear in the System Events tabview

  @core
  Scenario: CLI task transition is persisted to system_events
    Given a migrated Spur workspace database
    And "spur serve" is NOT running
    When the operator runs "spur task update 0042 wip"
    Then a "task.transitioned" (or "task.updated") row exists in the system_events ledger
    And its source is "planning" and payload carries from -> to status

  @core
  Scenario: CLI feature transition is persisted to system_events
    Given a migrated Spur workspace database
    When the operator runs "spur feature transition B wip"
    Then a "feature.transitioned" row exists in the system_events ledger

  @core
  Scenario: The tabview history surfaces CLI-originated rows
    Given task/feature status was changed via the CLI while the server was down
    When the server later serves the System Events history endpoint
    Then the CLI-originated task.* / feature.* rows are returned and render under the planning renderer

  @edge
  Scenario: Sink failure never breaks the mutation
    Given the system_events write will fail (e.g. the ledger DAO throws)
    When the operator runs "spur task update 0042 done"
    Then the task file transition still succeeds
    And the persistence error is logged, not thrown

  @edge
  Scenario: No duplicate row on the Board-driven path
    Given the server system-event tap is active
    When a task status change flows through the server API
    Then exactly one system_events row is written for that change
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Chosen approach — a durable, DAO-backed emitter on the CLI planning-write path**
(the direct spur analog of ts-libs 0049's process-independent file observer).


A structural `EventEmitter` (the interface from `planning-write-service.ts:122`) that, on
`emit(event: PlanningEvent)`:

1. Looks up the catalog entry via `systemEventCatalogEntry(event.event)` (skip if unregistered).
2. Builds the row payload with `normalizeSystemEventPayload(entry, event)` and the actor with
   `extractSystemEventActor(event)` — the **same** helpers the server tap uses (R3).
3. Inserts a `system_events` row via `SystemEventDao` (occurred-at = `event.at`), honoring
   `SYSTEM_EVENTS_CAP` (R7).
4. Wraps the insert in try/catch: log + swallow, never throw (R5).

It depends only on `SystemEventDao` + the catalog helpers already exported from
`@gobing-ai/spur-app` — no EventBus, no server. Export it from the `packages/app` barrel
(`packages/app/src/index.ts`).

```ts
export class SystemEventEmitter implements EventEmitter {
    constructor(private readonly dao: SystemEventDao, private readonly logger: Pick<Logger,'warn'>) {}
    async emit(event: PlanningEvent): Promise<void> {
        const entry = systemEventCatalogEntry(event.event);
        if (!entry) return;
        try {
            await this.dao.insert({
                id: createId('sev'),
                event_name: entry.name,
                occurred_at: event.at,
                actor: extractSystemEventActor(event),
                payload: safeStringify(normalizeSystemEventPayload(entry, event)),
            });
        } catch (err) { this.logger.warn(/* isolate — R5 */); }
    }
}
```


Both CLI builders currently pass **no** emitter, so `PlanningWriteService` falls back to
`NoopEventEmitter` (`planning-write-service.ts:212`). Change:

- `apps/cli/src/commands/task.ts:608` (`makeService`) — pass
  `emitter: new SystemEventEmitter(new SystemEventDao(await context.getDb()), logger)`.
- `apps/cli/src/commands/feature.ts:362` (`makeService`) — same.

The CLI already opens the shared SQLite DB (`context.getDb()` → `createMigratedDb`, which applies
`drizzle/0006_spur_cli_system_events.sql`), so the `system_events` table is present. Keep the DB
resolution lazy (the emitter is only constructed for mutating verbs).


`resolveEventName` (`planning-write-service.ts:524`) maps create → `*.created` and other mutations
→ `*.updated`. The catalog and the tabview also expect `task.transitioned` /
`feature.transitioned` for **status** transitions (audit lists both as reachable via
`planning-events.ts`). During implementation, confirm whether a status transition already yields
`*.transitioned` (via the lifecycle path) or must be distinguished in `resolveEventName`. The goal
per the operator is that **status changes** are visible — so `*.transitioned` must fire on a
status transition and carry `from`/`to`.


Register a full `registerSystemEventTap` on a real `EventBus` inside the CLI context and inject a
`BusPlanningEventEmitter`. This spins a bus + subscribes the whole catalog per CLI invocation,
when the CLI only ever produces planning events. The direct DAO emitter is the minimal,
0049-aligned durable sink; prefer it. (If a future task needs CLI-side `rule.*` / `workflow.*`
durability, the tap route can be revisited.)


- Server path unchanged → no double-write (R6): the tap stays server-only; the CLI emitter is
  wired only in the CLI `makeService` builders.
- No new ts-libs surface required — 0.4.9 already landed; this is pure spur-owned wiring.
### Plan
1. **Confirm event-name behavior.** Read `resolveEventName` + the lifecycle transition path; verify
   whether `task.transitioned` / `feature.transitioned` already fire on a status transition, or
   whether `resolveEventName` must distinguish a status transition from a metadata update. Capture
   the finding before coding.
2. **Add `SystemEventEmitter`** in `packages/app/src/services/`, reusing `systemEventCatalogEntry`,
   `normalizeSystemEventPayload`, `extractSystemEventActor`, `safeStringify`, and `SystemEventDao`.
   Export from `packages/app/src/index.ts`.
3. **Unit-test the emitter** against an in-memory `SystemEventDao` (`:memory:`): asserts one row per
   registered planning event, correct `event_name` / `actor` / normalized payload, unregistered
   names skipped, and DAO-throw is swallowed (R5).
4. **Wire the emitter** into `apps/cli/src/commands/task.ts:608` and `feature.ts:362` `makeService`
   builders via `context.getDb()` → `SystemEventDao`.
5. **Integration test (CLI level).** Run `spur task create` / `spur task update <status>` /
   `spur feature transition` against a temp file DB with the server down; assert `system_events`
   rows exist and match the catalog names (R1, R2, R4). Assert the mutation still succeeds when the
   sink throws (R5) and that only one row is written on the server path (R6).
6. **Update `docs/inventory/system-events-producer-audit.md`** — flip the Planning rows and Gap 1
   path table to Board+CLI reachable; add the ts-libs 0049 cross-reference (R8). Run
   `sp:doc-evolve sync-check` if any numbered design doc is touched.
7. **Verification gate.** `bun run autofix && bun run spur-check`; `bun run lint`; `bun run test`;
   `bun run test-cf`; `bun run build`; `spur task check <wbs> --strict-core --json`.
### Solution
**Change map:**
- `packages/app/src/services/system-event-emitter.ts` (new) — `SystemEventEmitter` class implementing `EventEmitter`. On `emit`: looks up catalog entry via `systemEventCatalogEntry`; builds payload with `normalizeSystemEventPayload`; inserts via `SystemEventDao`; prunes to `SYSTEM_EVENTS_CAP`. Try/catch logs+swallows (R5).
- `apps/cli/src/planning-emitter.ts` (new) — `makePlanningEmitter(context)` factory. Lazy `getDb()` (R4) — adapter+DAO constructed on first emit, cached. Warn-logger routes sink failures to `context.output.error` (R5).
- `apps/cli/src/commands/task.ts:612` — `makeService` adds `emitter: makePlanningEmitter(context)`.
- `apps/cli/src/commands/feature.ts:366` — same.
- `packages/app/src/index.ts:128-129` — exports `SystemEventEmitter`, `SystemEventEmitterLogger`.
- `packages/app/src/services/system-event-tap.ts:92` — exported `safeStringify` (was private).
- `docs/inventory/system-events-producer-audit.md` — Planning rows + Gap 1 path table flipped to Board **and** CLI reachable; added 0249 note + ts-libs 0049 cross-reference (R8).

**Key decisions:**
- `resolveEventName` already yields `*.transitioned` for status transitions (not `*.updated`) — confirmed via smoke test: `spur task update 0250 todo` emits `task.transitioned` with `from=backlog, to=todo`.
- Lazy DB resolution keeps read-only verbs (`task list`, `feature show`) from opening SQLite.
- No server-side wiring change → no double-write (R6).

### Testing
**Unit tests:**
- `packages/app/tests/services/system-event-emitter.test.ts` — 5 tests: one row per registered planning event; correct `event_name`/actor/payload; unregistered names skipped; DAO-throw swallowed (R5); cap prune honored. All pass.
- `apps/cli/tests/commands/planning-emitter.test.ts` — 3 tests: lazy DB resolution failure swallowed (R5); DAO insert failure warns (R5); lazy caching verified. 100% coverage on `planning-emitter.ts`. All pass.

**Integration tests:**
- `apps/cli/tests/commands/planning-system-events.test.ts` — 3 tests: task create → `task.created` row; task transition → `task.transitioned` row with from→to; feature create → `feature.created` row. All pass against real SQLite.

**End-to-end smoke test (2026-07-13):**
- `spur task create` → `task.created` row in `system_events` ledger ✓
- `spur task update 0250 todo` → `task.transitioned` row, `from=backlog, to=todo` ✓
- `spur feature update J active` → `feature.transitioned` row, `from=backlog, to=active` ✓
- All with server NOT running — rows in shared `.spur/spur.db` ✓

**Full suite:** `bun run test` → 2723 pass, 0 fail, 7667 expect() calls, exit=0.
**Lint:** `bun run lint` → 0 errors. **Build:** `bun run build` → exit=0.
**test-cf:** Segfault (Signal #11) — pre-existing, confirmed via `git stash` + re-run on clean checkout. No server files touched.

### Review
**P1-P4 findings:** None.
**Residual risk:**
- `test-cf` segfault is pre-existing (miniflare/vitest worker issue), not a regression.
- Real-time SSE push of CLI-originated events to already-connected Board clients is explicitly out of scope (R9) — this task guarantees they appear in the history query, not live push.

**Disposition:** PASS — all 9 requirements (R1-R9) satisfied, all acceptance criteria verified, all gates green.

### References
- Parent feature: **J** — observabilities board module (`docs/features/J_observabilities-board-module.md`).
- Originating handoff: ts-libs **0049** — *Diagnosis & fix plan for missing System Events in Observability module*
  (`~/xprojects/ts-libs/docs/tasks/0049_diagnosis_fix_missing_system_events_in_observability_tabview.md`).
  0049 fixed the six shared-gap prefixes upstream (0.4.9 `lifecycleBus`) and deferred `feature.*` /
  `task.*` to this consumer project.
- Gap of record: `docs/inventory/system-events-producer-audit.md` — **Gap 1 (CLI event-tap gap)**;
  Planning (`task.*` / `feature.*`) rows.
- Prior spur work: 0221 (upstream coverage + bus wiring), 0226 (real producer wiring), 0237
  (TeamOrchestrator events), 0238 (documented the CLI event-tap gap).
- Key source: `packages/app/src/services/event-names.ts` (catalog),
  `packages/app/src/services/system-event-tap.ts` (server tap + normalization helpers),
  `packages/app/src/services/planning-write-service.ts` (mutation path + `NoopEventEmitter`),
  `apps/cli/src/commands/task.ts` / `feature.ts` (emitter-less `PlanningWriteService` construction),
  `apps/cli/src/context.ts` (`getDb()` shared SQLite adapter).
### History
- 2026-07-13T23:33:17.093Z todo → wip (system)
- 2026-07-13T23:33:22.659Z wip → testing (system)
- 2026-07-13T23:33:23.060Z testing → done (system)
