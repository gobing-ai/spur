---
schema_version: 1
id: "J31"
name: "Observabilities module polish: header naming, shell-level time range, catalog-open event ingestion"
status: backlog
priority: P2
tags: []
created_at: "2026-09-07T03:39:36.195Z"
updated_at: "2026-09-07T03:42:44.261Z"
---

# J31: Observabilities module polish: header naming, shell-level time range, catalog-open event ingestion

## Goal

Make the Observabilities board module consistent and complete: the header matches the sidebar label, one shell-level time-range selector governs every tab's queries, and the System Events ledger shows every emitted event by default — cataloged or not — instead of silently dropping anything absent from spur's hard-coded catalog.

## Scope

**In scope:**

1. Rename the ObservabilityShell header title to `Observabilities`, matching the sidebar label (`modules/observability/index.tsx`).
2. Hoist the time-range preset selector to ObservabilityShell so it renders for all tabs (Summary, System Events, Jobs, Routing), following the HistoryShell pattern; every tab's data queries honor the selected range, including RoutingTab wiring `since` into `GET /api/observability/routing-summary`.
3. Catalog-open event ingestion: both persistence paths (server `registerSystemEventTap`, CLI `SystemEventEmitter`) persist events whose names are absent from `BASE_CATALOG` — derived prefix, generic renderer, default severity, standard redaction — so uncataloged upstream ts-libs events (e.g. `db.connected`, `db.connection.error`) and future drift are visible by default.
4. A drift audit surface (static scan and/or runtime warn) that lists emitted-but-uncataloged event names so they can be promoted into `BASE_CATALOG` with presenters.

**Out of scope:**

- Changes to released `@gobing-ai/ts-*` packages (e.g. adding `onAny` wildcard to ts-infra EventBus) — follow-up only.
- Presenter/field polish for individual uncataloged events — promotion into the catalog is separate follow-up work.
- Redesign of the diagnostic-tier policy; existing tier semantics stay, with only the default-visibility decision for uncataloged events settled by this feature's design.
- Any Board UI outside the observability module.

## Acceptance Criteria

```gherkin
Feature: Observabilities module polish — naming, shell time range, catalog-open ingestion

  # ── Header naming ──────────────────────────────────────────────────────────

  @core
  Scenario: R1 — Module header matches the sidebar label
    Given the Observabilities module is open on the Board
    When the module header renders
    Then the header title reads "Observabilities"
    And it matches the sidebar menu label exactly

  # ── Shell-level time range ─────────────────────────────────────────────────

  @core
  Scenario: R2 — The time-range selector renders for every tab
    Given the Observabilities module is open
    When the operator switches between the Summary, System Events, Jobs, and Routing tabs
    Then the time-range selector stays visible on every tab
    And the selected range persists across tab switches

  @core
  Scenario: R3 — Every tab's data queries honor the selected time range
    Given a time range is selected in the shell
    When any tab loads or refreshes its data
    Then that tab's server query carries a since window derived from the selected range
    And the Routing tab passes the derived since to the routing-summary endpoint

  @edge
  Scenario: R4 — The "all" range sends no since bound
    Given the "all" time range is selected
    When a tab queries its data
    Then no since parameter is sent
    And the full retained history is eligible for the result

  # ── Catalog-open ingestion ─────────────────────────────────────────────────

  @core
  Scenario: R5 — An uncataloged event emitted on the server bus is persisted
    Given an event name absent from the system event catalog
    When that event is emitted on the server event bus
    Then a system_events row is persisted with the emitted name
    And its prefix is derived from the event name
    And its payload passes through the standard redaction path

  @core
  Scenario: R6 — An uncataloged planning event emitted from the CLI is persisted
    Given an event name absent from the system event catalog
    When the CLI planning emitter receives that event
    Then the event is persisted rather than silently dropped
    And the row renders on the history endpoint with the generic renderer

  @core
  Scenario: R7 — Uncataloged events are visible by default on the Board
    Given uncataloged events have been persisted
    When the System Events tab loads with default filters
    Then uncataloged events appear without enabling the diagnostic toggle
    And cataloged events keep their existing presenters and tiers

  @core
  Scenario: R8 — Cataloged event behavior is unchanged
    Given an event name registered in the catalog
    When that event is emitted and persisted
    Then its catalog entry's renderer, tier, and payload policy still apply
    And no duplicate row is written by a catch-all path

  @edge
  Scenario: R9 — Uncataloged ingestion still isolates failures
    Given persisting an uncataloged event will fail
    When the event is emitted
    Then the emit path continues normally
    And the failure is logged, never thrown to the producer

  @edge
  Scenario: R10 — Uncataloged rows respect retention
    Given uncataloged events of one prefix exceed the resolved retention quota
    When retention is applied
    Then that prefix is pruned to its quota
    And other prefixes are untouched

  # ── Drift audit ────────────────────────────────────────────────────────────

  @core
  Scenario: R11 — A drift audit names every emitted-but-uncataloged event
    Given producers emit events not registered in the catalog
    When the drift audit runs
    Then it reports each uncataloged event name it observed
    And the report is consumable as a promotion list for catalog entries
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0793 | Align Observabilities header and hoist the time-range selector to the shell for all tabs | todo |
| 0794 | Catalog-open system-event ingestion with generic fallback and drift signal | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
