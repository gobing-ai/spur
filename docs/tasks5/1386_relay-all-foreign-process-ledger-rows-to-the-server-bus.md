---
schema_version: 1
name: Relay all foreign-process ledger rows to the server bus
status: done
template: feature-impl
created_at: 2026-11-18T05:29:28.838Z
updated_at: "2026-11-18T16:36:34.092Z"
feature_id: D92
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 4.5

done_forced: "false"
done_reason: unforced close
---

## 1386. Relay all foreign-process ledger rows to the server bus

### Background

Board task actions spawn child agent CLIs (`runTaskActionJob`, `apps/server/src/serve.ts:545-563`). Their nested `spur workflow run` / `spur rule run` events are persisted to `system_events` by the CLI ledger (`apps/cli/src/system-event-ledger.ts`, through `registerSystemEventTap`), but they never reach the server bus. The server's ledger relay (`startMessageRelay`, `apps/server/src/modules/events/index.ts:143-172`) follows `followSystemEventsAfter` with `match: event_name.startsWith('message.')`.

**Refine corrections (2026-11-17)**
- R1 "persist the emitting process identity, via a migration if a column is needed" → `system_events` has no origin column (`drizzle/0006`, `0008`). A column would also misclassify the server's own `InboxService` `message.*` rows: they are written in-transaction without touching the bus, so the relay must keep forwarding them. → No migration. The server's two bus-to-ledger writers (`registerSystemEventTap` and `createSystemEventCatchAllSink`, `serve.ts:1051-1080`) share one `SystemEventDao`. Wrap it so each inserted id goes into a process-local `ownIds` set. The relay skips an id it finds there and deletes it on sight, so the set stays bounded by the rows still in flight.
- Missing loop hazard: re-emitting a foreign `workflow.*` row on the bus would trigger the server's own tap and catch-all, which would persist the row a second time and loop. → Relayed payloads are marked (the existing `relayedRowColumns` WeakMap at `:141` already keys them), and the tap and catch-all take a `skip(event)` predicate that ignores marked payloads.
- "appear on the SSE stream" → the SSE handler filters to `SYSTEM_EVENT_STREAMED_NAMES` (plus the diagnostic tier), so relaying every row does not widen what the Board shows beyond the catalog. Non-streamed names reach bus listeners only.

### Requirements

- [x] R1. Wrap the server's shared ledger `SystemEventDao` so every insert by the server tap or catch-all adds its row id to a process-local `ownIds` set exposed on `ServerContext`. No schema change.
- [x] R2. Rename the relay to `startLedgerRelay`. It matches every row, skips (and removes) ids in `ownIds`, and emits all others, including in-server `InboxService` `message.*` rows (unchanged behavior) and child-CLI `workflow.*`/`rule.*` rows.
- [x] R3. `registerSystemEventTap` and `createSystemEventCatchAllSink` accept `skip?: (event: unknown) => boolean`. The server passes a predicate that matches relayed payloads, so a relayed row is never re-persisted.
- [x] R4. Keep per-row failure isolation (one malformed row is skipped and the loop continues), and keep the boot snapshot (rows from before boot are not re-emitted).
- [x] R5. Replace the v1 scope-limit comment at `serve.ts:555-563` and the relay doc comment, and update `docs/design/observability-contracts.md`.

### Acceptance Criteria

- [x] AC1 — Child-process workflow events reach the live Board stream (req: R2, R4)
- [x] AC2 — The server never re-emits its own rows (req: R1, R3, R5)

Test layer: a real in-memory ledger and bus for the module tests, plus one real child CLI process for the e2e.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:50:26.094Z

- **Origin column vs in-memory ids?** Closed: in-memory ids. They need no migration and keep server inbox `message.*` rows relayed.
- **Relay loop?** Closed: relayed payloads are marked, and the tap and catch-all skip marked payloads.
- **Board visibility of every family?** Unchanged: the SSE catalog filter still decides what streams.

### Design

**WHAT.**

```ts
// apps/server/src/modules/events/index.ts
export const relayedPayloads = new WeakSet<object>(); // or reuse relayedRowColumns.has
// serve.ts composition
const ownIds = new Set<string>();
const dao = trackOwnInserts(new SystemEventDao(db), ownIds); // insert(input) { ownIds.add(input.id); return inner.insert(input) }
registerSystemEventTap(bus, dao, logger, { …, skip: (e) => isRelayed(e) });
```

`trackOwnInserts` adds the id before awaiting the insert, so the relay can never see the row before the id is registered. The relay's `match` is replaced by `(row) => !ownIds.delete(row.id)`: `delete` returns true when the id was present, which skips the row and prunes the set in one call.

**WHY.** An in-memory id set is exact and migration-free. Origin is a fact about this process's writers, not about event families or processes in general, so it doesn't belong in the shared schema. The `skip` predicate breaks the relay → tap → ledger cycle at the only place that can see both.

**WHERE.** `apps/server/src/serve.ts` (composition and comment), `apps/server/src/modules/events/index.ts` (relay), `apps/server/src/context.ts` (`ownIds` accessor), `packages/app/src/services/system-event-tap.ts` and `system-event-catch-all.ts` (`skip` option), and `docs/design/observability-contracts.md`.

**Anti-patterns.** No new IPC transport. Don't filter by event family. Don't add a column. Don't re-persist relayed rows.

**Limit.** The set holds the ids of own rows the relay has not yet read. If the relay stops on a ledger error, the set grows until restart (`// ponytail: bounded only while the relay runs; clear on relay stop if that matters`).

