---
template: feature-impl
schema_version: 1
name: "Add indexed correlation columns to system_events and populate them from the event envelope"
description: ""
status: done
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "schema", "migration", "data-plane"]
dependencies: ["0367"]
created_at: "2026-07-29T00:14:03.009Z"
updated_at: "2026-07-29T04:50:49.129Z"
---

## 0369. Add indexed correlation columns to system_events and populate them from the event envelope

### Background

`system_events` is `(id, event_name, occurred_at, actor, payload_json)` with indexes only on `occurred_at` and `event_name` (packages/domain/src/migrations.ts:78-87). There is no run, entity, or sequence column, so `SystemEventDao.query` can only filter on exact `event_name` plus `since` plus `limit` (system-event-dao.ts). Every richer filter the Board wants — this run, this task, this member — must therefore be done client-side over a fixed newest-N window, which is exactly why JobsTab slices the newest 50 in the browser (JobsTab.tsx:114). The 0365 envelopes now carry runId, actionId, and sequence, and planning events carry entity identity; making those queryable columns is what turns every J4 tabview into one indexed round trip.

### Requirements
- [x] R1. Add `run_id`, `entity_kind`, `entity_id`, and `sequence` columns to `system_events` through a new top-level `drizzle/*.sql` migration carrying the `_spur_cli_` marker, wired into `CLI_SCHEMA_SQL`.
- [x] R2. Add indexes supporting the query patterns J3's read API needs (at minimum `run_id` and the `entity_kind`/`entity_id` pair).
- [x] R3. Populate the columns in both write paths — the server `SystemEventTap` and the CLI `SystemEventEmitter` — deriving them from the 0365 envelope and from planning event payloads.
- [x] R4. Keep the columns nullable: pre-migration rows and events with no correlation must persist and read back cleanly with nulls.
- [x] R5. The migration must be idempotent and must not rewrite or backfill existing payloads.
- [x] R6. Surface the new fields on the history endpoint's row projection without breaking the current response shape for existing consumers.
### Acceptance Criteria
```gherkin
Scenario: R5 — Correlated events persist their identity in queryable columns
Scenario: R6 — Planning events persist their entity identity
Scenario: R7 — Pre-migration rows remain readable
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/server/src/modules/events/index.ts:188` |
| `apps/server/tests/modules/events/history.test.ts:129` |
| `apps/server/tests/modules/events/history.test.ts:25` |
| `apps/server/tests/modules/events/history.test.ts:36` |
| `apps/server/tests/modules/events/history.test.ts:61` |
| `packages/app/src/index.ts:169` |
| `packages/app/src/index.ts:173` |
| `packages/app/src/services/system-event-emitter.ts:21` |
| `packages/app/src/services/system-event-emitter.ts:64` |
| `packages/app/src/services/system-event-tap.ts:1` |
| `packages/app/src/services/system-event-tap.ts:105` |
| `packages/app/src/services/system-event-tap.ts:110` |
| `packages/app/src/services/system-event-tap.ts:115` |
| `packages/app/src/services/system-event-tap.ts:150` |
| `packages/app/src/services/system-event-tap.ts:64` |
| `packages/app/tests/services/system-event-emitter.test.ts:104` |
| `packages/app/tests/services/system-event-tap.test.ts:10` |
| `packages/app/tests/services/system-event-tap.test.ts:145` |
| `packages/app/tests/services/system-event-tap.test.ts:327` |
| `packages/domain/src/dao/system-event-dao.ts:10` |
| `packages/domain/src/dao/system-event-dao.ts:153` |
| `packages/domain/src/dao/system-event-dao.ts:165` |
| `packages/domain/src/dao/system-event-dao.ts:180` |
| `packages/domain/src/dao/system-event-dao.ts:182` |
| `packages/domain/src/dao/system-event-dao.ts:184` |
| `packages/domain/src/dao/system-event-dao.ts:186` |
| `packages/domain/src/dao/system-event-dao.ts:29` |
| `packages/domain/src/dao/system-event-dao.ts:45` |
| `packages/domain/src/dao/system-event-dao.ts:75` |
| `packages/domain/src/dao/system-event-dao.ts:82` |
| `packages/domain/src/dao/system-event-dao.ts:89` |
| `packages/domain/src/dao/system-event-dao.ts:96` |
| `packages/domain/src/index.ts:28` |
| `packages/domain/src/migrations.ts:150` |
| `packages/domain/src/migrations.ts:185` |
| `packages/domain/src/migrations.ts:211` |
| `packages/domain/src/migrations.ts:73` |
| `packages/domain/src/migrations.ts:86` |
| `packages/domain/src/migrations.ts:95` |
| `packages/domain/tests/dao/migrations.test.ts:13` |
| `packages/domain/tests/dao/migrations.test.ts:135` |
| `packages/domain/tests/dao/migrations.test.ts:138` |
| `packages/domain/tests/dao/migrations.test.ts:171` |
| `packages/domain/tests/dao/migrations.test.ts:222` |
| `packages/domain/tests/dao/migrations.test.ts:61` |
| `packages/domain/tests/dao/migrations.test.ts:71` |
| `packages/domain/tests/dao/migrations.test.ts:84` |
| `packages/domain/tests/dao/system-event-dao.test.ts:294` |
### Testing
**Forced verifyall result: PASS**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `drizzle/0008_spur_cli_system_events_correlation.sql:1-18`; `packages/domain/tests/dao/migrations.test.ts:71-89` |
| R2 | MET | `drizzle/0008_spur_cli_system_events_correlation.sql:20-21` |
| R3 | MET | `packages/app/src/services/system-event-tap.ts:73-80`; `packages/app/src/services/system-event-emitter.ts:64-68`; tests at `packages/app/tests/services/system-event-tap.test.ts:145,171` |
| R4 | MET | `packages/domain/tests/dao/migrations.test.ts:259-273`; `packages/app/tests/services/system-event-tap.test.ts:194` |
| R5 | MET | `packages/domain/tests/dao/migrations.test.ts:264-288` |
| R6 | MET | `apps/server/src/modules/events/index.ts:319-324`; `apps/server/tests/modules/events/history.test.ts:312,342` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R5 — Correlated events persist their identity in queryable columns | MET | test | `packages/app/tests/services/system-event-tap.test.ts:145` |
| R6 — Planning events persist their entity identity | MET | test | `packages/app/tests/services/system-event-tap.test.ts:171`; `packages/app/tests/services/system-event-emitter.test.ts:117-121` |
| R7 — Pre-migration rows remain readable | MET | test | `packages/domain/tests/dao/migrations.test.ts:259-273`; `apps/server/tests/modules/events/history.test.ts:342` |

**Fresh command:** `bun run test` → 3,878 pass, 0 fail, 11,951 assertions; exit 0.

**Coverage:** root per-file line/function ≥90% gate passed.

**SECUA:** no blocker/major; nullable/idempotent migration and shared correlation derivation remain correct.

**Fix-pass disclosure:** `.spur/run/0369-verdict.json:1-69` regenerated; empty requirement evidence cells were repaired.
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | tests-pass | — | 87/87 targeted tests green (system-event-dao, migrations, system-event-tap, system-event-emitter, history) |
| P4 | design-conformance | — | empty task Design; docs/04_DESIGN.md §7.10 matches implementation |
| P4 | evidence-rule-pass | — | all 3 AC rows use test evidence |
| P4 | migration-idempotent | — | addColumnIfMissing sequence; second apply returns 0 |
| P4 | spur-task-check | — | spur task check 0369 --strict-core pass |
### References

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T03:13:22.828Z todo → testing (system)
- 2026-07-29T03:16:38.299Z testing → done (system)
