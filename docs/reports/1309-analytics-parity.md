# 1309 analytics parity

schemaVersion: 1
candidate: time-range-predicates
status: go
sourceRevision: 2f63548bb9239b84925f640ed68d80ddb5c5a111
command: `rm -f docs/reports/1309-analytics-parity.json docs/reports/1309-analytics-parity.md && cd packages/domain && bun test tests/analytics/history-parity-evidence.test.ts`
fixtureSeed: 1309-48h-v1 (48h 2026-01-01T12:00:00Z .. 2026-01-03T12:00:00Z)
toolVersions: bun 1.4.3; sqlite 3.54.0
measuredAt: 2026-11-06T07:50:44.659Z

## Reason

Date-grain raw, rollup, and mart reads match on comparable requests, and one timeBoundClauses helper is smaller than the buildRollupWhere and dayClauses assemblies. Whole queries are not claimed equivalent. 1310 may consume this artifact; this task does not unblock it.

## Source digests

- `packages/domain/src/analytics/history-board-rollup.ts`: `a2811302b9f216814297bc171e4c2b87276a26446c4ff9de0d49fd383004c8ab`
- `packages/domain/src/analytics/history-board-marts.ts`: `968cefc46197be250fd2af42ea8ff798fcdffadf0bd550ea614b4fe9769e862d`
- `packages/domain/src/analytics/message-where.ts`: `f1cbd0bd12689cf8421c895a130234c5d3b4c7ffddb37b96057aa0a326bbe9dc`
- `packages/app/src/services/history-board-service.ts`: `09ac7d4ed69491d0637bc20b7bd71ae5a011628a658b9054c909ace1abc1d2eb`

## Surface

Candidate functions: buildRollupWhere, dayClauses.
Current handwritten lines: 20.
Proposed helper lines (helper + two call sites): 15.
Smaller: true.
Time-bound assemblies in the inspected files, including the candidate blocks: packages/domain/src/analytics/history-board-rollup.ts:726, packages/domain/src/analytics/history-board-rollup.ts:732, packages/domain/src/analytics/history-board-rollup.ts:969, packages/domain/src/analytics/history-board-rollup.ts:1146, packages/domain/src/analytics/history-board-rollup.ts:1301, packages/domain/src/analytics/history-board-rollup.ts:1305, packages/domain/src/analytics/history-board-rollup.ts:1854, packages/domain/src/analytics/history-board-marts.ts:304, packages/domain/src/analytics/history-board-marts.ts:308, packages/domain/src/analytics/history-board-marts.ts:372, packages/domain/src/analytics/history-board-marts.ts:376, packages/domain/src/analytics/history-board-marts.ts:491, packages/domain/src/analytics/history-board-marts.ts:569, packages/domain/src/analytics/history-board-marts.ts:599, packages/domain/src/analytics/history-board-marts.ts:603, packages/domain/src/analytics/message-where.ts:22.

## Predicate vectors

- rollup-date-both (rollup): r.day >= DATE(?) ; r.day <= DATE(?)
- mart-date-both (mart): d.day >= DATE(?) ; d.day <= DATE(?)
- raw-instant-both (raw): m.ts >= ? ; m.ts <= ?
- rollup-date-lower (rollup): r.day >= DATE(?)
- rollup-date-unbounded (rollup): (no time predicate)
- rollup-instant-both (rollup): strftime('%Y-%m-%dT%H:%M:%SZ', ?)

## Cases

| id | grain | bounds | filters | comparable | differences | reason |
| --- | --- | --- | --- | --- | --- | --- |
| bounds-null | 1d | null | none | true | 0 | time-predicates-select-the-same-rows |
| bounds-lower-only | 1d | lower | none | false | 0 | time-predicate-selects-different-rows: DATE(?) keeps the whole calendar day; the raw instant bound does not |
| bounds-upper-only | 1d | upper | none | false | 0 | time-predicate-selects-different-rows: DATE(?) keeps the whole calendar day; the raw instant bound does not |
| bounds-both-day-aligned | 1d | both-day | none | true | 0 | time-predicates-select-the-same-rows |
| grain-daily | 1d | both-day | none | true | 0 | time-predicates-select-the-same-rows |
| filter-same-dimension | 1d | null | source=claude | true | 0 | time-predicates-select-the-same-rows |
| bounds-both-subdaily | 1h | both-instant | none | false | 0 | mart is day-grain only, and DATE(?) selects different rows than the raw instant bound |
| grain-subdaily | 1h | null | none | false | 0 | mart has no subdaily grain; a 1h request stays on the rollup path |
| filter-cross-dimension | 1d | null | model=opus on source dimension | false | 0 | mart cannot apply a model filter on the source dimension; the service routes that request to rollup |
| filter-tool | 1d | null | tool=Read | false | 0 | a tool filter is not mart-eligible and the rollup read switches to allocated tool measures |
| filter-skill | 1d | null | skill=code-review | false | 0 | a skill filter is not mart-eligible; skill rows are not a second copy of the day predicate |
| watermark-fresh | 1d | null | none | false | 0 | rollups are fresh after refresh; measure parity is bounds-null |
| watermark-stale | 1d | null | none | false | 0 | stale watermark: rollup and mart omit the trailing import; raw includes it. Noncomparable until refresh. |
| phenomenon-duplicate-import | none | null | fixture | false | 0 | m-dup-old is superseded by m-dup-new (same request_id, later rowid) |
| phenomenon-null-measures | none | null | fixture | false | 0 | m-null stores null token measures and is coalesced to 0 on the message rollup |
| phenomenon-unknown-usage | none | null | fixture | false | 0 | m-unknown uses model unknown in its own session |
| phenomenon-midnight-boundary | none | null | fixture | false | 0 | m-midnight is 2026-01-02T00:00:00Z and m-pre-midnight is the previous second |

## Timings

Seven-day fixture: 2 warmups, 9 sequential reads.
All-history fixture: 2 warmups, 9 sequential reads.
No real history database was opened. Both workloads use in-memory synthetic rows.

## Decision

1310 may consume this artifact after review.
