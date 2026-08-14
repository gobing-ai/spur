---
template: feature-impl
schema_version: 1
name: "Correlate existing history retroactively by time window, marked estimated"
description: ""
status: done
type: task
profile: standard
feature_id: E6
parent_wbs: null
priority: P2
tags: []
dependencies: ["0557"]
ac_numbering: task-local
created_at: "2026-08-14T02:43:13.136Z"
updated_at: "2026-08-14T17:39:19.376Z"
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
- [x] **R1.** Correlate imported history rows to runs by time window over `(source, cwd, ts)` against
      recorded run windows, writing the result with exactness **estimated**. Measurable: a fixture with
      a known run window and matching session yields an estimated mapping.
- [x] **R2.** An `exact` mapping from task 0557 is never overwritten or downgraded by an estimated
      one. Measurable: running retroactive correlation over a range already covered by exact mappings
      leaves them unchanged, asserted by test.
- [x] **R3.** Ambiguous matches — several runs plausibly matching one session, or none — produce no
      mapping rather than a nearest-neighbour guess, and are counted in the run's report. Measurable:
      an overlapping-window fixture yields zero mappings and a reported ambiguity count.
- [x] **R4.** Correlation is re-runnable and bounded: it takes an explicit window, is idempotent over
      the same input, and does not rescan the full 1.3M-row table on every invocation. Measurable:
      a second run over the same window writes no duplicate rows and reads a bounded row count.
- [x] **R5.** The run reports coverage — how many rows in the window were correlated, how many were
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
- [x] Extend `exactness` with `estimated` and `mechanism` with `inferred` (R1)
- [x] Correlate by `(source, cwd, ts)` against run windows over an explicit bounded window (R1, R4)
- [x] Refuse to overwrite or downgrade an `exact` row, enforced in the write path (R2)
- [x] Write no mapping on ambiguous or absent candidates; count them (R3)
- [x] Make re-runs idempotent and the scan indexed (R4)
- [x] Report correlated / ambiguous / no-candidate counts and the window (R5)
- [x] Add tests: known-window match, exact-not-overwritten, ambiguity yields none, idempotent re-run (R1-R5)
- [x] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
#### Change map

1. `packages/domain/src/migrations.ts:122-146` — `HISTORY_RUN_SESSION_SCHEMA_SQL` composed into `CLI_SCHEMA_SQL` (0000 foundation) and shipped as incremental migration `0012_spur_cli_history_run_session`; the table is shared with task 0557, whose `exact`/`unresolved` rows this task must not disturb (R2). No new DDL needed for `estimated` / `inferred` — they are values in existing `exactness` / `mechanism` columns, extended in the DAO types (R1).
2. `packages/domain/src/dao/run-session-dao.ts:17-21` — `RunSessionExactness` adds `'estimated'`, `RunSessionMechanism` adds `'inferred'` (R1); `insertInferred()` (new, `:96-131`) enforces both write-path guards: an `exact` row for the run blocks the insert (R2 — a task 0557 boundary observation is authoritative and never shadowed), and an identical `estimated` row for `(run_id, source, session_id)` blocks a duplicate (R4 idempotence). Returns whether a row was written so the correlator can report `mappingsWritten`.
3. `packages/domain/src/analytics/retro-correlation.ts` (new) — `RetroCorrelator.correlate(window)`: loads run windows from `system_events` `agent.invoke.start`/`agent.invoke.exit` pairs keyed by `run_id` (PREMISE VERIFICATION source; `coordination_runs` holds 0 rows) and history sessions via a `WHERE ts BETWEEN ? AND ? AND run_id IS NULL … GROUP BY source, session_id, cwd` scan (R4 — bounded and indexed). A session whose `(source, min_ts, max_ts)` span intersects exactly one run window is written `estimated`/`inferred`; zero or several intersections write nothing and are counted (R3 — no nearest-neighbour guess); an open window (crash/kill, no exit) is bounded by the correlation window's end, never treated as matching everything after it. Source resolves from the event payload's `agent` field, falling back to the `actor` column; events without a `run_id` are skipped. Missing `system_events`/`history_message` tables degrade to an empty report instead of throwing.
4. `packages/domain/src/analytics/index.ts:49-53` and `packages/domain/src/index.ts` (`export * from './analytics'`) — export `RetroCorrelator`, `RetroCorrelationWindow`, `RetroCorrelationReport`.
5. `packages/domain/tests/analytics/retro-correlation.test.ts` (new) — 10 tests covering R1 (known window → estimated mapping), R2 (exact row unchanged, no estimated duplicate), R3 (overlap → zero mappings + ambiguity count; no candidate → counted, not guessed; unresolvable source → noCandidate), R4 (re-run writes no duplicates, scans only the window), R5 (mixed report carries all three counts + window), plus open-window bounding and unmigrated-table tolerance.
6. `docs/04_DESIGN.md:266-281` (§3.1 table row + `spur agent run` section) — retroactive-correlation paragraph and `history_run_session` row (T3).

