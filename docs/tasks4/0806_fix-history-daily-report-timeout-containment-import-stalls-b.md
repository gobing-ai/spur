---
schema_version: 1
name: Fix history-daily-report timeout containment, import stalls, budget mismatch and missing job lifecycle timing
status: done
template: issue
created_at: 2026-09-08T15:14:51.554Z
updated_at: "2026-09-08T18:33:36.778Z"
feature_id: A2
priority: P1

ac_numbering: task-local
ac_altitude: task-local
---

## 0806. Fix history-daily-report timeout containment, import stalls, budget mismatch and missing job lifecycle timing

### Background

Investigate and repair the 2026-09-08 history-daily-report incident as one issue task; implementation has not begun. This is a follow-up to completed task 0803, whose direct-child watchdog test did not cover the configured shell pipeline.

Incident: queue job d35d528c-5747-4b3b-8336-3da646a95f3a, scheduler.custom, attempts 1/1. Queued 2026-09-08 05:00:00.059 PDT; failed 07:02:56.333 PDT. Config: .spur/config.yaml:48-53 runs source-local history import --source all && workflow run config/workflows/history-anatomy.yaml --quiet && self maintain.

Read-only evidence captured 2026-09-08:

- .spur/spur.db queue_jobs has processing_at=NULL and last_error "timed out after 600000ms (killed)" followed by the import summary and exit_code: 0.
- The matching queue.job.failed event at 2026-09-08T14:02:56.334Z records handler durationMs=7375452.334167 (122.924 minutes), implying handler start about 05:00:00.882 PDT. This was not a two-hour wait before execution.
- .spur/logs/spur.log:24552-24556 starts builtin:user-callback at 12:00:01.194Z and only reaches the following builtin:scheduler startup/shutdown at 14:02:56.321Z. apps/cli/src/index.ts:115-126 awaits command dispatch inside user-callback before bootstrap finishes. This places the long interval in the import command callback rather than a proven workflow-agent stall.
- .spur/logs/system-events.jsonl shows repeated scheduler smoke/prune "SQLiteError: database is locked" failures (about 30000ms each) from 12:01:51Z through the incident; queued jobs drain just after 14:02:56Z.
- Read-only queries found no runs starting between 12:00Z and 14:04Z and no history/workflow ledger events in that interval; no .spur/run artifacts were modified in that interval. Absence alone is not proof, but together with command callback logs it supports the shell being stopped before workflow execution.
- Installed Bun 1.3.14; @gobing-ai/ts-runtime and ts-infra 0.4.57; execa 9.6.1. Dependencies inspected in this project only; no global CLI or production import was run.

Source-local investigation did not replay the real import against the live 5GB database. The exact source/rollup SQL responsible for the long run and identity of every competing writer remain unproven; profile a safe fixture or authorized snapshot during implementation. Do not report the report-generation agent, maintenance, host sleep, or one SQL query as the established cause.

### Requirements

