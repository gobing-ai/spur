---
template: feature-impl
schema_version: 1
name: "Emit the routing decision on agent run events via the J5 envelope"
description: ""
status: todo
type: task
profile: standard
feature_id: J6
parent_wbs: null
priority: P2
tags: []
dependencies: ["0536"]
ac_numbering: task-local
created_at: "2026-08-14T00:19:14.945Z"
updated_at: "2026-08-14T02:53:15.259Z"
---

## 0545. Emit the routing decision on agent run events via the J5 envelope

### Background
Feature B2's standing telemetry gap: *"Nothing currently records which executor served which
intention. Without it, the operator cannot tell whether the routing is actually saving money — the
stated motivation for tiers."*

Batch 1 makes the routing decision explicit — a role selects a tier, a tier selects an executor, or a
pin overrides both. Nothing writes that decision down. So after batch 1 ships, the operator still
cannot answer "did my `scribe` work actually run on a cheap executor?" except by reading logs.

Feature J5 (verifying) builds the versioned payload envelope with producer attribution, redaction,
and recursive bounds. This task is a **consumer** of that envelope: routing metadata becomes
additional envelope content on events the ledger already writes, which is why no new table or column
is needed.

Scope here is the decision itself. Token consumption per role is task 0547, which joins this
attribution to the history plane over `run_id` — so the rows written here must carry that key. No
dollar figure is ever computed: per-model pricing is too volatile to hold correctly (operator ruling
2026-08-13, feature J6 § *Tokens, not prices*).
### Requirements
- [ ] **R1.** Agent-run lifecycle events carry the routing decision in the J5 envelope: the role, the
      resolved tier, the resolved executor, and the **selection source** distinguishing a role
      resolution from an explicit pin from the `agent.default` role. The row must also carry
      `run_id` — already indexed as `idx_system_events_run_id` — so this attribution is joinable to
      the history plane by task 0547. Measurable: a run dispatched each of those three ways produces
      events whose payload names the correct source and whose row carries a non-null `run_id`.
- [ ] **R2.** An escalation is recorded with the originating tier, the resulting tier, and the
      objective trigger that caused it (`gate-fail`, `timeout`, `insufficient-evidence`,
      `retry-exhausted`). A run that never escalated is distinguishable from one that escalated once.
      Measurable: an escalating run's events show both tiers and the trigger; a non-escalating run
      shows no escalation record rather than a null-valued one.
- [ ] **R3.** No new table, no new column, no historical rewrite. Attribution is envelope metadata on
      rows the ledger already writes, and pre-existing rows project cleanly without one. Measurable:
      the migration set is unchanged and a query over rows written before this task returns them
      without error.
- [ ] **R4.** Attribution carries identifiers, tiers, and counts only — no prompt text, no command
      line, no configured secret value — under J5's existing payload bounds and redaction rules.
      Measurable: a redaction test asserts a configured secret appearing in a run's context never
      reaches the persisted attribution payload.
- [ ] **R5.** Every selection source has coverage, so an unrecorded path fails the suite rather than
      passing silently. The four are: role-resolved, pinned, defaulted, escalated. Measurable: four
      tests, one per source, each asserting the recorded value.
### Acceptance Criteria
Covers feature J6 scenarios:

- **R1 — An agent run records the routing decision it made**
- **R2 — An escalation is recorded with the trigger that caused it**
- **R3 — The record rides the existing envelope**
- **R5 — Every selection source is covered**
- **R6 — Attribution never carries secrets or prompt bodies**

