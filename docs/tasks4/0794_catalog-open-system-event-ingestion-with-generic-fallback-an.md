---
schema_version: 1
name: Catalog-open system-event ingestion with generic fallback and drift signal
status: todo
template: feature-impl
created_at: 2026-09-07T03:53:27.194Z
updated_at: "2026-09-07T03:53:57.201Z"
feature_id: J31
priority: P2

---

## 0794. Catalog-open system-event ingestion with generic fallback and drift signal

### Background

Covers feature J31 scenarios R5–R11. Both persistence paths are catalog-closed: `registerSystemEventTap` subscribes only to `SYSTEM_EVENT_CATALOG` names and `SystemEventEmitter.emit` no-ops on unregistered names (`packages/app/src/services/system-event-emitter.ts:61`), so uncataloged upstream events (e.g. ts-infra `db.connected`/`db.connection.error`) never reach the ledger. The ts-infra EventBus has no wildcard subscription (exact-name handler maps). ADR-110 (Proposed) and `docs/design/observabilities-module-polish.md` record the decided shape.

### Requirements

R5. An uncataloged event emitted on the server bus persists with its emitted name, derived prefix, and standard redaction.
R6. An uncataloged planning event received by the CLI emitter persists instead of being dropped, rendering via the generic renderer on the history endpoint.
R7. Uncataloged events are visible on the Board with default filters, without the diagnostic toggle; cataloged events keep their presenters and tiers.
R8. Cataloged event behavior is unchanged; no duplicate rows from the catch-all.
R9. Catch-all persist failures are logged and swallowed, never thrown to the producer.
R10. Uncataloged prefixes prune under the existing per-prefix quota fallback.
R11. A drift audit surface reports each observed uncataloged event name as a promotion list (once-per-name `system_events.uncataloged` warn log + `renderer='generic'` ledger rows, documented in the design satellite).

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

### Design

Per ADR-110 and the satellite: one shared capability in `packages/app` — `genericSystemEventCatalogEntry(name)` (prefix = first dot-segment, renderer generic, default-visible tier, severity from the payload's own `severity` when present else info, standard normalization + secret redaction) and `installSystemEventCatchAll(bus, sink)` (idempotent `emit`-method wrap at the attach point; persists uncataloged names through the sink and warn-logs once per name per process). Server: installed at boot beside `registerSystemEventTap` with the same DAO/quotas/secrets/project context. CLI: `SystemEventEmitter.emit` drops the no-op and persists via the generic path; the ledger attach installs the same wrapper. Accepted limitation: uncataloged events are history-visible on refresh, not live-streamed, until ts-infra grows an `onAny` seam (out of scope).

### Plan

1. Add the generic-entry synthesizer and catch-all installer in packages/app with DAO tests (in-memory SQLite) covering R5–R10. 2. Remove the unregistered-name no-op in SystemEventEmitter. 3. Install the wrapper at server boot (serve.ts) and CLI ledger attach. 4. Update the design satellite if the as-built shape diverges. 5. Run package/app and cli test suites plus lint.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
