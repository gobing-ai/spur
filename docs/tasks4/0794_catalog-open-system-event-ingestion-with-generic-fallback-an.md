---
schema_version: 1
name: Catalog-open system-event ingestion with generic fallback and drift signal
status: todo
template: feature-impl
created_at: 2026-09-07T03:53:27.194Z
updated_at: "2026-09-07T04:09:06.627Z"
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
- [ ] R5. An uncataloged event emitted on the **server** bus persists a `system_events` row with the
      emitted name, a prefix derived from the name's first dot-segment, and the standard
      normalization + configured-secret redaction path.
- [ ] R6. An uncataloged planning event reaching the **CLI** `SystemEventEmitter` persists instead of
      being dropped, and renders on the history endpoint with the `generic` renderer.
- [ ] R7. Uncataloged events are visible on the System Events tab under **default** filters, with no
      diagnostic toggle; cataloged events keep their presenters and tiers. (Verified by test — the
      existing client tier post-filter already admits undefined-tier rows; see Background.)
- [ ] R8. Cataloged event behavior is byte-unchanged, and the catch-all writes **no duplicate row**
      for any name the tap or emitter already owns.
- [ ] R9. Catch-all persist failures are logged and swallowed — never thrown to the producer, never
      aborting the emit path.
- [ ] R10. An uncataloged prefix is bounded by the **default** retention quota and pruned to it;
      pruning one prefix leaves other prefixes untouched.
- [ ] R11. A drift audit surface reports each observed uncataloged event name as a promotion list:
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- ADR: `docs/00_ADR.md:2301` — **ADR-110** System-Event Ingestion Is Catalog-Open, Presentation Stays Cataloged (Proposed, 2026-09-07)
- Feature: `docs/features/J31_observabilities-module-polish-header-naming-shell-level-time-range-catalog-open-event-ingestion.md` (R5–R11)
- Design satellite: `docs/design/observabilities-module-polish.md` — D3 (catch-all persist), D4 (drift audit). **Its R10 "existing per-prefix quota fallback" claim is corrected by D3c here.**
- Ingestion seams: `packages/app/src/services/system-event-tap.ts:51,68,73` · `packages/app/src/services/system-event-emitter.ts:61-63`
- Retention seam: `packages/app/src/services/system-event-retention.ts:34-43` · `packages/domain/src/dao/system-event-dao.ts:268`
- Board visibility seam: `apps/web/src/modules/observability/SystemEventsTab.tsx:205,622-625,822-825` · `apps/server/src/modules/events/index.ts:266-270,305`
- Sibling task: `0793` — naming + shell time range (shares `SystemEventsTab.tsx` only)
### History
