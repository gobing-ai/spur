---
schema_version: 1
name: Catalog-open system-event ingestion with generic fallback and drift signal
status: done
template: feature-impl
created_at: 2026-09-07T03:53:27.194Z
updated_at: "2026-09-07T07:23:27.390Z"
feature_id: J31
priority: P2

---

## 0794. Catalog-open system-event ingestion with generic fallback and drift signal

### Background

Covers feature J31 scenarios R5–R11. Authority: **ADR-110** (Proposed, `docs/00_ADR.md:2301`) and
`docs/design/observabilities-module-polish.md` (D3, D4).

**Both persistence paths are catalog-closed (verified 2026-09-07):**

- `registerSystemEventTap` (`packages/app/src/services/system-event-tap.ts:51`) builds one handler
  **per `SYSTEM_EVENT_CATALOG` entry** (`:68`), additionally skipping `tier === 'diagnostic'` entries
  unless `diagnosticEnabled` (`:73`). An unregistered name has no subscriber at all.
- `SystemEventEmitter.emit` looks up `systemEventCatalogEntry(event.event)`
  (`packages/app/src/services/system-event-emitter.ts:61`) and **returns early** when it is absent
  (`:63`).
- ts-infra's `EventBus` exposes only exact-name handler maps — no `onAny`/wildcard — so a catch-all
  cannot be a subscriber; ADR-110 therefore intercepts at the **emit seam**.

**Two premises the satellite states that the tree does not support — corrected here:**

1. **R10 retention does _not_ already cover uncataloged prefixes.** The satellite says uncataloged
   prefixes "resolve through the existing per-prefix quota fallback … so no new config shape".
   They do not. `resolveRetentionQuotas`
   (`packages/app/src/services/system-event-retention.ts:34-43`) maps over `SYSTEM_EVENT_PREFIXES`
   — **catalog prefixes only** — and its own contract states "Unknown override keys (prefixes not in
   the catalog) are ignored: retention scopes to registered events only". `SystemEventDao.pruneQuotas`
   (`packages/domain/src/dao/system-event-dao.ts:268`) prunes only the prefixes present in the quota
   list, so an uncataloged prefix becomes an **unbounded bucket** — the exact failure that resolver
   was written to prevent. ADR-110's intent (uncataloged rows are bounded by the default quota) is
   correct; its mechanism needs the small change in Design D3c. See Q&A Q2.
2. **R7 already holds on the Board with no web change.** `SystemEventsTab` defaults
   `tierFilter: 'all'` (`:205`), post-filters tier only when it is not `all` (`:622`), and explicitly
   treats an **undefined** tier as `default` (`:625`); `tierByName` is built only from catalog
   entries (`:822-825`), so an uncataloged name yields `undefined`. The server history endpoint
   filters by a client-supplied `names` param (`apps/server/src/modules/events/index.ts:266-270,305`)
   which `serializeFilter` sets **only from a user search query**
   (`SystemEventsTab.tsx:582`) — never a catalog allow-list. R7 is therefore a **test** obligation,
   not a code change. See Q&A Q3.

**Shared-file note.** Sibling task `0793` also edits `SystemEventsTab.tsx` (time-range plumbing);
this task touches only its renderer/tier path. No `dependencies[]`; whoever lands second rebases.

### Requirements

- [x] R5. An uncataloged event emitted on the **server** bus persists a `system_events` row with the
      emitted name, a prefix derived from the name's first dot-segment, and the standard
      normalization + configured-secret redaction path.
- [x] R6. An uncataloged planning event reaching the **CLI** `SystemEventEmitter` persists instead of
      being dropped, and renders on the history endpoint with the `generic` renderer.
- [x] R7. Uncataloged events are visible on the System Events tab under **default** filters, with no
      diagnostic toggle; cataloged events keep their presenters and tiers. (Verified by test — the
      existing client tier post-filter already admits undefined-tier rows; see Background.)
- [x] R8. Cataloged event behavior is byte-unchanged, and the catch-all writes **no duplicate row**
      for any name the tap or emitter already owns.
- [x] R9. Catch-all persist failures are logged and swallowed — never thrown to the producer, never
      aborting the emit path.
- [x] R10. An uncataloged prefix is bounded by the **default** retention quota and pruned to it;
      pruning one prefix leaves other prefixes untouched.
- [x] R11. A drift audit surface reports each observed uncataloged event name as a promotion list:
      once-per-name-per-process `system_events.uncataloged` warn log **and** `renderer='generic'`
      ledger rows queryable through the history endpoint's catalog metadata.

**Out of scope / non-goals**

- No change to any released `@gobing-ai/ts-*` package — in particular **no** `onAny`/wildcard in
  ts-infra's `EventBus`. Accepted consequence: uncataloged events are history-visible on load or
  refresh, **not** live-streamed over SSE (ADR-110 accepted limitation).
- No presenter/field polish for individual uncataloged events; promotion into `BASE_CATALOG` with a
  real presenter is separate follow-up work.
- No dedicated `spur` CLI verb for the drift audit — deferred until the list proves recurrent (D4).
- No change to the diagnostic-tier policy or to `resolveRetentionQuotas`'s typo-guard for
  operator-supplied **config override keys** (see Q&A Q2 for the precise seam that does change).
- No new config shape, contract, DTO, or migration.
- No time-range or naming work — that is task 0793.

### Acceptance Criteria