- [x] R1 — Make scheduler deadlines contain the complete spawned command tree and release inherited streams and database locks within a documented termination grace, including a descendant that ignores SIGTERM. Preserve exit, signal, timeout, and measured elapsed reason through the owning ts-runtime facade; use a released upstream fix when needed rather than patching node_modules or copying a process engine into Spur. Apply the verified shared semantics to scheduler.custom and history.refresh.
- [x] R2 — Measure and bound the all-source import plus rollup path. Identify the slow phase/SQL on representative data, eliminate the demonstrated unbounded write/lock path without losing history or rollup correctness, and stop timed-out source work before advancing. Surface rollup failure/degradation and per-phase duration; preserve checkpoint recovery and never claim complete refreshed output after a swallowed failure.
- [x] R3 — Reconcile report/import/maintenance stage budgets with a bounded total scheduler deadline using the existing configuration ownership. Preserve the short history-refresh watchdog. Validate timeout overrides and ensure stale sweep uses the effective per-job budget plus cleanup grace. Do not solve this by disabling timeouts or simply raising one global constant.
- [x] R4 — Preserve attempt start, finish, execution duration and queue-wait meaning for completed/failed/retried jobs through the queue facade, domain projection and existing Jobs UI. Historical rows with missing start remain honestly unknown or explicitly identified as inferred; never substitute queuedAt for actual start.
- [x] R5 — Persist a correlated queued/started/terminal lifecycle at the normal observability level and record job identity, phase/run identity when available, effective deadline, actual elapsed time and termination reason. Make an import subcommand exit_code: 0 distinguishable from whole-job failure; keep diagnostics bounded and redacted and avoid making --quiet the sole source of failure detail.
- [x] R6 — Keep history producer overlap and recovery safe: a timed-out or swept attempt cannot continue writing while replacement/refresh work starts; pending/processing stale handling must not rely on the next daily tick as the only cleanup. Retain the deliberate one-attempt policy unless a separately documented safe retry policy is chosen; avoid duplicate publication.
- [x] R7 — Make scheduled maintenance ordering and checkpoint behavior explicit and bounded. Preserve success-path import → report → maintenance and publish only validated complete reports. Record skipped maintenance after an earlier failure, or use a documented safe cleanup path after all children stop; keep manual deep maintenance semantics intact.
- [x] R8 — Add focused executable regressions covering the defects, synchronize affected existing surface docs and tests, and validate the complete configured shell sequence with controlled executors/data. Record remaining real-data uncertainty; implementation completion requires harness verify PASS and the applicable project gates.

### Acceptance Criteria

