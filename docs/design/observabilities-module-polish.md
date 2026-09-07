# Observabilities module polish — shell naming, shell-level time range, catalog-open ingestion

Feature: **J31** · Status: proposed · Date: 2026-09-07

## Problem

1. The module header reads `Observability`; the sidebar label reads `Observabilities`
   (`apps/web/src/modules/observability/index.tsx:18`).
2. The time-range selector renders only inside System Events (`ObservabilityFilters`), while
   `ObservabilityShell` already owns `timeRange` state and passes it to every tab. Routing ignores
   the prop entirely even though `GET /api/observability/routing-summary` accepts `since`/`until`
   (`apps/server/src/modules/observability/index.ts:216`). History already demonstrates the target
   pattern: `HistoryShell` owns the filter and renders `HistoryFilters` for every tab.
3. Event visibility is catalog-closed. `registerSystemEventTap` subscribes only to
   `SYSTEM_EVENT_CATALOG` names; `SystemEventEmitter.emit` no-ops on unregistered names
   (`packages/app/src/services/system-event-emitter.ts:61`). Any event whose name is absent from
   spur's `BASE_CATALOG` — e.g. ts-infra's `db.connected` / `db.connection.error` — never reaches
   the `system_events` ledger. The ts-infra `EventBus` has no wildcard subscription
   (exact-name handler maps only), so a catch-all cannot be a subscriber.

## Decisions

### D1 — Header rename

`<h1>Observability</h1>` → `<h1>Observabilities</h1>` in `ObservabilityShell.tsx`. One line; the
`data-observability-shell` selector and aria labels are name-independent.

### D2 — Shell-level time range (History pattern)

- Extract the `TIME_RANGES` preset chip group from `ObservabilityFilters` into a shell-level
  control rendered in `ObservabilityShell`'s header row, beside the tab strip. The shell already
  owns `timeRange`/`setTimeRange`; the selector becomes view for that existing state.
- `SystemEventsTab` keeps its remaining filters (prefix, severity, search, tier) but no longer
  renders the range chips.
- `RoutingTab` accepts the existing `timeRange` prop and passes `timeRangeSince(timeRange)` as
  `since` on its `routing-summary` fetch (`undefined` for `all`). Summary and Jobs already consume
  the prop; no server change is needed.

### D3 — Catalog-open ingestion (catch-all persist)

One shared capability in `packages/app`, consumed at both persistence seams:

- `genericSystemEventCatalogEntry(name)` — synthesizes a catalog entry for an uncataloged name:
  `prefix` = first dot-segment, `renderer` = `generic`, tier = default-visible, severity = the
  payload's own `severity` field when present (ts-libs stamp `WithEventSeverity` at emit time)
  else `info`. Payload policy = the standard normalization + configured-secret redaction path.
- `installSystemEventCatchAll(bus, sink)` — idempotently wraps the shared bus's `emit` method
  (one method swap per process at the attach point; existing holders call `bus.emit(...)`
  dynamically, so prior references see the wrapper). On each emit whose name fails
  `systemEventCatalogEntry(name)`, it persists a row through the sink and warn-logs
  `system_events.uncataloged` once per name per process.
- Server: installed at boot beside `registerSystemEventTap` (`apps/server/src/serve.ts`), same
  DAO/quotas/secrets/project-context options. Cataloged names are untouched — the tap keeps
  owning them, so no double-write (R8).
- CLI: `SystemEventEmitter.emit` drops the unregistered-name no-op and persists through the same
  generic-entry path; the CLI ledger attach installs the same catch-all wrapper.
- Retention: uncataloged prefixes resolve through the existing per-prefix quota fallback
  (documented default), so no new config shape (R10).
- Failure isolation is unchanged: catch-all persist errors are logged and swallowed, never thrown
  to the producer (R9).

**Known limitation (accepted):** the live SSE tail subscribes per catalog name, so uncataloged
events are history-visible on the next load/refresh rather than streamed live. Closing that needs
a wildcard/`onAny` in ts-infra's EventBus — upstream follow-up, explicitly out of scope.

### D4 — Drift audit surface

The promotion list is derived, not stored: uncataloged names are observable as (a) once-per-name
`system_events.uncataloged` warn logs and (b) ledger rows with renderer `generic`
(`SELECT DISTINCT event_name … WHERE renderer = 'generic'` semantics via the history endpoint's
catalog metadata). The satellite documents this query as the audit surface; a dedicated CLI verb
is deferred until the list proves recurrent.

## Blast radius

- `packages/app`: new catch-all module + generic-entry synthesizer; `system-event-emitter.ts`
  no-op removal. No change to cataloged paths.
- `apps/server`: one install call at boot. `apps/cli`: emitter branch + ledger attach wrapper.
- `apps/web`: `ObservabilityShell`, `ObservabilityFilters` (chip extraction), `RoutingTab`
  (`since` wiring), `SystemEventsTab` (chip removal). No contract change: `routing-summary`
  already accepts `since`.

## Rejected alternatives

- **Upstream `onAny` in ts-infra first** — correct long-term seam for live streaming too, but
  gates the fix on a ts-libs release; the spur-side emit wrapper delivers persistence now and
  composes with a future wildcard.
- **Catalog-closed + CI drift scan only** — keeps new upstream events invisible until manually
  registered; that is the reported defect, not a fix.