```gherkin
Scenario: R5 — An uncataloged event emitted on the server bus is persisted
  Given an event name absent from the system event catalog
  When that event is emitted on the server event bus
  Then a system_events row is persisted with the emitted name
  And its prefix is derived from the event name
  And its payload passes through the standard redaction path

Scenario: R6 — An uncataloged planning event emitted from the CLI is persisted
  Given an event name absent from the system event catalog
  When the CLI planning emitter receives that event
  Then the event is persisted rather than silently dropped
  And the row renders on the history endpoint with the generic renderer

Scenario: R7 — Uncataloged events are visible by default on the Board
  Given uncataloged events have been persisted
  When the System Events tab loads with default filters
  Then uncataloged events appear without enabling the diagnostic toggle
  And cataloged events keep their existing presenters and tiers

Scenario: R8 — Cataloged event behavior is unchanged
  Given an event name registered in the catalog
  When that event is emitted and persisted
  Then its catalog entry's renderer, tier, and payload policy still apply
  And no duplicate row is written by a catch-all path

Scenario: R9 — Uncataloged ingestion still isolates failures
  Given persisting an uncataloged event will fail
  When the event is emitted
  Then the emit path continues normally
  And the failure is logged, never thrown to the producer

Scenario: R10 — Uncataloged rows respect retention
  Given uncataloged events of one prefix exceed the resolved retention quota
  When retention is applied
  Then that prefix is pruned to its quota
  And other prefixes are untouched

Scenario: R11 — A drift audit names every emitted-but-uncataloged event
  Given producers emit events not registered in the catalog
  When the drift audit runs
  Then it reports each uncataloged event name it observed
  And the report is consumable as a promotion list for catalog entries
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-07T04:09:06.130Z

**Q1 — How does a catch-all avoid double-writing cataloged events (R8)?**
**Closed: the wrapper is name-gated, not a second subscriber.** `installSystemEventCatchAll` wraps
`bus.emit` and persists **only** when `systemEventCatalogEntry(name)` returns `undefined`. Cataloged
names fall through untouched to the per-name handlers `registerSystemEventTap` already registered
(`system-event-tap.ts:68`), so exactly one path writes each row. Diagnostic-tier cataloged names stay
gated by `diagnosticEnabled` (`:73`) — the catch-all must **not** rescue them, or the toggle becomes
meaningless.

**Q2 — Does R10 work with the existing retention code?**
**Closed: no — one seam changes.** `resolveRetentionQuotas`
(`system-event-retention.ts:34-43`) enumerates `SYSTEM_EVENT_PREFIXES` only, so an uncataloged prefix
gets **no quota row** and `pruneQuotas` (`system-event-dao.ts:268`) never bounds it. Chosen fix:
at the uncataloged persist site, ensure the quota list carries the row's prefix before pruning —
append `{ prefix, quota: config.default ?? DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA }` when absent.
**Rejected:** widening `resolveRetentionQuotas` to accept arbitrary prefixes — that would dissolve
its deliberate typo-guard for operator **config override keys**, which stays. The guard protects
config input; this fix bounds observed emissions. The satellite's "no new config shape" claim
survives (no config change); its "already resolves through the existing fallback" claim does not,
and is corrected in Background.

**Q3 — Does R7 need a Board change?**
**Closed: no code, yes test.** `tierFilter` defaults to `'all'` (`SystemEventsTab.tsx:205`), the tier
post-filter is skipped entirely at `'all'` (`:622`), and `'default'` explicitly admits an
**undefined** tier (`:625`). `tierByName` is built from catalog entries only (`:822-825`), so
uncataloged names resolve to `undefined`. Server-side, `names` is a client-supplied filter
(`apps/server/src/modules/events/index.ts:266-270`) that `serializeFilter` populates only from a user
search query (`SystemEventsTab.tsx:582`) — never a catalog allow-list. R7 ships as a regression test
pinning this behavior, so a future tier refactor cannot silently re-close the Board.

**Q4 — Where does the wrapper attach, and is it idempotent?**
**Closed: once per process, at each existing attach point** — server boot beside
`registerSystemEventTap` (`apps/server/src/serve.ts:499`) and the CLI ledger attach
(`apps/cli/src/system-event-ledger.ts`). Idempotence is a marker property on the wrapped `emit`:
re-installing is a no-op. Holders call `bus.emit(...)` dynamically, so prior references see the
wrapper.

**Q5 — Severity for an uncataloged event?**
**Closed: the payload's own `severity` when present, else `info`** (ADR-110). ts-libs stamp
`WithEventSeverity` at emit time; nothing is inferred from the name.

**Deferred:** live SSE streaming of uncataloged events — blocked on an upstream ts-infra
`onAny`/wildcard seam; explicitly out of scope (ADR-110 accepted limitation). Revisit when that
lands. Owner: whoever schedules the ts-infra follow-up.

### Design

**WHAT/WHY.** Stop the catalog from acting as an ingestion gate: every emitted event name persists,
with the catalog retained as the **presentation/promotion** layer (ADR-110). WHY: catalog-closed
ingestion silently drops upstream ts-libs emissions (`db.connected`, `db.connection.error`) and all
future drift, making the board incomplete by construction.

**WHERE (primary targets).**

| File | Change |
| --- | --- |
| `packages/app/src/services/` (new module) | `genericSystemEventCatalogEntry(name)` + `installSystemEventCatchAll(bus, sink)` |
| `packages/app/src/index.ts` | export both new symbols beside the existing system-event surface (`:125-132`) |
| `packages/app/src/services/system-event-emitter.ts:61-63` | replace the unregistered-name early return with the generic-entry path |
| `apps/server/src/serve.ts:499` | install the catch-all beside `registerSystemEventTap`, same DAO / quotas / secrets / project context |
| `apps/cli/src/system-event-ledger.ts` | install the same wrapper at the CLI ledger attach |
| `docs/design/observabilities-module-polish.md` | correct the R10 mechanism claim (see D3c) |

**Frozen names.** `genericSystemEventCatalogEntry(name: string): SystemEventCatalogEntry`,
`installSystemEventCatchAll(bus: SystemEventBus, sink: SystemEventSink): SystemEventCatchAll`.
Reused unchanged: `systemEventCatalogEntry`, `SYSTEM_EVENT_CATALOG`, `buildSystemEventEnvelope`,
`extractSystemEventActor`, `extractSystemEventCorrelation`, `safeStringify`, `createId('sev')`,
`resolveRetentionQuotas`, `DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA`, `SystemEventDao.pruneQuotas`.
Warn-log event name: `system_events.uncataloged`. Renderer literal: `generic`. **No** new config key,
contract, DTO, or migration.

**D3a — generic entry (R5, R6).** `prefix` = the name's first dot-segment; `renderer` = `generic`;
`tier` = the default (non-diagnostic) tier; `severity` = the payload's own `severity` field when
present, else `info`; payload policy = the same normalization + configured-secret redaction the
cataloged path uses (`buildSystemEventEnvelope`). Nothing is inferred from the name beyond the prefix.

**D3b — catch-all wrapper (R8, R9).** Idempotently wrap `bus.emit` at the attach point (marker
property; re-install is a no-op). On each emit, look up `systemEventCatalogEntry(name)`: **present ⇒
do nothing** (the tap/emitter owns it — this is the whole of R8's no-duplicate guarantee); absent ⇒
persist through the sink using D3a, then warn-log `system_events.uncataloged` **once per name per
process**. Persist errors are caught, logged, and swallowed (R9) — the wrapper always returns the
underlying `emit`'s result.

**D3c — retention for uncataloged prefixes (R10) — the one non-obvious seam.**
`resolveRetentionQuotas` (`system-event-retention.ts:34-43`) enumerates `SYSTEM_EVENT_PREFIXES` only,
so an uncataloged prefix is currently **unbounded**. At the uncataloged persist site, ensure the
quota list carries the row's prefix before calling `pruneQuotas` — append
`{ prefix, quota: config.default ?? DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA }` when absent, then prune
**scoped to that prefix** so overflow never evicts another prefix's rows. `resolveRetentionQuotas`'s
typo-guard for operator config **override keys** is unchanged (Q&A Q2).

**D4 — drift audit (R11).** Derived, not stored: (a) once-per-name `system_events.uncataloged` warn
logs, (b) `renderer = 'generic'` ledger rows reachable through the history endpoint's catalog
metadata. The satellite documents the query as the promotion list; a dedicated CLI verb is deferred.

**Anti-patterns — do not implement.**

- Do **not** register a second per-name subscriber or a `SYSTEM_EVENT_CATALOG` loop in the catch-all —
  that is how R8 duplicates get written.
- Do **not** let the catch-all persist **cataloged diagnostic-tier** names when `diagnosticEnabled`
  is false; that would silently defeat the toggle (`system-event-tap.ts:73`).
- Do **not** widen `resolveRetentionQuotas` to accept arbitrary prefixes (dissolves its config
  typo-guard) — bound the prefix at the persist site instead (D3c).
- Do **not** add an `onAny`/wildcard to ts-infra, or vendor a patched copy, to get live streaming.
- Do **not** add a config key, DB column, or migration; the generic entry is synthesized at runtime.
- Do **not** infer severity from the event name, and do **not** bypass `buildSystemEventEnvelope`
  (that is the redaction path R5 depends on).
- Do **not** change `SystemEventsTab`'s tier post-filter for R7 — it already admits undefined tiers
  (Q&A Q3); pin it with a test instead.

**Handoff / cross-task.** `0793` owns naming + time-range plumbing in `apps/web`, including
`SystemEventsTab.tsx`'s range props. This task touches `SystemEventsTab.tsx` only if the R7 test
requires it. `dependencies[]` is empty; either order lands.

### Plan

- [ ] 1. **(R5, R6)** Add `genericSystemEventCatalogEntry(name)` in `packages/app/src/services/`;
      unit-test prefix derivation, `generic` renderer, default tier, severity precedence
      (payload `severity` → else `info`), and that redaction runs via `buildSystemEventEnvelope`.
- [ ] 2. **(R8, R9)** Add `installSystemEventCatchAll(bus, sink)` in the same module: idempotent
      `emit` wrap, cataloged names pass through untouched, uncataloged names persist,
      once-per-name-per-process `system_events.uncataloged` warn, persist errors logged + swallowed.
- [ ] 3. **(R10)** Bound the uncataloged prefix at the persist site — append
      `{ prefix, quota: default }` to the quota list when absent, then `pruneQuotas(quotas, prefix)`.
      DAO test (in-memory SQLite): an uncataloged prefix past quota prunes to quota; a second prefix
      is untouched. Leave `resolveRetentionQuotas`'s config typo-guard alone.
- [ ] 4. **(R6)** Remove the unregistered-name early return in
      `system-event-emitter.ts:61-63`; route absent-entry names through the D3a generic path.
- [ ] 5. **(R5)** Install the wrapper at server boot (`apps/server/src/serve.ts:499`) with the same
      DAO/quotas/secrets/project context, and at the CLI ledger attach
      (`apps/cli/src/system-event-ledger.ts`).
- [ ] 6. **(R7)** Add the regression test pinning default Board visibility of an undefined-tier row
      (`tierFilter: 'all'` and `'default'` both admit it) so a later tier refactor cannot re-close it.
      No production web change expected.
- [ ] 7. **(R11)** Document the promotion-list query (warn logs + `renderer='generic'` rows) in
      `docs/design/observabilities-module-polish.md`, and correct that file's R10 mechanism claim to
      match D3c.
- [ ] 8. **Verify:** `bun test` from inside `packages/app`, `apps/server`, `apps/cli`, and `apps/web`;
      then the root gate `bun run spur-check`. Record commands and outcomes in Testing.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
| ---------------------- |
| `apps/cli/src/system-event-ledger.ts:109` |
| `apps/cli/src/system-event-ledger.ts:19` |
| `apps/cli/src/system-event-ledger.ts:23` |
| `apps/cli/src/system-event-ledger.ts:71` |
| `apps/cli/src/system-event-ledger.ts:79` |
| `apps/cli/tests/system-event-ledger.test.ts:220` |
| `apps/server/src/serve.ts:11` |
| `apps/server/src/serve.ts:507` |
| `apps/server/src/serve.ts:6` |
| `apps/server/tests/upstream-system-events-wiring.test.ts:6` |
| `apps/server/tests/upstream-system-events-wiring.test.ts:606` |
| `apps/server/tests/upstream-system-events-wiring.test.ts:8` |
| `apps/web/src/modules/observability/JobsTab.tsx:133` |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:14` |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:161` |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:195` |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:47` |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:118` |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:2` |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:66` |
| `apps/web/src/modules/observability/RoutingTab.tsx:228` |
| `apps/web/src/modules/observability/RoutingTab.tsx:235` |
| `apps/web/src/modules/observability/RoutingTab.tsx:242` |
| `apps/web/src/modules/observability/RoutingTab.tsx:253` |
| `apps/web/src/modules/observability/RoutingTab.tsx:4` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:1010` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:1011` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:575` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:587` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:600` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:604` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:773` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:907` |
| `apps/web/src/modules/observability/index.tsx:14` |
| `apps/web/src/modules/observability/tabs.ts:22` |
| `apps/web/src/modules/observability/tabs.ts:30` |
| `apps/web/tests/modules/observability.test.ts:23` |
| `apps/web/tests/modules/observability/components.test.tsx:1030` |
| `apps/web/tests/modules/observability/components.test.tsx:1086` |
| `apps/web/tests/modules/observability/components.test.tsx:1142` |
| `apps/web/tests/modules/observability/components.test.tsx:1153` |
| `apps/web/tests/modules/observability/components.test.tsx:1924` |
| `apps/web/tests/modules/observability/components.test.tsx:1957` |
| `apps/web/tests/modules/observability/components.test.tsx:1959` |
| `apps/web/tests/modules/observability/components.test.tsx:1961` |
| `apps/web/tests/modules/observability/components.test.tsx:1962` |
| `apps/web/tests/modules/observability/components.test.tsx:1966` |
| `apps/web/tests/modules/observability/components.test.tsx:2002` |
| `apps/web/tests/modules/observability/components.test.tsx:2081` |
| `apps/web/tests/modules/observability/components.test.tsx:2122` |
| `apps/web/tests/modules/observability/components.test.tsx:2362` |
| `apps/web/tests/modules/observability/components.test.tsx:2464` |
| `apps/web/tests/modules/observability/components.test.tsx:277` |
| `apps/web/tests/modules/observability/components.test.tsx:282` |
| `apps/web/tests/modules/observability/components.test.tsx:304` |
| `apps/web/tests/modules/observability/components.test.tsx:33` |
| `apps/web/tests/modules/observability/components.test.tsx:337` |
| `apps/web/tests/modules/observability/components.test.tsx:352` |
| `apps/web/tests/modules/observability/components.test.tsx:378` |
| `apps/web/tests/modules/observability/components.test.tsx:394` |
| `apps/web/tests/modules/observability/components.test.tsx:424` |
| `apps/web/tests/modules/observability/components.test.tsx:448` |
| `apps/web/tests/modules/observability/components.test.tsx:463` |
| `apps/web/tests/modules/observability/components.test.tsx:481` |
| `apps/web/tests/modules/observability/components.test.tsx:516` |
| `apps/web/tests/modules/observability/components.test.tsx:574` |
| `apps/web/tests/modules/observability/components.test.tsx:587` |
| `apps/web/tests/modules/observability/components.test.tsx:619` |
| `apps/web/tests/modules/observability/components.test.tsx:641` |
| `apps/web/tests/modules/observability/components.test.tsx:651` |
| `apps/web/tests/modules/observability/components.test.tsx:658` |
| `apps/web/tests/modules/observability/components.test.tsx:661` |
| `apps/web/tests/modules/observability/components.test.tsx:695` |
| `apps/web/tests/modules/observability/components.test.tsx:697` |
| `apps/web/tests/modules/observability/components.test.tsx:717` |
| `apps/web/tests/modules/observability/components.test.tsx:719` |
| `apps/web/tests/modules/observability/components.test.tsx:723` |
| `apps/web/tests/modules/observability/components.test.tsx:731` |
| `apps/web/tests/modules/observability/components.test.tsx:737` |
| `apps/web/tests/modules/observability/components.test.tsx:758` |
| `apps/web/tests/modules/observability/components.test.tsx:779` |
| `apps/web/tests/modules/observability/components.test.tsx:803` |
| `apps/web/tests/modules/observability/components.test.tsx:824` |
| `apps/web/tests/modules/observability/components.test.tsx:858` |
| `apps/web/tests/modules/observability/components.test.tsx:912` |
| `apps/web/tests/modules/observability/components.test.tsx:972` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:120` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:159` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:187` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:218` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:244` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:264` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:105` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:12` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:136` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:181` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:2` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:210` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:222` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:234` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:238` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:127` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:171` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:192` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:221` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:233` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:253` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:269` |
| `apps/web/tests/modules/observability/system-events-tab.test.ts:3` |
| `apps/web/tests/modules/observability/system-events-tab.test.ts:409` |
| `apps/web/tests/modules/observability/system-events-tab.test.ts:7` |
| `packages/app/src/index.ts:374` |
| `packages/app/src/services/system-event-emitter.ts:19` |
| `packages/app/src/services/system-event-emitter.ts:26` |
| `packages/app/src/services/system-event-emitter.ts:46` |
| `packages/app/src/services/system-event-emitter.ts:59` |
| `packages/app/src/services/system-event-emitter.ts:66` |
| `packages/app/src/services/system-event-emitter.ts:86` |
| `packages/app/tests/services/system-event-emitter.test.ts:10` |
| `packages/app/tests/services/system-event-emitter.test.ts:165` |
| `packages/app/tests/services/system-event-emitter.test.ts:173` |
| `packages/app/tests/services/system-event-emitter.test.ts:178` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R5 | MET | Server install beside the tap with the same DAO/quotas/secrets/project context: `apps/server/src/serve.ts:511-520`. Generic entry (prefix = first dot-segment `:69`, renderer `generic` `:75`, tier default, severity `info`): `packages/app/src/services/system-event-catch-all.ts:66-87`. Persist through the standard envelope path (normalization + configured-secret redaction via `buildSystemEventEnvelope`): `system-event-catch-all.ts:127-142` (`:136`). Tests (passed this run): `apps/server/tests/upstream-system-events-wiring.test.ts:607-637` (uncataloged row persisted, schemaVersion 2, payload severity honored) and `packages/app/tests/services/system-event-catch-all.test.ts:112-165` (row fields + secret redacted from `payload_json`). |
| R6 | MET | Early return replaced by the generic-entry fallback: `packages/app/src/services/system-event-emitter.ts:70`. Catch-all installed at the CLI ledger attach and drained on flush: `apps/cli/src/system-event-ledger.ts:82-90,107-111`. History endpoint renders uncataloged rows with the generic renderer: `apps/server/src/modules/events/index.ts:328` (`?? 'generic'`; also SSE `:215`). Tests (passed this run): `packages/app/tests/services/system-event-emitter.test.ts:165-192` (unregistered planning event persisted, D3c quota append asserted) and `apps/cli/tests/system-event-ledger.test.ts:220-248` (uncataloged bus event persists after `ledger.flush()`). |
| R7 | MET | Regression test pinning default Board visibility of an undefined-tier row: `apps/web/tests/modules/observability/system-events-tab.test.ts:410-444` (default filters admit it `:429-431`; `'default'` admits it while gating a diagnostic name `:433-439`; a cataloged default-tier row stays admitted `:441-443`). Pinned to the real implementation: `apps/web/src/modules/observability/SystemEventsTab.tsx:622-625` (`'all'` skips the filter; `'default'` admits `entryTier === undefined`), `tierByName` built from catalog entries only `:814-820`, exported pure helper `:604` (behavior-inert `export`, the only 0794 web production delta). No tier-filter production change — per Q&A Q3. Suite passed this run (35 pass). |
| R8 | MET | Name-gated wrapper, not a second subscriber: sink invoked only when `systemEventCatalogEntry(event) === undefined`, cataloged names pass to the untouched bound emit — `packages/app/src/services/system-event-catch-all.ts:183-199` (gate at `:186`); re-install no-op via marker `:179-181,201`. Diagnostic-tier cataloged `bus.emit.done` not rescued. Tests (passed this run): `packages/app/tests/services/system-event-catch-all.test.ts:277-298` (cataloged + diagnostic names never sunk), composition single-write `apps/server/tests/upstream-system-events-wiring.test.ts:621-622` (1 row) and `apps/cli/tests/system-event-ledger.test.ts:250-273` (1 row). Cataloged emitter path unchanged (identical quotas array returned by `ensureRetentionQuotaForPrefix` for a present prefix). |
| R9 | MET | Sink persist failures warn-logged and swallowed: `packages/app/src/services/system-event-catch-all.ts:144-149`. Wrapper detaches the persist, guards with a last-resort `.catch(() => {})`, and always returns the underlying emit result: `:188-199`. Emitter failure isolation unchanged: `packages/app/src/services/system-event-emitter.ts:92-99`. Tests (passed this run): `packages/app/tests/services/system-event-catch-all.test.ts:238-253` (persist failure swallowed, drift warn skipped) and `:333-341` (rejected sink never breaks emit). |
| R10 | MET | Persist-site quota ensure + prune scoped to the written prefix: `packages/app/src/services/system-event-catch-all.ts:92-99` (`ensureRetentionQuotaForPrefix`) and `:143`; same seam at the emitter: `packages/app/src/services/system-event-emitter.ts:88-91`. `resolveRetentionQuotas` is NOT in the diff — its config typo-guard is intact: `packages/app/src/services/system-event-retention.ts:31-44`. Real-DAO test (in-memory SQLite, passed this run): `packages/app/tests/services/system-event-catch-all.test.ts:383-428` (uncataloged prefix pruned to quota 3, newest kept, other prefix untouched) + typo-guard test `:210-222`. |
| R11 | MET | Drift signal: warn event name constant `system_events.uncataloged` — `packages/app/src/services/system-event-catch-all.ts:44`; once per name per sink at first successful persist `:151-154` (dedup Set `:125`). `renderer='generic'` rows queryable through the history endpoint's catalog metadata: `apps/server/src/modules/events/index.ts:328`. Promotion-list query documented and the D3c retention claim corrected: `docs/design/observabilities-module-polish.md:69-80` (D4) and `:57-60` (D3c). Tests (passed this run): `apps/cli/tests/system-event-ledger.test.ts:220-248` (exactly 1 drift warn across 2 same-name emissions) and `packages/app/tests/services/system-event-catch-all.test.ts:224-236` (once per name across retries). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R5 — An uncataloged event emitted on the server bus is persisted | MET | test | `apps/server/tests/upstream-system-events-wiring.test.ts:607-637` (row persisted with emitted name, schemaVersion 2, redacted envelope) + suite run green this run + `apps/server/src/serve.ts:511-520`, `packages/app/src/services/system-event-catch-all.ts:66-87,127-143`. |
| R6 — An uncataloged planning event emitted from the CLI is persisted | MET | test | `packages/app/tests/services/system-event-emitter.test.ts:165-192` and `apps/cli/tests/system-event-ledger.test.ts:220-248` (persisted after flush, not dropped) + suites green this run + `packages/app/src/services/system-event-emitter.ts:70`, `apps/cli/src/system-event-ledger.ts:82-90`, history renderer `apps/server/src/modules/events/index.ts:328`. |
| R7 — Uncataloged events are visible by default on the Board | MET | test | `apps/web/tests/modules/observability/system-events-tab.test.ts:410-444` (default and `'default'` filters admit an undefined-tier row; diagnostic still gated; cataloged default-tier admitted) + suite green this run (35 pass) + `apps/web/src/modules/observability/SystemEventsTab.tsx:622-625,814-820`. |
| R8 — Cataloged event behavior is unchanged | MET | test | `packages/app/tests/services/system-event-catch-all.test.ts:277-298`, `apps/server/tests/upstream-system-events-wiring.test.ts:616-622` (cataloged row exactly 1), `apps/cli/tests/system-event-ledger.test.ts:250-273` (no duplicate) + suites green this run + name gate `packages/app/src/services/system-event-catch-all.ts:186-199`, marker no-op `:179-181,201`; `packages/app/src/services/system-event-tap.ts` untouched. |
| R9 — Uncataloged ingestion still isolates failures | MET | test | `packages/app/tests/services/system-event-catch-all.test.ts:238-253,333-341` (persist failure swallowed; emit resolves; never thrown to producer) + suite green this run + `packages/app/src/services/system-event-catch-all.ts:144-149,188-199`, `packages/app/src/services/system-event-emitter.ts:92-99`. |
| R10 — Uncataloged rows respect retention | MET | test | `packages/app/tests/services/system-event-catch-all.test.ts:383-428` (real in-memory SQLite DAO: uncataloged prefix pruned to quota 3, other prefix untouched at 6) and `:210-222` (typo-guard intact) + suite green this run + `packages/app/src/services/system-event-catch-all.ts:92-99,143`, `packages/app/src/services/system-event-emitter.ts:88-91`, `packages/app/src/services/system-event-retention.ts:31-44` (unchanged). |
| R11 — A drift audit names every emitted-but-uncataloged event | MET | test | `apps/cli/tests/system-event-ledger.test.ts:220-248` (exactly 1 `system_events.uncataloged` warn for 2 same-name emissions) and `packages/app/tests/services/system-event-catch-all.test.ts:224-236` + suites green this run + `packages/app/src/services/system-event-catch-all.ts:44,151-154`, `apps/server/src/modules/events/index.ts:328`, promotion-list doc `docs/design/observabilities-module-polish.md:69-80`. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: **PASS with findings** (all P4; no P1–P3). Three-dimensional review of the uncommitted 0794 working-tree changes (functional traceability + SECUA + architecture), run with `--auto`. Scope: the 0794 files (`packages/app` catch-all module + emitter reroute, `apps/server/src/serve.ts`, `apps/cli/src/system-event-ledger.ts`, apps/web R7 regression test, `docs/design/observabilities-module-polish.md`) — 0793's web changes reviewed separately and excluded from traceability. All `file:line` evidence re-read this run (including the pi-lens-reformatted `system-event-catch-all.ts`, `system-event-catch-all.test.ts`, `system-events-tab.test.ts`).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | SECUA (usability/honesty) | `apps/web/src/modules/observability/SystemEventsTab.tsx:601-604` | Q3 closed as "no code, yes test", but `matchesClientFilter` gained an `export` keyword + JSDoc so the R7 test can import it. Behavior-inert (tier-filter logic byte-identical; `DEFAULT_FILTER` was already exported), and it improves the test surface (pure function, no DOM render). Letter-vs-spirit deviation from Q3 worth recording. |
| P4 | SECUA (correctness) | `packages/app/src/services/system-event-catch-all.ts:69` | `name.split('.')[0] ?? name` — `?? name` is unreachable (`split` never returns an empty array); an empty-string event name would persist an empty prefix row. Pathological input only; no impact on realistic emissions. |
| P4 | SECUA (correctness, pre-existing) | `apps/server/src/serve.ts:511-517` | Server path discards the `SystemEventCatchAll` handle, so in-flight uncataloged persists are not drained on shutdown. Matches the pre-existing tap pattern (the tap handle is discarded too, `serve.ts:504-508`; best-effort per the comment at `serve.ts:495-497`). The CLI path does drain both (`apps/cli/src/system-event-ledger.ts:108-111`). No asymmetry introduced by 0794. |
| P4 | Architecture (note) | `packages/app/src/services/system-event-catch-all.ts:125` | Drift-warn dedup `Set` is per-sink ("≈ per process", documented at `:117`). Two buses in one process would each warn once — arguably correct per bus; noted for awareness only. |