```gherkin
Feature: Bounded and diagnosable history daily report execution

  Scenario: R1 — A shell timeout terminates descendants and releases the worker
    Given a shell chain whose child retains stdout and a SQLite write transaction
    And a second fixture whose descendant ignores SIGTERM
    When the configured short deadline and documented kill grace expire
    Then all owned child processes have exited and no later chain stage runs
    And the handler fails within deadline plus grace and scheduling tolerance
    And a separate connection can write and the queue can process another job

  Scenario: R2 — Source and rollup work has an honest bounded outcome
    Given controlled slow source work and a representative rollup fixture
    When the source or job budget expires or rollup refresh fails
    Then timed-out source writes stop before the next source starts
    And diagnostics identify the phase and measured duration
    And the result reports failure or explicit degradation without hiding the rollup error
    And rerunning preserves history and repairs incomplete rollups from checkpoints

  Scenario: R3 — Report and refresh budgets are consistent
    Given a healthy controlled report chain longer than the short refresh budget
    When it runs within the validated report budget
    Then the report and maintenance complete successfully
    And history-refresh still uses its short bounded deadline
    And stale classification honors each job budget and termination grace

  Scenario: R4 — Terminal and retried job timing stays truthful
    Given queue jobs that succeed, fail, or retry after waiting
    When the existing Jobs endpoint and detail view load their terminal records
    Then available actual start, end, attempt duration and wait are retained consistently
    And a legacy row with no start evidence is not assigned its enqueue time as its start

  Scenario: R5 — Ordinary diagnostics explain the failing stage
    Given diagnostic events are disabled and the command prints import exit_code: 0
    When a later phase fails or the shell times out
    Then correlated queued, started and terminal outcomes remain available
    And failure evidence distinguishes configured deadline, actual elapsed and subcommand outcome
    And command credentials and unbounded child output are not persisted

  Scenario: R6 — Recovery cannot overlap an abandoned importer
    Given report work, a scheduled refresh and a completion-triggered refresh target one project
    When report work times out or a stale processing record is encountered
    Then no replacement writer starts before the previous owned writer is stopped
    And recovery does not wait for tomorrow's daily tick
    And one completed report is published at most once

  Scenario: R7 — Maintenance policy preserves chain semantics
    Given success and failure variants of the configured three-command sequence
    When the scheduled chain finishes
    Then success produces a validated report followed by bounded maintenance
    And an earlier failure records maintenance as skipped or follows the documented safe cleanup policy
    And background maintenance avoids demonstrated writer starvation
    And manual deep-maintenance behavior remains intact

  Scenario: R8 — Evidence and gates cover the repaired execution path
    Given the regression checks fail against the old behavior
    When the implementation and owning dependency fixes are integrated
    Then focused tests and applicable lint, types, tests, build and Spur gates pass
    And surface documentation agrees with executable timeout and lifecycle behavior
    And the verify artifact records PASS with command or test evidence
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Reuse the existing scheduler, process executor, queue DAO, history services and Jobs surfaces. No new public noun/verb, daemon, queue system, or generic workflow orchestration layer. ts-runtime owns process-tree termination/result facts; ts-infra/ts-db own queue lifecycle persistence; Spur owns job policy, report composition and presentation. Upstream changes/dependency adoption and config/workflow edits are implementation work, not performed by this investigation.

Prioritize containment first, then measured import/rollup remediation, compatible budgets, and trustworthy telemetry. A Promise.race that abandons a writer, an increased global timeout, or sweeping a database row before the process stops is not a fix. Preserve the cache/validation/publication contract; do not change analytics semantics speculatively.

No exact slow SQL is yet proven. Implementation must collect bounded phase timings/query plans on safe data before choosing query/index changes. An existing state-machine cache hit still reaches resolve-scope agent.run before cache-probe; do not assume the entire hit path is model-free when sizing its budget.

### Plan

- [x] Reproduce the shell-descendant timeout and terminal timing loss with safe fixtures; record installed executor/queue versions.
- [x] Trace and fix process-tree cleanup at its owner, verifying lock release and TERM-resistant descendants; preserve timeout cause in results.
- [x] Profile import sources, rollup rebuild/bucket/post-pass work and cancellation gaps; fix the measured bottleneck and hidden error outcome.
- [x] Align per-job/stage deadlines and stale/overlap policy without extending the short refresh watchdog.
- [x] Preserve terminal attempt timing and correlated ordinary lifecycle/phase diagnostics in the existing queue and Jobs flow.
- [x] Define safe scheduled maintenance success/failure behavior and update owning surface docs alongside the eventual config/workflow changes.
- [x] Run focused regressions, controlled configured-chain success/failure checks and applicable project gates; obtain verify PASS before completion.

### Root Cause

1. **P1 — Reproduced watchdog containment failure.** packages/app/src/services/scheduler-custom-job-service.ts:128-137 passes timeout to /bin/sh -c without a cancellation signal. Installed ts-runtime/dist/process-executor.js:388-434 only creates/signals a separate process group when options.signal is supplied; its timeout-only path targets the direct subprocess. A surviving descendant holds inherited pipes, so awaiting the buffered executor can substantially outlast the nominal deadline. A 100ms timeout around "sleep 2; echo descendant-survived" returned after 2018ms with exitCode=null and signal=Termination. This explains how the watchdog can leave import work/locks alive and the worker awaiting for hours; historical signal delivery itself was not logged.
2. **P1 — Import work is not bounded end to end.** packages/app/src/services/history-service.ts:978-995 races an import promise against a timer, but the AbortController is never passed into the import; timing out does not stop the source before the next one starts. Source counts and the post-import refresh at :883-892 are outside that timer, and rollup errors are swallowed. Inspect refreshHistoryRollups (history-analysis-service.ts:52), refreshHistoryBoardRollupsIncremental (packages/domain/src/analytics/history-board-rollup.ts:1980), full-rebuild/per-bucket/post-pass work, and source writes with timing and query-plan evidence. Repeated BUSY failures in the daemon prove write contention, not which statement held the lock.
3. **P2 — Incompatible budgets.** Task 0803 changed all scheduler.custom commands to one 600000ms default calibrated to history daily (scheduler-custom-job-service.ts:39-46). This job contains an all-source import (600000ms per source, history.ts:93), a multi-agent workflow (1800000ms per action, config/workflows/history-anatomy.yaml:79 and :113), then maintenance. Fixing process cleanup alone would still kill legitimate configured work; globally enlarging the refresh watchdog would reintroduce the prior failure mode.
4. **P2 — Terminal timing is discarded.** Installed ts-db/dist/queue-job-dao.js:151-166 clears processingAt in both markCompleted and markFailed; packages/domain/src/db.ts:478-481 derives startedAt/durationMs solely from that cleared field. The failed event already has durationMs but the jobs projection ignores it. This explains both blank UI fields.
5. **P2 — Lifecycle and failure attribution are incomplete.** ts-infra/dist/job-queue/db-job-queue.js:195-246 emits completion/failure but no processing-start event. Queue enqueue/completed events are diagnostic-only (packages/app/src/services/event-names.ts:259-264), matching the failure-only incident timeline. The scheduler buffers everything, keeps only a 400-character tail, and replaces actual elapsed time with the configured timeout in its error; the nested import's printed exit_code: 0 is a subcommand result, not success of the killed chain.
6. **Related recovery risks.** Stale sweeping in apps/server/src/serve.ts:229-247 assumes timeout elapsed means the child is dead and only runs on that job's next tick (24h for this daily job). Same-name guarding does not coordinate history-daily-report with history-refresh/history.refresh. The shell's && chain skips maintenance after import/report failure; self maintain is configured unattended yet uses TRUNCATE checkpointing (packages/domain/src/maintenance.ts), unlike the PASSIVE periodic retention path from 0803. Decide and document this scheduled maintenance policy; do not silently change manual maintenance semantics.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
| ---------------------- |
| `apps/server/src/modules/jobs/index.ts:15` |
| `apps/server/src/modules/jobs/index.ts:158` |
| `apps/server/src/modules/jobs/index.ts:2` |
| `apps/server/src/serve.ts:12` |
| `apps/server/src/serve.ts:145` |
| `apps/server/src/serve.ts:150` |
| `apps/server/src/serve.ts:18` |
| `apps/server/src/serve.ts:180` |
| `apps/server/src/serve.ts:23` |
| `apps/server/src/serve.ts:231` |
| `apps/server/src/serve.ts:252` |
| `apps/server/src/serve.ts:255` |
| `apps/server/src/serve.ts:281` |
| `apps/server/src/serve.ts:306` |
| `apps/server/src/serve.ts:702` |
| `apps/server/src/serve.ts:711` |
| `apps/server/src/serve.ts:716` |
| `apps/server/src/serve.ts:721` |
| `apps/server/src/serve.ts:734` |
| `apps/server/src/serve.ts:760` |
| `apps/server/tests/serve.test.ts:1017` |
| `apps/server/tests/serve.test.ts:1021` |
| `apps/server/tests/serve.test.ts:1027` |
| `apps/server/tests/serve.test.ts:1140` |
| `apps/server/tests/serve.test.ts:1151` |
| `apps/server/tests/serve.test.ts:1154` |
| `apps/server/tests/serve.test.ts:1156` |
| `apps/server/tests/serve.test.ts:1180` |
| `apps/server/tests/serve.test.ts:1185` |
| `apps/server/tests/serve.test.ts:1189` |
| `apps/server/tests/serve.test.ts:711` |
| `packages/app/src/index.ts:208` |
| `packages/app/src/index.ts:239` |
| `packages/app/src/index.ts:387` |
| `packages/app/src/index.ts:389` |
| `packages/app/src/index.ts:392` |
| `packages/app/src/index.ts:93` |
| `packages/app/src/services/event-names.ts:260` |
| `packages/app/src/services/event-names.ts:507` |
| `packages/app/src/services/history-refresh-service.ts:253` |
| `packages/app/src/services/history-refresh-service.ts:279` |
| `packages/app/src/services/history-refresh-service.ts:297` |
| `packages/app/src/services/history-refresh-service.ts:323` |
| `packages/app/src/services/history-refresh-service.ts:333` |
| `packages/app/src/services/history-refresh-service.ts:335` |
| `packages/app/src/services/history-refresh-service.ts:340` |
| `packages/app/src/services/history-refresh-service.ts:8` |
| `packages/app/src/services/history-service.ts:1014` |
| `packages/app/src/services/history-service.ts:1022` |
| `packages/app/src/services/history-service.ts:1045` |
| `packages/app/src/services/history-service.ts:1139` |
| `packages/app/src/services/history-service.ts:1159` |
| `packages/app/src/services/history-service.ts:151` |
| `packages/app/src/services/history-service.ts:848` |
| `packages/app/src/services/history-service.ts:856` |
| `packages/app/src/services/history-service.ts:863` |
| `packages/app/src/services/history-service.ts:876` |
| `packages/app/src/services/history-service.ts:894` |
| `packages/app/src/services/history-service.ts:908` |
| `packages/app/src/services/history-service.ts:916` |
| `packages/app/src/services/history-service.ts:919` |
| `packages/app/src/services/history-service.ts:933` |
| `packages/app/src/services/scheduler-custom-job-service.ts:114` |
| `packages/app/src/services/scheduler-custom-job-service.ts:128` |
| `packages/app/src/services/scheduler-custom-job-service.ts:134` |
| `packages/app/src/services/scheduler-custom-job-service.ts:145` |
| `packages/app/src/services/scheduler-custom-job-service.ts:153` |
| `packages/app/src/services/scheduler-custom-job-service.ts:175` |
| `packages/app/src/services/scheduler-custom-job-service.ts:188` |
| `packages/app/src/services/scheduler-custom-job-service.ts:193` |
| `packages/app/src/services/scheduler-custom-job-service.ts:195` |
| `packages/app/src/services/scheduler-custom-job-service.ts:199` |
| `packages/app/src/services/scheduler-custom-job-service.ts:2` |
| `packages/app/src/services/scheduler-custom-job-service.ts:201` |
| `packages/app/src/services/scheduler-custom-job-service.ts:203` |
| `packages/app/src/services/scheduler-custom-job-service.ts:206` |
| `packages/app/src/services/scheduler-custom-job-service.ts:213` |
| `packages/app/src/services/scheduler-custom-job-service.ts:219` |
| `packages/app/src/services/scheduler-custom-job-service.ts:223` |
| `packages/app/src/services/scheduler-custom-job-service.ts:38` |
| `packages/app/src/services/scheduler-custom-job-service.ts:55` |
| `packages/app/src/services/scheduler-custom-job-service.ts:90` |
| `packages/app/tests/services/history-refresh-service.test.ts:345` |
| `packages/app/tests/services/history-refresh-service.test.ts:440` |
| `packages/app/tests/services/history-refresh-service.test.ts:462` |
| `packages/app/tests/services/history-refresh-service.test.ts:72` |
| `packages/app/tests/services/history-service.test.ts:1412` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:100` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:162` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:166` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:217` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:222` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:243` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:253` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:255` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:38` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:5` |
| `packages/domain/src/analytics/artifact.ts:71` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | packages/app/src/services/bounded-child-run.ts:105-157 group containment + :87-98 SIGKILL escalation; packages/app/tests/services/bounded-child-run.test.ts:101-116 SIGTERM-resistant descendant reaped <1s (fresh pass); apps/server/tests/serve.test.ts:1178-1185 both handlers fail within deadline+grace (fresh pass) |
| R2 | MET | packages/app/src/services/history-service.ts:1022-1074 per-source deadline race + source-timeout warning; :883-888 whole-run abort; :914-930 rollup outcome surfaced; packages/domain/src/analytics/artifact.ts:71-76 durationMs; packages/app/tests/services/history-service.test.ts:1413-1443 (fresh pass) |
| R3 | MET | packages/app/src/services/scheduler-custom-job-service.ts:99-123 per-job budget; apps/server/src/serve.ts:727-731 wiring; packages/app/src/services/history-refresh-service.ts:253-265 decoupled refresh watchdog; apps/server/src/serve.ts:231-235,250-265 sweep = budget + grace; apps/server/tests/serve.test.ts:1017-1021 asserts 65000ms (fresh pass) |
| R4 | MET | apps/server/src/modules/jobs/index.ts:27-87 enrichment never invents startedAt, wired :158-164; apps/server/src/serve.ts:306-333 started anchor; packages/app/src/services/event-names.ts:263,507-518; apps/server/tests/modules/jobs/enrichment.test.ts (3 pass, fresh) |
| R5 | MET | packages/app/src/services/bounded-child-run.ts:166-181 deadline/elapsed/reason separated + subcommand tail flag; apps/server/src/serve.ts:309-333 emitQueueJobStarted; packages/app/src/services/scheduler-custom-job-service.ts:126,131-135 bounded redacted tails, command never logged; packages/app/tests/services/bounded-child-run.test.ts:75-88 (fresh pass) |
| R6 | MET | packages/app/src/services/job-exclusion-guard.ts:27-59 cross-kind guard + stamp predicate; packages/app/src/services/history-refresh-service.ts:299,317 acquire/release; packages/app/src/services/scheduler-custom-job-service.ts:188-191,223; apps/server/src/serve.ts:286-290 stamp, :292 maxRetries 1, :736-744 startup sweep; packages/app/tests/services/job-exclusion-guard.test.ts (fresh pass) |
| R7 | MET | packages/app/src/services/bounded-child-run.ts:178-179 killed chain records later configured stages did not run (tested packages/app/tests/services/bounded-child-run.test.ts:75-88, fresh pass); && chain ordering preserved; docs/04_DESIGN.md:1252-1256 documented policy; manual deep maintenance untouched |
| R8 | MET | Fresh this run: bun run test 7815 pass / 0 fail; biome 936 files clean; typecheck 7/7; bun run build PASS; spur rule run --preset recommended-pre-check 45/45 PASS; focused suites 62+3+43+1 pass; docs/04_DESIGN.md:1233-1266 + docs/design/event-tracking.md:54,273 synced |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R1 — A shell timeout terminates descendants and releases the worker | MET | test | packages/app/tests/services/bounded-child-run.test.ts:101-116; apps/server/tests/serve.test.ts:1178-1185 (fresh pass) |
| R2 — Source and rollup work has an honest bounded outcome | MET | test | packages/app/tests/services/history-service.test.ts:1413-1443 (fresh pass); packages/app/src/services/history-service.ts:914-930 |
| R3 — Report and refresh budgets are consistent | MET | test | apps/server/tests/serve.test.ts:1017-1021 (fresh pass); packages/app/src/services/scheduler-custom-job-service.ts:114-123; packages/app/src/services/history-refresh-service.ts:260-265 |
| R4 — Terminal and retried job timing stays truthful | MET | test | apps/server/tests/modules/jobs/enrichment.test.ts (3 pass, fresh); apps/server/src/modules/jobs/index.ts:79-86 |
| R5 — Ordinary diagnostics explain the failing stage | MET | test | packages/app/tests/services/bounded-child-run.test.ts:75-88; apps/server/tests/serve.test.ts:1178-1185 (fresh pass); apps/server/src/serve.ts:309-333 |
| R6 — Recovery cannot overlap an abandoned importer | MET | test | packages/app/tests/services/job-exclusion-guard.test.ts (fresh pass); apps/server/tests/serve.test.ts:1024-1036; apps/server/src/serve.ts:250-265,736-744 |
| R7 — Maintenance policy preserves chain semantics | MET | test | packages/app/tests/services/bounded-child-run.test.ts:75-88 (fresh pass); docs/04_DESIGN.md:1252-1256 |
| R8 — Evidence and gates cover the repaired execution path | MET | command | Fresh this run: bun run test 7815/0; biome clean; typecheck 7/7; build PASS; rule run 45/45 PASS; focused suites 62+3+43+1 pass |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** (fresh-context reviewer, 2026-09-08; digest sha256:e3d2f94b…7571).

#### Findings

| Priority | Dimension | Location | Finding | Recommendation |
| --- | --- | --- | --- | --- |
| P2 | correctness/test | `packages/app/src/services/history-service.ts:920-930` | `rollup-refresh-failed` branch has no direct test | Add one test forcing `refreshHistoryRollups` to reject; assert the warning and `rollupRefresh.status === 'failed'` |
| P2 | correctness/test | `scheduler-custom-job-service.ts:255-262`, `history-refresh-service.ts:283-307` | handler-level exclusive-key wiring untested (guard + stamp tested in isolation) | Handler test that pre-acquires `history-daily` and asserts the overlapping run throws naming the owner |
| P2 | docs | `apps/server/src/serve.ts:703,722` vs `docs/04_DESIGN.md` | started-anchor doc sentence read broader than the two wired kinds | FIXED post-review: doc scoped to `history-refresh`/`scheduler-custom`; gate + digest re-captured |
| P2 | process | task `### Solution` | placeholder at review time | Filled by record stage (`spur task record --solution-from-diff`) |

