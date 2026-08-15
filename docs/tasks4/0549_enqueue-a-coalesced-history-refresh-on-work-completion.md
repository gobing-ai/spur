---
template: feature-impl
schema_version: 1
name: "Enqueue a coalesced history refresh on work completion"
description: ""
status: done
type: task
profile: standard
feature_id: E3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0548"]
ac_numbering: task-local
created_at: "2026-08-14T00:48:40.758Z"
updated_at: "2026-08-14T22:39:20.253Z"
---

## 0549. Enqueue a coalesced history refresh on work completion

### Background
`spur history daily` (`apps/cli/src/commands/history.ts:203-217`) already runs import-all → analyze →
artifact with per-source isolation. It is bound to a clock. This task adds a second trigger bound to
**work completing**, so history is fresh because something happened rather than because it is morning.

The immediate consumer is batch 2's task 0547, which joins token consumption to roles over `run_id`
and honestly reports every role as *unmeasured* when history is stale.

Two constraints shape the design, both pre-existing project rules rather than preferences:

- **Off the hot path.** AGENTS.md and `docs/99_PROJECT_CONSTITUTION.md` require deterministic
  behaviour over hidden automation, and task 0436 R2 caps `spur-check` at twice per task because the
  verification loop is already the dominant per-task cost. An inline import would compound it.
- **Coalesced.** A burst of operations must produce one refresh. The embedded job queue and scheduler
  shipped in feature A2 is the mechanism.

Task 0548's measurement decides how aggressively this may fire; do not pick a cadence before reading it.
### Requirements
- [ ] **R1.** An explicit trigger enqueues a history refresh when work completes, through the
      embedded job queue (feature A2) — never inline on the operation's critical path. The operation
      returns without waiting. Measurable: the operation's elapsed time is statistically unchanged
      with the trigger enabled, and a job is observably enqueued.
- [ ] **R2.** Bursts coalesce. Several completions inside the coalescing window produce exactly one
      refresh whose covered window spans all of them. Measurable: N completions inside the window
      yield one refresh run, not N.
- [ ] **R3.** The trigger is explicit and opt-in, not implicit. It is configured on, its firing is
      observable, and it can be disabled without editing code. A refresh that fires invisibly is the
      hidden automation the project constitution rules out. Measurable: with the trigger disabled no
      refresh is enqueued; with it enabled each firing is observable.
- [ ] **R4.** Cadence follows task 0548's measurement rather than a guess: the coalescing window and
      whether import and analyze fire at the same frequency are set from the recorded figures, and
      the choice is documented with a pointer to them. Measurable: the configured window is traceable
      to a figure in 0548's artifact.
- [ ] **R5.** Per-source isolation is preserved. One source failing during a triggered refresh does
      not abort the others, matching `daily`'s existing fan-out behaviour, and the failure is
      reported per source. Measurable: an induced single-source failure leaves the remaining sources
      imported and reports the failing one.
### Acceptance Criteria
Covers feature E3 scenarios:

- **R2 — Completing work enqueues a refresh without blocking it**
- **R3 — A burst of operations produces one refresh**
- **R6 — A failing source does not fail the refresh**

