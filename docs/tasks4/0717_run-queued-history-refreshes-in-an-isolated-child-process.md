---
schema_version: 1
name: "Run queued history refreshes in an isolated child process"
status: done
template: feature-impl
created_at: 2026-08-29T23:11:49.416Z
updated_at: "2026-08-30T01:26:40.773Z"
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
Plan step 1 — validated internal refresh context in `history daily`:
- packages/app/src/services/history-refresh-service.ts:92 — `HISTORY_REFRESH_CONTEXT_ENV` ('SPUR_HISTORY_REFRESH_CONTEXT'): internal parent→child contract, not config.
- packages/app/src/services/history-refresh-service.ts:103 — `validateHistoryRefreshPayload`: strict shape/trigger/window/importMode gate; bad payload fails the attempt before any spawn.
- packages/app/src/services/history-refresh-service.ts:138 — `parseHistoryRefreshContext`: null when env absent/empty (interactive daily unchanged), throws on malformed JSON/shape → CLI exits before bus/ledger/import.
- apps/cli/src/commands/history.ts:288 — daily parses the context env before creating EventBus/ledger; malformed context exits 1 pre-import.
- apps/cli/src/commands/history.ts:320 — `importMode` from context selects full|incremental only when present.
- apps/cli/src/commands/history.ts:328,342,374,383,409 — child stamps `trigger`/window onto its own `history.import.completed`/`history.analyze.completed`/`history.daily.failed` (+`coverage` on import); child owns all `history.*` events, parent emits none (no duplicate emission).

Plan step 2 — PATH-independent invocation injection:
- apps/cli/src/workflow/resolve-spur-bin.ts:47 — existing `resolveSpurBin()` returns `<execPath> <mainModule>`; passed at apps/cli/src/commands/serve.ts:61 as `spurInvocation` into `startServer`.
- apps/server/src/serve.ts:97 — optional `StartServerOptions.spurInvocation`; omission degrades to a run-time split failure, keeping existing callsites compiling.

Plan step 3 — child-process execution in the queue handler:
- packages/app/src/services/history-refresh-service.ts:213 — `HistoryRefreshJobDeps { cwd, invocation, executor }`: child opens its own DB/agentConfig from `cwd`; shared WAL DB + 5s busy timeout preserved.
- packages/app/src/services/history-refresh-service.ts:234 — handler takes the raw `Job`; `validateHistoryRefreshPayload(job.payload)` unwraps ONLY `job.payload` (queue-envelope-as-payload fails the attempt) — fixes the old envelope-drift bug.
- packages/app/src/services/history-refresh-service.ts:239 — `splitLaunchCommand(invocation)`: no shell string evaluated.
- packages/app/src/services/history-refresh-service.ts:241-246 — awaited `executor.run` of `<leading args> history daily --json --json-envelope` in `cwd`, output bounded at 1 MB (`HISTORY_REFRESH_MAX_OUTPUT` :95), env carries the serialized payload.
- packages/app/src/services/history-refresh-service.ts:250-273 — spawn failure / non-zero exit / invalid JSON / wrong shape throw bounded stderr detail → existing queue retry/failure state and `queue.job.*` events stay truthful.
- apps/server/src/serve.ts:494-501 — registration wires `NodeProcessExecutor` + `{ cwd, invocation, executor }`; handler input stays `Job<unknown>` per the `JobHandlerRegistry` contract (validation is the payload type gate).

Plan step 4 — tests (targeted, in-workspace):
- packages/app/tests/services/history-refresh-service.test.ts — 19 pass: kept 0549 enqueue + 0716 single-flight suites; new `parseHistoryRefreshContext` suite; new handler suite covering R2/R3 (invocation split, exact args/cwd/maxOutput, payload env round-trip), R4 (envelope drift, blank invocation, spawn/exit/JSON/shape failures), R1 (real held-open bun child: five 10ms event-loop probes drift <150ms while pending). `cd packages/app && bun test tests/services/history-refresh-service.test.ts` → 19 pass.
- packages/domain/tests/db.test.ts:734 — R5: two adapters on one temp file DB; WAL asserted file-level via raw bun:sqlite; held `BEGIN IMMEDIATE` makes a second writer fail visibly ('database is locked') bounded by the 5s busy_timeout (~5s, not instant/unbounded), then a fresh writer proceeds after commit. `cd packages/domain && bun test tests/db.test.ts` → 28 pass.

