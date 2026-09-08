---
schema_version: 1
name: "Bound the periodic history-refresh job: child watchdog timeout, PASSIVE checkpoint in daily path, bounded BUSY retry — a wedged history-daily child held the WAL write lock 30+ min and blocked all corpus writes"
status: done
template: issue
created_at: 2026-09-07T21:54:35.183Z
updated_at: "2026-09-08T00:30:14.858Z"

---

## 0803. Bound the periodic history-refresh job: child watchdog timeout, PASSIVE checkpoint in daily path, bounded BUSY retry — a wedged history-daily child held the WAL write lock 30+ min and blocked all corpus writes

### Background

Dogfood of `/sp:dev-run 0800` (2026-09-07, run `2026-09-07-dev-run-0800`) was blocked at setup for
~35 minutes: every corpus write (`spur task run-link`, event-tap persist) failed with
`SQLiteError: database is locked` after waiting the full 30s `busy_timeout`.

**Incident evidence.**

- The daemon's 15-minute `history-refresh` scheduler entry spawns child
  `bun apps/cli/src/index.ts --no-logo history daily` (queue type `scheduler.custom`, job
  `ddd6de09-…`, `processing` since 2026-09-07 21:15:00Z — the lock window starts exactly then).
- The child (PID 56111) went **write-silent at 21:15:41Z**: `.spur/spur.db-wal` byte-static
  (1,742,792 B) for 27+ minutes while the process stayed alive holding the DB — a wedged writer
  holding the WAL write lock in an uncommitted transaction, not throughput contention.
- `run-link` measured: 30.166s wall = full `busy_timeout` (`SQLITE_BUSY_TIMEOUT_MS = 30_000`,
  `packages/domain/src/db.ts:19,38`), then failure. 10/10 attempts failed across the window.
- Killing the child released the lock immediately; DB writes recovered.
- Pre-existing mitigations are real but insufficient: WAL mode is on, `busy_timeout = 30s` is set
  at the connection seam, import writes are per-batch transactions (`ts-db` `batch()`,
  `adapters/bun-sqlite.ts:109`), per-source isolation catches per-source failures.
- 2-day job stats (`queue_jobs`, type `scheduler.custom`): 22 completed / **8 failed**, all 8 as
  `Process terminated: server restarted/stopped while job was in flight`; typical runtimes
  83–110s with a 40-minute outlier (2026-09-06 01:26→02:07).

### Requirements

- [x] R1. Both `history daily` child spawn sites enforce a hard wall-clock timeout — default 600_000 ms (10 min), overridable via the `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` env var. On expiry the child is killed (execa timeout: SIGTERM, escalating to SIGKILL), the job attempt fails with a timeout-labelled `last_error` (message says "timed out"), and the failure is observable in System Events via the existing `queue.job.failed` tap. Covers `handleSchedulerCustomJob` (today: 60-min default, `SCHEDULER_CUSTOM_TIMEOUT_MS = 3_600_000`) and `handleHistoryRefreshJob` (today: no timeout at all).
- [x] R2. The periodic `history daily` path never runs `wal_checkpoint(TRUNCATE)`: retention compaction — the only TRUNCATE reachable from `daily()` (`daily()` → `runRetention`, history-service.ts:917 → retention.ts:169) — uses `wal_checkpoint(PASSIVE)`. The manual `spur history maintain` path (`maintainDatabase`) keeps TRUNCATE.
- [x] R3. A daily/import run bounds cumulative `SQLITE_BUSY` tolerance: after 2 consecutive source failures classified as BUSY the run aborts the remaining sources and fails fast (non-zero exit + `history.daily.failed` event) instead of letting each remaining source burn its own 30s `busy_timeout`; and the scheduler tick enqueues `scheduler.custom` with `maxRetries: 1` so a failed attempt goes terminal instead of re-pending and suppressing later ticks.
- [x] R4. A `processing` `scheduler.custom` row older than the resolved timeout is failed by the next scheduler tick of the same job name (no daemon restart required) and a fresh job is enqueued on that same tick; a younger processing row or any pending row keeps today's skip behavior.

Non-goals (explicitly out of scope):

- Per-job `timeoutMinutes` in `bootstrap.scheduler.jobs` — `SchedulerJobConfig` is validated upstream in `@gobing-ai/ts-infra`; the env var is the in-repo configurability seam.
- Importer-internal per-batch abort — `@gobing-ai/ts-llm-jsonl-importer` exposes no per-batch/BUSY seam (`ImportOptions` has neither signal nor error hook); the importAll-level abort (R3) plus the process kill (R1) bound the damage without an upstream facade change.
- Cancelling the in-flight import on per-source timeout — the `Promise.race` in `importOneIsolated` (history-service.ts:947-968) stops awaiting but does not cancel; the import keeps running. Real cancellation needs an AbortSignal seam in the importer package. The process-level kill (R1) is the enforcement for the periodic path.
- Daemon reader-connection hygiene (the three long-lived connections observed in the incident) — separable; the PASSIVE checkpoint (R2) removes the writer-side starvation those readers caused.
- Merging import batches into one big transaction or raising `busy_timeout` — both lengthen the write-lock hold; rejected in Root Cause.

### Acceptance Criteria