```gherkin
Scenario: R1 — An agent run records the routing decision it made
  Given a run resolved through a declared role
  When its lifecycle events are read
  Then the payload carries the role, the resolved tier, and the resolved executor
  And it carries the selection source distinguishing a role resolution from a pin or a default

Scenario: R2 — An escalation is recorded with the trigger that caused it
  Given a run whose starting-tier executor failed on an objective signal
  When the run's events are read
  Then the escalation is visible with the originating tier, the resulting tier, and the trigger
  And a run that never escalated is distinguishable from one that escalated once

Scenario: R3 — The record rides the existing envelope
  Given the J5 payload envelope is the carrier
  When attribution is persisted
  Then no new table or column is introduced
  And rows written before this feature project cleanly without a rewrite

Scenario: R5 — Every selection source is covered
  Given the four selection sources role, pin, default, and escalated
  When the test suite runs
  Then each source has coverage asserting its recorded value
  And a source that records nothing fails the suite rather than passing silently

Scenario: R6 — Attribution never carries secrets or prompt bodies
  Given the payload bounds and redaction rules established by J5
  When attribution metadata is written
  Then it contains only identifiers, tiers, and counts
  And it carries no prompt text, command line, or configured secret value
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Where does attribution live physically?** `system_events.payload_json`, as envelope content. No
  new table, no new column — `run_id` is already a column and already indexed
  (`idx_system_events_run_id`).
- **Which call site emits?** `resolveExecutorSelector` (`agent-service.ts:1235`) — the only place that
  knows role, tier, executor, and source simultaneously.
- **What are the escalation triggers?** The existing objective vocabulary: `gate-fail`, `timeout`,
  `insufficient-evidence`, `retry-exhausted` (`stage-registry/schema.ts:375-379`). No new trigger is
  invented here.
- **Is a new event name needed?** Attribution rides existing agent-run lifecycle events; the escalation
  is its own record (R2). Any new name must be registered in the event catalog
  (`event-names.ts:30-36`), not emitted ad hoc.

**Deferred with owner.**

- **If J5's envelope cannot carry this metadata** — owner: feature J5. Route it back rather than
  adding a column; J5 is `verifying` and still open to a contract finding.
- **Dollar cost** — owner: nobody, permanently. Excluded 2026-08-13 (feature J6 § *Tokens, not prices*).
### Design
**Consume the envelope; do not extend the plane.** J5 owns the payload envelope shape, producer
attribution, redaction, and bounds. Routing metadata is envelope *content*. If J5's envelope turns
out not to admit this metadata, that is a finding to route back to J5 — not a reason to add a column
here (R3). Adding a column would also contradict J5's own recorded scope, which rules out new tables
and columns for this plane.

**Emit where the decision is made, not where it is used.** The resolution funnel
(`resolveExecutorSelector`, `packages/app/src/services/agent-service.ts:1235`) is the single place
that knows role, tier, executor, and source together. Emitting from anywhere downstream means
re-deriving what was already decided, which is how the two facts drift apart.

**Escalation is a second event, not a mutated first one** (R2). The starting decision and the
escalation are distinct facts with distinct timestamps; collapsing them loses the "how often does
routing start too cheap" signal, which is the most actionable thing this data can tell the operator.

**Absence must be distinguishable from null** (R2). "This run did not escalate" and "we did not
record whether it escalated" are different, and conflating them silently degrades the dataset the
moment a path is missed — which is precisely what R5's per-source coverage exists to prevent.

**Not in scope:** any change to selection or escalation behavior. This task observes; feature B2
decides, and task 0540 exercises. If writing the tests here reveals a behavioral defect, file it
against B2/I3 rather than fixing it in an observability task.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Ledger table (**no change**) | `system_events (id, event_name, occurred_at, actor, payload_json, run_id, entity_kind, entity_id, sequence)` | `packages/domain/src/migrations.ts:81-91` |
| Metadata carrier | `payload_json` — attribution rides here, **no new column** | same |
| Join key (already indexed) | `run_id` / `idx_system_events_run_id` | `migrations.ts:87`, `:95` |
| Envelope builder | `buildSystemEventEnvelope(...)` | `packages/app/src/services/system-event-tap.ts:83` |
| Envelope type | `SystemEventEnvelopeV2` | exported `packages/app/src/index.ts:275` |
| Version guard | `isSystemEventEnvelopeV2` | `packages/app/src/index.ts:74` |
| Legacy projection (unchanged) | `projectStoredSystemEventEnvelope` | `packages/app/src/index.ts:77` |
| Correlation type | `SystemEventCorrelation` | `system-event-tap.ts:174` |
| Catalog types | `SystemEventCatalogEntry` · `SystemEventMetadataField` | `packages/app/src/services/event-names.ts:30`, `:36` |
| Emission point | `resolveExecutorSelector` — knows role, tier, executor, source together | `packages/app/src/services/agent-service.ts:1235` |
| Selection-source union | `'phase' \| 'default' \| 'explicit'` + `'role'` (added by task 0536) | `agent-service.ts:1238` |
| Escalation source | `getNextFallback` · trigger vocabulary | `packages/domain/src/stage-registry/schema.ts:432-444`, `:375-379` |
| Trigger values | `gate-fail` · `timeout` · `insufficient-evidence` · `retry-exhausted` | `schema.ts:375-379` |

**No new table, column, transport, or CLI noun.** Attribution is envelope content inside `payload_json`.

#### Anti-patterns — what not to implement

- Do **not** add a column to `system_events`. J5's own scope rules out new tables/columns for this
  plane, and R3 requires pre-existing rows to project cleanly.
- Do **not** emit from a call site downstream of resolution. Only `resolveExecutorSelector` knows
  role, tier, executor, and source together; re-deriving downstream is how the two facts drift apart.
- Do **not** collapse the escalation into the initial decision event. They are distinct facts with
  distinct timestamps; merging them destroys the "routing started too cheap" signal.
- Do **not** represent "did not escalate" as a null-valued escalation record — absence and
  not-recorded must be distinguishable (R2).
- Do **not** write prompt text, command lines, or configured secrets into the payload (R4); J5's
  bounds and recursive redaction apply.

#### Cross-task contract

**Assumes from 0536 (batch 1):** `resolveExecutorSelector` resolves roles and its `source` union
carries `'role'`, so a role-resolved dispatch is distinguishable from a pin or a default. Without
that, three of the four selection sources in R5 cannot be recorded.

**Assumes from E6 task 0557:** `agent.invoke.*` events carry a non-null `run_id`. Measured
2026-08-13: 0 of 202 invoke rows have one — the minted runId (`agent-service.ts:959`) is never
threaded into the payload the tap reads (`system-event-tap.ts:200-201`). Task 0557 owns that fix.
If 0545 runs first, wire it here and note the overlap; do not add a second correlation channel.

**Assumes from J5 (verifying):** `buildSystemEventEnvelope` admits additional metadata under its
bounds and redaction rules. If it does not, that is a finding to route back to J5 — **not** a licence
to add a column here.

**Leaves for dependents:**

- Task **0546** aggregates these rows and needs `run_id` present on every attribution row plus a
  stable selection-source value.
- Task **0547** joins on `run_id` to the history plane; this task is why that join has a role to group by.
### Plan
- [ ] Emit role, resolved tier, resolved executor, and selection source from the resolution funnel (R1)
- [ ] Carry them as J5 envelope metadata on agent-run lifecycle events (R1, R3)
- [ ] Emit escalation as its own record with originating tier, resulting tier, and trigger (R2)
- [ ] Make "did not escalate" distinguishable from "not recorded" (R2)
- [ ] Confirm no migration change and that pre-existing rows project cleanly (R3)
- [ ] Add a redaction test asserting no secret or prompt body reaches the attribution payload (R4)
- [ ] Add one coverage test per selection source: role, pin, default, escalated (R5)
- [ ] Update `docs/04_DESIGN.md §7.9` and `docs/design/actionable-observability-context.md` (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Emission point (R1):** `packages/app/src/services/agent-service.ts:1235`
  (`resolveExecutorSelector` — knows role, tier, executor, and source together), `:990` (explicit
  source), `:1051-1052` (default source), `:996` + `:1142` (starting tier)
- **Escalation source (R2):** `packages/domain/src/stage-registry/schema.ts:432-444`
  (`getNextFallback`), `:375-379` (objective trigger vocabulary)
- **Envelope to consume (R3/R4):** feature J5 payload envelope built in `packages/app`;
  `docs/design/actionable-observability-context.md`, `docs/04_DESIGN.md §7.9`
- **Ledger:** `system_events` (no schema change); `attachSystemEventLedger`
  (`apps/cli/src/system-event-ledger.ts`), `followSystemEventsAfter`
- **Upstream dependency:** feature B2 task 0536 (makes the routing decision explicit)
- **Adjacent, do not duplicate:** feature J3 (ingestion/retention/correlation, verifying), J5
  (envelope, verifying), J4 (Board surfaces, done)
- **Redaction contract:** observability persistence receives configured secrets at composition roots
  and redacts recursively before payload bounds (AGENTS.md § Conventions)
### History