Plan step 5 — docs reconciliation:
- docs/design/history-refresh-process-isolation.md:3 — status built; `--json-envelope` args bullet; new As-built section (writer/handler/child command/failure mapping/verification).
- docs/04_DESIGN.md:52 — index status built (0716–0717); :773 in-process call replaced by child execution via ProcessExecutor + SPUR_HISTORY_REFRESH_CONTEXT; :775 scheduler now routed through the single-flight writer; :1096/:1101/:1108 — as-built wording for never-inline, child-process run, and child-stamped observability.
- docs/design/event-tracking.md:77-79 — `history.*` emit sites moved to `apps/cli/src/commands/history.ts`; :295-297 — payload rows note trigger/window (+coverage) flow when a refresh context is present.

Verification: `bunx tsc --noEmit` clean in packages/app, apps/server, apps/cli; `bun test tests/serve.test.ts` (apps/server) → 36 pass; targeted suites above green. Format applied to changed files.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | test 'R1: a held-open child leaves the server event loop responsive' packages/app/tests/services/history-refresh-service.test.ts:367 (real bun child via NodeProcessExecutor, 5x10ms real-clock loop probes drift <150ms while pending); handler only awaits child exit packages/app/src/services/history-refresh-service.ts:243-249; 10s web RPC abort timeout apps/web/src/lib/rpc-client.ts:44; grep: no HistoryService.daily/.daily( in apps/server/src |
| R2 | MET | apps/cli/src/commands/serve.ts:61 injects resolveSpurBin() (PATH-independent execPath+mainModule, apps/cli/src/workflow/resolve-spur-bin.ts:35-49) as spurInvocation; wiring apps/server/src/serve.ts:494-505 (NodeProcessExecutor); split + awaited executor.run of '<leading args> history daily --json --json-envelope' in cwd packages/app/src/services/history-refresh-service.ts:241-248; tests 'R2/R3: splits the invocation...' :293 and 'R2: an unusable invocation rejects before spawning' :325; server suite 36 pass (apps/server tests/serve.test.ts) |
| R3 | MET | job.payload unwrapped+validated packages/app/src/services/history-refresh-service.ts:240 (validateHistoryRefreshPayload :103-131); env SPUR_HISTORY_REFRESH_CONTEXT :247; test asserts full env round-trip incl importMode:'full' history-refresh-service.test.ts:293-313; envelope-drift fails attempt :316; parseHistoryRefreshContext suite :255-288; child side static: apps/cli/src/commands/history.ts:288 (parse pre-bus/ledger, malformed exits 1 pre-import), :320 (importMode into svc.daily), :328-331,374,383,409 (trigger/window stamped on history.import.completed/analyze.completed/daily.failed), :375 (coverage only with context) |
| R4 | MET | all four modes throw -> queue-attempt failure packages/app/src/services/history-refresh-service.ts:253-267; tests 'R4: spawn failure (exitCode null)...' :333, 'R4: non-zero exit rejects with a bounded stderr tail' :340, 'R4: unparseable child stdout rejects' :353, 'R4: child JSON without {ok:true,data} rejects' :360; throw maps onto pre-existing queue failOrRetry retry/failure state + queue.job.* events (queue contract unchanged) |
| R5 | MET | test 'cross-connection writer conflict fails bounded (~5s) with a visible SQLITE_BUSY, then recovers' packages/domain/tests/db.test.ts:737-799 (WAL asserted file-level PRAGMA journal_mode=wal :747; second writer fails with 'locked' :770 bounded >=4500ms <15000ms :772-773; fresh writer proceeds after commit :782-791); child owns its own DB connection in cwd (deps.cwd history-refresh-service.ts:216,246) so server loop never busy-waits; loop responsiveness under pending child covered by R1 held-open test; domain suite 28 pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — A running refresh does not block Board requests | MET | test | 'R1: a held-open child leaves the server event loop responsive' packages/app/tests/services/history-refresh-service.test.ts:367-392; suite run: cd packages/app && bun test tests/services/history-refresh-service.test.ts -> 19 pass |
| R2 — The queue worker reuses the existing daily command in a child process | MET | test | 'R2/R3: splits the invocation, runs history daily --json --json-envelope in cwd, passes payload as child context' history-refresh-service.test.ts:293 + 'R2: an unusable invocation rejects before spawning' :325; static wiring apps/server/src/serve.ts:494-505, apps/cli/src/commands/serve.ts:61 |
| R3 — Refresh intent survives the queue envelope | MET | test | env round-trip with trigger/window/importMode history-refresh-service.test.ts:293-313 + 'R3: queue-envelope drift... fails the attempt' :316 + parseHistoryRefreshContext suite :255-288; child stamping static apps/cli/src/commands/history.ts:328-409 |
| R4 — Child-process failure fails the queue job visibly | MET | test | 'R4: spawn failure...' history-refresh-service.test.ts:333; 'R4: non-zero exit rejects with a bounded stderr tail' :340; 'R4: unparseable child stdout rejects' :353; 'R4: child JSON without {ok:true,data} rejects' :360; handler throws so queue failOrRetry marks failed + emits queue.job.* |
| R5 — SQLite contention remains bounded and visible | MET | test | 'cross-connection writer conflict fails bounded (~5s) with a visible SQLITE_BUSY, then recovers' packages/domain/tests/db.test.ts:737-799; suite run: cd packages/domain && bun test tests/db.test.ts -> 28 pass; apps/server suite 36 pass |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P2 | Correctness / data integrity | `apps/cli/src/commands/serve.ts:33-34` + `apps/server/src/serve.ts:420,498` | Wrong-DB refresh under `spur serve --cwd X` with `DATABASE_URL` unset: the server opens `X/.spur/spur.db` (`resolveServeDbUrl` uses the `--cwd` option), but `ctx.cwd` stays the server's launch dir (`process.cwd()`) and the child runs there with no `--db`/`--cwd`/`DATABASE_URL` propagated, so it re-resolves and refreshes the launch dir's database — not the one the server/Board serves. Pre-0717 the in-process job body used server adapters and always hit the correct DB; this is a silent regression for the `--cwd` path. Fix direction: propagate the resolved dbUrl (env or flag) into the child. |
| P2 | Tests | `apps/cli/tests/` (untouched by this diff) | The child side of the env contract has zero coverage: no test asserts `history daily` honors `SPUR_HISTORY_REFRESH_CONTEXT` — malformed context exits 1 before bus/ledger creation (`apps/cli/src/commands/history.ts:283-301`), `refreshMeta` stamped onto `history.*` events, `importMode` threaded into `svc.daily`, `coverage` emitted only when a context is present. The parent handler is well tested; the contract's only production consumer (the child CLI) is not. |
| P3 | Correctness | `apps/server/src/index.ts:24-30` | The standalone server entrypoint (`main()`) calls `startServer` without `spurInvocation`, so the handler receives `''` and every `history.refresh` attempt fails at `splitLaunchCommand` on that path. Each failure is loud and truthful, but the feature can never succeed via the server binary; the design doc's as-built section covers only the `spur serve` path and does not state this limitation. |
| P4 | Correctness | `packages/app/src/services/history-refresh-service.ts:253-254` | A child killed for exceeding `maxOutput` (1 MB) surfaces as `exitCode: null` and is reported as "history refresh child failed to spawn" although the child ran. The queue outcome (failed attempt) is truthful; the message is misleading. Distinguishable via the kill `signal` if desired. |
| P4 | Correctness | `packages/app/src/services/history-refresh-service.ts:256-257` | On non-zero exit the child's rich `{ok:false,error:{message}}` stdout envelope is discarded: the CLI writes errors to stdout under `--json`, so stderr is typically empty and the queue records only the generic "history daily exited N". |
| P4 | Security | `packages/app/src/services/history-refresh-service.ts:247` + executor env merge | Child inherits the full server env (standard spawn semantics) plus the single context variable; the context carries only validated payload fields (no secrets introduced), and failure stderr detail is truncated to the last 400 chars. No secret-leak surface added by this diff. |
| P4 | Docs | `docs/04_DESIGN.md`, `docs/design/event-tracking.md`, `docs/design/history-refresh-process-isolation.md` | Docs match as-built: `triggerId` intentionally stays parent-side (only `history.refresh.enqueued` carries it), `coverage` documented as refresh-context-only, event rows re-pointed to `apps/cli/src/commands/history.ts`, as-built section added with R1/R5 verification pointers. No drift found. |

**Verdict: approve-with-findings.** Core contract is sound — `job.payload` (not the envelope) is validated and serialized; argv-only spawn (no shell string); PATH-independent invocation from `spur serve` via `resolveSpurBin()`; all four failure modes (spawn / non-zero / invalid JSON / wrong shape) map to truthful bounded queue-attempt failures; output bounded at 1 MB; child-side parse happens before any bus/ledger work; WAL + 5s `busy_timeout` behaviorally proven cross-connection; no in-process `HistoryService.daily` remains on the server path. The two P2s are follow-ups, not merge blockers: the wrong-DB case requires the `spur serve --cwd` + unset-`DATABASE_URL` combination (default launch-from-project-root is correct), and the untested child-side contract is test debt rather than a demonstrated defect. Recommend addressing both before declaring E31 done.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-30T00:37:21.967Z todo → wip (system)
- 2026-08-30T01:26:32.930Z wip → testing (system)
- 2026-08-30T01:26:40.773Z testing → done (system)