#### Per-requirement traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R5 | MET | `apps/server/src/serve.ts:511-517` — catch-all installed beside the tap with the same DAO/quotas/secrets/project context; `packages/app/src/services/system-event-catch-all.ts:66-85` — generic entry (`prefix: name.split('.')[0]` `:69`, renderer `generic` `:41`); `:128-146` — insert via `buildSystemEventEnvelope` (normalization + configured-secret redaction). Tests: `apps/server/tests/upstream-system-events-wiring.test.ts:607-637` (uncataloged row persisted, schemaVersion 2) and `packages/app/tests/services/system-event-catch-all.test.ts:152` (secret redacted from `payload_json`) — both passed this run. |
| R6 | MET | `packages/app/src/services/system-event-emitter.ts:70` — `systemEventCatalogEntry(event.event) ?? genericSystemEventCatalogEntry(event.event)` replaces the early return; `apps/cli/src/system-event-ledger.ts:82-91` — catch-all at the CLI ledger attach; `apps/server/src/modules/events/index.ts:328` — history endpoint renders uncataloged rows with `?? 'generic'` (pre-existing read-side fallback, unchanged). Tests: `packages/app/tests/services/system-event-emitter.test.ts:165` (unregistered planning event persists) and `apps/cli/tests/system-event-ledger.test.ts:220` (uncataloged bus event persists after `ledger.flush()`) — both passed. |
| R7 | MET (test only, per Q3) | `apps/web/tests/modules/observability/system-events-tab.test.ts:410-443` — default filters admit an undefined-tier row (`:429`), `'default'` admits it while gating a diagnostic name (`:433`), cataloged default-tier row still admitted (`:441`); behavior pinned to the real implementation `apps/web/src/modules/observability/SystemEventsTab.tsx:622-625` (`'all'` skips; `'default'` admits `entryTier === undefined`). Suite passed (35 pass). No tier-filter production change. |
| R8 | MET | Name-gate: `system-event-catch-all.ts:186` — sink invoked only when `systemEventCatalogEntry(event) === undefined`; cataloged names pass to the untouched bound emit (`:183-199`). Diagnostic-tier cataloged `bus.emit.done` (`packages/app/src/services/event-names.ts:347`) is not rescued — asserted at `system-event-catch-all.test.ts:277-309`. Composition single-write: `upstream-system-events-wiring.test.ts:607-637` (`task.created` → 1 row) and `system-event-ledger.test.ts:250-272` (`workflow.run.started` → 1 row) — passed. Server tap and catch-all share one catalog (`apps/server/src/modules/events/system-event-tap.ts:1-6` re-exports the app module), so the gate and the tap cannot disagree. |
| R9 | MET | Sink: `system-event-catch-all.ts:144-148` — persist errors warn-logged and swallowed; wrapper: `:190-198` — detached persist with a last-resort `.catch(() => {})`, always returns the underlying emit's result (`:199`). Tests: `system-event-catch-all.test.ts:238` (persist failure swallowed, drift warn skipped) and `:333` (rejected sink never breaks emit) — passed. Emitter failure isolation unchanged (`system-event-emitter.ts:93-102`). |
| R10 | MET | Persist-site quota ensure: `system-event-catch-all.ts:93-95` (`ensureRetentionQuotaForPrefix` appends `{ prefix, quota: fallback }` only when absent) and `:143` (prune scoped to the written prefix); emitter: `system-event-emitter.ts:62, 87-91`. `resolveRetentionQuotas` (`packages/app/src/services/system-event-retention.ts:34-45`) is NOT in the diff — its typo-guard (`:31-32`) is intact. Real-DAO test `system-event-catch-all.test.ts:383` (uncataloged prefix pruned to quota 3, other prefix untouched, in-memory SQLite) and typo-guard test `:183` — passed. |
| R11 | MET | `system-event-catch-all.ts:44` (`system_events.uncataloged`), `:151-155` (once per name per sink at first successful persist); `renderer='generic'` rows → history endpoint `apps/server/src/modules/events/index.ts:215,328`. Doc: `docs/design/observabilities-module-polish.md` D4 rewritten with the two-artifact promotion list and the corrected D3c retention mechanism. Test: `system-event-ledger.test.ts:220-248` — exactly 1 drift warn across 2 emissions of the same name — passed. |

