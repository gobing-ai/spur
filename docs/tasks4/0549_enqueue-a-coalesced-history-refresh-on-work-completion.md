---
template: feature-impl
schema_version: 1
name: "Enqueue a coalesced history refresh on work completion"
description: ""
status: todo
type: task
profile: standard
feature_id: E3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0548"]
ac_numbering: task-local
created_at: "2026-08-14T00:48:40.758Z"
updated_at: "2026-08-14T01:38:48.953Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
