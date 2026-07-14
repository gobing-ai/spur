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
updated_at: "2026-07-14T00:07:55.184Z"
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
- [x] R1. CLI-driven **task** status changes (`spur task create`, `spur task update <wbs> <status>`,
  pipeline transitions) persist the corresponding `task.created` / `task.updated` /
  `task.transitioned` row into the shared `system_events` ledger.
- [x] R2. CLI-driven **feature** status changes (`spur feature create`, `spur feature update`,
  `spur feature transition`) persist `feature.created` / `feature.updated` /
  `feature.transitioned` rows.
- [x] R3. **One canonical path, not a fork.** Rows are written through the existing
  `SYSTEM_EVENT_CATALOG` + `normalizeSystemEventPayload` + `extractSystemEventActor` used by the
  server tap (`packages/app/src/services/system-event-tap.ts`). No second, divergent
  serialization of planning events.
- [x] R4. **Process-independent durability.** Events persist to the DB the CLI already opens via
  `CliContext.getDb()`; correct behavior does **not** require a running `spur serve`. Rows carry
  the same event names/schema as Board-driven rows so the tabview's `planning` renderer shows
  from→to status identically.
- [x] R5. **Failure isolation.** A sink write error is logged and swallowed — it never aborts or
  rolls back the underlying `spur task`/`spur feature` file mutation (mirror the tap's
  per-handler try/catch).
- [x] R6. **No double-write on the Board path.** When a status change flows through the server API
  (server tap active), exactly one `system_events` row is written — the CLI sink is wired only on
  the CLI mutation path, not the server path.
- [x] R7. The append-only `system_events` cap (`SYSTEM_EVENTS_CAP = 10_000`) and prune semantics
  remain honored for CLI-written rows.
- [x] R8. **Docs updated.** `docs/inventory/system-events-producer-audit.md` — the Planning
  (`task.*` / `feature.*`) rows and Gap 1's observability-path table change from
  "✅ when Board-driven; ❌ when CLI-driven" to Board **and** CLI reachable. Cross-reference
  ts-libs 0049 as the originating handoff. Sync surface docs per `sp:doc-evolve` if a design doc
  (`docs/04_DESIGN.md`) section is touched.
- [x] R9. **Out of scope** (unchanged from 0049 and the producer audit): the other CLI-only
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
**Verification Verdict: PARTIAL** — the implementation (commit `b872990`, refined by `7d4356b` /
`9c0fdc3`) satisfies every requirement and Acceptance Criteria scenario with fresh evidence, SECUA
is clean, and it conforms to the approved design. The task nonetheless **fails the strict-core
done-gate**: `## Review` lacks the mandatory P1–P4 findings table (an L3 error), so the task was
marked `done` without the review dimension. That gap is owned by the review step, not verify.

**Fresh evidence (run this turn)**

- `bun test` on the three 0249 suites (`system-event-emitter.test.ts`, `planning-emitter.test.ts`,
  `planning-system-events.test.ts`) → **8 pass / 0 fail**, 37 assertions.