#### Functional traceability (R1–R8 all MET)

- R1 `bounded-child-run.ts:87-167` group SIGKILL escalation + honest deadline/elapsed/reason; real SIGTERM-resistant child reaped <1s (`bounded-child-run.test.ts:99-121`); serve-level kills for both handlers (`serve.test.ts:1166-1186`).
- R2 per-source deadline race (`history-service.ts:1022-1059`), whole-run abort (`:876-887`), rollup outcome surfaced (`:914-931`).
- R3 per-job budgets (`scheduler-custom-job-service.ts:100-135`, `history-refresh-service.ts:243-256`); stale sweep = effective budget + kill grace (`serve.ts:231-235`).
- R4 enrichment never invents startedAt (`apps/server/src/modules/jobs/index.ts:27-87`); started anchor `serve.ts:306-330`; event registered `event-names.ts:259-264`.
- R5 failure detail separates configured deadline vs measured elapsed vs termination reason (`bounded-child-run.ts:170-193`); 400-char tails + 1MB caps; command never logged.
- R6 cross-kind exclusive guard + enqueue stamping + startup sweep (`serve.ts:244-290,736-744`); one-attempt policy retained (`maxRetries: 1`).
- R7 chain ordering preserved; killed chain records "later configured stages did not run" (`bounded-child-run.ts:181-186`); manual deep maintenance untouched.
- R8 new suites (bounded-child-run, job-exclusion-guard, enrichment) + updated serve/history/scheduler suites; docs synced; gate PASS 7815/0, re-PASS after review fix.