- AC1. A simulated wedged `history daily` child (holds the write lock, makes no progress) is
  killed and marked failed within the configured timeout; concurrent `spur task` writes succeed
  within busy_timeout during the job's normal import phase.
- AC2. During a periodic refresh, `PRAGMA wal_checkpoint` behavior is observably PASSIVE
  (no writer starvation while readers are active); `maintain` still runs TRUNCATE.
- AC3. Under induced write contention, the refresh job aborts within the bounded budget and
  emits a failure event; the next scheduler tick is not suppressed after the failure.
- AC4. Regression: existing history import/analyze tests and the scheduler job tests pass;
  `bun run spur-check` green.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-07T22:40:41.167Z

Resolved during `--depth ready` refinement (2026-09-07) — no open decisions remain.

- Q: Default timeout value? A: 600_000 ms (10 min) — ~6× the observed healthy runtime (83–110s); the 40-min outlier in the 2-day job stats was itself the wedge signature. Task 0734's "under the queue's 2-hour visibility timeout" bound stays satisfied.
- Q: Configurability mechanism? A: `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` env var, resolved once at daemon boot. Per-job `timeoutMinutes` in `bootstrap.scheduler.jobs` is deferred — `SchedulerJobConfig` is validated upstream in `@gobing-ai/ts-infra`, so a per-job field is an upstream facade change, not this task.
- Q: Parameterize the checkpoint mode (PASSIVE vs TRUNCATE)? A: No. `runRetention` has exactly one caller (`HistoryService.daily`, history-service.ts:917) — flip compaction to PASSIVE unconditionally. `maintainDatabase` keeps TRUNCATE; its only path is the manual `spur history maintain`.
- Q: Where does the BUSY budget live? A: `importAll`'s sequential source loop (consecutive-busy abort, threshold 2). The importer package exposes no per-batch seam (`ImportOptions` has neither signal nor error hook); the process-level timeout is the outer bound.
- Q: How is a timeout kill distinguished from an external SIGTERM? A: `exitCode === null && durationMs >= resolvedTimeoutMs`. ts-runtime's `ProcessResult` drops execa's `timedOut` flag; upstream facade fix deferred. The comparison is exact for the timeout path (execa kills at the deadline) and conservatively labels an external kill past the deadline as a timeout.
- Q: Why is the per-source `Promise.race` timeout not the enforcement? A: It stops awaiting but never cancels — the import promise keeps running and touching the DB (history-service.ts:947-968). The process-level kill (R1) is the real bound; the race stays as per-source degradation.
- Q: Why change the tick enqueue's retry policy? A: the default 3-attempt policy re-pends a failed row, and `findActiveSchedulerCustomJob` counts `pending` as active — ticks would stay suppressed through the backoff, violating AC3. `maxRetries: 1` makes failures terminal; the next 15-min tick is the natural retry for an idempotent daily job.

### Design

Frozen for implementation. Anchors verified against the 2026-09-07 tree.

## R1 — child watchdog timeout (both `history daily` spawn sites)

WHAT: re-tune the existing scheduler.custom timeout, close the history.refresh gap, label timeout failures.

Frozen names:

- `SCHEDULER_CUSTOM_TIMEOUT_MS = 600_000` (was `3_600_000`) — packages/app/src/services/scheduler-custom-job-service.ts:43. Sized ~6× the observed healthy runtime (83–110s; the 40-min outlier in the incident stats was itself the wedge). Task 0734's constraint stays satisfied: 10 min is still comfortably under the queue's 2-hour visibility timeout.
- Env override `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` (positive integer ms; absent/invalid → default), parsed by a new exported helper `resolveSchedulerCustomTimeoutMs(env)` in scheduler-custom-job-service.ts. Follows the existing ad-hoc env convention (`SPUR_TEAM_AUTOSTART`, `SPUR_SKIP_GLOBAL_CONFIG`).
- `HistoryRefreshJobDeps.timeoutMs?: number` — packages/app/src/services/history-refresh-service.ts; `handleHistoryRefreshJob` passes `timeout: deps.timeoutMs ?? SCHEDULER_CUSTOM_TIMEOUT_MS` into its `executor.run` (call at :264, which today passes no timeout). Import the constant from scheduler-custom-job-service — no second constant.
- Timeout classification shared helper `isTimeoutResult(result, timeoutMs)`: `result.exitCode === null && result.durationMs >= timeoutMs`. On true, the thrown message becomes `… timed out after ${timeoutMs}ms (killed)` instead of the generic "terminated before a normal exit". Exactness: execa enforces the kill at the deadline (execa@9.6.1 terminate/timeout.js: `context.terminationReason = 'timeout'`; `subprocess.kill()`), so a non-timeout exit cannot overshoot the deadline; an external kill past the deadline is conservatively labelled timeout. ts-runtime's `ProcessResult` drops execa's `timedOut` flag (process-executor.js catch mapping) — upstream facade fix deferred, not worked around beyond this comparison.

WHERE: apps/server/src/serve.ts — resolve `resolveSchedulerCustomTimeoutMs(env)` once beside the queue-handler registrations and pass `timeoutMs` into both `handleSchedulerCustomJob` (:564-566) and `handleHistoryRefreshJob` (:549-560) deps.