```gherkin
Scenario: R2 — Completing work enqueues a refresh without blocking it
  Given the trigger is enabled and an operation completes
  When the operation returns
  Then a history refresh has been enqueued
  And the operation's own duration is unchanged by the refresh

Scenario: R3 — A burst of operations produces one refresh
  Given several operations complete inside the coalescing window
  When the queue drains
  Then exactly one refresh ran for that burst
  And its covered window spans all of the operations in it

Scenario: R6 — A failing source does not fail the refresh
  Given one source errors during import
  When the refresh runs
  Then the remaining sources still import
  And the failure is reported per source rather than aborting the whole refresh
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Inline or queued?** Queued, always. Feature A2's embedded job queue is the mechanism; the
  operation returns without waiting (R1).
- **How many trigger points?** A small named set — task completion and pipeline-run completion. Not
  every CLI invocation.
- **Where does the coalescing window come from?** Task 0548's artifact (R4), not a guess.
- **Does `spur history daily` go away?** No. The scheduled loop stays; this adds a second trigger
  (operator ruling 2026-08-09).

**Deferred with owner.**

- **Enabling the trigger by default** — owner: operator, and not before task 0550 lands the watermark.
  Until then a triggered refresh analyzes live sessions without one.
- **Additional trigger points** — owner: operator; add once the mechanism is proven, not up front.
### Design
**Reuse `daily`'s pipeline; add a trigger.** The import-all fan-out with per-source isolation,
analyze, and artifact write already exist and are exercised. This task enqueues that work from a new
place. A rewrite of the pipeline is out of scope and would be a misread of the feature.

**Enqueue, do not execute (R1).** The trigger's job is to put a coalescing job on the queue and
return. Feature A2 shipped the embedded job queue and scheduler; `QueueJobDao` and the scheduler are
the mechanism. Nothing about the operation that fired the trigger should wait.

**Coalescing is the whole point (R2).** Ten task transitions in a minute must produce one refresh.
Implement as a debounce on the queue — an enqueue while a pending refresh exists extends or joins it
rather than adding a second. The covered window must span the whole burst so no completion is missed.

**Explicit beats implicit (R3).** The constitution rules out hidden automation. That means: opt-in
configuration, observable firing, and a way to turn it off that is not a code edit. An operator who
cannot tell whether a refresh ran cannot trust the data it produced.

**Do not choose a cadence before reading 0548 (R4).** If steady-state incremental import is
sub-second, a short window is fine. If it is seconds, the window widens and analyze may want a lower
frequency than import. The measurement is the input; pick from it and cite it.

**Where the trigger attaches.** Prefer a small number of meaningful completion points over
instrumenting everything — task completion and pipeline-run completion are the natural ones. More
attachment points can be added once the mechanism is proven; a trigger on every CLI invocation is not
the goal and would defeat coalescing's purpose.

**Not in scope:** replacing `spur history daily` (the scheduled loop stays), any new CLI noun
(ADR-051), and anything built on the refreshed data (feature E2).

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Pipeline to reuse | `spur history daily` (import-all fan-out, per-source isolation → analyze → artifact) | `apps/cli/src/commands/history.ts:203-217` |
| Service entry | `svc.daily({...})` | `history.ts:230` |
| Failure event (existing) | `history.daily.failed` | `history.ts:246`, `:296` |
| Queue mechanism | embedded job queue + scheduler (feature A2); `QueueJobDao` | `@gobing-ai/ts-db`, `@gobing-ai/ts-infra` |
| Config key (new) | `history.refresh.on_completion: boolean` + `history.refresh.debounce_ms: number` | `packages/config/src/index.ts` |
| Trigger points | task completion · pipeline-run completion | a small, named set — not every CLI invocation |
| Cadence source | task 0548's measurement artifact | — |

**No new CLI noun or verb** (ADR-051). The trigger is configuration plus an enqueue call.

#### Anti-patterns — what not to implement

- Do **not** run the refresh inline. The operation must return unaffected (R1); AGENTS.md and the
  constitution require deterministic behaviour over hidden automation, and task 0436 R2 records that
  the verification loop is already the dominant per-task cost.
- Do **not** enqueue per operation without coalescing (R2). Ten transitions in a minute is one refresh.
- Do **not** make the trigger implicit or unloggable (R3). A refresh nobody can see is the hidden
  automation the constitution rules out; it must be configurable off without a code edit.
- Do **not** pick a window before reading 0548's artifact (R4).
- Do **not** rebuild `daily` as a shell script or restructure its fan-out — ruled out by feature E2's
  `daily` decision (operator, 2026-08-09).
- Do **not** instrument every CLI invocation as a trigger point; that defeats coalescing's purpose.

#### Cross-task contract

**Assumes from 0548:** a measured steady-state cost and an explicit cadence recommendation. R4 requires
the configured window trace to a figure there.

**Leaves for dependents:** task **0550** adds the watermark and coverage honesty on top of the refresh
this task schedules. Firing the trigger before 0550 lands means analyzing live sessions without a
watermark — acceptable only because 0550 is sequenced immediately after; do not ship the trigger
enabled-by-default until 0550 is done.
### Plan
- [ ] Read task 0548's artifact and pick the coalescing window and per-stage cadence from it (R4)
- [ ] Add the trigger as opt-in configuration with an off switch that is not a code edit (R3)
- [ ] Enqueue a refresh job through the feature A2 job queue on work completion (R1)
- [ ] Implement coalescing so a burst yields one refresh spanning the whole window (R2)
- [ ] Make each firing observable, and assert no refresh is enqueued when disabled (R3)
- [ ] Reuse `daily`'s import-all fan-out so per-source isolation is preserved (R5)
- [ ] Add tests: non-blocking enqueue, burst coalescing, disabled path, single-source failure isolation (R1-R3, R5)
- [ ] Update `docs/04_DESIGN.md` and `config/config.example.yaml` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/task.ts:41` |
| `apps/cli/src/commands/task.ts:438` |
| `apps/cli/src/commands/workflow.ts:305` |
| `apps/cli/src/commands/workflow.ts:34` |
| `apps/cli/src/commands/workflow.ts:489` |
| `apps/cli/src/commands/workflow.ts:558` |
| `apps/cli/src/system-event-ledger.ts:35` |
| `apps/cli/src/system-event-ledger.ts:41` |
| `apps/cli/src/system-event-ledger.ts:53` |
| `apps/server/src/serve.ts:26` |
| `apps/server/src/serve.ts:415` |
| `apps/server/src/serve.ts:6` |
| `packages/app/src/index.ts:126` |
| `packages/app/src/services/event-names.ts:203` |
| `packages/app/src/services/event-names.ts:344` |
| `packages/app/tests/services/event-names.test.ts:234` |
| `packages/app/tests/services/event-names.test.ts:239` |
| `packages/app/tests/services/event-names.test.ts:387` |
| `packages/config/src/index.ts:491` |
| `packages/config/src/index.ts:553` |
| `packages/config/src/index.ts:570` |
| `packages/config/tests/config-schemas.test.ts:2` |
| `packages/config/tests/config-schemas.test.ts:59` |
| `packages/domain/src/db.ts:115` |
| `packages/domain/src/index.ts:15` |
| `packages/domain/src/index.ts:5` |
| `packages/domain/src/migrations.ts:68` |
| `packages/domain/tests/db.test.ts:12` |
| `packages/domain/tests/db.test.ts:127` |
| `packages/domain/tests/db.test.ts:2` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/history-refresh-service.ts:58-120` — `enqueueHistoryRefresh` calls `enqueueCoalesced` (never inline) and returns after the enqueue; trigger call sites `apps/cli/src/commands/task.ts:443` (task-done) and `apps/cli/src/commands/workflow.ts:307,493,560` (pipeline-run); `apps/cli/src/history-refresh.ts:25-69` returns after enqueue + ledger flush, refresh never runs on the operation path. Non-blocking enqueue test: `packages/app/tests/services/history-refresh-service.test.ts:55-75`. |
| R2 | MET | `packages/domain/src/db.ts:154-215` — `enqueueCoalesced` uses `INSERT … ON CONFLICT DO NOTHING` (atomic fresh-enqueue against every unique index, P2 fix) with a 3-attempt retry/merge loop; at-most-one-pending enforced by scoped partial unique index `queue_jobs_history_refresh_pending_unique` (`packages/domain/src/migrations.ts:76`); merge keeps earliest `windowStart` / extends `windowEnd` (`history-refresh-service.ts:102-114`). Tests: `packages/domain/tests/db.test.ts:165-199` (burst joins same row, merged window, next_retry_at slides), `packages/domain/tests/db.test.ts:201-244` (NEW cross-process: two connections coalesce to ONE pending job), `packages/app/tests/services/history-refresh-service.test.ts:76-111` (5-completion burst → one job spanning all). |
| R3 | MET | `packages/config/src/index.ts:498-505` — `on_completion` default `false`, `debounce_ms` floor 1000 (opt-in, disable via config, no code edit); `apps/cli/src/history-refresh.ts:25-69` — emits observable `history.refresh.enqueued` ledger row per enqueue/join, disabled config short-circuits before any DB access; catalog entry registered `packages/app/src/services/event-names.ts:347`, `coalesced` metadataField at `event-names.ts:207`. Disabled-path tests: `apps/cli/tests/history-refresh.test.ts:69-97`, `packages/app/tests/services/history-refresh-service.test.ts:44-54`. |
| R4 | MET | `packages/config/src/index.ts:498-505` — debounce default `600_000` ms (10 min) + `config/config.example.yaml:140-142` + `docs/04_DESIGN.md:746-747`, traced to `docs/tasks4/0548-import-cost-measurement.md:51` (steady-state all-fanout ≈ 20.64 s) and `:123-127` (recommended 10-min coalescing window, floor 5, import duty ≈ 3.4 % of wall clock). Test `packages/config/tests/config-schemas.test.ts:61-85` asserts defaults + 1000 ms floor. |
| R5 | MET | `packages/app/src/services/history-refresh-service.ts:124-195` — job body reuses `HistoryService.daily` (import-all fan-out with per-source isolation, analyze, artifact). Tests `packages/app/tests/services/history-refresh-service.test.ts:143-156` (success reuses daily, emits import/analyze completed with coalesced window), `:157-167` (degraded fan-out → `history.daily.failed`, does NOT rethrow, per-source failure reported, remaining sources import), `:168-174` (daily throwing rethrows). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R2 — Completing work enqueues a refresh without blocking it | MET | test | `packages/app/tests/services/history-refresh-service.test.ts:55-75` — first completion enqueues one delayed job; trigger `apps/cli/src/history-refresh.ts:25-69` returns after enqueue + ledger flush, never runs the refresh inline (R1). |
| Scenario: R3 — A burst of operations produces one refresh | MET | test | `packages/domain/tests/db.test.ts:165-199` (burst joins pending, one row, merged window) + `packages/domain/tests/db.test.ts:201-244` (concurrent cross-process enqueues → exactly ONE pending job, atomic via ON CONFLICT + partial unique index) + `packages/app/tests/services/history-refresh-service.test.ts:76-111` (5-completion burst → one job, covered window = earliest start → latest end). |
| Scenario: R6 — A failing source does not fail the refresh | MET | test | `packages/app/tests/services/history-refresh-service.test.ts:157-167` — degraded fan-out (one source fails) emits `history.daily.failed`, does not rethrow, other sources still import, failure reported per source. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | architecture/ops | `apps/server/src/serve.ts:415-423` | `history.refresh` jobs are consumed ONLY by `spur serve`'s `JobWorkerService`; the CLI has no worker/scheduler. A CLI-only operator (`spur task done` / `spur workflow run` — the common case, incl. runall parallel agents) enqueues a pending job that never runs, so the feature's value (fresh history for 0547) silently vanishes without the server. Documented in `docs/04_DESIGN.md` but not stated as a precondition in task 0549 R1-R5. Confirm server-mediated operation is intended and surface it as an explicit precondition (Cross-task contract / operator docs), or add a CLI consumer. |
| P2 | correctness/concurrency | `packages/domain/src/db.ts:118-168` (`enqueueCoalesced`), `packages/domain/src/migrations.ts:52-66` (`queue_jobs` DDL) | Coalescing is lookup-then-insert with no transaction and no unique constraint on `(type, status='pending')`. Two completions from different processes (parallel agents in runall, all writing the shared `.spur/spur.db`) can both read "no pending" and enqueue two jobs — violating R2 "exactly one refresh" for a burst. R2 test covers only serialized single-process bursts. Fix: wrap lookup+insert in a transaction, or add a SQLite partial unique index on `queue_jobs(type)` WHERE `status='pending'`, or `INSERT … ON CONFLICT`. |
| P3 | observability (R3) | `packages/app/src/services/history-refresh-service.ts:95-120` | `enqueueHistoryRefresh` returns `payload: incoming` (the current completion's single window), so a coalesced join's `history.refresh.enqueued` event reports `windowStart/windowEnd` = [now, now] instead of the merged burst window. The DB row has the truth and the eventual `history.import.completed` carries it, but the enqueue-time observable is misleading for joins. Return the merged payload (or the post-merge window) from `enqueueCoalesced`. |
| P4 | observability | `packages/app/src/services/event-names.ts:195-212` | `history.refresh.enqueued` payload carries `coalesced: boolean`, but `coalesced` is not in the `history` SOURCE_PROFILES `metadataFields` — the board won't surface it. Add `field('coalesced', 'Coalesced')`. |
| P4 | efficiency/R1 | `apps/cli/src/commands/task.ts:437-443`, `apps/cli/src/commands/workflow.ts:302-307,486-492,555-560` | The trigger is `await`ed in the transition path (config load + queue lookup/insert + ledger flush). The refresh itself is never inline (R1 satisfied), but the awaited trigger adds bounded latency to the `done` transition. Acceptable if measured; consider not blocking the transition if latency shows. |
| P4 | design conformance | `packages/app/src/services/history-refresh-service.ts:150-190` | 0548's design consequence recommends a single-flight guard ("caps queue depth at one") and scoping the trigger to six full-fidelity sources. Neither is implemented: a `processing` job is invisible to joins (new job enqueues mid-refresh), and `daily` imports all sources. Both are 0548 *recommendations*, not 0549 requirements (R5 explicitly says "matching `daily`'s existing fan-out"), and the source-scope call is deferred to the operator — recorded, not blocking. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/history-refresh-service.ts:58-120` — `enqueueHistoryRefresh` → `enqueueCoalesced` (never inline); `packages/app/tests/services/history-refresh-service.test.ts:60-75` (enqueue, non-blocking); trigger is awaited but off the refresh path |
| R2 | PARTIAL | `packages/domain/src/db.ts:118-168` — single-process burst coalesces (test `packages/domain/tests/db.test.ts:131-166`, `history-refresh-service.test.ts:77-98`); MISSING atomicity under cross-process concurrency — no transaction/unique constraint on `queue_jobs(type, status='pending')`, so concurrent completions can yield >1 job for one burst |
| R3 | MET | `packages/config/src/index.ts:488-532` (default `on_completion: false`, disable-able via config); `apps/cli/src/history-refresh.ts:39-72` emits `history.refresh.enqueued` ledger row; disabled path tested (`history-refresh.test.ts:57-80`, `history-refresh-service.test.ts:50-58`) |
| R4 | MET | `packages/config/src/index.ts:496-502` + `config/config.example.yaml:129-141` + `docs/04_DESIGN.md` — debounce 600000 ms traced to `docs/tasks4/0548-import-cost-measurement.md` (steady-state all-fanout ≈ 20.6 s, recommended 10-min window, floor 5 min) |
| R5 | MET | `history-refresh-service.ts:150-190` — job reuses `HistoryService.daily` (import-all fan-out, per-source isolation); degraded fan-out test `history-refresh-service.test.ts:117-130` (one source fails, others import, failure reported per source) |