Rationale: correlation lives in `packages/domain` (not the app layer) because it is a pure analytics pass over domain tables with no HTTP/transport dependency, matching the `run-cost.ts` analytics precedent; the R2/R4 guards sit in the DAO write path so any future writer inherits them rather than re-deriving the invariant by convention.
### Testing
**Re-verify 2026-08-14** (`/sp-dev-verifyall --feature E6 --force --fix all` in worktree `spur-new-runall-e6-e91f`). Task already `done`; `--force` re-audited. Line anchors re-read this run.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/analytics/retro-correlation.ts:28` RetroCorrelator; DAO `packages/domain/src/dao/run-session-dao.ts:113` `insertInferred`. Test `packages/domain/tests/analytics/retro-correlation.test.ts:62` (this run). |
| R2 | MET | DAO `insertInferred` blocks when an exact row exists (`packages/domain/src/dao/run-session-dao.ts:113-133`). Tests `packages/domain/tests/analytics/retro-correlation.test.ts:115` + `packages/domain/tests/dao/run-session-dao.test.ts` insertInferred exact-blocks-estimated (this run). |
| R3 | MET | Tests `packages/domain/tests/analytics/retro-correlation.test.ts:156` overlap → no mapping; `:209` no candidate counted not guessed (this run). |
| R4 | MET | Test `packages/domain/tests/analytics/retro-correlation.test.ts:224` re-run writes no duplicates; DAO identical-estimated blocks rewrite (this run). |
| R5 | MET | Test `packages/domain/tests/analytics/retro-correlation.test.ts:265` mixed window reports all three counts (this run). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R4 — Already-imported history is correlated retroactively and marked estimated | MET | test | `packages/domain/tests/analytics/retro-correlation.test.ts:62` estimated/inferred + `:115` exact never overwritten (this run: 20 pass / 0 fail across retro-correlation + run-session-dao) |

Coverage: N/A (correlator + DAO covered by targeted tests). `--fix all` flipped leftover checkboxes and replaced basename-only Testing citations. Artifact: `.spur/run/0558-verdict.json`.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Efficiency | `packages/domain/src/analytics/retro-correlation.ts:49-62` | Per-session `runs.filter` is O(sessions × run-windows) in memory; fine at current scale (~202 invoke events → ~100 windows), revisit if run-window counts grow large |
| P4 | Correctness | `packages/domain/src/dao/run-session-dao.ts:120-127` | R2 guard is conservative: any `exact` row for a run blocks *all* estimated inserts for that run, even a different session; documented intent and asserted by the R2 correlator test — over-blocking direction is deliberate, not a defect |
| P4 | Architecture | `packages/domain/src/dao/run-session-dao.ts:120-135` | R4 idempotence enforced by SELECT-then-INSERT guard rather than a unique index; correct for sequential re-runs (the asserted R4 case), a unique constraint on `(run_id, source, session_id, exactness)` would harden concurrent runs |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `retro-correlation.ts:53-62` — single-candidate session written via `insertInferred` (exactness `estimated`, mechanism `inferred`, `run-session-dao.ts:134`); test `retro-correlation.test.ts:60-107` asserts the estimated mapping row |
| R2 | MET | `run-session-dao.ts:120-127` — `exact` row for the run blocks the estimated insert; correlator test `retro-correlation.test.ts:109-135` — exact row unchanged, `mappingsWritten: 0`; DAO test `run-session-dao.test.ts:97-121` |
| R3 | MET | `retro-correlation.ts:51-60` — zero or ≥2 candidate windows write nothing and are counted (`noCandidate` / `ambiguous`); tests `retro-correlation.test.ts:137-214` (overlap → zero mappings + ambiguity count; no candidate → counted, not guessed) |
| R4 | MET | `retro-correlation.ts:82,140` — window-bounded queries (`WHERE ts BETWEEN ? AND ? AND run_id IS NULL` / `occurred_at` bounds), index-backed by `idx_history_message_ts` (ts-libs `schema-sql.ts:78`); `run-session-dao.ts:120-127` duplicate guard; re-run test `retro-correlation.test.ts:216-253` (second run `mappingsWritten: 0`, `rowsScanned: 1`) |
| R5 | MET | `retro-correlation.ts:72-77` — report carries `correlated` / `ambiguous` / `noCandidate` plus the window; mixed-bucket test `retro-correlation.test.ts:255-330` asserts all three counts + window |

**Acceptance Criteria (R4 scenario)** — MET: matched rows carry a run id marked estimated (R1 test) and an exact mapping is never overwritten (R2 test).

**Design conformance** — 8/8 plan items DONE: migration `0012_spur_cli_history_run_session` (`migrations.ts:304`, asserted in `migrations.test.ts:75`); no new DDL for the two enum values (types only, `run-session-dao.ts:22-23`); run windows from `system_events` invoke pairs (`retro-correlation.ts:82-137`); open-window bounded by correlation-window end (`:97-106`, test `:411-445`); unmigrated-table tolerance (`:84-87,146-150`, test `:332-348`); source from payload `agent` with actor fallback (`:158-166`, test `:350-409`); exports (`analytics/index.ts:49-54`); `docs/04_DESIGN.md` §3.1 row + retroactive-correlation paragraph (T3, same working tree).

**Validation (this run):** `bun test packages/domain/tests/analytics/retro-correlation.test.ts packages/domain/tests/dao/run-session-dao.test.ts` → 17 pass / 0 fail; `bunx tsc --noEmit` (packages/domain) clean; `bunx biome check` on the 4 new/changed files clean.

Functional Verdict: PASS
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
- 2026-08-14T07:16:14.823Z todo → wip (system)
- 2026-08-14T07:21:01.863Z wip → testing (system)
- 2026-08-14T07:21:03.308Z testing → done (system)