WHY: bounds a wedged child's WAL write-lock hold to ≤ timeout + kill escalation (execa default SIGTERM then SIGKILL after a 5s grace — terminate/kill.js `DEFAULT_FORCE_KILL_TIMEOUT`). Kill enforcement, queue-attempt failure, and `queue.job.failed` → System Events observability already exist; only the default value, the history.refresh gap, and the error label change.

## R2 — PASSIVE checkpoint in the periodic path

WHAT: packages/domain/src/retention.ts compaction (:169): `PRAGMA wal_checkpoint(TRUNCATE)` → `PRAGMA wal_checkpoint(PASSIVE)`. No mode parameter — `runRetention` has exactly one caller (`HistoryService.daily`, history-service.ts:917), so parameterization would be speculative. `maintainDatabase` (maintenance.ts) is untouched: its only caller is the manual `spur history maintain` command (apps/cli/src/commands/maintain.ts:27 via `HistoryService.maintain` :618).

Trade accepted: after compaction's VACUUM the WAL stays large until readers drain — PASSIVE never blocks on readers and SQLite auto-checkpoint reclaims later. That is precisely the non-blocking behavior a 15-min background job needs on a DB shared with the always-on daemon.

## R3 — bounded BUSY tolerance + terminal failure

WHAT:

- packages/app/src/services/history-service.ts `importAll` (:837-854, deliberately sequential per task 0470 R7): new module const `HISTORY_BUSY_ABORT_THRESHOLD = 2` and pattern `/database is locked|SQLITE_BUSY/i`. After each source, classify BUSY when `coverageEntry.status === 'failed'` and its `source-failed` warning detail matches; two consecutive busy-classified failures throw `history import aborted: sustained SQLITE_BUSY contention (<n> consecutive sources)`, skipping all remaining sources. Any non-busy outcome resets the counter. The throw propagates through `daily()` to the CLI failure path — exit 1 + `history.daily.failed` event (emission already exists, apps/cli/src/commands/history.ts:543). Standalone `history import` inherits the same abort; that is desirable, not scope creep.
- apps/server/src/serve.ts tick enqueue (:212): add `{ maxRetries: 1 }` (same option shape the SYSTEM_EVENTS_PRUNE_JOB enqueue uses at :167). The default 3-attempt policy re-pends a failed row, and `findActiveSchedulerCustomJob` counts `pending` as active — ticks would stay suppressed through the whole backoff, violating AC3. The 15-min tick is the natural retry for an idempotent daily job.

## R4 — stale processing-row sweep on tick

WHAT:

- Extend `findActiveSchedulerCustomJob` (packages/domain/src/db.ts:645) to return `{ id, status, processingAt, updatedAt }` (SELECT gains `status, processing_at, updated_at`). Sole caller is serve.ts:201 — update it.
- New domain fn beside `failOrphanedProcessingJobs`: `failStaleSchedulerCustomJob(db, id, now, reason): Promise<boolean>` — guarded `UPDATE queue_jobs SET status='failed', last_error=?, processing_at=NULL, updated_at=? WHERE id=? AND status='processing'`, returning whether a row was flipped (the `status='processing'` guard leaves a row that completed between read and update untouched).
- In the serve.ts tick: when the active row has `status === 'processing'` and `now - (processingAt ?? updatedAt) > timeoutMs` (the R1-resolved timeout), sweep it with reason `watchdog: processing exceeded ${timeoutMs}ms`, emit `scheduler.job.executed` with `swept: true`, then fall through to enqueue a fresh job. Younger processing rows and any pending row keep today's skip-only behavior.

WHY: today's only recovery is the daemon-restart orphan sweep (`failOrphanedProcessingJobs`, serve.ts:567-573). R1 makes stuck rows rare; R4 covers the residual paths (kill-delivery failure, handler wedge) without a restart.

## Anti-patterns (do not implement)

- No new event types — `queue.job.failed` / `queue.job.retrying` + the system-event tap already make failures observable.
- No separate watchdog process, thread, or interval — execa's timeout kills the child; the tick sweep covers residual stuck rows.
- No busy-retry loop with sleep/backoff around importer batches — retrying lengthens lock wait; this design aborts instead.
- No upstream facade changes in this task (ts-runtime `timedOut`, ts-infra per-job timeout, importer AbortSignal) — see non-goals.
- Do not touch `history maintain`, VACUUM, or `PRAGMA optimize` behavior.

## File targets

- packages/app/src/services/scheduler-custom-job-service.ts — constant, env helper, timeout label.
- packages/app/src/services/history-refresh-service.ts — `timeoutMs` dep, timeout wiring, label.
- packages/app/src/services/history-service.ts — busy classification + consecutive abort in `importAll`.
- packages/domain/src/db.ts — extended `findActiveSchedulerCustomJob` + `failStaleSchedulerCustomJob`.
- packages/domain/src/retention.ts — PASSIVE.
- apps/server/src/serve.ts — env resolution, `timeoutMs` into both handlers, `maxRetries: 1`, tick sweep.
- docs/04_DESIGN.md — history surfaces: checkpoint semantics, env var, timeout default (same commit, T3).

## Handoffs

No `dependencies[]`; nothing blocks or is blocked by another task. Deliberately left for follow-ups (not required for AC1–AC4): ts-runtime exposing `timedOut` on `ProcessResult`; ts-infra `SchedulerJobConfig` per-job timeout; importer AbortSignal seam; daemon reader-connection hygiene.

