# History Refresh Process Isolation and Single-Flight Execution

**Status:** Accepted; built — 0716 single-flight, 0717 process isolation  
**Date:** 2026-08-29  
**Feature:** E31  
**Decision:** ADR-101

## Current failure

`spur serve` drains `history.refresh` jobs in its own Bun process. The handler calls
`HistoryService.daily()` directly; its synchronous filesystem and `bun:sqlite` work blocks the
server event loop long enough for the web client's 10-second abort timer to fire.

The current uniqueness constraint covers only `status = 'pending'`. Schedule and Board producers
bypass the coalescing writer, and a processing job is intentionally invisible to it. A second row
can therefore be queued while the first refresh is running. The queue handler also receives a
`Job<HistoryRefreshPayload>` envelope but currently parses that envelope as the payload, losing
`trigger`, window, and manual `importMode` values.

## Chosen flow

```text
schedule | completion | Board manual import
                  │
                  ▼
       enqueueHistoryRefresh (one writer)
                  │
       queue_jobs partial unique index
       type = history.refresh AND
       status IN (pending, processing)
                  │
                  ▼
       server queue handler unwraps job.payload
                  │
                  ▼
       NodeProcessExecutor.run (awaited Promise)
                  │
                  ▼
same Spur entrypoint history daily --json (child process)
                  │
                  ▼
      shared WAL SQLite + history artifacts
```

The queue handler remains awaited so queue completion/retry semantics stay truthful, but the
filesystem and SQLite work runs in another OS process. The Bun server event loop remains available
to Hono/oRPC while the child is active.

## Invocation contract

- `apps/cli` resolves the current PATH-independent Spur invocation with the existing
  `resolveSpurBin()` helper and passes it into `startServer`.
- The history job runner splits that trusted invocation with the existing `splitLaunchCommand()`
  helper and calls the existing `ProcessExecutor` seam with:
  - `cwd`: project root;
  - args: `<leading args> history daily --json --json-envelope`;
  - a bounded output buffer large enough for `DailyResult`;
  - `SPUR_HISTORY_REFRESH_CONTEXT`: serialized, validated `HistoryRefreshPayload` for this child
    invocation only.
- `history daily` uses that internal context to select `full` or `incremental` import and attach
  `trigger`/window metadata to its existing `history.*` events. Normal interactive invocations,
  where the variable is absent, are unchanged.
- A non-zero exit, spawn failure, or invalid JSON result throws from the handler. The existing queue
  consumer then owns retry/failure state and `queue.job.retrying|failed` events.

No public noun or verb is added. `SPUR_HISTORY_REFRESH_CONTEXT` is an internal parent-to-child
contract, not project configuration; malformed values fail before import starts.

## Single-flight contract

All three producers call `enqueueHistoryRefresh`; none call raw `JobQueue.enqueue` for
`history.refresh`.

| Existing active row | Result | Payload behavior |
| --- | --- | --- |
| none | `enqueued` | Insert one pending row. Completion triggers retain their debounce delay; schedule/manual requests are due immediately. |
| pending | `coalesced` | Merge into that row: earliest `windowStart`, latest `windowEnd`, and `full` dominates `incremental`. An immediate request may shorten, never extend, an existing due time. |
| processing | `already-running` | Insert nothing and return the running job id. Periodic/completion work is checkpoint-idempotent; a manual caller receives the explicit running outcome and can retry after completion. |

The database constraint is the concurrency authority:

```sql
CREATE UNIQUE INDEX queue_jobs_history_refresh_active_unique
ON queue_jobs (type)
WHERE type = 'history.refresh' AND status IN ('pending', 'processing');
```

The migration drops the pending-only index after deterministically retiring duplicate active
history rows, then creates the active index. `INSERT ... ON CONFLICT DO NOTHING` plus a guarded
pending update resolves concurrent producers without surfacing a uniqueness error. Other job types
retain their existing multiplicity.

## Observable outcomes

- Completion producers keep their current non-fatal warning policy if enqueue fails.
- Scheduled enqueue failures surface through `scheduler.job.executed`.
- Board manual import returns the existing job id plus a closed status value:
  `queued | coalesced | already-running`.
- `history.refresh.enqueued` records the enqueue outcome and payload window.
- The child retains `history.import.completed`, `history.analyze.completed`, and
  `history.daily.failed`; the queue retains `queue.job.completed|retrying|failed`.

## Verification

1. Hold a real child process open and prove Board/API requests complete before the existing
   10-second web timeout.
2. Race two independent SQLite adapters and prove exactly one pending/processing refresh exists.
3. Exercise schedule, completion, and manual producers against pending and processing rows.
4. Assert the queue handler reads `job.payload`, preserves `full` mode and trigger/window metadata,
   and rejects non-zero or malformed child results.
5. Run server and child against one WAL database; verify lock waits are bounded by the existing
   5-second `busy_timeout` and failures remain visible without blocking the server event loop.

## As-built (0716–0717)

- Writer + index: `enqueueHistoryRefresh` (`packages/app/src/services/history-refresh-service.ts`) over
  migration 0027's pending-or-processing unique index; Board returns `queued | coalesced | already-running`.
- Handler: `handleHistoryRefreshJob({ cwd, databaseUrl, invocation, executor }, job)` — input is the raw `Job` envelope;
  `validateHistoryRefreshPayload(job.payload)` is the type gate (envelope-as-payload fails the attempt).
- Child command: `splitLaunchCommand(invocation)` + `executor.run(... 'history', 'daily', '--json',
  '--json-envelope')` in `cwd`, `maxOutput` 1 MB; env carries both
  `SPUR_HISTORY_REFRESH_CONTEXT = JSON.stringify(payload)` and the server's resolved `DATABASE_URL`.
- `apps/cli serve` passes `spurInvocation: resolveSpurBin()` into `startServer`; a missing invocation
  fails the attempt at run time (split error), never a shell string. The standalone server entry resolves
  the source-local CLI under Bun/Node and the sibling `dist/cli/spur` for the compiled binary.
- Every fresh coalesced refresh row uses the queue schema's shared `max_retries = 3` policy, including
  schedule ticks; unifying the producer changes the old scheduler-only value of 1 intentionally.
- The server queue visibility timeout is two hours, covering six sequential ten-minute source bounds
  plus analysis. The upstream 30-second default must not reset and reclaim a live refresh row.
- `history daily` parses the context env before creating the event bus/ledger (malformed context exits 1
  before any import); when present it selects and stamps the resolved `importMode` plus `trigger`/window
  (`coverage` on import) onto its existing `history.*` events. Absent env: interactive behavior unchanged.
- Failures (abnormal termination, non-zero exit, invalid JSON, wrong shape) throw bounded detail; a
  non-zero JSON envelope contributes its child error message before stderr. Queue retry/failure
  state and `queue.job.*` events stay owned by the consumer. R1/R5 verified by the held-open-child and
  WAL busy-timeout tests (see task 0717).

## Rejected alternatives

| Alternative | Rejected because |
| --- | --- |
| Raise the web RPC timeout | Hides the event-loop stall and leaves concurrent refresh possible. |
| Keep in-process execution with a boolean/mutex | Protects one process only and does not isolate synchronous filesystem/SQLite work. |
| Add a worker-thread protocol or daemon | Adds a second execution/runtime contract when the existing CLI and `ProcessExecutor` already provide the required OS-process boundary. |
