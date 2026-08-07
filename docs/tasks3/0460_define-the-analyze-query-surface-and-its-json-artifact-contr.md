---
template: feature-impl
schema_version: 1
name: "Define the analyze query surface and its JSON artifact contract"
description: ""
status: cancelled
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0455"]
created_at: "2026-08-06T23:09:54.769Z"
updated_at: "2026-08-06T23:29:59.457Z"
---

## 0460. Define the analyze query surface and its JSON artifact contract

### Background
**Wayfinder ticket** — type: `wayfinder:grilling`. Map: feature E1. **Blocked by 0455.**

**The question:** What questions must `spur history analyze` answer, and what is the JSON artifact
contract that `spur history report` renders?

**Why it is open.** `analyze` today loads every ETL record into memory, prices each one, and returns
an `AnalyticsSummary` — `totals`, `bySource`, `byModel`, `daily`
(`packages/domain/src/analytics/types.ts:55`, `packages/app/src/services/history-service.ts:62`).
That is a spend dashboard. It answers "how much did I spend", never "which tool loop burned this
session" — the question this map exists to make answerable. It also has no artifact: output goes to
stdout, so `report` has nothing to render from.

**Sub-questions:**

- Which diagnoses earn a place? The lost 0451 report is the reference: time cost by step, token cost
  by step, tool calls by step. Name the concrete queries, not a category.
- Artifact shape: what does `analyze` write, where, and under what name? The operator's model is
  `analyze` → JSON file → `report` renders it, so `report` never re-queries the DB.
- Selectors: by session, by day, by source, by run/task. What is the minimum set for both the
  scheduled loop and ad-hoc forensics?
- Does `analyze` stay an in-memory pass over all records, or move to SQL? It currently loads
  everything — at 90k–1.5M lines per source per scan, check whether that survives a month of daily
  imports before committing to the design.
- Stability: `report` renders the artifact, so the artifact is a contract. Versioned? What happens
  when the record shape changes?
- What survives from the existing surface — `formatSummary` (`analytics/costs.ts:90`) and the
  `run-cost.ts` action-attribution helpers already exist and may be reusable rather than replaced.

**Resolved when** the task body carries the query list, the JSON artifact schema, the selector set,
and a decision on in-memory vs SQL with the volume reasoning behind it.

**Note:** the artifact must be machine-parsable for the scheduled loop (0461) and legible enough for
ad-hoc use. If those pull apart, say so — that is a real finding, not a failure.
### Requirements
- R1 — Name the concrete queries analyze must answer, including time cost by step, token cost by step, and tool calls by step.
- R2 — Define the JSON artifact contract: schema, location, naming, and versioning, such that report renders it without re-querying the database.
- R3 — Define the selector set (session, day, source, run/task) needed by both the scheduled loop and ad-hoc forensics.
- R4 — Decide in-memory aggregation vs SQL, justified against measured volume after a month of daily imports.
- R5 — State what survives from the existing surface — `formatSummary` and the `run-cost.ts` attribution helpers — rather than replacing them by default.
### Acceptance Criteria
```gherkin
Feature: 0460 wayfinder investigation

  Scenario: R1 — analyze answers forensic questions, not just spend questions
    Given the forensic record contract from 0455
    When ticket 0460 is resolved
    Then the task body names the concrete queries including per-step attribution
    And a JSON artifact schema with a versioning rule is stated
    And the in-memory versus SQL decision cites volume reasoning
    And reuse of existing analytics helpers is assessed explicitly
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

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
- 2026-08-06T23:29:59.457Z todo → cancelled (system)
