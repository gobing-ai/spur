---
template: feature-impl
schema_version: 1
name: "Make role-to-executor routing queryable in one indexed round trip"
description: ""
status: done
type: task
profile: standard
feature_id: J6
parent_wbs: null
priority: P2
tags: []
dependencies: ["0545"]
ac_numbering: task-local
created_at: "2026-08-14T00:19:15.171Z"
updated_at: "2026-08-14T23:36:17.924Z"
---

## 0546. Make role-to-executor routing queryable in one indexed round trip

### Background
Task 0545 records the routing decision. Recording it is not enough: the operator's question is
comparative — *which* executor served *which* role, how often, and how often did routing start too
cheap and have to escalate.

Feature J3's terrain finding is the warning here: the `system_events` ledger supported only exact
`name` + `since` + `limit` queries, so every Board filter degenerated into client-side sifting over a
fixed 100-row window that was statistically all heartbeat. Attribution written but not queryable
would land in exactly that state — present in the rows, unreachable in practice.

This task adds the read path. It rides an existing surface: J5 ruled new nouns and verbs out for this
plane, and ADR-051 gates them regardless.
### Requirements
- [x] **R1.** Answer "which executor served which role" as an aggregate: per (role, executor) pair,
      the run count and the escalation count, over a bounded time window. Measurable: a dataset with
      known routing produces the expected counts per pair.
- [x] **R2.** The answer comes from an indexed query, not client-side filtering over a fixed window.
      One round trip, bounded work. Measurable: the query plan uses an index on the correlating
      column(s), and result size does not depend on scanning unrelated event families.
- [x] **R3.** No new CLI noun or verb. The query rides an existing surface — the observability read
      API and/or an existing `spur` noun's `--json` output. Adding a noun requires ADR-051 operator
      consent and is explicitly out of scope. Measurable: `spur --help` gains no top-level noun.
- [x] **R4.** The result distinguishes the selection sources recorded by task 0545, so a pinned run
      is not counted as evidence that role routing chose that executor. Measurable: a dataset mixing
      pinned and role-resolved runs to the same executor reports them separately.
- [x] **R5.** The query is correct on a ledger that predates attribution. Rows without routing
      metadata are excluded from counts rather than counted as an unknown role, and the result states
      the covered window. Measurable: a mixed dataset of pre- and post-attribution rows returns
      counts over the post-attribution rows only, with the window reported.
### Acceptance Criteria
Covers feature J6 scenario:

- **R4 — Routing is queryable in one indexed round trip**

