---
schema_version: 1
name: "Bound the periodic history-refresh job: child watchdog timeout, PASSIVE checkpoint in daily path, bounded BUSY retry — a wedged history-daily child held the WAL write lock 30+ min and blocked all corpus writes"
status: todo
template: issue
created_at: 2026-09-07T21:54:35.183Z
updated_at: "2026-09-07T22:40:41.383Z"

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

- [ ] R1. Both `history daily` child spawn sites enforce a hard wall-clock timeout — default 600_000 ms (10 min), overridable via the `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` env var. On expiry the child is killed (execa timeout: SIGTERM, escalating to SIGKILL), the job attempt fails with a timeout-labelled `last_error` (message says "timed out"), and the failure is observable in System Events via the existing `queue.job.failed` tap. Covers `handleSchedulerCustomJob` (today: 60-min default, `SCHEDULER_CUSTOM_TIMEOUT_MS = 3_600_000`) and `handleHistoryRefreshJob` (today: no timeout at all).
- [ ] R2. The periodic `history daily` path never runs `wal_checkpoint(TRUNCATE)`: retention compaction — the only TRUNCATE reachable from `daily()` (`daily()` → `runRetention`, history-service.ts:917 → retention.ts:169) — uses `wal_checkpoint(PASSIVE)`. The manual `spur history maintain` path (`maintainDatabase`) keeps TRUNCATE.
- [ ] R3. A daily/import run bounds cumulative `SQLITE_BUSY` tolerance: after 2 consecutive source failures classified as BUSY the run aborts the remaining sources and fails fast (non-zero exit + `history.daily.failed` event) instead of letting each remaining source burn its own 30s `busy_timeout`; and the scheduler tick enqueues `scheduler.custom` with `maxRetries: 1` so a failed attempt goes terminal instead of re-pending and suppressing later ticks.
- [ ] R4. A `processing` `scheduler.custom` row older than the resolved timeout is failed by the next scheduler tick of the same job name (no daemon restart required) and a fresh job is enqueued on that same tick; a younger processing row or any pending row keeps today's skip behavior.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Incident: dogfood of `/sp:dev-run 0800`, run `2026-09-07-dev-run-0800` (2026-09-07) — ~35-min corpus-write block; wedged child PID 56111, `.spur/spur.db-wal` byte-static (1,742,792 B) for 27+ min; queue job `ddd6de09` (`scheduler.custom`, processing since 21:15:00Z).
- Prior art: task 0734 (`scheduler.custom` jobs; 60-min timeout constant), task 0717 (`history.refresh` runs `history daily` in a child process), task 0549 (coalesced refresh enqueue), task 0470 (daily pipeline; deliberately sequential fan-out, R7), bug-245 lineage (`SQLITE_BUSY_TIMEOUT_MS = 30_000`, packages/domain/src/db.ts:19).
- Verified seams (this tree, 2026-09-07): scheduler-custom-job-service.ts:43 (constant), :100 (timeout wiring); history-refresh-service.ts:264-277 (no timeout today); serve.ts:548-566 (child executor + registrations), :199-213 (tick single-flight skip), :567-573 (startup-only orphan sweep); db.ts:645 (`findActiveSchedulerCustomJob`), :665 (`failOrphanedProcessingJobs`); retention.ts:169 (TRUNCATE — sole periodic site, via compaction); maintenance.ts (TRUNCATE — manual-only via `history maintain`); history-service.ts:837-854 (sequential loop), :917 (`runRetention` in `daily()`), :1036-1056 (`source-failed` catch shape).
- ts-runtime process executor (execa@9.6.1): timeout → SIGTERM at the deadline, SIGKILL after a 5s default grace (`forceKillAfterDelay`, terminate/kill.js `DEFAULT_FORCE_KILL_TIMEOUT`); `timedOut` is dropped from the mapped `ProcessResult`.
- SQLite WAL checkpoint semantics: https://sqlite.org/pragma.html#pragma_wal_checkpoint — PASSIVE never blocks on or waits for readers/writers; TRUNCATE waits for readers and blocks writers.

### History
