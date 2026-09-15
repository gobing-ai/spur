---
schema_version: 1
name: Make scheduler.custom tick single-flight durable across serve daemons and stop failing suppressed duplicates
status: backlog
template: standard
created_at: 2026-09-15T23:25:40.931Z
updated_at: "2026-09-15T23:34:57.677Z"

---

## 0863. Make scheduler.custom tick single-flight durable across serve daemons and stop failing suppressed duplicates

### Background

Captured from the creation title: "Make scheduler.custom tick single-flight durable across serve daemons and stop failing suppressed duplicates".

### Requirements

- **R1 — Durable single-flight per job name.** A tick of a configured `bootstrap.scheduler.jobs` entry admits at most ONE active (`pending` or `processing`) `scheduler.custom` row per job name in the project database, enforced by a database constraint rather than a read-then-insert check. N `spur serve` daemons sharing one project database must therefore produce one row per cron occurrence, not N.
  - Evidence for the defect: `history-refresh` is registered with `cron: "*/20 7-23 * * *"`, yet the project database holds 3–14 rows per occurrence (`.spur/spur.db`: 5 rows at 2026-09-15 15:00 and 15:20 local, 4 at 13:00–14:00, 14 at 2026-09-14 18:00–18:40), and five `scheduler.job.executed` tick events are recorded at the same millisecond.
- **R2 — A losing tick is not a failure.** When a tick's insert loses the single-flight race, it emits the existing `scheduler.job.executed` evidence with `skipped: true` and a reason naming the active row, and produces NO error-severity queue event. The daemon restart / next cron occurrence is the natural retry, exactly as the task-0803 R4 sweep documents.
- **R3 — Duplicate execution is suppressed without a failed queue job.** If a `scheduler.custom` row for a job name already executing in this process is claimed anyway (a row enqueued before the constraint existed), the handler must not spawn a second child process, must not record a failed queue attempt, and must leave observable evidence that the run was suppressed.
- **R4 — The 0803 R4 age sweep is preserved.** An active `processing` row older than the job's resolved execution policy plus the kill grace is still failed in place (`failed`, `swept: true` evidence) and the tick still enqueues a fresh job on that same occurrence; an explicit-unlimited job policy is never swept by age.
- **R5 — Existing databases upgrade in place.** Applying the migration to a database that already contains duplicate active `scheduler.custom` rows keeps the deterministically oldest active row per job name and retires the rest to terminal `failed` with an auditable `last_error`; a fresh database gets the same constraint from the schema constant. No queue row is deleted.

### Acceptance Criteria