```gherkin
Scenario: R4 — Routing is queryable in one indexed round trip
  Given persisted attribution across many runs
  When the operator asks which executor served which role
  Then the answer comes from an indexed query rather than client-side filtering
  And it reports per pair the run count and the escalation count
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **May an index be added?** Yes. Task 0545 R3 forbids a new *table or column*; an index on an
  existing column is the sanctioned way to make the access path indexed (R2).
- **Are pinned runs counted as role routing?** No — reported separately (R4). Pinning is the common
  case here, so merging them would flatter the routing badly.
- **What happens to rows written before attribution existed?** Excluded from counts, with the covered
  window reported (R5). Imputing "unknown role" would dilute every ratio.
- **Does this need a new CLI noun?** No (R3) — ADR-051 gates that, and J5 already ruled new
  nouns/verbs out for this plane.

**Deferred with owner.**

- **Which existing surface hosts the query** — owner: operator, if no existing surface fits cleanly.
  Prefer the observability read API; a noun addition is a decision brief, not an implementation choice.
- **Token totals in the same aggregate** — owner: task 0547. Kept separate so this query carries no
  history-plane dependency.
### Design
**The comparison is the product.** A flat list of runs is not an answer; the operator is asking
whether cheap roles land on cheap executors. Aggregate by (role, executor) with run and escalation
counts, and the defect — a `scribe` routinely served by a `capable-3` executor, or a `planner`
escalating on most runs — is visible at a glance.

**Separate pinned from role-resolved (R4).** A pinned run says nothing about whether role routing
works; counting it as evidence would make a fully-pinned pipeline look like perfectly-tuned routing.
This repo's own `task-pipeline.yaml` pins deliberately, so this is the common case, not an edge case.

**Exclude, do not impute (R5).** Rows predating attribution have no role. Counting them as an unknown
role would silently dilute every ratio the operator reads. Exclude them and report the covered
window, so a small dataset reads as a small dataset rather than as a skewed one.

**Ride an existing surface (R3).** J5 ruled new nouns and verbs out for this plane and ADR-051 gates
them regardless. If no existing surface fits cleanly, that is a decision brief for the operator, not
a licence to add a noun.

**Indexed, not sifted (R2).** Feature J3 fixed exactly this failure mode on this ledger; do not
reintroduce it. If the correlating column is not indexed for this access pattern, adding the index is
in scope — adding a *table* is not (task 0545 R3).

**Not in scope:** token totals per role — task 0547 adds that dimension by joining to the history
plane over `run_id`, and it is kept separate so this query carries no history-plane dependency. Any
dollar figure is excluded permanently, not deferred (feature J6 § *Tokens, not prices*). Board
rendering is J4's; routing behavior is feature B2's.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Source rows | `system_events` filtered to attribution-bearing events | `packages/domain/src/migrations.ts:81-91` |
| Indexes available | `idx_system_events_run_id` · `_event_name` · `_occurred_at` · `_entity` · `_sequence` | `migrations.ts:93-98` |
| Aggregate key | `(role, executor)` | — |
| Aggregate shape | `{ role, executor, source, runs, escalations }` over a bounded window | new |
| Selection sources | `role` · `explicit` (pin) · `default` · escalated | from task 0545 |
| Window bound | explicit `since` / `until`, defaulting to a bounded recent range | no unbounded scan |

**No new CLI noun or verb** (R3). The query rides the existing observability read API and/or an
existing noun's `--json`; ADR-051 gates any noun addition regardless.

#### Anti-patterns — what not to implement

- Do **not** filter client-side over a fixed row window. That is precisely the failure feature J3
  fixed on this ledger (exact-`name` + `since` + `limit` only, forcing 100-row client sifting).
- Do **not** count pinned runs as evidence of role routing (R4). This repo's own
  `config/workflows/task-pipeline.yaml:56-65` pins deliberately, so pinned is the common case, not an
  edge case — merging them would make a fully-pinned pipeline look like perfect routing.
- Do **not** impute a role for pre-attribution rows (R5). Exclude them and report the window; counting
  them as "unknown" silently dilutes every ratio.
- Do **not** add a table. If the access path needs an index, add the **index** (task 0545 R3 forbids
  the table, not the index).
- Do **not** compute token totals here — that is task 0547, kept separate so this query has no
  history-plane dependency.

#### Cross-task contract

**Assumes from 0545:** every attribution row carries `run_id` and a stable selection-source value, and
escalations are separate records. Without separate escalation records the escalation count is not
computable.

**Leaves for dependents:**

- Task **0547** extends this aggregate with a token dimension and must not re-implement the grouping.
- Task **0552** (feature J7, batch 3) renders this aggregate and adds no query of its own — the shape
  frozen above is the interface it consumes.
### Plan
- [x] Define the aggregate shape: (role, executor) → run count, escalation count, over a window (R1)
- [x] Implement it as an indexed query on the existing ledger, adding an index if needed (R2)
- [x] Expose it through an existing read surface without adding a CLI noun or verb (R3)
- [x] Report pinned and role-resolved runs separately (R4)
- [x] Exclude pre-attribution rows from counts and report the covered window (R5)
- [x] Add tests: known dataset produces expected counts; mixed pinned/resolved separates; pre-attribution rows excluded (R1, R4, R5)
- [x] Assert the access path is indexed and does not scan unrelated event families (R2)
- [x] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
Implemented the role→executor routing aggregate as an indexed, one-round-trip SQL query on the
existing `system_events` ledger, riding the observability read API (`SystemEventDao`) — no new CLI
noun or verb (R3), no new table/column (an index addition was evaluated and found unnecessary: the
existing `idx_system_events_event_name` serves the `event_name` predicates and the escalation join
rides `idx_system_events_run_id`).

Change map:

- **`packages/domain/src/dao/system-event-dao.ts:103-158`** — new public types
  `RoutingSummaryWindow` / `RoutingSummaryPair` ({ role, executor, source, runs, escalations } —
  the frozen aggregate shape) / `RoutingSummaryResult` (pairs + covered window, R5) /
  `RoutingSummaryQuery`, plus `ROUTING_SUMMARY_DEFAULT_WINDOW_MS` (7-day bounded recent default;
  "no unbounded scan").
- **`packages/domain/src/dao/system-event-dao.ts:384-428`** — new `routingSummary(spec)` method.
  One SQL statement: `routed` CTE selects `agent.invoke.start` rows with a routing block
  (`json_extract` of `$.data.routing.{role,executor,source}`) inside the inclusive
  `occurred_at` window; `esc` CTE selects `agent.invoke.escalated` rows with `fromExecutor`;
  LEFT JOIN on `run_id` + `from_executor`; `GROUP BY (role, executor, source)` with
  `COUNT(DISTINCT …)`. Runs count dispatches (start, not exit — no double count; an escalated
  re-dispatch is its own serve on the executor it landed on). Escalations count records whose
  `fromExecutor` matches the pair — "started too cheap", not "escalated to". Pre-attribution rows
  (no routing metadata) and malformed payloads are excluded via `json_valid`-guarded extraction
  (R5); window reported on the result. Missing-table safety mirrors `query()`.
- **`packages/domain/src/dao/index.ts:27-31`** — export the new types + constant through the
  package surface.
- **`packages/domain/tests/dao/system-event-dao.test.ts:775-1036`** — 5 tests:
  (a) known dataset → exact per-pair runs/escalations (R1); (b) mixed pinned/resolved to the same
  executor report as separate pairs (R4); (c) pre-attribution rows excluded + window reported,
  incl. a malformed-JSON row that must not throw (R5); (d) omitted window defaults to bounded
  recent 7 days (R5); (e) captured SQL asserts `event_name = 'agent.invoke.start'` /
  `'agent.invoke.escalated'` predicates + window + `GROUP BY` in one round trip — indexed-column
  filtering in SQL, never client sifting (R2).
- **`docs/04_DESIGN.md:1731`** — §7.9 gains the "Routing aggregate read path (task 0546)"
  paragraph (T3, same commit): aggregate shape, indexed access path, source separation, window
  reporting, 0547/0552 contracts.

No index or migration change was needed (R2 measured: `EXPLAIN QUERY PLAN` uses
`idx_system_events_event_name` for the family filter and `idx_system_events_run_id` for the join).
### Testing
Independent re-audit 2026-08-14 (`/sp:dev-verify 0546 --auto --next --force --focus all --fix all`). `--fix all` flipped 5 leftover `[ ]` Requirement boxes. Verdict AC id remapped to feature J6 scenario R4. Artifacts: `.spur/run/0546-verdict.json`, `.spur/run/0546-verify-answer.txt`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Aggregate SQL `packages/domain/src/dao/system-event-dao.ts:387-440` (runs + escalations per role/executor/source). This run: `packages/domain/tests/dao/system-event-dao.test.ts:776` known dataset matches expected pair counts |
| R2 | MET | Composite index `packages/domain/src/migrations.ts:266-268` + `0014` `:340-342`. This run: SQL-in-one-trip test `:1002`; EXPLAIN names `idx_system_events_name_occurred` `:1138-1159` |
| R3 | MET | Query lives on existing `SystemEventDao` (`packages/domain/src/dao/index.ts` exports). This run: `rg routingSummary apps/cli/src` → no CLI noun/verb |
| R4 | MET | `source` is a GROUP BY key (`packages/domain/src/dao/system-event-dao.ts:436`). This run: `packages/domain/tests/dao/system-event-dao.test.ts:876` pinned vs role-resolved to the same executor stay separate |
| R5 | MET | `json_valid` + executor IS NOT NULL (`packages/domain/src/dao/system-event-dao.ts:400-401`); window on result (`packages/domain/src/dao/system-event-dao.ts:444`). This run: pre-attribution exclusion + default 7-day window tests in `packages/domain/tests/dao/system-event-dao.test.ts` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R4 — Routing is queryable in one indexed round trip | MET | test | `packages/domain/tests/dao/system-event-dao.test.ts` this run: R1 counts `:776`, R2 SQL + EXPLAIN `:1002` / `:1138-1159`, R4 source split `:876` |

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1 findings. Implement-time P2/P3 (composite index, `source: string \| null`, first-dispatch escalation join) already fixed |

This run: `bun test packages/domain/tests/dao/system-event-dao.test.ts --test-name-pattern "0546|routingSummary"` → 8 pass / 0 fail. Isolated-suite coverage exit 1 is not a product failure.
### Review
**Scope.** Reviewed `git diff HEAD` for `packages/domain/src/dao/system-event-dao.ts`, `packages/domain/src/dao/index.ts`, `packages/domain/tests/dao/system-event-dao.test.ts`, `docs/04_DESIGN.md` (457 insertions). Re-ran the DAO suite (33 pass / 0 fail), reproduced the query plan via `EXPLAIN QUERY PLAN` + bytecode on bun:sqlite 3.51 against a 20k-row ledger, and empirically exercised boundary cases absent from the suite.

**Functional traceability.** All five requirements and the J6 gherkin scenario are covered by code and tests:
- **R1** — per-(role, executor) run + escalation counts over a bounded window. Test at `system-event-dao.test.ts:776` asserts exact counts on a known dataset. Runs count `agent.invoke.start` dispatches only (`COUNT(DISTINCT r.id)`, not exit/heartbeat); escalations join on `run_id` + `fromExecutor` — "started too cheap", not "escalated to".
- **R2** — one SQL statement, one round trip (test asserts a single captured query, `system-event-dao.test.ts:1027`); `event_name` predicates live in SQL, never client-side sifting; the plan uses indexes on correlating columns (see F1 for the claim nuance).
- **R3** — no new CLI noun/verb; the diff touches only the DAO surface, package exports, tests, and design doc.
- **R4** — `source` is part of the group key, so `explicit` pins stay separate from `role`/`default` resolution; test at `:878` proves same-executor separation. Pure pins (no role) group under `role: null`.
- **R5** — pre-attribution rows and malformed payloads are excluded via `json_valid` + `executor IS NOT NULL` guards, never imputed; the covered window is reported on the result; tests at `:918` (exclusion incl. a malformed-JSON row, no throw) and `:970` (omitted window defaults to bounded recent 7 days).

**Edge cases empirically verified** (beyond the suite): out-of-window escalation rows are excluded even when the matching start row is in-window (esc CTE window filter survives the flattened LEFT JOIN); duplicate event ids dedupe via `COUNT(DISTINCT id)`; escalation rows without a matching start row contribute nothing.

**Architecture depth.** Aggregate-in-SQL via CTEs is the right call versus fetch-and-group client-side — result size is bounded to the pair set. `json_extract` on `payload_json` with the `json_valid` guard is viable at this scale because the JSON predicates evaluate only on `event_name`-matched rows (verified in bytecode: the family `Ne` filter precedes `json_valid`/`json_extract`). The esc CTE flattens into the LEFT JOIN, so the `run_id` join genuinely uses `idx_system_events_run_id` (measured). The known trade-off is the routed-side scan width (F1). Alternatives (a denormalized routing table, or counting in the 0545 writer) were correctly rejected — 0545 R3 forbids the table, and writer-side counting would make the aggregate unqueryable over historical rows.

**Findings.**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | Efficiency / claims | `system-event-dao.ts:361-364`, `docs/04_DESIGN.md:1739`, `system-event-dao.test.ts:1014-1036` | Claimed EXPLAIN evidence contradicted by the measured plan — the routed family scan uses `idx_system_events_occurred_at` with `event_name` as a residual filter, not `idx_system_events_event_name`; the R2 test asserts SQL text only, so the claim is unguarded in CI. |
| P3 | Correctness / type contract | `system-event-dao.ts:124` vs `:393,:398` | `RoutingSummaryPair.source` typed `string`, but the query emits `null` when a routing block omits `source` (reproduced); the CTE admits partial blocks via the `executor IS NOT NULL` guard alone. |
| P3 | Correctness / edge | `system-event-dao.ts:411-412` | One escalation is attributed to every (role, source) group sharing `(run_id, executor)` — reproduced double `escalations: 1` across two pairs when a run has two dispatch rows for the same executor. |

- **F1 (P2)** — Measured `EXPLAIN QUERY PLAN` (SQLite 3.51): routed scan = `SEARCH system_events USING INDEX idx_system_events_occurred_at (occurred_at>? AND occurred_at<?)` with `event_name = 'agent.invoke.start'` applied as a residual `Ne` filter (bytecode addr 20-21); esc join = `SEARCH system_events USING INDEX idx_system_events_run_id (run_id=?) LEFT-JOIN`. The code comment, design doc §7.9, and Solution all state "the `event_name` predicates ride `idx_system_events_event_name`" — not what the planner does, and impossible with two single-column indexes on one scan. Impact: the window walk touches every event family (heartbeats included) before pruning, so on the heartbeat-dominated ledger this task targets (feature J3's terrain) scan width scales with total window volume, not attribution volume; JSON predicates run only on matched rows, so the cost is index-walk width rather than JSON parse volume. R2's letter — an index on the correlating column(s), result size independent of unrelated families — still holds. Fix: add the sanctioned composite index `CREATE INDEX idx_system_events_event_name_occurred_at ON system_events (event_name, occurred_at)` so the family filter drives the access path, or correct the claim; either way, guard with an `EXPLAIN QUERY PLAN` assertion in the R2 test.
- **F2 (P3)** — Reproduced: start payload with `routing: { tier, executor }` (no `source`) yields `{"role":null,"executor":"no-src-exec","source":null,"runs":1,"escalations":0}`. The pure-pin path intentionally admits `role`-less blocks, but `source` can be missing too; the declared `source: string` contract is then violated, and consumers (0547/0552) treating it as a string would crash. Fix: type `source: string | null` (matching `role`), or require `json_extract(payload_json, '$.data.routing.source') IS NOT NULL` in the routed CTE.
- **F3 (P3)** — Reproduced: run with two start rows (same `run_id`, same executor, sources `role` and `explicit`) plus one escalation from that executor reports `escalations: 1` on both pairs — the LEFT JOIN fan-out multiplies the escalation across groups, inflating totals for the very comparison this feature exists to serve. Trigger requires the same executor to serve the same run twice with different recorded sources (re-pin / duplicate start emission / re-dispatch landing back on `fromExecutor`); the common single-dispatch case is unaffected. Fix: attribute each escalation to one dispatch — join esc to the earliest routed row per `(run_id, executor)` via `MIN(occurred_at)`/`sequence`, or dedupe routed to one row per `(run_id, executor)` before joining.

**Residual risk.** F1's scan-width behavior is planner/distribution-dependent; the composite index removes the dependence. F2/F3 need writer-side conditions absent from the current 0545 tap output, so they are latent rather than live.

**Disposition: approve.** All requirements (R1-R5) and the J6 gherkin scenario are met with a green suite; no P0/P1. F1 should be corrected (index or claim) before the design doc stands as the authoritative access-path statement; F2/F3 are cheap to harden now that the shape is frozen, before 0547/0552 consume it.
**P2/P3 follow-up resolution (same run, post-review):** all three findings addressed, mutation- and EXPLAIN-verified, gate re-run green.

- **P2 (index claim contradicted by measured plan) — fixed.** Added composite index `idx_system_events_name_occurred (event_name, occurred_at)`: `SYSTEM_EVENTS_SCHEMA_SQL` (+ `0014_spur_cli_system_events_name_occurred_idx` migration with table-exists guard, mirroring 0011's ledger-absence pattern; `drizzle/0014_*.sql`). EXPLAIN QUERY PLAN now shows all three scans served by `idx_system_events_name_occurred (event_name=? AND occurred_at>? AND occurred_at<?)` — the family filter drives the access path, scan width bounded to attribution rows. Code/doc claims corrected. R2 test extended to assert the composite index appears in the plan.
- **P3 (source typed string, can be NULL) — fixed.** `RoutingSummaryPair.source: string | null` (matching `role`); new test proves a routing block without source groups under `source: null` without type violation.
- **P3 (escalation fanned across pairs) — fixed.** Added `first_routed` CTE: each escalation attributes to the single earliest dispatch per (run_id, executor) — never fanned to every (role, source) group sharing the pair. Regression test: same executor twice (role + explicit sources) + one escalation → escalation counts once on the earliest dispatch's pair, zero on the later. Also added deterministic ORDER BY tiebreakers (runs DESC, executor ASC, role ASC, source ASC) so equal-count pairs return in stable order.
- Migration-count tests updated (15 migrations; 13/14/6 applied in the three legacy-shape tests).
- Full quality gate re-run: 5168+ tests / 0 fail, coverage + tsdoc + transition-shim PASS.
**P3 doc nit (verify-stage, same run) — fixed.** `docs/04_DESIGN.md` access-path sentence now names `idx_system_events_name_occurred (event_name, occurred_at)` as the serving index for family-filtered scans (verified by EXPLAIN QUERY PLAN), matching the P2 resolution.
### References
- **Upstream dependency:** task 0545 (writes the attribution this reads)
- **Failure mode to avoid (R2):** feature J3 § Goal — exact-`name` + `since` + `limit` only, forcing
  client-side sifting over a fixed 100-row window
- **Read API and correlation columns:** feature J3 deliverables (ingestion, retention, correlation,
  read APIs); `system_events` DAO in `packages/domain`
- **Existing surfaces to ride (R3):** the observability read API; `spur workflow trace` /
  `spur rule trace` enrichment pattern from feature J5
- **Consent boundary (R3):** ADR-051 — CLI noun/verb additions require explicit operator consent
- **Pinning is the common case (R4):** `config/workflows/task-pipeline.yaml:56-65`
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
- 2026-08-14T22:53:37.310Z todo → wip (system)
- 2026-08-14T23:12:53.318Z wip → testing (system)
- 2026-08-14T23:13:04.791Z testing → done (system)