### Plan

1. R2 — packages/domain/src/retention.ts: compaction checkpoint TRUNCATE → PASSIVE; fix the adjacent comment. Test: packages/domain/tests/retention.test.ts — spy `db.exec`, assert `wal_checkpoint(PASSIVE)` is issued and TRUNCATE absent; packages/domain/tests/maintenance.test.ts — assert `maintainDatabase` still issues TRUNCATE.
2. R1 — packages/app/src/services/scheduler-custom-job-service.ts: `SCHEDULER_CUSTOM_TIMEOUT_MS = 600_000`; add `resolveSchedulerCustomTimeoutMs(env)` + `isTimeoutResult(result, timeoutMs)`; timeout-labelled throw. Test: packages/app/tests/services/scheduler-custom-job-service.test.ts — fake executor resolving `exitCode: null, signal, durationMs >= timeout` → message contains "timed out after"; `durationMs < timeout` → existing "terminated before a normal exit"; env helper valid/invalid/absent cases.
3. R1 — packages/app/src/services/history-refresh-service.ts: `timeoutMs` dep, `timeout:` in `executor.run`, same label via the shared classifier. Test: packages/app/tests/services/history-refresh-service.test.ts — same fake-executor pattern.
4. R4 — packages/domain/src/db.ts: extend `findActiveSchedulerCustomJob` return shape; add `failStaleSchedulerCustomJob`. Test: the db/queue test file housing `failOrphanedProcessingJobs` tests (in-memory SQLite) — stale row flipped only while still `processing`; a row completed between read and update is untouched.
5. R1+R3+R4 — apps/server/src/serve.ts: resolve env timeout once, pass `timeoutMs` into both handler registrations; tick enqueue gains `{ maxRetries: 1 }`; tick sweeps a stale processing row before the single-flight skip and emits `scheduler.job.executed { swept: true }`. Test: apps/server/tests/serve.test.ts — extend the task-0734 tick tests: stale processing row → failed + fresh enqueue on the same tick; live processing row → skip, no sweep; enqueue options carry `maxRetries: 1`; env var propagates into handler deps.
6. R3 — packages/app/src/services/history-service.ts `importAll`: consecutive-busy counter + abort throw. Test: packages/app/tests/services/history-service.test.ts — two consecutive busy-classified source failures → throw, third source never attempted; busy → non-busy failure → busy does not abort.
7. Docs — docs/04_DESIGN.md history surfaces: PASSIVE in the periodic path, TRUNCATE only via `history maintain`, `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS`, 10-min default (same commit, T3).
8. Regression (AC4) — targeted: `cd packages/domain && bun test tests/retention.test.ts tests/maintenance.test.ts`; `cd packages/app && bun test tests/services/scheduler-custom-job-service.test.ts tests/services/history-refresh-service.test.ts tests/services/history-service.test.ts`; `cd apps/server && bun test tests/serve.test.ts`. Then `bun run spur-check` from the repo root.

Verification mapping: steps 2+3+5 → AC1 (kill + failed-marking within the timeout; concurrent-write headroom is the unchanged 30s `busy_timeout` behavior); step 1 → AC2; steps 5 (maxRetries) + 6 → AC3; step 8 → AC4.

### Root Cause

**Root-cause verdict.** Not "too many auto transactions" and not fixable by merging into one big
transaction (that would hold the write lock for the whole job — strictly worse). The defect set:

1. **No watchdog.** `scheduler.custom` children have no hard timeout; a wedged child pins the
   shared single-writer DB indefinitely. Its `processing` row also suppresses future refresh
   ticks (`findActiveSchedulerCustomJob`, `packages/domain/src/db.ts:645`) until the next daemon
   restart's orphan sweep (`failOrphanedProcessingJobs`).
2. **Blocking checkpoint in the periodic path.** `PRAGMA wal_checkpoint(TRUNCATE)` in
   `maintainDatabase` (`packages/domain/src/maintenance.ts:93`) and retention
   (`packages/domain/src/retention.ts:169`) holds the write lock while waiting for readers to
   drain — the wrong variant for a 15-minute background job on a DB shared with an always-on
   daemon's readers.
3. **Unbounded BUSY tolerance in the child.** Per-batch `SQLITE_BUSY` handling is not bounded
   into job-abort, so contention can spin the child through 30s waits indefinitely instead of
   degrading the refresh and releasing the lock.

### Solution

Bounded the periodic history-refresh job (task 0803): every periodic child now runs under one
daemon-resolved watchdog timeout, a wedged `processing` row self-heals on the next tick, the
`importAll` fan-out aborts on sustained `SQLITE_BUSY`, and the daily compaction path no longer takes
an exclusive checkpoint.

#### Change map

- `packages/app/src/services/scheduler-custom-job-service.ts:46-69` (R1) —
  `SCHEDULER_CUSTOM_TIMEOUT_MS` lowered 3,600,000 → 600,000 ms; new
  `resolveSchedulerCustomTimeoutMs(env)` parses `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` (positive
  integer, else default); new shared classifier `isTimeoutResult(result, timeoutMs)`
  (`exitCode === null && durationMs >= timeoutMs`); deadline kills now throw
  `scheduler job "<name>" timed out after <n>ms (killed)` while sub-deadline kills keep the generic
  terminated message.
