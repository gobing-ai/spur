---
template: feature-impl
schema_version: 1
name: "Cut spur history analyze over to SQL aggregation with the forensic query set and versioned JSON artifact"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0466"]
ac_numbering: task-local
created_at: "2026-08-07T06:45:01.675Z"
updated_at: "2026-08-07T06:45:10.051Z"
---

## 0474. Cut spur history analyze over to SQL aggregation with the forensic query set and versioned JSON artifact

### Background
Graduated from the consumption-surface investigation (feature E1). **Depends on task 0466**, which
populates the `history_message` and `history_tool_call` tables this reads.

`spur history analyze` today loads every ETL record into memory, prices each one, and folds them into
an `AnalyticsSummary` (`packages/app/src/services/history-service.ts:73-78`). That is a spend
dashboard: it answers "what did I spend" and cannot answer "which tool loop burned this session".

**Two independent reasons to move aggregation into SQL, both settled by measurement:**

1. **Memory.** Benchmarked at 600k rows — roughly this machine's real claude+codex corpus of ~590k
   lines — the load-all-and-fold path allocates **+865 MB heap** and takes 652 ms; the equivalent
   `GROUP BY` takes 286 ms at constant memory. `queryAllEtlRecords` issues a bare
   `SELECT payload_json` with no LIMIT, then `history-service.ts` holds three full-corpus arrays at
   once. Growth is measured at ~10.4 MB/day (~+280k lines/month), so the current path crosses ~1.3 GB
   within a month. This is linear in corpus size by construction, not a tuning problem.
2. **Capability.** Per-step duration, per-tool result bytes, and repeated-call loop detection cannot
   be computed from `history_etl_*` at all — they need `history_tool_call` rows.

The full query set, artifact schema, selector list, and the reuse assessment for every existing
analytics helper are specified in task 0464 `### Design` (§ R1, R2, R3, R4, R5). **Read that section
before starting; do not re-derive these decisions.**

Two anti-patterns it calls out explicitly: do not carry `etlToCostRecord`'s 4-chars-per-token estimate
(`packages/domain/src/analytics/query.ts:125-131`) into the artifact — an unflagged estimate reaching
a cost total is the fabrication the forensic contract exists to end; and do not write unbounded
per-line error arrays into the artifact.
### Requirements
- R1 — Implement the ten forensic queries specified in task 0464 Design § R1 as SQL against history_message and history_tool_call, including per-step time cost, per-step token cost, per-step tool-call counts, repeated-call loop detection, and the unknown-record drift alarm.
- R2 — Aggregate in SQL, not in memory: no code path may load the full record set into a JavaScript array before folding. Peak heap for an analyze run must not scale with corpus size.
- R3 — Implement the six selectors from task 0464 Design § R3 (since/until, source, session, run, task, top-N), composable, each resolving against an indexed column; add the one missing index on (provenance, run_id).
- R4 — Write the versioned JSON artifact exactly as specified in task 0464 Design § R2: schemaVersion, generatedAt, selector, coverage, totals, bySource, byModel, daily, byTool, bySession, loops, warnings — at the specified path with the specified selector-digest naming.
- R5 — Carry recordsWithUsage and durationUnmeasured through to the artifact so a consumer can render unavailable rather than a fabricated zero, extending the existing cacheHitRatio never-fabricate invariant to duration.
- R6 — Bound the artifact: store error counts plus at most 20 samples per source, streaming full detail to an errors.jsonl sidecar rather than embedding unbounded arrays.
- R7 — Reuse rather than replace where task 0464 Design § R5 says to: keep cacheHitRatio and formatRatio verbatim, extend TokenTotals with the forensic dimensions, and retire aggregateCosts, accumulate, queryAllEtlRecords, and the etlToCostRecord token estimate.
- R8 — Preserve the existing human stdout summary so `spur history analyze` without artifact flags stays usable, and keep `--json` emitting the artifact shape.
### Acceptance Criteria
```gherkin
Feature: 0468 analyze answers forensic questions from SQL

  Scenario: R1 — per-step attribution is answerable
    Given a populated history_message and history_tool_call for one session
    When analyze runs with that session selector
    Then time cost by tool, token cost by tool, and tool-call counts are reported
    And repeated identical calls are surfaced as a loop finding
    And unknown-disposition records are counted as a drift signal

  Scenario: R2 — aggregation does not scale in memory
    Given a corpus large enough that loading it would exceed available heap
    When analyze runs
    Then it completes without materializing the full record set in memory
    And peak heap does not grow proportionally with the row count

  Scenario: R4 — the artifact is a contract
    Given an analyze run with a fixed selector
    When the run completes
    Then a JSON artifact is written at the specified path with a schemaVersion
    And re-running with the same selector produces the same artifact path

  Scenario: R5 — unavailable is never rendered as zero
    Given records whose duration_ms and usage are absent
    When analyze aggregates them
    Then the artifact reports how many were unmeasured
    And no fabricated zero is written in place of an unknown value

  Scenario: R6 — a mapping regression cannot produce an unbounded artifact
    Given a source producing validation errors on a large fraction of its lines
    When analyze runs
    Then the artifact holds error counts and at most 20 samples per source
    And full error detail is written to a sidecar file

Scenario: R3 — selectors compose and resolve against indexes
    Given an artifact request narrowed by time window, source, and session together
    When analyze resolves the selector set
    Then only records matching every selector are aggregated
    And the run-and-task selectors resolve against an index rather than a scan

  Scenario: R7 — retired helpers are gone and reused helpers are unchanged
    Given the SQL aggregation path is in place
    When the analytics module is inspected
    Then the never-fabricate ratio helpers are still used unchanged
    And the in-memory fold and the token-length estimate are no longer reachable

  Scenario: R8 — the existing human surface still works
    Given analyze is run with no artifact flags
    When the command completes
    Then a human-readable summary is printed to stdout as before
    And the same run with --json emits the artifact shape
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
