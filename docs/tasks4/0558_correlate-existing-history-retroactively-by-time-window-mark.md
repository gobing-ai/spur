---
template: feature-impl
schema_version: 1
name: "Correlate existing history retroactively by time window, marked estimated"
description: ""
status: todo
type: task
profile: standard
feature_id: E6
parent_wbs: null
priority: P2
tags: []
dependencies: ["0557"]
ac_numbering: task-local
created_at: "2026-08-14T02:43:13.136Z"
updated_at: "2026-08-14T02:52:59.865Z"
---

## 0558. Correlate existing history retroactively by time window, marked estimated

### Background
Task 0557 correlates future runs. It cannot help the 1,296,633 history rows already imported, of
which 166,162 carry token data — all with `run_id` NULL.

Retroactive correlation is the only way to attribute any of that, and it is inherently probabilistic:
the evidence available after the fact is `(source, cwd, timestamp)` on the history side and a run
window on the spur side. The 2026-08-13 operator ruling accepts this **as long as it is marked
estimated** — a distinction the codebase already models with `actionCost` versus
`actionCostEstimated` (`packages/domain/src/analytics/run-cost.ts`).

This is the R1b half of the design already sketched at `agent-service.ts:195-201`.
### Requirements
- [ ] **R1.** Correlate imported history rows to runs by time window over `(source, cwd, ts)` against
      recorded run windows, writing the result with exactness **estimated**. Measurable: a fixture with
      a known run window and matching session yields an estimated mapping.
- [ ] **R2.** An `exact` mapping from task 0557 is never overwritten or downgraded by an estimated
      one. Measurable: running retroactive correlation over a range already covered by exact mappings
      leaves them unchanged, asserted by test.
- [ ] **R3.** Ambiguous matches — several runs plausibly matching one session, or none — produce no
      mapping rather than a nearest-neighbour guess, and are counted in the run's report. Measurable:
      an overlapping-window fixture yields zero mappings and a reported ambiguity count.
- [ ] **R4.** Correlation is re-runnable and bounded: it takes an explicit window, is idempotent over
      the same input, and does not rescan the full 1.3M-row table on every invocation. Measurable:
      a second run over the same window writes no duplicate rows and reads a bounded row count.
- [ ] **R5.** The run reports coverage — how many rows in the window were correlated, how many were
      ambiguous, how many had no candidate run at all. Measurable: the result carries all three counts
      and the window.
### Acceptance Criteria
Covers feature E6 scenario:

- **R4 — Already-imported history is correlated retroactively and marked estimated**

```gherkin
Scenario: R4 — Already-imported history is correlated retroactively and marked estimated
  Given history rows imported before correlation existed
  When retroactive correlation runs over a bounded window
  Then matched rows carry a run id marked estimated
  And an exact mapping is never overwritten by an estimated one
```
### Q&A
**Closed during refine (2026-08-13).**

- **Why is this estimated rather than exact?** After the fact the only evidence is source, cwd, and
  time. Calling that exact would erase the distinction task 0559 and task 0547 R4 both depend on.
- **What if a run already has an exact mapping?** Untouched (R2), enforced in the write path.
- **What about ties?** No mapping (R3). A nearest-neighbour pick is a guess wearing a number.
- **Can `provenance` narrow the search?** No — it is a cwd substring match today and does not mean
  spur-launched. Task 0559 fixes it.

**Deferred with owner.**

- **Re-correlating after task 0559 fixes `provenance`** — owner: operator. A better launch signal
  would let this task narrow its candidate set; worth a re-run, not a redesign.
- **Whether estimated mappings should expire** — owner: operator; only if they prove noisy.
### Design
**Estimated is the honest ceiling here, not a defect.** After the fact the only evidence is source,
cwd, and time. Presenting that as exact would collapse the very distinction task 0559 needs to
weight its output, and would make a heuristic indistinguishable from a boundary observation.

**Exact always wins (R2).** Task 0557's rows are authoritative. This task fills gaps; it does not
adjudicate. Enforce it in the write path, not by convention.

**No nearest-neighbour (R3).** When two run windows plausibly contain a session, picking the closer
one is a guess wearing a number. Report the ambiguity and leave the row uncorrelated — the operator
can see the gap; they cannot see a wrong attribution.

**Bounded and idempotent (R4).** This runs over a 1.3M-row table. Take an explicit window, key writes
so a re-run is a no-op, and index the scan. An unbounded full-table pass on every invocation is the
failure feature J3 already fixed once on the events ledger.