### Plan

- [ ] Step 1 (test first, R2/R4): an events-module test with an in-memory DB inserts a foreign `workflow.run.started` row directly through `SystemEventDao`. Assert the bus emits it once. Insert one malformed row and assert the loop continues.
- [ ] Step 2 (test first, R1/R3): emit an event on the server bus with the tap attached. Assert it is persisted once and emitted on the bus once, with no relay echo and no second ledger row. A relayed foreign row must not be re-persisted (the ledger row count stays at 1).
- [ ] Step 3: an e2e that spawns a real `spur workflow run` child against a running test server's DB and asserts the SSE stream receives the streamed workflow event exactly once.
- [ ] Step 4: implement the DAO wrapper, `ownIds`, the `skip` options and the relay rename. Update the comment and docs, run `(cd apps/server && bun test tests/modules/events)` plus `packages/app` tap tests, then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/server/src/context.ts:303` |
| `apps/server/src/context.ts:466` |
| `apps/server/src/context.ts:848` |
| `apps/server/src/modules/events/index.ts:128` |
| `apps/server/src/modules/events/index.ts:142` |
| `apps/server/src/modules/events/index.ts:158` |
| `apps/server/src/modules/events/index.ts:162` |
| `apps/server/src/modules/events/index.ts:173` |
| `apps/server/src/modules/events/index.ts:194` |
| `apps/server/src/modules/events/index.ts:226` |
| `apps/server/src/serve.ts:1065` |
| `apps/server/src/serve.ts:1071` |
| `apps/server/src/serve.ts:1093` |
| `apps/server/src/serve.ts:550` |
| `apps/server/src/serve.ts:554` |
| `apps/server/src/serve.ts:594` |
| `apps/server/src/serve.ts:67` |
| `apps/server/tests/modules/events/index.test.ts:4` |
| `apps/server/tests/modules/events/index.test.ts:476` |
| `docs/design/observability-contracts.md:282` |
| `packages/app/src/services/system-event-catch-all.ts:108` |
| `packages/app/src/services/system-event-catch-all.ts:129` |
| `packages/app/src/services/system-event-tap.ts:60` |
| `packages/app/src/services/system-event-tap.ts:83` |
| `apps/server/tests/modules/events/ledger-relay-loop.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — wrap the shared ledger DAO so every server insert registers its id in a process-local `ownIds` set exposed on `ServerContext`; no schema change | MET | `apps/server/src/context.ts:308` (accessor), `:467` (the set), `:848` (impl); `apps/server/src/serve.ts:599` (`trackOwnInserts`, exported + wired at the tap composition); test `apps/server/tests/modules/events/ledger-relay-loop.test.ts` (`trackOwnInserts` — the id is in the set at insert time, so the relay cannot race the write). No migration touched |
| R2 — rename to `startLedgerRelay`; match every row, skip+remove `ownIds` ids, emit all others (in-server `message.*` and child `workflow.*`/`rule.*`) | MET | `apps/server/src/modules/events/index.ts:158` (`startLedgerRelay`), `:173` (`!ownIds.delete(row.id)` — one call tests and prunes); tests `index.test.ts` (`a foreign workflow row is relayed` — the old `message.*` filter is gone; `an own row is skipped and its id pruned`), `ledger-relay-loop.test.ts` (relayed foreign row emitted once) |
| R3 — `registerSystemEventTap` and `createSystemEventCatchAllSink` accept `skip?: (event) => boolean`; the server passes a relayed-payload predicate | MET | `packages/app/src/services/system-event-tap.ts:64` + handler early-return, `packages/app/src/services/system-event-catch-all.ts:109` + sink early-return; predicate `apps/server/src/modules/events/index.ts:146` (`isRelayedPayload`) wired at both `serve.ts` call sites; test `ledger-relay-loop.test.ts` (`a relayed foreign row … not persisted a second time` — ledger stays at one row) |
| R4 — per-row failure isolation and the boot snapshot are kept | MET | `index.ts` keeps the per-row `try/catch` around parse+emit and still starts at `latestSequence()`; test `a malformed row is skipped and the loop continues` (`{not json` then a good row: the good row still surfaces) |
| R5 — replace the v1 scope-limit comment, the relay doc comment, and update `docs/design/observability-contracts.md` | MET | `apps/server/src/serve.ts` `runTaskActionJob` doc comment rewritten (the "child events do NOT cross back" v1 limit is gone, two guards documented), relay doc comment rewritten at `index.ts:128-145`, `docs/design/observability-contracts.md:282` new §7.9b with the four rules |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Child-process workflow events reach the live Board stream (R2, R4) | MET | test | `ledger-relay-loop.test.ts` — a **real child CLI process** (`bun apps/cli/src/index.ts workflow run <fixture>`) writes `workflow.run.started` into a file-backed ledger; the in-process relay surfaces it on the bus. Plus the module-level test proving the `workflow.*` family is no longer filtered |
| AC2 — The server never re-emits its own rows (R1, R3, R5) | MET | test | `index.test.ts` (own row skipped, id pruned, following foreign row still relayed) + `ledger-relay-loop.test.ts` (own emit: one ledger row, one bus delivery, no echo after 200ms) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T16:34:23.816Z todo → wip (system)
- 2026-11-18T16:36:32.349Z wip → testing (system)
- 2026-11-18T16:36:34.088Z testing → done (system)