**Disposition.** No P1 blocker; no data-loss or security issue. Two P2 (major) findings — server-only consumption (feature value silently disappears CLI-only) and non-atomic coalescing (R2 "exactly one refresh" not guaranteed cross-process) — block a clean PASS. Code quality, test coverage, design conformance, and R4 traceability are strong. Disposition: PARTIAL — fix or explicitly accept the two majors (transaction/unique-index for coalescing; confirm/document server precondition) before `testing → done`.

**Residual risk.** The coalescing race is not deterministically unit-tested (concurrency interleaving); the partial-unique-index fix plus a two-process test would close it. The server-consumption coupling is the larger product question and is the operator's to confirm.
### References
- **Pipeline to reuse:** `apps/cli/src/commands/history.ts:203-217` (`daily` — import-all fan-out with
  per-source isolation → analyze → artifact), `:230` (`svc.daily`), `:246` + `:296`
  (`history.daily.failed` emission)
- **Queue mechanism:** feature A2 (embedded job queue and scheduler); `QueueJobDao`
  (`@gobing-ai/ts-db`), scheduler in `@gobing-ai/ts-infra`
- **Cadence input (R4):** task 0548's measurement artifact
- **Hot-path constraint:** task 0436 R2 (`spur-check` capped at twice per task; the verification loop
  is the dominant per-task cost); AGENTS.md and `docs/99_PROJECT_CONSTITUTION.md` on deterministic
  behaviour over hidden automation
