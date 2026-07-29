---
template: feature-impl
schema_version: 1
name: "Redesign the Jobs tabview as a purpose-built queue and scheduler view over a filtered query"
description: ""
status: todo
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P1
tags: ["board", "web", "observability", "jobs"]
dependencies: ["0368", "0372"]
created_at: "2026-07-29T00:15:02.349Z"
updated_at: "2026-07-29T00:25:38.517Z"
---

## 0376. Redesign the Jobs tabview as a purpose-built queue and scheduler view over a filtered query

### Background

JobsTab fetches the newest 50 events across all prefixes and then filters in the browser for names starting with `queue.` or `scheduler.` (JobsTab.tsx:103, :114-117). It appears to work only because those three heartbeat events are 89.8 percent of the ledger — the moment J3 demotes them to the diagnostic tier, this client-side slice will frequently return nothing. The rendering is also raw: each event is a card with a `JSON.stringify(payload, null, 2)` block (:181-183), so job identity, state, attempt count, duration, and failure reason are buried in a pretty-printed blob rather than being columns an operator can scan.

### Requirements
- [ ] R1. Load job events through the J3 server-side prefix filter instead of slicing a client-side page of all events.
- [ ] R2. Present job identity, job type, state, attempt or retry count, duration, and failure reason as first-class scannable fields rather than a raw JSON dump.
- [ ] R3. Correlate the enqueue, retry, completion, and failure events of one job so an operator can read a single job's story.
- [ ] R4. Keep the four queue counters (pending, processing, completed, failed) visible and visually distinct from the event list.
- [ ] R5. Render an explicit empty state when no job events match, never a perpetual loading indicator.
- [ ] R6. Keep the existing untrusted-input narrowing discipline for both the stats and the history responses.
### Acceptance Criteria
```gherkin
Scenario: R9 — Job events come from a server-side filtered query
Scenario: R10 — A job row surfaces identity, state, timing, and failure reason
Scenario: R11 — Queue counters remain visible alongside the event view
Scenario: R12 — An empty job history renders an explicit empty state
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
