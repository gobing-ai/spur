---
schema_version: 1
name: "Run queued history refreshes in an isolated child process"
status: done
template: feature-impl
created_at: 2026-08-29T23:11:49.416Z
updated_at: "2026-08-30T23:46:23.830Z"
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

- [x] R1. Keep Hono/oRPC responsive while a real history refresh child remains active, with Board requests completing before the existing 10-second web timeout.
- [x] R2. Resolve the same PATH-independent Spur entrypoint that launched `serve` and run `history daily --json` through the existing `ProcessExecutor`, awaited by the queue handler but never executing import/analyze filesystem or SQLite work in the server process.
- [x] R3. Consume `Job.payload` rather than the queue envelope and carry validated trigger, window, and `full | incremental` mode through the internal child context into daily execution and existing history events.
- [x] R4. Treat spawn errors, non-zero exit, and invalid JSON as queue-attempt failures so existing retry/failure state and system events remain truthful.
- [x] R5. Preserve the shared WAL database and existing 5-second busy timeout, surfacing lock failures without blocking the server event loop.

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
Implemented the existing child-process seam end to end:

- `history daily` validates `SPUR_HISTORY_REFRESH_CONTEXT`, applies `full | incremental`, and stamps trigger/window/mode metadata on child-owned history events.
- Both server launchers resolve a PATH-independent Spur invocation and pass the resolved project database URL to the child.
- `handleHistoryRefreshJob` validates only `job.payload`, runs `history daily --json --json-envelope` through `ProcessExecutor`, bounds output, and throws on spawn, exit, JSON, or shape failure so queue retry state remains truthful.
- Held-open-child, payload propagation, failure, CLI integration, and cross-connection WAL/busy-timeout tests cover the process boundary.

Post-verification lock regression:

- Multiple same-project servers exposed the upstream queue consumer's 30-second visibility default: a second consumer reset and reclaimed the same still-running `history.refresh` row, launching duplicate children against `.spur/spur.db`.
- `apps/server/src/context.ts:104-107,615-627` now gives the shared server queue a two-hour visibility timeout, covering six sequential ten-minute source bounds plus analysis without adding a new configuration surface.
- `apps/server/tests/context.test.ts:337-360` proves a refresh older than 30 seconds remains `processing` and is not reclaimed.
- The exact post-check command now passes after the duplicate local consumers were stopped.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/history-refresh-service.ts:238-254` awaits `ProcessExecutor` instead of running history work in-process; `packages/app/tests/services/history-refresh-service.test.ts:388-412` keeps real-clock probes responsive while the child remains active; `apps/server/src/context.ts:104-107,615-627` leases the live queue row for two hours and `apps/server/tests/context.test.ts:337-360` proves it is not reclaimed at 30 seconds. |
| R2 | MET | `packages/app/src/services/history-refresh-service.ts:243-254` splits the trusted invocation and runs `history daily --json --json-envelope`; `apps/cli/src/commands/serve.ts:61` and `apps/server/src/index.ts:19-43` provide PATH-independent invocations for both launchers. |
| R3 | MET | `apps/cli/src/commands/history.ts:283-336` parses the child context, applies `importMode`, and builds trigger/window/mode event metadata; `packages/app/src/services/event-names.ts:861-921` retains it through metadata projection; `apps/cli/tests/commands/history.test.ts:472-523` proves the real CLI consumer and persisted events end to end. |
| R4 | MET | `packages/app/src/services/history-refresh-service.ts:255-282` rejects abnormal termination, non-zero exit, invalid JSON, and wrong shape with bounded detail; `packages/app/tests/services/history-refresh-service.test.ts:333-392` exercises every failure class. |
| R5 | MET | `packages/app/src/services/history-refresh-service.ts:215-253` carries the server database URL into the isolated child; `packages/domain/tests/db.test.ts:736-799` proves WAL, the bounded five-second lock failure, and recovery across connections. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — A running refresh does not block Board requests | MET | test | `packages/app/tests/services/history-refresh-service.test.ts:388-412` proves event-loop responsiveness; `apps/server/tests/context.test.ts:337-360` prevents duplicate live children across consumers; comprehensive gate passed 6780 tests. |
| Scenario: R2 — The queue worker reuses the existing daily command in a child process | MET | test | `packages/app/tests/services/history-refresh-service.test.ts:297-319` asserts command, args, cwd, output bound, payload context, and `DATABASE_URL`; `apps/server/tests/index.test.ts:41-48` proves source and compiled standalone paths. |
| Scenario: R3 — Refresh intent survives the queue envelope | MET | test | `apps/cli/tests/commands/history.test.ts:472-523` proves `full` reaches `HistoryService.daily` and trigger/window/mode/coverage survive ledger persistence; `packages/app/tests/services/event-names.test.ts:552-562` covers success and failure projections. |
| Scenario: R4 — Child-process failure fails the queue job visibly | MET | test | `packages/app/tests/services/history-refresh-service.test.ts:333-392` covers envelope drift, unusable invocation, abnormal termination, structured non-zero exit, invalid JSON, and wrong shape. |
| Scenario: R5 — SQLite contention remains bounded and visible | MET | test | `packages/domain/tests/db.test.ts:736-799` asserts WAL, visible `locked` failure after the configured bound, and a successful subsequent writer. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional, SECUA, and architecture verdicts PASS. |

**Verdict: approve.**

| Requirement | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/tests/services/history-refresh-service.test.ts:388-412` holds a real child open while timed probes prove the server event loop remains responsive; `apps/server/tests/context.test.ts:337-360` proves another server cannot reclaim the live row at the upstream 30-second boundary. |
| R2 | MET | `packages/app/src/services/history-refresh-service.ts:238-254` launches `history daily --json --json-envelope` through `ProcessExecutor`; `apps/server/src/index.ts:19-43` and `apps/cli/src/commands/serve.ts:61` provide PATH-independent invocations for both server launchers. |
| R3 | MET | `packages/app/src/services/history-refresh-service.ts:238-252` validates `job.payload` and propagates context plus `DATABASE_URL`; `apps/cli/src/commands/history.ts:283-380` consumes the context, selects import mode, and stamps child-owned events; `apps/cli/tests/commands/history.test.ts:472-523` proves the child contract. |
| R4 | MET | `packages/app/src/services/history-refresh-service.ts:255-282` turns abnormal termination, non-zero exit, invalid JSON, and wrong shape into bounded failures while retaining structured child errors; `packages/app/tests/services/history-refresh-service.test.ts:333-392` covers each outcome. |
| R5 | MET | The child inherits the server's resolved database URL at `apps/server/src/serve.ts:495-505`; the task's existing WAL/busy-timeout cross-connection test remains the behavioral proof. |

SECUA: argv is split and executed without a shell, payload shape is validated at the queue boundary, and child output/error detail is bounded. Architecture: `ProcessExecutor` remains the sole process seam and the child CLI owns history business events; no duplicate import/analyze implementation entered the server.

Resolved prior findings: `serve --cwd` propagates the exact database, child context has CLI integration coverage, the standalone server resolves its companion CLI, abnormal termination is no longer mislabeled as spawn failure, and non-zero JSON envelopes preserve their bounded error message. The shared server consumer now uses a two-hour visibility timeout at `apps/server/src/context.ts:104-107,615-627`, preventing a second server from resetting and reclaiming the same long-running refresh after the upstream 30-second default.

Fresh checks: `bun run autofix` completed with all workspace typechecks passing; `cd apps/server && bun test tests/context.test.ts tests/serve.test.ts tests/index.test.ts` passed 83 tests; `bun run apps/cli/src/index.ts rule run --preset recommended-post-check --fail-on warning` passed after duplicate local consumers were stopped.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-30T00:37:21.967Z todo → wip (system)
- 2026-08-30T01:26:32.930Z wip → testing (system)
- 2026-08-30T01:26:40.773Z testing → done (system)
