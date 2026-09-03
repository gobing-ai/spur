---
schema_version: 1
name: "Sort and paginate session listing in SQL on both read paths"
status: todo
template: feature-impl
created_at: 2026-09-03T16:43:04.191Z
updated_at: "2026-09-03T17:45:50.922Z"
feature_id: E91
priority: P2
tags: ["history", "read-path", "pagination"]
---

## 0744. Sort and paginate session listing in SQL on both read paths

### Background
This task's original premise was that both session-listing read paths sort and slice in application memory. Checking it against the tree corrects half of it, and the correction changes what the work is.

The materialized path is already compliant. `historyBoardSessionsFromRollup` at `packages/domain/src/analytics/history-board-rollup.ts:910` maps the seven sort keys to columns, computes `offset` from `page` and `pageSize`, and issues `ORDER BY ${order} ${dir}, s.session_id ASC LIMIT ? OFFSET ?` against `history_board_session_stats` alongside a separate `COUNT(*)` for the total. Ordering, pagination, and the total are all the database's work, and the ordering already carries a `session_id` tiebreak so paging is stable.

The fallback path is not. `getSessions` at `packages/app/src/services/history-board-service.ts:1349` falls through at `packages/app/src/services/history-board-service.ts:1391` to `bySession(db, sel, 1_000_000)`, maps every returned row, sorts the whole array in JavaScript at `packages/app/src/services/history-board-service.ts:1416`, and slices a page out of it at `packages/app/src/services/history-board-service.ts:1438`. `bySession` at `packages/domain/src/analytics/forensic-query.ts:380` does take a `top` limit, so a `LIMIT` exists in the SQL — but passing 1,000,000 against a corpus of 1,791,462 messages makes that limit meaningless, and there is no `ORDER BY` matching the requested sort and no `OFFSET`. Measured cost of that call is 2.30 s.

So R1 and R3 are unmet on the fallback path only, and R2's "both paths" is satisfied on the materialized side by an assertion that locks in behaviour that already exists rather than by new code. Writing it as new work on both paths would mean rewriting a correct query for no reason.
### Requirements
- [ ] R1. A session listing request with a sort order and page offset has its ordering and pagination performed by the database.
- [ ] R2. This holds on both the materialized path and the fallback path.
- [ ] R3. No path materializes the full session set in application memory before slicing.
- [ ] R4. The response shape is unchanged.
### Acceptance Criteria
```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

  @core
  Scenario: R10 — Session listing is sorted and paginated in SQL on both read paths
    Given a session listing request with a sort order and a page offset
    When the request is served from either the materialized path or the fallback path
    Then ordering and pagination are performed by the database
    And no path materializes the full session set in application memory before slicing.


```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:45:50.921Z

**Why add `bySessionPage` rather than adding optional parameters to `bySession`?** Two of `bySession`'s three callers want every row for aggregation, not a page. Optional parameters would leave the unpaged behaviour reachable by omission, which is how the `1_000_000` cap survived in the first place; a separate function makes the paged contract explicit at every call site.

**Why assert the materialized path at all, when it already works?** Because R2 claims both paths push down, and an unasserted claim about working code is the kind that quietly stops being true during a later refactor.

**Why is the total a second query rather than a window function?** `COUNT(*) OVER ()` would return the total on every row of the page, which SQLite computes correctly but which couples the total to the page being non-empty. A separate `COUNT(*)` is the shape the materialized path already uses, and matching it keeps the two paths comparable.

**Deferred:** keyset pagination. Offset pagination degrades on deep pages, but the History UI pages from the top with a page size of twenty and does not expose deep offsets. Keyset is the right change if deep paging ever appears in the UI, and it would need a contract change the operator's UI-unchanged constraint currently forbids.
### Design
**WHAT.** Give the fallback session listing a real paged query — database ordering, offset, limit, and total — and add a regression assertion that the materialized path keeps the pushdown it already has.

**WHY.** A 2.30 s query that returns 1.79 million rows so the application can keep twenty of them is the single clearest instance of the pattern E91 exists to remove. It is also the path that keeps running whenever rollups are stale, which is exactly when the system is already under load.

**WHERE — frozen names.**

