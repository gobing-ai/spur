---
schema_version: 1
name: "Run queued history refreshes in an isolated child process"
status: todo
template: feature-impl
created_at: 2026-08-29T23:11:49.416Z
updated_at: "2026-08-29T23:11:59.366Z"
feature_id: E31
priority: P1
tags: ["history", "reliability", "process"]
dependencies: ["0716"]
---

## 0717. Run queued history refreshes in an isolated child process

### Background

Implements feature scenarios R1 — A running refresh does not block Board requests, R2 — The queue worker reuses the existing daily command in a child process, R5 — Refresh intent survives the queue envelope, R6 — Child-process failure fails the queue job visibly, and R7 — SQLite contention remains bounded and visible. The queue handler currently calls `HistoryService.daily` inside the Bun server process and parses the `Job` envelope as if it were `HistoryRefreshPayload`.

Rubric: E8 D1 L4 C1 R2 = 16 → decompose (force: R=high). Depends on the single-flight task; process isolation must not ship while multiple consumers can launch overlapping children. Rejected split: payload repair, CLI context, responsiveness, and failure handling are one process-boundary review and share the same handler/tests.

### Requirements

- [ ] R1. Keep Hono/oRPC responsive while a real history refresh child remains active, with Board requests completing before the existing 10-second web timeout.
- [ ] R2. Resolve the same PATH-independent Spur entrypoint that launched `serve` and run `history daily --json` through the existing `ProcessExecutor`, awaited by the queue handler but never executing import/analyze filesystem or SQLite work in the server process.
- [ ] R3. Consume `Job.payload` rather than the queue envelope and carry validated trigger, window, and `full | incremental` mode through the internal child context into daily execution and existing history events.
- [ ] R4. Treat spawn errors, non-zero exit, and invalid JSON as queue-attempt failures so existing retry/failure state and system events remain truthful.
- [ ] R5. Preserve the shared WAL database and existing 5-second busy timeout, surfacing lock failures without blocking the server event loop.

### Acceptance Criteria

```gherkin
Feature: Isolated history refresh execution

  @core
  Scenario: R1 — A running refresh does not block Board requests
    Given the Spur server is serving Board API requests
    And a queued history refresh child process is still running
    When the Board requests data during that refresh
    Then the requests complete before the existing web RPC timeout
    And no request fails because its abort signal timed out

  @core
  Scenario: R2 — The queue worker reuses the existing daily command in a child process
    Given a history refresh job is ready
    When the queue worker handles the job
    Then it invokes the source-local `spur history daily --json` command through the existing process executor
    And the server process does not execute import or analyze work directly

  @core
  Scenario: R3 — Refresh intent survives the queue envelope
    Given a scheduled or manual refresh includes a trigger, import mode, and requested window
    When the queue worker starts the child process
    Then the child receives the same trigger, import mode, and requested window
    And completion telemetry reports those values rather than defaults

  @edge
  Scenario: R4 — Child-process failure fails the queue job visibly
    Given the history refresh child process exits non-zero or returns invalid JSON
    When the queue worker handles its result
    Then the queue job is marked failed and follows its configured retry policy
    And the failure is recorded through the existing system-event surface

  @edge
  Scenario: R5 — SQLite contention remains bounded and visible
    Given the server and refresh child process access the project database concurrently
    When either side encounters a lock beyond the configured busy timeout
    Then the affected operation fails with its original database error
    And the server event loop remains responsive
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: inject the existing `ProcessExecutor` seam and the CLI's existing `resolveSpurBin()` result into the history queue handler. Split the trusted invocation with `splitLaunchCommand()` and execute `<leading args> history daily --json` in the project root. One validated internal `SPUR_HISTORY_REFRESH_CONTEXT` JSON value carries the queue payload and import mode; absence leaves interactive daily behavior unchanged. The child owns existing `history.*` events, while the parent validates exit/output and lets the queue own retry state.

Rejected: increasing the RPC timeout leaves the event-loop stall; worker threads add a second runtime protocol; a new daemon or public command duplicates the existing CLI/process seam; fire-and-forget would mark the queue job complete before work finishes.

Invariants: handler input is `Job<HistoryRefreshPayload>` and only `job.payload` crosses the child boundary; no shell command string is evaluated; malformed child context fails before import; no duplicate parent/child business event emission; output is bounded and parsed before queue completion.

### Plan

1. Add validated internal refresh-context parsing to `history daily` and thread import mode/event metadata without changing normal invocations.
2. Pass the PATH-independent current Spur invocation from CLI serve bootstrap into the server history handler.
3. Replace direct `HistoryService.daily` execution with awaited `ProcessExecutor.run`, unwrap `job.payload`, and fail on spawn/exit/JSON errors.
4. Add held-open-child responsiveness, payload/mode propagation, failure, and WAL contention tests.
5. Reconcile ADR-101/architecture/design surfaces to the as-built contract and run targeted plus workspace gates.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