```gherkin
Feature: Durable single-flight for configured scheduler jobs

  @core
  Scenario: A1 — Two daemons ticking the same occurrence admit one row
    Given two servers sharing one project database, each with the same configured "history-refresh" cron
    When both ticks of one occurrence run
    Then exactly one active "scheduler.custom" row for "history-refresh" exists
    And the losing tick does not create a second row

  @core
  Scenario: A2 — A losing tick is observable and non-fatal
    Given an active "scheduler.custom" row for "history-refresh" exists
    When a tick for the same job name runs
    Then the tick emits scheduler.job.executed with skipped: true and a reason naming the active row
    And no error-severity queue event is recorded for it

  @core
  Scenario: A3 — An already-running job name suppresses a duplicate claim
    Given a handler attempt for "history-refresh" is executing in this process
    When a second queue attempt for the same job name is handled
    Then no second child process is spawned
    And the second attempt settles as completed (not failed)
    And the suppression is recorded as observable evidence

  @edge
  Scenario: A4 — A stale processing row is still swept
    Given an active "processing" row for a job with a finite execution policy
    And that row is older than the resolved policy plus the kill grace
    When the next tick runs
    Then the stale row is marked failed in place with swept evidence
    And a fresh job is enqueued on that same occurrence

  @edge
  Scenario: A5 — An explicit-unlimited job is never swept by age
    Given an active "processing" row for a job whose resolved policy is explicit unlimited
    When the next tick runs with a skip outcome
    Then the row is left untouched and reported as skipped

  @edge
  Scenario: A6 — The migration retires pre-existing duplicate active rows
    Given a database holding several active "scheduler.custom" rows for one job name
    When the migration applies
    Then the deterministically oldest active row survives
    And every other active row is terminal failed with an auditable last_error
    And every original row still exists
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: make the database the single-flight authority for named scheduler jobs, mirroring the task-0716 `history.refresh` precedent instead of adding a new lock, daemon registry, or process supervisor.

- **Constraint.** Partial unique index on `json_extract(payload, '$.name')` where `type = 'scheduler.custom'` and `status IN ('pending','processing')`. Terminal rows are invisible to it, so the next occurrence always admits a fresh row, and other job types are unaffected. The read-then-insert check in the tick cannot be atomic across processes; the index can, because SQLite serializes writers.
- **Tick.** The insert itself is the check: the tick enqueues and treats `SQLITE_CONSTRAINT_UNIQUE` on that index as the expected "an active job already exists" outcome (the same shape `enqueueCoalesced` gets from `ON CONFLICT DO NOTHING`, kept on the normal `queue.enqueue` path so `queue.job.enqueued` stays in the ledger). Only on that conflict does it look up the active row to decide between the 0803 R4 age sweep and a `skipped: true` outcome. Rejected alternative: routing the tick through a raw `INSERT … ON CONFLICT DO NOTHING` helper — it would have to re-implement the queue's enqueue event and its policy options for no additional safety.
- **Handler.** The in-process same-name guard becomes non-fatal: the sibling run is doing this row's work, so the attempt settles as completed and emits `scheduler.job.executed` with `skipped: true` (fail-loud rule: observable, not silent). The cross-kind `exclusiveKey` guard keeps failing its own attempt — there a different job kind holds the corpus writer and the run genuinely did not happen.
- **Invariant.** At most one active `scheduler.custom` row per job name per project database. Consequence: a job name can no longer be executed by two daemons concurrently, which is what made the 2026-09-08…15 duplicate-suppression failures (402 rows) possible.

Impacted surfaces: `queue_jobs` (new index, migration 0047), `spur serve` scheduler tick, the `scheduler.custom` queue handler, `scheduler.job.executed` evidence (unchanged shape, `skipped` reused).

### Plan

1. Migration 0047 + `QUEUE_JOBS_SCHEMA_SQL`: retire duplicate active `scheduler.custom` rows per name, create `queue_jobs_scheduler_custom_active_unique`; register the migration and its table-absence guard.
2. Export the constraint predicate (`isSchedulerCustomActiveConflict`) next to `SCHEDULER_CUSTOM_JOB`.
3. Rewire the tick in `apps/server/src/serve.ts`: insert-as-check, conflict → sweep or skip, no error path for a duplicate.
4. Make the handler's same-name guard non-fatal and observable (`onDuplicate` audit hook wired to the server event bus).
5. Tests: domain (index admits one active row per name; migration retires duplicates), app (duplicate claim completes without spawning a second child), server (tick conflict → skipped evidence, stale sweep still enqueues).
6. Design-doc note + focused workspace tests, then the repo gate.

### Solution

| Change | Where | Why |
| ------ | ----- | --- |
| `SCHEDULER_CUSTOM_ACTIVE_UNIQUE_SCHEMA_SQL` (`packages/domain/src/migrations.ts:942`) + migration entry `0047_spur_cli_scheduler_custom_active_unique` (`packages/domain/src/migrations.ts:1493`) + `drizzle/0047_spur_cli_scheduler_custom_active_unique.sql` | `packages/domain/src/migrations.ts`, `drizzle/0047_spur_cli_scheduler_custom_active_unique.sql` | Retires duplicate active `scheduler.custom` rows per job name (oldest survives, rest terminal `failed` with an auditable `last_error`, nothing deleted), then creates the partial unique index on `json_extract(payload,'$.name')` where `type='scheduler.custom'` and `status IN ('pending','processing')`. A table-absence guard (`packages/domain/src/migrations.ts:1718`) keeps legacy DBs upgrading |
| Same index in the fresh-schema constant | `packages/domain/src/migrations.ts:119` | Fresh databases get the constraint from migration `0004` |
| `SCHEDULER_CUSTOM_ACTIVE_INDEX` + `isSchedulerCustomActiveConflict()` | `packages/app/src/services/scheduler-custom-job-service.ts:39`, `packages/app/src/services/scheduler-custom-job-service.ts:50` (re-exported from `packages/app/src/index.ts`) | Names the constraint and classifies its violation (code `SQLITE_CONSTRAINT_UNIQUE` + index-naming message) so the tick treats the loss as an expected outcome |
| Tick: enqueue-as-check, conflict → sweep or `skipped` | `apps/server/src/serve.ts:293` (`enqueueFresh`), `apps/server/src/serve.ts:311` (conflict branch) | The one-active-row invariant is enforced by the index across daemons; the read-then-insert pre-check is gone, and the 0803 R4 age sweep now runs on the conflict path (fresh enqueue after a successful sweep) |
| Handler: same-name duplicate completes instead of failing, with an audit hook | `packages/app/src/services/scheduler-custom-job-service.ts:221` (`deps.onDuplicate?.`), `packages/app/src/services/scheduler-custom-job-service.ts:99` (dep) | A duplicate claim folds into the sibling run; the model-side hook wired at `apps/server/src/serve.ts:876` emits `scheduler.job.executed` with `skipped: true`, so the suppression is observable rather than silent. The cross-kind `exclusiveKey` guard still fails its own attempt |
| Design satellite | `docs/design/server-contracts.md:128` | Documents the DB-enforced single-flight and the non-fatal duplicate |

### Testing

| Command (workspace) | Result |
| ------------------- | ------ |
| `bun test tests/db.test.ts tests/dao/migrations.test.ts` (`packages/domain`) | 102 pass / 0 fail — index admits one active row per name, terminal rows and other types unaffected, migration 0047 retires pre-existing duplicates, registry/governance counts updated |
| `bun test tests/services/scheduler-custom-job-service.test.ts` (`packages/app`) | 36 pass / 0 fail — duplicate claim completes without a second child and audits itself; conflict classifier accepts only this index |
| `bun test tests/serve.test.ts` (`apps/server`) | 53 pass / 0 fail — tick conflict → `skipped` with the active row id; stale-row sweep still re-enqueues; explicit-unlimited still unswept; real-queue round trip admits one row per occurrence |
| `bun run typecheck` (root) | all 7 workspaces exit 0 |
| `bunx biome check` on the touched files | clean |

Live-DB migration evidence (the project's own `.spur/spur.db`, 796 `scheduler.custom` rows): index created, no invalid-JSON payloads, 0 active duplicate rows, row count unchanged (nothing deleted).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