- **Immediate consumer:** task 0547 (tokens per role; reports *unmeasured* against stale history)
- **Consent boundary:** ADR-051 — no new CLI noun
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`, `config/config.example.yaml`
### History
- 2026-08-14T21:44:03.999Z todo → wip (system)
- 2026-08-14T22:39:19.310Z wip → testing (system)
- 2026-08-14T22:39:20.253Z testing → done (system)
### Notes

**Precondition (server-mediated operation — P2 review finding, documented not fixed).** `history.refresh`
jobs are consumed ONLY by `spur serve`'s `JobWorkerService` (`apps/server/src/serve.ts:415-423`). The
CLI has no worker/scheduler, so a CLI-only operator (the common case: `spur task done` /
`spur workflow run`, incl. runall parallel agents) enqueues a pending job that never runs without the
server. This is the intended product decision (operator, 2026-08-14) — no CLI consumer was added per
the verify instruction — and it is a documented precondition: **the feature's value (fresh history for
0547) is delivered only when the server is running.** Documented in `docs/04_DESIGN.md` and surfaced
here as an explicit precondition on R1-R5; enabling `history.refresh.on_completion` without a running
`spur serve` will silently accumulate pending jobs.

**Residual risk — coalescing migration.** The scoped partial unique index
`queue_jobs_history_refresh_pending_unique` (`packages/domain/src/migrations.ts`) enforces at most one
pending `history.refresh` job. `CREATE UNIQUE INDEX IF NOT EXISTS` fails on an existing DB that already
holds duplicate pending rows of that type (only possible via the pre-fix race); none expected since the
trigger is opt-in and default-off.

**Residual risk — 0548 recommendations not implemented.** Single-flight guard ("caps queue depth at
one", a `processing` job is invisible to joins) and scoping the trigger to six full-fidelity sources are
0548 *recommendations*, not 0549 requirements (R5 explicitly says "matching `daily`'s existing
fan-out"). Deferred to the operator.