| Name | Kind | Location |
| --- | --- | --- |
| `bySessionPage` | function taking `(db, sel, { sortBy, sortDir, limit, offset }, opts?)` and returning `{ items, total }` | `packages/domain/src/analytics/forensic-query.ts` |
| `SESSION_SORT_COLUMNS` | exported const mapping the seven public sort keys to SQL expressions | same file |
| `SessionPageInput` | interface | same file |
| `SessionPage` | interface `{ items: SessionRow[]; total: number }` | same file |

`bySession` keeps its existing name, signature, and behaviour. It has two other callers — the Summary fan-out at `packages/app/src/services/history-board-service.ts:816` and the Sources fan-out at `packages/app/src/services/history-board-service.ts:1639` — which are not session listings and are not this task's to change. Adding a paged sibling rather than changing the shared function is what keeps this task's diff inside the session-listing path.

**Sort key parity is the correctness risk.** `SESSION_SORT_COLUMNS` must cover exactly the seven keys the materialized path already maps at `packages/domain/src/analytics/history-board-rollup.ts:916` — `start`, `duration`, `messages`, `toolCalls`, `billedTokens`, `cacheRead`, `freshInput` — with the same meanings, and must fall back to `start` for an unrecognised key exactly as that mapping does. A key that sorts one way on the materialized path and another way on the fallback path is a user-visible inconsistency that appears only when rollups go stale, which is the hardest possible time to notice it. The two maps are asserted equal by a test rather than kept in step by care.

**Ordering must be total.** Every ordering appends `session_id ASC` as a final tiebreak, matching the materialized path. Without it, rows with equal sort values can appear on two pages or on none.

**Total count.** `bySessionPage` returns the unpaged total from a `COUNT(*)` over the same `WHERE`, so `HistorySessionsResponse.total` stays accurate. Returning the page length as the total would change the response's meaning while leaving its shape intact, which is worse than a shape change because nothing would catch it.

**Anti-patterns — do not do these.**

- Do not change `bySession`'s signature or behaviour. Its other two callers want the unpaged result.
- Do not keep `1_000_000` as a limit anywhere in the session-listing path, and do not replace it with a larger number.
- Do not sort or slice in JavaScript after the query returns. The rows the query returns are the page.
- Do not duplicate the sort-key mapping by hand in a way the parity test cannot compare.
- Do not touch `packages/contracts/src/history.ts`. R4's unchanged response shape is a hard constraint, and task 0745 asserts it mechanically.

**Handoff to dependents.** Task 0745 measures the Sessions tab against its recorded baseline, so `bySessionPage` must be callable from a test directly. Task 0743 owns the Summary and Sources fallbacks that still call `bySession` unpaged, and bounds them separately; this task deliberately leaves those two call sites alone.

Authority: ADR-103; design section 7 (D5).
### Plan
1. Add `SESSION_SORT_COLUMNS`, `SessionPageInput`, `SessionPage`, and `bySessionPage` to `packages/domain/src/analytics/forensic-query.ts`, with a total `ORDER BY` ending in `session_id ASC` and a `COUNT(*)` total over the same `WHERE`. Test intent: each of the seven sort keys orders correctly in both directions, an unrecognised key falls back to `start`, and the returned total is the unpaged count rather than the page length.
2. Add a parity test asserting `SESSION_SORT_COLUMNS` and the materialized path's `orderColumns` cover the identical key set with the same fallback. Test intent: adding a sort key to one map without the other fails.
3. Replace the fallback branch of `getSessions` with a single `bySessionPage` call, deleting the in-memory map, sort, and slice. Test intent: for a fixed filter and sort, the fallback path returns the same page contents and the same total as the materialized path.
4. Add a regression assertion that the materialized path issues `ORDER BY`, `LIMIT`, and `OFFSET` in SQL, using the statement recorder task 0743 introduces. Test intent: removing the pushdown from either path fails the test.
5. Assert the response shape is unchanged for both paths. Test intent: the assertion compares against the contract type rather than a hand-written literal, so a contract change cannot pass silently.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- Design satellite: `docs/design/history-incremental-materialization.md` section 7 (D5)
- ADR-103: `docs/00_ADR.md`
- Materialized path already pushing down, and its sort-key map: `packages/domain/src/analytics/history-board-rollup.ts:910`
- Fallback branch to replace: `packages/app/src/services/history-board-service.ts:1391`
- In-memory sort and slice to delete: `packages/app/src/services/history-board-service.ts:1416`
- Existing unpaged analyzer that keeps its signature: `packages/domain/src/analytics/forensic-query.ts:380`
- Transport contract that must not change: `packages/contracts/src/history.ts`
### History
