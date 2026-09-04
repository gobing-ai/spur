---
schema_version: 1
name: "Bound the whole-corpus rollup derivations: candidate-set design for loop findings and ranked steps, and a covering index for source summary"
status: backlog
template: standard
created_at: 2026-09-04T08:14:01.724Z
updated_at: "2026-09-04T08:15:38.310Z"
feature_id: E91
ac_altitude: task-local
---

## 0763. Bound the whole-corpus rollup derivations: candidate-set design for loop findings and ranked steps, and a covering index for source summary

### Background
Task 0741 made the rollup refresh incremental per bucket and measured the result. The per-bucket
derivations behave: at a constant 400-row delta across an 18x corpus (100,000 -> 1,810,110 messages)
they cost 144 ms -> 179 ms -> 324 ms, bounded by materialized bucket/day count rather than row count.

Four derivations do not, because none has a bounded-candidate path today:

| Derivation | 100k | 400k | 1.81M |
| --- | ---: | ---: | ---: |
| `loops()` `filtered_messages` CTE -> `history_board_loop_findings` | 155 ms | 669 ms | 3,547 ms |
| three `topStepsBy*` -> `history_board_ranked_steps` | 72 ms | 211 ms | 1,376 ms |
| `sourceSummary` `COUNT(DISTINCT m.source_file)` -> `history_board_source_stats` | 46 ms | 227 ms | 604 ms |
| `applyToolAliases` full-table `UPDATE history_tool_call` | 19 ms | 57 ms | 96 ms |

(Instrumented per-statement times; they sum above wall clock because batched statements are attributed
individually. Harness: full rebuild after clearing every board table, then one 400-row delta import and
an incremental refresh, timed through a proxy `DbAdapter`.)

At 1.81M messages the whole delta refresh is 4,794 ms against a 45,565 ms full rebuild - 10.5%, inside
0741 R8's stated worst-day bound of 15% but outside its typical-day bound of 5%. That headroom is
consumed by these four, and it shrinks as the corpus grows: they are the only part of the refresh that
scales with total corpus rather than with the delta.

The 0741 Design mandates the current shape for the global-ranked class - "No incremental path; recompute
in full whenever any bucket changed" - on the premise that these tables are "cheap because they are
already bounded". Measurement shows the *output* is bounded (a top-N list) but the *computation* is
O(corpus): each refresh rescans every message to find the candidates it will then rank down to N.

`sourceSummary` is a different problem with a different fix: `COUNT(DISTINCT m.source_file)` per source
has no covering index. `history_message` carries indexes on `(provenance, run_id)`, `request_id`,
`(source, ts)`, `(model, ts)`, `(session_id, seq)`, `duration_ms`, a computed token sum, `input_tokens`,
`ts`, and `imported_at` - none on `(source, source_file)`.
### Requirements
- [ ] R1. `history_board_loop_findings` and `history_board_ranked_steps` are derived from a bounded candidate set rather than a full-corpus rescan: a delta refresh reads the changed buckets plus the currently materialized top-N, and never scans messages outside that set.
- [ ] R2. The bounded derivation produces the same rows as the full rebuild for every case the full rebuild would produce them, or the cases where it cannot is documented as an explicit, tested staleness rule — not left implicit.
- [ ] R3. `sourceSummary`'s `COUNT(DISTINCT m.source_file)` per source resolves from an index rather than a table scan, proven by `EXPLAIN QUERY PLAN`.
- [ ] R4. `applyToolAliases` updates only rows in the delta's scope, not the whole `history_tool_call` table, on an incremental refresh.
- [ ] R5. The delta-refresh cost of these four derivations, measured at a constant delta across at least three corpus scales, grows sublinearly in total corpus row count — the property 0741 R8 asserts for the per-bucket derivations and 0741 R9 explicitly exempts these from.
- [ ] R6. `ROLLUP_DEFINITION_VERSION` is bumped and its digest re-pinned, because every change here is a derivation change; existing databases rebuild rather than extend.
### Acceptance Criteria
```gherkin
Feature: Bounded whole-corpus rollup derivations

  @core
  Scenario: R1 — Loop findings and ranked steps are derived from a bounded candidate set
    Given a materialized history database whose rollups are current
    When a delta import touching a bounded time range triggers an incremental refresh
    Then the loop-findings and ranked-steps derivations read only the changed buckets plus the currently materialized top-N
    And no statement in the refresh scans messages outside that candidate set.

  @core
  Scenario: R2 — The bounded derivation agrees with the full rebuild
    Given a database refreshed incrementally through the bounded derivation
    When its loop-findings and ranked-steps rows are diffed against a full rebuild of the same corpus
    Then the rows are identical, except for cases covered by the documented staleness rule
    And each such case has a test that asserts the rule's stated outcome.

  @core
  Scenario: R3 — Source summary resolves from an index
    Given a corpus whose messages span many source files per source
    When `EXPLAIN QUERY PLAN` is run against the sourceSummary derivation
    Then the plan shows an index search rather than a scan of `history_message`.

  @core
  Scenario: R5 — Delta cost stays sublinear as the corpus grows
    Given three corpora at increasing scale built from the same real database
    When an identical delta is imported into each and the incremental refresh is timed
    Then the combined cost of the four derivations grows sublinearly in total corpus row count
    And the measurement is recorded against the 0741 R9 baseline it supersedes.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Candidate-set derivation (R1/R2).** `loops()` and `topStepsBy*` rescan every message because they
compute their candidates and their ranking in one pass. Split the two: keep a per-bucket materialized
candidate contribution (the bucket's own top-N and its loop candidates), and derive the global top-N by
merging the changed buckets' contributions with the currently materialized global rows. A global top-N
combined from per-bucket top-N is exact for `ranked_steps`, whose ordering key is a per-row scalar; it is
*not* automatically exact for `loop_findings`, whose repeat detection spans rows within a session — so
the loop candidate unit is the session, not the bucket, and a session touched by the delta re-derives in
full while untouched sessions are read from the materialized rows.

**Deletion is the hard case.** A combine-with-materialized derivation cannot see a row that left the
corpus. Either the deletion path invalidates the affected sessions explicitly, or the staleness rule is
documented and a periodic full rebuild bounds it (R2's second clause).

**Source summary (R3).** `COUNT(DISTINCT m.source_file)` per source needs a `(source, source_file)`
index on `history_message`. This is a schema migration, so the index is not assumed here; it is settled
during this task's refinement and recorded in Q&A.

**Alias backfill (R4).** `applyToolAliases` already runs after the bucket pass; scope its `UPDATE` to the
delta's `imported_at` range, which `history_tool_call` already indexes via `(source, imported_at)`.

**Version bump (R6).** Every change above alters emitted SQL, so `rollup-definition-version.test.ts` will
fail until `ROLLUP_DEFINITION_VERSION` is bumped past `v2` and the new digest pinned.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature `E91` — History read path materialized-only.
- Task `0741` — incremental rollup refresh engine; R8/R9 record the measurement this task acts on.
- `packages/domain/src/analytics/history-board-rollup.ts` — `loops`, `topStepsBy*`, `sourceSummary`, `applyToolAliases`.
- `packages/domain/src/analytics/rollup-watermark.ts` — `ROLLUP_DEFINITION_VERSION`.
- `packages/domain/tests/analytics/rollup-definition-version.test.ts` — the digest pin that a derivation change trips.
- `docs/report/2026-09-03-E91-history-tab-latency-baseline.md` — corpus and refresh-cost context.
### History
