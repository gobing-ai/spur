---
topic: History refresh process isolation and single-flight execution
date: 2026-08-29
needs_design: true
run_id: inline-history-refresh-20260829
---

# Brainstorm: History refresh process isolation and single-flight execution

## Overview

The scheduled refresh is already asynchronous at the Promise/queue level, but not isolated from the
Board server. `JobWorkerService` awaits `handleHistoryRefreshJob` in the same Bun process that owns
`Bun.serve`; that handler calls `HistoryService.daily`, whose `bun:sqlite` adapter and several file
operations are synchronous. The browser aborts API requests after 10 seconds, which explains the
reported `signal is aborted without reason` symptom when main-thread work delays responses.

Live evidence is material: 190 completed `history.refresh` queue events range from 32.6 to 205.4
seconds (57.7-second mean). Current overlap protection is partial: `enqueueCoalesced` plus the
partial unique index permits at most one `pending` refresh, but intentionally ignores a refresh once
it becomes `processing`. The schedule path also bypasses that helper and calls `queue.enqueue`
directly. This is queueing/coalescing, not single-flight execution.

## Approaches

### Approach 1: Existing CLI in a child process plus DB-backed single-flight ⭐ Recommended

**Description:** Keep the existing queue and `HistoryService.daily` pipeline, but have the server
handler invoke the shipped `spur history daily --json` command through `ProcessExecutor`. The queue
job remains `processing` while the child runs, but HTTP/SSE stays in the parent process. Route every
refresh trigger through one enqueue service and make its database invariant cover both `pending`
and `processing`, returning an observable skip/coalesce outcome when a refresh is already in flight.

**Trade-offs:**

- **Pros:** Reuses the existing CLI pipeline, event persistence, checkpointing, process executor,
  and SQLite WAL/busy-timeout behavior; smallest solution that actually removes main-thread work.
- **Cons:** A second process contends on the same SQLite database; parent/child exit and output
  parsing must fail loud; trigger metadata must remain observable.

**Implementation notes:**

- Do not add a new public command or queue implementation.
- Preserve `incremental` versus manual `full` mode across the queue-job envelope.
- Test a tick while `processing`, two producer connections racing, child failure, and parent HTTP
  responsiveness while the child is held open.

**Confidence:** HIGH for process isolation; MEDIUM-HIGH for the contention ceiling until measured.

**Sources:** `apps/server/src/serve.ts:492-518`, `apps/cli/src/commands/history.ts:263-414`,
`packages/app/src/services/history-service.ts:622-666`, `packages/domain/src/db.ts:18-31`, and live
`.spur/logs/system-events.jsonl`, verified 2026-08-29.

### Approach 2: Dedicated Bun worker thread

**Description:** Run `HistoryService.daily` inside a Bun worker thread and return a typed result to
the server for event emission.

**Trade-offs:**

- **Pros:** Avoids a CLI subprocess and can preserve typed app-service results directly.
- **Cons:** Introduces worker bootstrap/protocol/lifecycle code, separate DB/config initialization,
  error serialization, and tests for a boundary the codebase does not currently use for this job.

**Confidence:** MEDIUM. Technically viable, but larger than the existing-process-executor path.

**Sources:** current process-executor inventory in `apps/server/src/context.ts` and
`packages/app/src/services/history-refresh-service.ts`, verified 2026-08-29.

### Approach 3: Serialize only; keep the work in-process

**Description:** Add a pending/processing guard and leave `HistoryService.daily` inside the server.

**Trade-offs:**

- **Pros:** Smallest code diff; prevents redundant queued work.
- **Cons:** Does not address the reported UI outage because synchronous SQLite/filesystem work still
  occupies the server event loop. Raising the client timeout only hides the same fault.

**Confidence:** HIGH that this is insufficient as the complete fix.

**Sources:** `apps/web/src/lib/rpc-client.ts:42-55`,
`node_modules/@gobing-ai/ts-db/src/adapters/bun-sqlite.ts:78-111`, verified 2026-08-29.

## Recommendations

Proceed with Approach 1. Treat process isolation and single-flight as one feature with two ordered
deliverables: first make enqueue/processing identity truthful and race-safe; then move the refresh
body across the existing process boundary without losing result/error observability. Do not spend a
task on increasing the HTTP timeout or inventing another scheduler.

The implementation should also correct the queue envelope seam: queue handlers receive a `Job<T>`,
but the registered history handler currently passes that wrapper to a parser expecting the inner
payload. Live schedule events therefore render as `trigger: task-done`, `windowStart: 0`, proving
the metadata loss. Fix it at the shared handler registration while touching this boundary.

## Next Steps

1. Create a feature with AC for UI responsiveness, process isolation, cross-trigger single-flight,
   preserved import mode/trigger metadata, and observable child failure.
2. Author the process/queue boundary design and reconcile the stale “off the hot path” claim in E3
   and the schedule-overlap claim in `docs/04_DESIGN.md`.
3. Decompose into two dependency-ordered implementation tasks: single-flight/envelope correctness,
   then child-process isolation/responsiveness.

## Design Summary

Keep the scheduler, embedded queue, `history.refresh` job kind, `HistoryService.daily`, and public
CLI unchanged. Consolidate schedule/manual/completion producers on one application enqueue seam;
enforce one refresh across pending and processing states in SQLite so multiple producers/processes
cannot race; expose `enqueued`, `coalesced`, or `already-running` as explicit outcomes. The server
job handler unwraps the queue `Job` envelope, launches the existing `spur history daily --json`
surface through the repository's `ProcessExecutor`, awaits it without blocking the event loop, and
maps exit/output into queue and history observability. No new daemon, command, dependency, or queue
abstraction.

Self-review: no placeholders; alternatives are distinct; the recommended boundary, invariants,
failure behavior, task ordering, and non-goals are explicit. Scope is limited to refresh scheduling
and execution; importer/analyzer algorithms and Board timeout policy remain unchanged.

---

**Generated by:** sp-brainstorm (inline operator override)
**Research:** local source, tests, queue database, and runtime event log; no external claims