- `packages/app/src/services/history-refresh-service.ts:248` (R1) — new optional `timeoutMs` dep
  threaded into the bounded `executor.run`; timeout label via the same shared classifier
  (`history refresh child timed out after <n>ms (killed)`).
- `packages/domain/src/db.ts:682-701` (R4) — `findActiveSchedulerCustomJob` now returns
  `ActiveSchedulerCustomJob` (`{ id, status, processingAt, updatedAt }`); new
  `failStaleSchedulerCustomJob(db, id, now, reason)` — guarded `status = 'processing'` UPDATE that
  sets `status='failed'`, `last_error`, `processing_at=NULL`, `updated_at`, and reads
  `SELECT changes()` so a row completed in between is never clobbered (returns boolean). Also fixed
  two pi-lens blockers in the same file (SAFETY comments at the `as unknown as DbAdapter`
  migration-seam casts; named `ParsedQueueJobPayload` return type replacing `unknown`).
- `packages/app/src/services/history-service.ts:418,874-876` (R3) — `importAll` classifies each
  per-source failure against `/database is locked|SQLITE_BUSY/i`; **2 consecutive** busy-classified
  failures abort the remaining sources with
  `history import aborted: sustained SQLITE_BUSY contention (<n> consecutive sources)`; any
  non-busy outcome resets the counter.
- `packages/domain/src/retention.ts:173` (R2) — `compactDatabase` checkpoints
  `PRAGMA wal_checkpoint(PASSIVE)` instead of `TRUNCATE`; `maintainDatabase` (manual path) keeps
  TRUNCATE.
- `apps/server/src/serve.ts:584,160-262` (R1/R3/R4) — resolves the timeout once at daemon boot and
  threads it into both queue-handler deps; `registerSchedulerEntries` takes `{ timeoutMs }`
  (defaults to the env-resolved value); the tick sweeps a stale `processing` row (older than the
  timeout by `processingAt ?? updatedAt`), emits `scheduler.job.executed` with `swept: true`
  (`serve.ts:237-243`), and falls through to enqueue fresh; tick enqueues carry `{ maxRetries: 1 }`
  (`serve.ts:262`) so a failed attempt goes terminal instead of re-pending and suppressing later
  ticks via single-flight.
- `packages/app/src/index.ts`, `packages/domain/src/index.ts` — mechanical re-exports of the new
  symbols only (`resolveSchedulerCustomTimeoutMs`, `isTimeoutResult`, `failStaleSchedulerCustomJob`,
  `ActiveSchedulerCustomJob`).
- `docs/04_DESIGN.md` — §5.2 execution bounds (600,000 ms default, env override, timeout label),
  tick policy (`maxRetries: 1`, stale-row sweep), `history daily` (bounded SQLITE_BUSY tolerance,
  PASSIVE checkpoint, watchdog note), `maintain` command row (TRUNCATE is manual-path only).

#### Tests

- `packages/domain`: `bun test tests/db.test.ts tests/retention.test.ts tests/maintenance.test.ts`
  → 50 pass / 0 fail (findActive 4-field shape, failStale flip/guards, PASSIVE + no-TRUNCATE in
  compaction, TRUNCATE kept in maintain).
- `packages/app`: `bun test tests/services/scheduler-custom-job-service.test.ts
  tests/services/history-refresh-service.test.ts tests/services/history-service.test.ts` → 102
  pass / 0 fail (resolver table, constant 600,000, timeout vs sub-deadline classification in both
  handlers, timeoutMs pass-through, B/B abort with codex unattempted, B/N/B reset, single-busy
  degrade).
- `apps/server`: `bun test tests/serve.test.ts` → 42 pass / 0 fail (stale sweep + `maxRetries: 1`
  enqueue, young-processing single-flight skip, real-child e2e: `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS=
  300` kills both handlers in ~300 ms with timeout labels; 0734 round-trip updated to the R3
  terminal-failure contract — the next tick is the retry).
- `tsc --noEmit` clean in domain, app, server.

#### Deviations

- The 0734 round-trip test's retry expectations were updated to the R3 contract (failing tick now
  goes terminal by design, not by queue retry) — sanctioned by the frozen design's
  `{ maxRetries: 1 }` enqueue option.
- Two pre-existing pi-lens blockers in `packages/domain/src/db.ts` (a declared target) were fixed
  minimally (comments/type name only, no behavior change).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/services/scheduler-custom-job-service.ts:46 (`SCHEDULER_CUSTOM_TIMEOUT_MS = 600_000`, was 3_600_000), :55 `resolveSchedulerCustomTimeoutMs` (absent/blank/invalid env falls back to the default — the watchdog can never be disabled), :69 `isTimeoutResult` (`exitCode === null && durationMs >= timeoutMs`), :140 timeout-labelled throw `scheduler job "<name>" timed out after <n>ms (killed)`. The previously unbounded site is now bounded: packages/app/src/services/history-refresh-service.ts:273 (timeoutMs dep defaulting to the shared constant), :282 (`timeout:` into `executor.run`), :294 (same timeout label). One boot-resolved value threads into both handlers: apps/server/src/serve.ts:584 (`resolveSchedulerCustomTimeoutMs(env)` once at boot), :612 (HistoryRefresh deps), :621-622 (scheduler.custom deps), :648-649 (tick sweep threshold). Kill escalation is execa SIGTERM→SIGKILL (existing executor). Observability rides the existing `queue.job.failed` tap — handler throw → attempt failure, no new event type. Tests: scheduler-custom-job-service.test.ts:195 (resolver table), :215 (timeout vs sub-deadline classification), history-refresh-service.test.ts:421, and a real-child e2e serve.test.ts:1004 (`SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS=300` kills both handlers; attempts reject with "timed out after 300ms (killed)"). |
