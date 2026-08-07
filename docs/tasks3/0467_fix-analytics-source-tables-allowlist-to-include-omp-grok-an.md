---
template: feature-impl
schema_version: 1
name: "Fix analytics SOURCE_TABLES allowlist to include omp, grok, and agy history ETL tables"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-07T05:02:00.489Z"
updated_at: "2026-08-07T05:05:36.015Z"
---

## 0467. Fix analytics SOURCE_TABLES allowlist to include omp, grok, and agy history ETL tables

### Background
Graduated from the consumption-surface investigation (feature E1). **Standalone bug — no dependencies,
fixable today**, independent of the forensic ETL work.

`SOURCE_TABLES` (`packages/domain/src/analytics/query.ts:8-16`) is a hardcoded compile-time allowlist
of seven history ETL tables: pi, claude, codex, gemini, opencode, antigravity, openclaw. It **omits
`history_etl_omp`, `history_etl_grok`, and `history_etl_agy`** — three of the six sources feature E1
declares in scope.

**Impact is live, not theoretical.** Two consumers read through this allowlist:

- `queryAllEtlRecords` (`packages/domain/src/analytics/query.ts:55-72`) — so `spur history analyze`
  reports totals that silently exclude omp, grok, and agy.
- `loadAllEtlPayloads` (`packages/domain/src/analytics/run-cost.ts:103`) — so workflow run-cost
  attribution under-reports every omp-executed step. `agent.default` is `omp`
  (`config/config.example.yaml`), which makes this the common case, not an edge case.

The allowlist exists for a real reason documented in the file: SQLite cannot parameterize identifiers,
so these names are interpolated into SQL directly and must never derive from user input. **Keep that
invariant** — this is an allowlist extension, not a removal.

A later ticket cuts analyze over to a single `history_message` table, which dissolves the per-source
allowlist entirely. That does not make this fix redundant: it is a wrong-answer bug until then, and
the run-cost path may keep reading ETL tables afterward.
### Requirements
- R1 — Add `history_etl_omp`, `history_etl_grok`, and `history_etl_agy` to the `SOURCE_TABLES` allowlist without weakening the compile-time-constant security invariant that keeps table names out of user input.
- R2 — Confirm the three added tables exist in the importer's schema SQL so a query against them cannot fail on a missing table for a project that has never imported those sources.
- R3 — Verify `queryAllEtlRecords` returns rows for the added sources, and that the derived `source` string (currently `table.replace('history_etl_', '')`) yields the correct source identifier for each.
- R4 — Verify `loadAllEtlPayloads` picks up the added tables so workflow run-cost attribution covers omp-executed steps.
- R5 — Add a regression test that fails if a source is added to the importer's schema but not to this allowlist, so the two lists cannot drift apart again silently.
### Acceptance Criteria
```gherkin
Feature: 0467 analytics source allowlist covers every in-scope source

  Scenario: R1 — analyze sees omp, grok, and agy records
    Given a database holding imported records in history_etl_omp, history_etl_grok, and history_etl_agy
    When queryAllEtlRecords runs with no since bound
    Then records from all three tables are returned
    And each record carries the correct source identifier
    And table names remain compile-time constants never derived from user input

  Scenario: R4 — run-cost attribution covers omp-executed steps
    Given a workflow action run executed by the omp agent with imported omp history
    When loadAllEtlPayloads runs
    Then the omp payloads are included in the returned set

  Scenario: R5 — the allowlist cannot silently drift from the schema again
    Given the importer schema declares a set of history_etl_* tables
    When the drift regression test runs
    Then it fails if any declared source table is absent from SOURCE_TABLES

Scenario: R2 — the added tables always exist to query
    Given a project that has never imported omp, grok, or agy history
    When analyze queries the added source tables
    Then the query succeeds against tables created by the importer schema
    And no missing-table error is raised

  Scenario: R3 — the derived source identifier is correct per table
    Given rows in each of the added history ETL tables
    When queryAllEtlRecords derives the source string for each row
    Then omp, grok, and agy are produced respectively
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