#### Q&A closed decisions — honored

| Decision | Verdict | Evidence |
| --- | --- | --- |
| Q1 name-gated wrapper, not a second subscriber | Honored | `system-event-catch-all.ts:186` gate; wrapper contains no `bus.on`/catalog loop; tap untouched. |
| Q2 quota-append at persist site, NOT `resolveRetentionQuotas` widening | Honored | `system-event-catch-all.ts:93-95,143`; `system-event-emitter.ts:87-91`; `system-event-retention.ts` absent from `git diff --stat`. |
| Q3 R7 = test only | Honored (one P4 letter deviation) | Tier-filter logic unchanged (`SystemEventsTab.tsx:622-625`); sole prod-web delta is the behavior-inert `export` on `matchesClientFilter` (`:601-604`). |
| Q4 idempotent marker at both attach points | Honored | Marker `system-event-catch-all.ts:159,201`; re-install no-op (`:179-181`); installs at `serve.ts:511` and `system-event-ledger.ts:82`; test `system-event-catch-all.test.ts:312` passed. |
| Q5 payload severity else info | Honored | Entry severity fixed `info` (`system-event-catch-all.ts:78`); envelope precedence `extractSeverity(payload) ?? entry.severity ?? 'warning'` (`system-event-envelope.ts:206`); invalid severity falls to info — tests at `system-event-catch-all.test.ts` (Q5) and `upstream-system-events-wiring.test.ts:633-636` passed. No name-inferred severity. |