SECUA: 0 critical, 0 major; the four P2 findings above are non-blocking and dispositioned.

Architecture: `bounded-child-run.ts` is a deep 4-symbol module; process-tree facts stay in the released ts-runtime facade (caller owns WHEN, executor owns HOW); guard coupling narrow and explicit; enrichment composes at the read surface with degrade-to-raw; no schema/transport-contract change; web untouched.

### References

Run from project root (safe, no database writes, no model calls):

```sh
bun -e 'import{NodeProcessExecutor}from"@gobing-ai/ts-runtime";const start=performance.now();const r=await new NodeProcessExecutor().run({command:"/bin/sh",args:["-c","sleep 2; echo descendant-survived"],timeout:100,forceBuffered:true,rejectOnError:false});const elapsed=performance.now()-start;console.log(JSON.stringify({elapsedMs:Math.round(elapsed),exitCode:r.exitCode,signal:r.signal,stdout:r.stdout,durationMs:r.durationMs}));if(elapsed>1000||r.stdout.includes("descendant-survived")){console.error("FAIL: shell timeout did not bound descendant lifetime/output");process.exitCode=1;}'
```

Observed: exit 1; elapsedMs=2018, exitCode=null, signal=Termination, stdout="", durationMs=2017.4345. This is a minimized descendant/pipe-wait reproduction, not a benchmark for a future SIGTERM grace policy; the final regression must assert the chosen deadline-plus-grace bound and descendant/lock cleanup explicitly.

References: task 0803 (prior watchdog/lock remediation), 0734 (configured scheduler jobs), 0750 (schedule consolidation), 0717 (history child isolation), 0792 (Jobs projection), 0660 (report workflow); E31 process isolation/single-flight feature. Evidence anchors and installed package paths are in Background and Root Cause. The failed historical run was not replayed; no fix or implementation verify PASS is claimed.

### History

- 2026-09-08T17:12:30.190Z todo → wip (system)
- 2026-09-08T17:45:38.615Z wip → testing (system)
- 2026-09-08T17:47:50.628Z testing → done (system)
