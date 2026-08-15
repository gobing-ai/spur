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
updated_at: "2026-08-15T05:49:58.528Z"
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
- [x] **R1.** An explicit trigger enqueues a history refresh when work completes, through the
      embedded job queue (feature A2) — never inline on the operation's critical path. The operation
      returns without waiting. Measurable: the operation's elapsed time is statistically unchanged
      with the trigger enabled, and a job is observably enqueued.
- [x] **R2.** Bursts coalesce. Several completions inside the coalescing window produce exactly one
      refresh whose covered window spans all of them. Measurable: N completions inside the window
      yield one refresh run, not N.
- [x] **R3.** The trigger is explicit and opt-in, not implicit. It is configured on, its firing is
      observable, and it can be disabled without editing code. A refresh that fires invisibly is the
      hidden automation the project constitution rules out. Measurable: with the trigger disabled no
      refresh is enqueued; with it enabled each firing is observable.
- [x] **R4.** Cadence follows task 0548's measurement rather than a guess: the coalescing window and
      whether import and analyze fire at the same frequency are set from the recorded figures, and
      the choice is documented with a pointer to them. Measurable: the configured window is traceable
      to a figure in 0548's artifact.
- [x] **R5.** Per-source isolation is preserved. One source failing during a triggered refresh does
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
- [x] Read task 0548's artifact and pick the coalescing window and per-stage cadence from it (R4)
- [x] Add the trigger as opt-in configuration with an off switch that is not a code edit (R3)
- [x] Enqueue a refresh job through the feature A2 job queue on work completion (R1)
- [x] Implement coalescing so a burst yields one refresh spanning the whole window (R2)
- [x] Make each firing observable, and assert no refresh is enqueued when disabled (R3)
- [x] Reuse `daily`'s import-all fan-out so per-source isolation is preserved (R5)
- [x] Add tests: non-blocking enqueue, burst coalescing, disabled path, single-source failure isolation (R1-R3, R5)
- [x] Update `docs/04_DESIGN.md` and `config/config.example.yaml` in the same commit (T3), then run `bun run autofix && bun run spur-check`
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
**Re-verify 2026-08-15** (`/sp-dev-verifyall --feature E3 --force --fix all`). Status guard bypassed with `--force` (task already `done`). `--next: no-op — task already terminal (done)`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/history-refresh-service.ts:82-117` — `enqueueHistoryRefresh` calls `enqueueCoalesced` and returns; never runs the refresh. Call sites: `apps/cli/src/commands/task.ts:443` (task-done), `apps/cli/src/commands/workflow.ts:307`, `apps/cli/src/commands/workflow.ts:493`, `apps/cli/src/commands/workflow.ts:560` (pipeline-run). CLI helper `apps/cli/src/history-refresh.ts:25-69` returns after enqueue + ledger flush. Test: `packages/app/tests/services/history-refresh-service.test.ts:55` (0 fail this run). |
| R2 | MET | `packages/domain/src/db.ts:209-282` — `INSERT … ON CONFLICT DO NOTHING` + 3-attempt merge; at-most-one-pending via `queue_jobs_history_refresh_pending_unique` (`packages/domain/src/migrations.ts:76`). Merge keeps earliest `windowStart` / extends `windowEnd` (`packages/app/src/services/history-refresh-service.ts:102-111`). Tests this run (0 fail): `packages/domain/tests/db.test.ts:165` (burst joins), `packages/domain/tests/db.test.ts:201` (two connections → one pending job), `packages/app/tests/services/history-refresh-service.test.ts:76` (5-completion burst). |
| R3 | MET | `packages/config/src/index.ts:503-506` — `on_completion` default `false`, `debounce_ms` floor 1000. Disabled path short-circuits before DB (`packages/app/src/services/history-refresh-service.ts:86-87`). Observable `history.refresh.enqueued` at `apps/cli/src/history-refresh.ts:47-57`; `coalesced` metadata field `packages/app/src/services/event-names.ts:222`. Tests this run (0 fail): `apps/cli/tests/history-refresh.test.ts:69`, `apps/cli/tests/history-refresh.test.ts:80`, `packages/app/tests/services/history-refresh-service.test.ts:44`. |
| R4 | MET | `packages/config/src/index.ts:498-506` — default `600_000` ms traced to `docs/tasks4/0548-import-cost-measurement.md:51` (20.64 s fan-out) and `docs/tasks4/0548-import-cost-measurement.md:123-127` (10-min window). Example + design: `config/config.example.yaml:139-142`, `docs/04_DESIGN.md:763-776`. Test: `packages/config/tests/config-schemas.test.ts:61` (0 fail this run). `--fix all` this run: `docs/04_DESIGN.md:574` debounce default **60000** → **600000**; removed stale first example block that still said `60000`. |
| R5 | MET | `packages/app/src/services/history-refresh-service.ts:141-205` — job body reuses `HistoryService.daily`. Tests this run (0 fail): `packages/app/tests/services/history-refresh-service.test.ts:143` (success + coalesced window), `packages/app/tests/services/history-refresh-service.test.ts:157` (degraded fan-out emits `history.daily.failed`, does not rethrow). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R2 — Completing work enqueues a refresh without blocking it | MET | test | `packages/app/tests/services/history-refresh-service.test.ts:55` — first completion enqueues one delayed job; `apps/cli/src/history-refresh.ts:25-69` returns after enqueue + ledger flush. 0 fail this run. |
| R3 — A burst of operations produces one refresh | MET | test | `packages/domain/tests/db.test.ts:165` (join + merged window) + `packages/domain/tests/db.test.ts:201` (cross-process → one pending) + `packages/app/tests/services/history-refresh-service.test.ts:76` (5 completions → one job spanning all). 0 fail this run. |
| R6 — A failing source does not fail the refresh | MET | test | `packages/app/tests/services/history-refresh-service.test.ts:157` — degraded fan-out emits `history.daily.failed`, does not rethrow, remaining sources still import. 0 fail this run. |

**Design conformance:** DONE — queued not inline; opt-in config; window from 0548; `daily` reused. CHANGED (documented): server-mediated drain (`apps/server/src/serve.ts`) is an explicit precondition in task Notes — no CLI consumer, operator 2026-08-14.

**SECUA:** no open P1–P2. Server-only drain is an accepted precondition. Coalescing race is closed (unique index + cross-process test).

Coverage: N/A (verdict-based; verify pipeline does not measure code coverage).
### Review
**Review verdict: PASS** — R1–R5 MET. Prior P2s are closed or accepted; they no longer block `done`.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 | architecture/ops | `apps/server/src/serve.ts:415-423` | Jobs drain only under `spur serve`. CLI-only operators enqueue a pending row that never runs without the server. | ACCEPTED — intended product decision (operator 2026-08-14). Documented as a precondition in Notes + `docs/04_DESIGN.md:574,788`. No CLI consumer (ADR-051). |
| P2 | correctness/concurrency | `packages/domain/src/db.ts:209-282`, `packages/domain/src/migrations.ts:76` | Original review: lookup-then-insert race under two processes. | CLOSED — `INSERT … ON CONFLICT DO NOTHING` + partial unique index `queue_jobs_history_refresh_pending_unique`. Cross-process test: `packages/domain/tests/db.test.ts:201`. |
| P3 | observability (R3) | `packages/app/src/services/history-refresh-service.ts:113-116` | Enqueue event used to report the incoming `[now, now]` window on a join. | CLOSED — `enqueueCoalesced` returns the post-merge payload; `history.refresh.enqueued` carries the burst window. |
| P4 | observability | `packages/app/src/services/event-names.ts:222` | `coalesced` was missing from history metadata fields. | CLOSED — `field('coalesced', 'Coalesced')`. |
| P4 | efficiency/R1 | `apps/cli/src/history-refresh.ts:25-69` | Trigger is awaited (config + enqueue + ledger flush); refresh itself is never inline. | NOTE — bounded; R1 still holds. |
| P4 | design conformance | `packages/app/src/services/history-refresh-service.ts:141-205` | 0548 recommended single-flight while `processing` and six-source scope. | DEFERRED — 0548 recommendations, not 0549 R5 (`daily` fan-out reused as specified). |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/history-refresh-service.ts:82-117` enqueue never inline; test `packages/app/tests/services/history-refresh-service.test.ts:55` |
| R2 | MET | `packages/domain/src/db.ts:209-282` + `packages/domain/src/migrations.ts:76`; tests `packages/domain/tests/db.test.ts:165`, `packages/domain/tests/db.test.ts:201` |
| R3 | MET | `packages/config/src/index.ts:503-506` default off; tests `apps/cli/tests/history-refresh.test.ts:69` |
| R4 | MET | default `600_000` ms from `docs/tasks4/0548-import-cost-measurement.md:123-127`; test `packages/config/tests/config-schemas.test.ts:61` |
| R5 | MET | job reuses `HistoryService.daily`; test `packages/app/tests/services/history-refresh-service.test.ts:157` |