#### Anti-patterns — avoided

- No second subscriber / catalog loop in the catch-all (verified `system-event-catch-all.ts` full read).
- No diagnostic-tier rescue (`bus.emit.done` diagnostic name asserted non-sunk).
- No `resolveRetentionQuotas` widening (file not in diff).
- No `onAny`/wildcard or ts-infra change (`EventBus` exposes only exact-name handler maps; `node_modules` untouched).
- No new config key, contract, DTO, or migration (no `drizzle/`, `packages/contracts/`, or config files in the diff).
- No `buildSystemEventEnvelope` bypass at either persist site.
- No `SystemEventsTab` tier-filter change (0793's time-range plumbing in that file is out of 0794 scope and leaves the tier path identical).

#### SECUA summary

Security: redaction intact — both attach points plumb `configuredSecretValues` (`serve.ts:515`, `system-event-ledger.ts:85-88`); envelope path applies SECRET_KEY key redaction + `redactAndBound`; drift/persist-failure warn logs carry only name + error string, never payload. Correctness: marker idempotence, detached persists with in-flight tracking and a terminating flush loop, `current.bind(bus)` preserves the receiver; `EventBus.emit` is a prototype async method (`ts-infra/src/event-bus/event-bus.ts:95`), so the instance own-property shadowing reaches all dynamic `bus.emit(...)` call sites (Q4). Tests are honest: 87 tests across the four suites passed fresh this run; `tsc --noEmit` exit 0 in packages/app, apps/server, apps/cli.

#### Architecture

`system-event-catch-all.ts` is a deep module: a two-symbol frozen surface (`genericSystemEventCatalogEntry`, `installSystemEventCatchAll` — exported once at `packages/app/src/index.ts:382-383`) over a real body (entry synthesis, shared sink factory, idempotent emit wrap). Both attach points compose the same factory — no duplicated envelope/retention logic; frozen helper reuse (`buildSystemEventEnvelope`, `extractSystemEventActor/Correlation`, `safeStringify`, `createId('sev')`, `DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA`, `pruneQuotas`) is exact. `ensureRetentionQuotaForPrefix` is one concept with one spelling shared by emitter and sink. The `matchesClientFilter` export slightly improves web testability. No speculative abstraction, no shallow pass-through, no coupling regressions.

#### Commands run (this review)

- `cd packages/app && bun test tests/services/system-event-catch-all.test.ts tests/services/system-event-emitter.test.ts` → 29 pass, 0 fail.
- `cd apps/server && bun test tests/upstream-system-events-wiring.test.ts` → 13 pass, 0 fail.
- `cd apps/cli && bun test tests/system-event-ledger.test.ts` → 10 pass, 0 fail.
- `cd apps/web && bun test tests/modules/observability/system-events-tab.test.ts` → 35 pass, 0 fail.
- `bun run typecheck` in packages/app, apps/server, apps/cli → exit 0 each.

Residual risk: server-path in-flight uncataloged persists are not drained on shutdown (pre-existing best-effort pattern, P4); a pathological empty-string event name persists an empty-prefix row (P4).

### References

- ADR: `docs/00_ADR.md:2301` — **ADR-110** System-Event Ingestion Is Catalog-Open, Presentation Stays Cataloged (Proposed, 2026-09-07)
- Feature: `docs/features/J31_observabilities-module-polish-header-naming-shell-level-time-range-catalog-open-event-ingestion.md` (R5–R11)
- Design satellite: `docs/design/observabilities-module-polish.md` — D3 (catch-all persist), D4 (drift audit). **Its R10 "existing per-prefix quota fallback" claim is corrected by D3c here.**
- Ingestion seams: `packages/app/src/services/system-event-tap.ts:51,68,73` · `packages/app/src/services/system-event-emitter.ts:61-63`
- Retention seam: `packages/app/src/services/system-event-retention.ts:34-43` · `packages/domain/src/dao/system-event-dao.ts:268`
- Board visibility seam: `apps/web/src/modules/observability/SystemEventsTab.tsx:205,622-625,822-825` · `apps/server/src/modules/events/index.ts:266-270,305`
- Sibling task: `0793` — naming + shell time range (shares `SystemEventsTab.tsx` only)

### History

- 2026-09-07T06:24:41.333Z todo → wip (system)
- 2026-09-07T07:20:25.995Z wip → testing (system)
- 2026-09-07T07:23:27.390Z testing → done (system)