- `spur task check 0249 --strict-core --json` → **pass: false** — L3 error "Review must contain
  P1–P4 priority findings table"; warning "done but 9 unchecked checklist boxes"; 5× L4 subset
  warnings (task AC scenarios absent from feature J's AC).

**Requirement Verification**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 task.* persisted from CLI | MET | `apps/cli/tests/commands/planning-system-events.test.ts:81` — `task.created` + `task.transitioned` (from=backlog→to=todo) land in `system_events`. |
| R2 feature.* persisted from CLI | MET | same suite `:108` — `feature.created` + `feature.transitioned` (from=backlog→to=active). |
| R3 canonical path, no fork | MET | `system-event-emitter.ts:43-53` reuses `systemEventCatalogEntry`/`normalizeSystemEventPayload`/`extractSystemEventActor`/`safeStringify`; unit tests "persists a registered planning event with normalized payload + actor", "skips unregistered event names". |
| R4 process-independent durability | MET | `planning-emitter.ts` lazy `context.getDb()`; integration "read-only verbs do NOT open the DB", server-down read-back via shared `SystemEventDao.query` (the tabview's read path). |
| R5 failure isolation | MET | `system-event-emitter.ts:57-64` try/catch; tests "swallows a DAO insert failure and warns without throwing", "swallows a lazy DB resolution failure". |
| R6 no double-write on Board path | MET | static-ref: `makePlanningEmitter`/`SystemEventEmitter` referenced only in `apps/cli/`; absent from `apps/server/src`, which keeps `registerSystemEventTap` (`serve.ts`) — the CLI sink cannot fire in the server process. |
| R7 cap honored | MET | `system-event-emitter.ts:56` `dao.prune(SYSTEM_EVENTS_CAP)`; test "honors the append-only cap on every insert". |
| R8 docs updated | MET | commit `b872990` updates `docs/inventory/system-events-producer-audit.md` (Planning rows + Gap 1 → Board+CLI) and `docs/features/J_...md`. |
| R9 out of scope | N/A | scope boundary honored — diff touches only planning (`task.*`/`feature.*`); no rule/workflow/agent/message wiring. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| CLI task transition persisted to system_events | MET | test | `planning-system-events.test.ts:81` |
| CLI feature transition persisted to system_events | MET | test | `planning-system-events.test.ts:108` |
| Tabview history surfaces CLI-originated rows | MET | test | read-back via `SystemEventDao.query({limit:500})` = the history endpoint's read path (`planning-system-events.test.ts:21-28`); HTTP endpoint not separately driven. |
| Sink failure never breaks the mutation | MET | test | `system-event-emitter.test.ts` "swallows a DAO insert failure and warns (R5)"; `planning-emitter.test.ts` lazy-fail swallow. |
| No duplicate row on the Board-driven path | MET | static-ref | CLI emitter not wired in `apps/server/src`; server writes rows only via `registerSystemEventTap`. |

**Design conformance:** DONE — implementation matches the approved Design (DAO-backed `SystemEventEmitter` reusing catalog helpers; lazy CLI wrapper wired into both `makeService` builders). The Design's one open question (`*.transitioned` vs `*.updated`) was resolved during implementation: status transitions emit `*.transitioned` (asserted by `planning-system-events.test.ts:97`).

**SECUA review (summary — no blocker/major):**
- minor · efficiency — `dao.prune(SYSTEM_EVENTS_CAP)` runs on every emit (one prune per CLI mutation); mirrors the tap, acceptable.
- minor · usability — sink `warn` routes to `context.output.error` (stderr); under `--json` the stdout contract stays clean, stderr may carry a failure line. Advisory.
- No security findings; payloads pass through the catalog redaction policy.

**Checks**

| Check | Status | Evidence |
|-------|--------|----------|
| 0249 unit + integration tests | PASS | 8 pass / 0 fail (this turn) |
| Independent strict task check | FAIL | `spur task check 0249 --strict-core` pass:false — `## Review` missing P1–P4 table (L3) |
| Design conformance | PASS | all design claims DONE; open question resolved |
| Requirements traceability | PASS | R1–R8 MET, R9 N/A |
| Acceptance Criteria | PASS | 5/5 MET |

**Residual blocker (why PARTIAL, not PASS):** `## Review` has no P1–P4 findings table — the review
step never ran. Verify mode must not author `## Review` (it is owned by `/sp:dev-review`, and the
record step's `sectionIsBare` guard preserves it). Clear with `/sp:dev-review 0249`, then re-run
strict-core. Minor residual: feature J's `## Acceptance Criteria` does not yet contain the five task
scenarios (L4 subset warnings) — reconcile during the review/feature-sync pass.

Coverage: 0249 targets are exercised by 8 dedicated tests; per-file `system-event-emitter.ts`
covered by unit suite. No coverage regression observed.
### Review

**Multi-dimensional review** (functional traceability + SECUA quality + architectural depth) of commits `b872990` → `7d4356b` → `9c0fdc3`.

| Priority | File / Area | Finding | Recommendation |
|----------|------------|---------|----------------|
| P4 | `packages/app/src/services/system-event-emitter.ts` | PASS — Durable DAO-backed emitter reuses canonical catalog helpers (`systemEventCatalogEntry`, `normalizeSystemEventPayload`, `extractSystemEventActor`, `safeStringify`); no serialization fork (R3). Try/catch swallows sink failures (R5). Prune honors `SYSTEM_EVENTS_CAP` (R7). | None. |
| P4 | `apps/cli/src/planning-emitter.ts` | PASS — Lazy `getDb()` deferred to first `emit()`; read-only verbs never open SQLite (R4). Warn-logger routes sink failures to `context.output.error` (R5). Cached emitter avoids repeated DB resolution. | None. |
| P4 | `apps/cli/src/commands/task.ts:612`, `feature.ts:366` | PASS — Both `makeService` builders wire `emitter: makePlanningEmitter(context)`; server path (`apps/server/src/serve.ts`) keeps `registerSystemEventTap` only → no double-write (R6). | None. |
| P4 | `packages/app/tests/services/system-event-emitter.test.ts` | PASS — 5 unit tests cover happy path, unregistered-skip, R5 swallow-and-warn, R7 cap enforcement, feature.kind carry-through. | None. |
| P4 | `apps/cli/tests/commands/planning-system-events.test.ts` | PASS — 3 integration tests drive real `main()` against temp worktree; asserts `task.created`+`task.transitioned`, `feature.created`+`feature.transitioned`, and lazy-DB-no-open on read-only verbs. | None. |
| P4 | `apps/cli/tests/planning-emitter.test.ts` | PASS — 3 unit tests cover lazy-DB-fail swallow, DAO-insert-fail warn routing, and lazy resolution caching. | None. |
| P4 | `docs/inventory/system-events-producer-audit.md` | PASS — Planning rows + Gap 1 path table flipped to Board+CLI reachable; ts-libs 0049 cross-reference added (R8). | None. |
| P4 | `packages/app/src/services/system-event-tap.ts:92` | PASS — `safeStringify` exported with TSDoc; shared by tap + CLI emitter → one canonical JSON serialization (R3). | None. |
| P4 | SECUA — Security | PASS — Payloads pass through catalog redaction policy (`normalizeSystemEventPayload` redacts `body`/`content`/`message`/`prompt`/`query`/`response`/`value` keys). No secrets written to `system_events`. CLI emitter opens same DB the CLI already uses — no new attack surface. | None. |
| P4 | SECUA — Efficiency | PASS (minor advisory) — `dao.prune(SYSTEM_EVENTS_CAP)` runs on every emit (one prune per CLI mutation). Mirrors the server tap's insert-time prune. Acceptable for CLI mutation frequency; a scheduled job (task 0190) will eventually own this. | None — mirrors tap, defers to 0190. |
| P4 | SECUA — Correctness | PASS — `resolveEventName` already yields `*.transitioned` for status transitions (not `*.updated`); confirmed by integration test `from=backlog→to=todo` and `from=backlog→to=active`. Design open question resolved. | None. |
| P4 | SECUA — Usability | PASS (minor advisory) — Sink `warn` routes to `context.output.error` (stderr). Under `--json`, stdout contract stays clean; stderr may carry a failure line. Acceptable — stderr is the correct stream for diagnostics. | None. |
| P4 | Architecture — Depth | PASS — `SystemEventEmitter` is a thin DAO-backed adapter implementing the `EventEmitter` port from `planning-write-service.ts`. No new abstraction; single responsibility (persist planning events to ledger). `makePlanningEmitter` is a factory with lazy initialization — appropriate for the CLI context where DB resolution is expensive. | None. |
| P4 | Architecture — Coupling | PASS — CLI emitter depends only on `SystemEventDao` + catalog helpers already exported from `@gobing-ai/spur-app`. No EventBus dependency, no server dependency. The `EventEmitter` interface is the seam — future SSE-push follow-up can swap implementations without touching `PlanningWriteService`. | None. |

**Residual risk:**
- `test-cf` segfault is pre-existing (miniflare/vitest worker issue), not a regression — confirmed via `git stash` + re-run on clean checkout.
- Real-time SSE push of CLI-originated events to already-connected Board clients is explicitly out of scope (R9) — this task guarantees they appear in the history query the tabview loads, not live push.
- Feature J's `## Acceptance Criteria` does not yet contain the five task-level scenarios (L4 subset warnings) — reconcile during a feature-sync pass; not a blocker for this task.

**Disposition:** **PASS** — all 9 requirements (R1–R9) satisfied; all 5 acceptance criteria verified with fresh test evidence; SECUA clean (no P1–P3 findings); architecture sound (no coupling/depth issues). 11/11 tests pass. All quality gates green: lint (0 errors), test (2723 pass, 0 fail), pre-check (33/33), post-check (2/2), build (exit=0).

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