| R2 | MET | packages/domain/src/retention.ts:173 — `PRAGMA wal_checkpoint(PASSIVE)` (was TRUNCATE); repo grep confirms the only remaining `wal_checkpoint(TRUNCATE)` is packages/domain/src/maintenance.ts:93, reachable solely from the manual `spur history maintain` path; `daily()` → `runRetention` (history-service.ts:917) remains compaction's sole caller, so no periodic TRUNCATE path survives. Tests: retention.test.ts:172-173 (spy on `db.exec` — PASSIVE issued, zero TRUNCATE in compaction), maintenance.test.ts:77-78 (maintain keeps TRUNCATE, no PASSIVE). docs/04_DESIGN.md updated in the same diff (daily-path PASSIVE + manual-only TRUNCATE rows). |
| R3 | MET | packages/app/src/services/history-service.ts:418 (`HISTORY_BUSY_ABORT_THRESHOLD = 2`), :420 (busy pattern matching "database is locked" or SQLITE_BUSY), :869-881 — per-source `source-failed` detail classified BUSY, two consecutive busy failures throw `history import aborted: sustained SQLITE_BUSY contention (<n> consecutive sources)` skipping remaining sources, any non-busy outcome resets the counter. Propagation verified: `daily()` awaits `importAll` directly (history-service.ts:913, no swallowing catch), the throw reaches the CLI catch (apps/cli/src/commands/history.ts:427-431) → `history.daily.failed` emitted (:450) + `setExitCode(1)` (:459) — non-zero exit. Terminal-failure half: apps/server/src/serve.ts:262 — tick enqueue carries `{ maxRetries: 1 }`. Tests: history-service.test.ts:1333 (two consecutive busy failures abort with codex unattempted; busy/non-busy/busy does not abort; single busy degrades per-source), serve.test.ts:1484 (real-queue round-trip: failing attempt terminal at attempts=1, zero `queue.job.retrying` → the next tick is not suppressed). |
| R4 | MET | packages/domain/src/db.ts:661-679 — `findActiveSchedulerCustomJob` now returns `ActiveSchedulerCustomJob` (`id, status, processingAt, updatedAt`, :682); :701-716 — `failStaleSchedulerCustomJob` guarded `WHERE ... AND status = 'processing'` UPDATE (failed + last_error + processing_at=NULL) reading `SELECT changes()`, so a row resolved between read and update is never clobbered. Tick sweep: apps/server/src/serve.ts:229-247 — stale = processing and `now - (processingAt ?? updatedAt) > timeoutMs` (the R1-resolved value), reason `watchdog: processing exceeded <n>ms`, `scheduler.job.executed` with `swept: true`, then falls through to the fresh enqueue on the same tick; younger processing rows and pending rows keep the single-flight skip + return (:249-260). Sole production caller updated in the same diff. Tests: db.test.ts:820 (flip while processing; completed-in-between row untouched), serve.test.ts:886 (stale row → failed + same-tick fresh enqueue), serve.test.ts:951 (young processing / pending keep the skip). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1. | MET | test | serve.test.ts:1004 runs a real wedged child under `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS=300`: both the scheduler.custom and history-refresh handler attempts are killed at the deadline and reject with the timeout label, so the job attempt fails and surfaces through the existing `queue.job.failed` → System Events tap. The failed-attempt marking is additionally proven end-to-end on a real queue at serve.test.ts:1484 (status failed, attempts 1). Concurrent-write clause: import writes remain per-batch transactions with the unchanged 30s busy_timeout seam, whose cross-process WAL contention behavior is regression-tested and passed in this run (db.test.ts SQLite contention case, domain suite 50/50). |
| AC2. | MET | test | Observably asserted at the `db.exec` seam: retention.test.ts:172-173 proves compaction issues `PRAGMA wal_checkpoint(PASSIVE)` and never TRUNCATE; maintenance.test.ts:77-78 proves `maintain` still issues TRUNCATE (and no PASSIVE). The no-writer-starvation property is SQLite-documented PASSIVE checkpoint semantics (task References, sqlite.org pragma docs). docs/04_DESIGN.md daily-path and maintain rows updated in the same commit. |
| AC3. | MET | test | history-service.test.ts:1333 — under scripted lock-error contention the fan-out aborts at 2 consecutive busy-classified failures, never attempting the third source, with the bounded-abort error message; a non-busy failure resets and a lone busy failure degrades per-source. The abort propagates to the CLI failure path emitting `history.daily.failed` with exit 1 (history-service.ts:913 → commands/history.ts:427-459, verified in source this run). Next-tick non-suppression: serve.test.ts:1484 real-queue round-trip — a failing tick goes terminal at attempts 1 with zero `queue.job.retrying`, so the single-flight lookup no longer suppresses subsequent ticks (maxRetries 1, serve.ts:262). |
| AC4. | MET | test | Re-run by this verify pass from inside each workspace: packages/domain (db + retention + maintenance tests) 50 pass / 0 fail; packages/app (scheduler-custom-job-service + history-refresh-service + history-service tests) 102 pass / 0 fail; apps/server (serve.test.ts, includes the real-child kill e2e) 42 pass / 0 fail. Full gate: `.spur/run/0803-test-gate.log` with status file PASS — lint, typecheck, 7716 tests / 0 fail across 426 files, `rule run` 2/2 passed, history-surface freeze check vs base 3b5c7e17. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Three-dimensional review (functional traceability + SECUA + architecture) of the working-tree diff vs base `3b5c7e17`. Evidence re-read at cited lines this run; targeted suites re-run this turn (50 + 102 + 42 pass / 0 fail; quality gate `.spur/run/0803-test-gate.log` = full `spur-check` chain, 7716 pass).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Correctness | `packages/domain/src/db.ts:701-716` | `failStaleSchedulerCustomJob` reads `SELECT changes()` as a second statement to learn whether the guarded UPDATE flipped the row. If another write on the same connection interleaves at the await boundary between UPDATE and SELECT, the boolean can misreport (a `swept: true` event for a row someone else resolved, or a silent skip of the event). The `status = 'processing'` guard still protects the row data; only the return value / event accuracy is affected, and the subsequent enqueue is correct in both cases. Non-blocking; revisit if `DbAdapter.run` ever exposes change counts. |
| P3 | Correctness | `packages/app/src/services/history-service.ts:420,871` | BUSY classification matches error-message text (`/database is locked\|SQLITE_BUSY/i`) against the `source-failed` warning detail (raw `Error.message`, `history-service.ts:1065-1066`). Wording drift in `bun:sqlite` or an upstream wrapper would silently disable the abort — worst case regresses to the pre-0803 per-source 30s burns, still bounded by the R1 watchdog. Accepted tradeoff (no errno seam through the per-source boundary); both spellings covered. Non-blocking; keep in sync if the import path starts wrapping errors. |
| P4 | Correctness | `packages/app/src/services/scheduler-custom-job-service.ts:55-62` | `Number()` accepts `'0x10'` / `'5e2'` / `'+5'` as positive integers, wider than a strict decimal-integer reading. Harmless: the watchdog can never be disabled by a bad override (invalid → default). No action needed. |
| P4 | Architecture | `apps/server/src/serve.ts:167,584` | The timeout is resolved at two sites (daemon boot :584 and `registerSchedulerEntries`'s `process.env` default :167). Documented in-code and keeps standalone callers consistent with the daemon; advisory only. |

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/scheduler-custom-job-service.ts:46` (`SCHEDULER_CUSTOM_TIMEOUT_MS = 600_000`), :55 (`resolveSchedulerCustomTimeoutMs`, invalid env → default), :69 (`isTimeoutResult`), :139-140 (timeout-labelled throw); `packages/app/src/services/history-refresh-service.ts:273,282,293-294` (`timeoutMs` dep → `timeout:` + same label — the previously unbounded site). Both handlers threaded from one boot-resolved value (`apps/server/src/serve.ts:584,612,622,649`). Tests: `scheduler-custom-job-service.test.ts:195,215`, `history-refresh-service.test.ts:421`, real-child kill e2e `serve.test.ts:1004` (`SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS=300` → both handlers reject with `timed out after 300ms (killed)`). |
| R2 | MET | `packages/domain/src/retention.ts:173` — `PRAGMA wal_checkpoint(PASSIVE)` (sole periodic-reachable TRUNCATE site flipped; grep confirms TRUNCATE remains only in `packages/domain/src/maintenance.ts:93`, manual `history maintain`). Tests: `retention.test.ts:172` (PASSIVE issued, TRUNCATE absent), `maintenance.test.ts:77` (maintain keeps TRUNCATE). |
| R3 | MET | `packages/app/src/services/history-service.ts:418,420` (threshold 2 + pattern), :867-882 (consecutive-busy counter, non-busy resets, abort throw) against `source-failed` detail from :1065-1066; throw propagates through `daily()` to the CLI catch → `history.daily.failed` + exit 1 (`apps/cli/src/commands/history.ts:428-431,450`). Tick enqueue `{ maxRetries: 1 }` at `apps/server/src/serve.ts:262`; real-queue round-trip proves terminal-at-attempt-1 (`serve.test.ts:1484` — `failed`, `attempts: 1`, zero `queue.job.retrying`). Tests: `history-service.test.ts:1333` (B/B abort with third source unattempted; B/N/B no-abort; single-busy degrade), `serve.test.ts:886`. |
| R4 | MET | `packages/domain/src/db.ts:661-679` (4-field `findActiveSchedulerCustomJob` + `ActiveSchedulerCustomJob`), :701-716 (`failStaleSchedulerCustomJob`, guarded UPDATE + changes read); tick sweep with `processingAt ?? updatedAt` vs the R1 timeout, `swept: true` event, fall-through enqueue (`apps/server/src/serve.ts:229-247,262`); sole production caller updated. Tests: `db.test.ts:820` (flip + completed-in-between guard + pending guard), `serve.test.ts:886` (stale → failed + same-tick enqueue), `serve.test.ts:951` (young processing / pending keep single-flight skip). |

**AC cross-check.** AC1 — kill + terminal failure within the configured timeout is directly tested with a real child at `serve.test.ts:1004`; the concurrent-write clause rests on unchanged per-batch transaction behavior (30s `busy_timeout`, existing suite green). AC2 — PASSIVE vs TRUNCATE observably asserted at the `exec` seam (`retention.test.ts:172`, `maintenance.test.ts:77`); the no-starvation property is SQLite-documented PASSIVE semantics (task References). AC3 — bounded abort + `history.daily.failed` (`history-service.test.ts:1333`, `history.ts:450`) and the un-suppressed next tick via terminal failure (`serve.test.ts:1484`). AC4 — full `spur-check` chain PASS in `.spur/run/0803-test-gate.log` (lint, typecheck, 7716 tests, rules, `history-surface-freeze-check` vs base 3b5c7e17).

#### SECUA (S/E/C/U/A)

No security findings (no new input surfaces; env var parsed with fail-safe default; no secrets). Efficiency: the abort and watchdog strictly reduce lock-hold time. Correctness: P3 rows above; timeout-vs-external-kill classification is conservatively labelled and exact for the execa deadline path (`durationMs` on `ProcessResult`, ts-runtime `process-executor.d.ts:109`). Usability: timeout-labelled `last_error` and the `watchdog:` sweep reason make failures distinguishable in System Events. Architecture: no new cross-package seams; domain owns row-state mutation, app owns child policy, one shared classifier (no duplicated constant).

#### Architecture depth

Five-lens scan over the diff: no shallow module added (`resolveSchedulerCustomTimeoutMs` / `isTimeoutResult` / `failStaleSchedulerCustomJob` each have a real body, docs, and dedicated tests); locality good (watchdog fn beside `failOrphanedProcessingJobs`); test surfaces inject at the `ProcessExecutor` seam, in-memory SQLite, and a real-queue round-trip. No blocker/major deepening candidates. Advisory: the P4 dual-resolution note above.

#### Scope and residual risk

Diff hunks outside R1–R4: two pi-lens fixes in `packages/domain/src/db.ts` (SAFETY comments at the migration-seam casts; named `ParsedQueueJobPayload` type) — no behavior change, documented under Solution → Deviations; well under the scope-creep threshold. Residual risks accepted by design and re-affirmed here: `maxRetries: 1` applies to every configured `scheduler.custom` job (not just history-refresh; documented in `docs/04_DESIGN.md`); a swept row whose handler later wakes can at most lose a status write (guarded) while the R1 kill bounds the child; docs updated in the same commit (`docs/04_DESIGN.md` §execution bounds, tick policy, daily/maintain checkpoint semantics).

Disposition: all four requirements MET with fresh line-anchored evidence; no blocker/major findings. Reviewed diff is approvable — no source edits made by this review.

Functional Verdict: PASS
Review Verdict: PASS (functional PASS · SECUA no P1–P2 findings · architecture no blocker/major)

### References

- Incident: dogfood of `/sp:dev-run 0800`, run `2026-09-07-dev-run-0800` (2026-09-07) — ~35-min corpus-write block; wedged child PID 56111, `.spur/spur.db-wal` byte-static (1,742,792 B) for 27+ min; queue job `ddd6de09` (`scheduler.custom`, processing since 21:15:00Z).
- Prior art: task 0734 (`scheduler.custom` jobs; 60-min timeout constant), task 0717 (`history.refresh` runs `history daily` in a child process), task 0549 (coalesced refresh enqueue), task 0470 (daily pipeline; deliberately sequential fan-out, R7), bug-245 lineage (`SQLITE_BUSY_TIMEOUT_MS = 30_000`, packages/domain/src/db.ts:19).
- Verified seams (this tree, 2026-09-07): scheduler-custom-job-service.ts:43 (constant), :100 (timeout wiring); history-refresh-service.ts:264-277 (no timeout today); serve.ts:548-566 (child executor + registrations), :199-213 (tick single-flight skip), :567-573 (startup-only orphan sweep); db.ts:645 (`findActiveSchedulerCustomJob`), :665 (`failOrphanedProcessingJobs`); retention.ts:169 (TRUNCATE — sole periodic site, via compaction); maintenance.ts (TRUNCATE — manual-only via `history maintain`); history-service.ts:837-854 (sequential loop), :917 (`runRetention` in `daily()`), :1036-1056 (`source-failed` catch shape).
- ts-runtime process executor (execa@9.6.1): timeout → SIGTERM at the deadline, SIGKILL after a 5s default grace (`forceKillAfterDelay`, terminate/kill.js `DEFAULT_FORCE_KILL_TIMEOUT`); `timedOut` is dropped from the mapped `ProcessResult`.
- SQLite WAL checkpoint semantics: <https://sqlite.org/pragma.html#pragma_wal_checkpoint> — PASSIVE never blocks on or waits for readers/writers; TRUNCATE waits for readers and blocks writers.

### History

- 2026-09-07T23:58:11.574Z todo → wip (system)
- 2026-09-08T00:27:06.433Z wip → testing (system)
- 2026-09-08T00:30:14.858Z testing → done (system)

