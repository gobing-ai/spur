---
template: feature-impl
schema_version: 1
name: "Rebuild the System Events tabview on server-side queries and surface the enriched envelope fields"
description: ""
status: todo
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P1
tags: ["board", "web", "observability"]
dependencies: ["0369", "0372"]
created_at: "2026-07-29T00:15:02.339Z"
updated_at: "2026-07-29T00:25:36.101Z"
---

## 0375. Rebuild the System Events tabview on server-side queries and surface the enriched envelope fields

### Background

SystemEventsTab fetches the newest 100 rows once (SystemEventsTab.tsx:44, :432-451) and then does all filtering in the browser — prefix pills, tier, time window, and search scope all run inside a `useMemo` over that fixed window (:508-542). With the ledger dominated by heartbeat noise, filtering for a prefix that is not in the newest 100 returns nothing and there is no way to page back. Detail is also thin: `buildTooltipSummary` caps at 4 label/value pairs (:401) and renders only on CSS hover (:880-894), so it is unreachable on touch and cannot show the correlation and outcome fields the J3 envelopes now carry. This task repoints the tabview at J3's filtered, paginated query surface and gives the enriched fields a real home.

### Requirements
- [ ] R1. Replace client-side filtering with the J3 server-side query params (`prefix`, `names`, `runId`, `actor`) and cursor pagination; matching events outside the newest page must be reachable.
- [ ] R2. Surface run and action identity, duration, and outcome on the row itself, not only in a hover affordance.
- [ ] R3. Render explicitly-unavailable usage as unavailable; never substitute a zero.
- [ ] R4. Replace the hover-only tooltip with a persistent, dismissible detail affordance showing the full redacted envelope, keyboard reachable and usable without a pointer.
- [ ] R5. Keep the SSE live tail, the tri-state connection indicator, and the rolling event-rate strip working while a filter is active.
- [ ] R6. Preserve the existing runtime narrowing discipline: a row or frame failing schema validation is dropped without breaking the remaining rows.
- [ ] R7. Keep the responsive collapse behaviour and the existing accessibility contract for the filter controls.
### Acceptance Criteria
```gherkin
Scenario: R3 — Filtering is applied server-side, not over a fixed client window
Scenario: R4 — A correlated event row surfaces its identity and outcome
Scenario: R5 — Absent usage is shown as unavailable, never as zero
Scenario: R6 — Event detail is inspectable without hover
Scenario: R7 — The live tail and the liveness strip keep working under the new query path
Scenario: R8 — A malformed row or frame never breaks the tabview
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

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