**Residual risk.** Enabling `history.refresh.on_completion` without `spur serve` accumulates pending jobs (accepted precondition). A pre-index DB that already holds duplicate pending `history.refresh` rows would fail `CREATE UNIQUE INDEX IF NOT EXISTS` — not expected (trigger default-off).
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
**Precondition (server-mediated operation — ACCEPTED).** `history.refresh` jobs are consumed ONLY
by `spur serve`'s `JobWorkerService` (`apps/server/src/serve.ts:415-423`). The CLI has no
worker/scheduler, so a CLI-only operator (`spur task done` / `spur workflow run`, incl. runall
parallel agents) enqueues a pending job that never runs without the server. This is the intended
product decision (operator, 2026-08-14) — no CLI consumer (ADR-051). **The feature's value (fresh
history for 0547) is delivered only when the server is running.** Documented in `docs/04_DESIGN.md`.
Enabling `history.refresh.on_completion` without a running `spur serve` will silently accumulate
pending jobs.

**Residual risk — coalescing migration.** The scoped partial unique index
`queue_jobs_history_refresh_pending_unique` (`packages/domain/src/migrations.ts`) enforces at most
one pending `history.refresh` job. `CREATE UNIQUE INDEX IF NOT EXISTS` fails on an existing DB that
already holds duplicate pending rows of that type (only possible via the pre-fix race); none
expected since the trigger is opt-in and default-off.

**Residual risk — 0548 recommendations not implemented.** Single-flight guard ("caps queue depth at
one", a `processing` job is invisible to joins) and scoping the trigger to six full-fidelity
sources are 0548 *recommendations*, not 0549 requirements (R5 says "matching `daily`'s existing
fan-out"). Deferred to the operator.