#### Frozen names

| Frozen | Value | Location |
| --- | --- | --- |
| Mapping table (from 0557) | `history_run_session` | `packages/domain/src/migrations.ts` |
| `exactness` value added | `estimated` (joins `exact`, `unresolved`) | — |
| `mechanism` value added | `inferred` (joins `observed`, `supplied`) | — |
| History side | `history_message (source, cwd, ts, session_id)` | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:29-52` |
| Run windows | `coordination_runs (run_id, started_at, completed_at)` (currently 0 rows) and/or the run records task 0557 writes | `packages/domain/src/migrations.ts:107-117` |
| Existing precedent | `actionCost` vs `actionCostEstimated` | `packages/domain/src/analytics/index.ts:52-53` |

#### Anti-patterns — what not to implement

- Do **not** mark an inferred mapping `exact`, and do **not** overwrite an existing `exact` row (R2).
- Do **not** pick a nearest match when several runs fit (R3).
- Do **not** scan the whole table per invocation (R4).
- Do **not** use `provenance` as a filter — it is a cwd substring match today
  (`mappers.ts:61-64`) and does not mean spur-launched. Task 0559 fixes it; until then it is noise.
- Do **not** write into `history_message` outside the correlated `run_id` column.

#### Cross-task contract

**Assumes from 0557:** the `history_run_session` table with `exactness` and `mechanism`, and exact
rows already present for observed runs.

**Leaves for dependents:** task **0559** weights attribution by `exactness`; feature J6 task **0547**
reports exact and estimated totals separately (its own R4), which only works if this task never
blurs the two.

#### PREMISE VERIFICATION (2026-08-13) — where run windows actually come from

`coordination_runs` (`packages/domain/src/migrations.ts:107-117`) holds **0 rows** — it is G4's
supervised-coordination table and nothing has populated it. It is **not** the source of run windows,
despite being the obvious-looking candidate.

The real source is the `agent.invoke.start` / `agent.invoke.exit` pair in `system_events`: 202 rows
today, each with `occurred_at`, and carrying `run_id` once task 0557 threads it. A run window is the
`occurred_at` of a `start` and its matching `exit` for the same `run_id`.

| Frozen | Value | Location |
| --- | --- | --- |
| Run-window source | `system_events` where `event_name IN ('agent.invoke.start','agent.invoke.exit')`, paired by `run_id` | `packages/domain/src/migrations.ts:81-91` |
| Window bounds | `occurred_at` of `start` → `occurred_at` of `exit` | same |
| Index available | `idx_system_events_event_name` · `idx_system_events_occurred_at` · `idx_system_events_run_id` | `migrations.ts:93-98` |
| **Not** the source | `coordination_runs` (0 rows) | `migrations.ts:107-117` |

A run whose `exit` is missing (crash, kill) has an open window; bound it by the next `start` for the
same agent or by a configured maximum, and mark those correlations estimated like any other — never
treat an unbounded window as matching everything after it.
### Plan
- [ ] Extend `exactness` with `estimated` and `mechanism` with `inferred` (R1)
- [ ] Correlate by `(source, cwd, ts)` against run windows over an explicit bounded window (R1, R4)
- [ ] Refuse to overwrite or downgrade an `exact` row, enforced in the write path (R2)
- [ ] Write no mapping on ambiguous or absent candidates; count them (R3)
- [ ] Make re-runs idempotent and the scan indexed (R4)
- [ ] Report correlated / ambiguous / no-candidate counts and the window (R5)
- [ ] Add tests: known-window match, exact-not-overwritten, ambiguity yields none, idempotent re-run (R1-R5)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Design precedent (R1b):** `packages/app/src/services/agent-service.ts:195-201` — "the heuristic
  time-window fallback (R1b) applies"
- **Exact-vs-estimated precedent:** `packages/domain/src/analytics/index.ts:52-53`
  (`actionCost` / `actionCostEstimated`)
- **History columns:** `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:29-52`
  (`source`, `cwd`, `ts`, `session_id`, `run_id`)
- **Run windows:** `packages/domain/src/migrations.ts:107-117` (`coordination_runs`, 0 rows today)
- **Unbounded-scan failure to avoid:** feature J3 § Goal
- **`provenance` is not a launch signal:**
  `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts:61-64`
- **Upstream:** task 0557 · **Downstream:** task 0559, feature J6 task 0547
### History
