---
template: feature-impl
schema_version: 1
name: "Implement spur history report as a pure artifact renderer with markdown sidecar and staleness banner"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0474"]
ac_numbering: task-local
created_at: "2026-08-07T05:02:01.061Z"
updated_at: "2026-08-07T06:45:17.611Z"
---

## 0469. Implement spur history report as a pure artifact renderer with markdown sidecar and staleness banner

### Background
Graduated from the consumption-surface investigation (feature E1). **Depends on task 0468**, which
writes the artifact this renders.

`spur history report` is an explicit not-implemented stub today
(`apps/cli/src/commands/history.ts:39-52`). Task 0464 settled what it becomes: **a pure renderer of
the analyze artifact that never opens the database.**

That separation is the contract, not an implementation detail. It is what makes the morning report
reproducible (the same artifact always renders the same report), diffable (yesterday's and today's
artifacts share a stable selector digest), and cheap (re-rendering costs a file read, not a corpus
scan). The moment `report` issues a query, all three properties are lost.

`formatSummary` (`packages/domain/src/analytics/costs.ts:90-125`) survives this move — its padded
column layout is good and re-deriving it would be waste. It becomes one section of the renderer, fed
from the artifact's `totals`/`bySource`/`byModel` instead of an in-memory `AnalyticsSummary`. So do
`cacheHitRatio` and `formatRatio` (`packages/domain/src/analytics/costs.ts:81-131`), whose
never-fabricate `n/a` behavior is exactly what the artifact's `recordsWithUsage` and
`durationUnmeasured` denominators exist to feed.

Sequence this immediately after the analyze cut-over so the artifact is never write-only.

Full spec: task 0464 `### Design` § R2 (artifact shape and versioning rule) and § R8 (delivery,
staleness banner).
### Requirements
- R1 — Render the analyze artifact into a human report without opening the database; the command must issue no SQL and require no DB connection.
- R2 — Reuse formatSummary, cacheHitRatio, and formatRatio rather than re-implementing the spend rollup layout, feeding them from artifact fields.
- R3 — Render the forensic sections the spend summary lacks: per-tool time cost, per-tool token and result-byte cost, tool-call counts, detected loops, and the session leaderboard.
- R4 — Refuse an artifact whose schemaVersion is unknown, reporting the artifact path and the expected version rather than rendering a shape the renderer does not understand.
- R5 — Render unavailable values as unavailable, never as zero, using the artifact's recordsWithUsage and durationUnmeasured denominators.
- R6 — Resolve the newest artifact by default via the latest.json pointer, with an explicit path argument overriding it.
- R7 — Print a prominent staleness banner when the resolved artifact is older than 36 hours, since artifact freshness is the first-line missed-run signal.
- R8 — Write a rendered markdown sidecar next to the JSON so the morning read requires no CLI invocation.
### Acceptance Criteria
```gherkin
Feature: 0469 report renders the artifact and never queries the database

  Scenario: R1 — rendering is database-free
    Given a valid analyze artifact on disk and no reachable database
    When report runs against that artifact
    Then the report renders in full
    And no database connection is opened

  Scenario: R4 — an unknown schema version is refused, not guessed
    Given an artifact whose schemaVersion is newer than the renderer understands
    When report runs against it
    Then rendering is refused with the artifact path and the expected version
    And no partially-rendered output is emitted

  Scenario: R5 — unknown values render as unavailable
    Given an artifact whose durationUnmeasured equals its tool-call count
    When report renders the per-tool timing section
    Then the timing column reads unavailable rather than zero

  Scenario: R7 — a stale artifact is loud
    Given the newest artifact was generated more than 36 hours ago
    When report runs with no explicit path
    Then a staleness banner naming the artifact age is printed before the report

Scenario: R2 — the spend rollup layout is reused, not re-implemented
    Given an artifact carrying totals, bySource, and byModel
    When report renders the spend section
    Then the existing summary formatter produces it from artifact fields

  Scenario: R3 — the forensic sections the spend summary lacks are rendered
    Given an artifact carrying byTool, loops, and bySession
    When report renders
    Then per-tool time cost, per-tool token and result-byte cost, detected loops, and the session leaderboard all appear

  Scenario: R6 — the newest artifact is found without an explicit path
    Given several artifacts exist across multiple dates
    When report runs with no path argument
    Then the newest artifact is resolved through the latest pointer
    And an explicit path argument overrides that resolution

  Scenario: R8 — a markdown sidecar is written for reading without the CLI
    Given a rendered report
    When the render completes
    Then a markdown file is written next to the JSON artifact
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
