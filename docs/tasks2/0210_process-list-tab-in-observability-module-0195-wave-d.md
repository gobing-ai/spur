---
template: feature-impl
schema_version: 1
name: Process List tab in observability module (0195 wave D)
description: ""
status: todo
type: task
profile: standard
feature_id: G2
parent_wbs: "0195"
priority: P2
tags: [approach-c,web,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.858Z
updated_at: 2026-07-04T04:18:23.661Z
---

## 0210. Process List tab in observability module (0195 wave D)

### Background

Wave D of parent 0195 (team process supervision) — read the parent's Background and Design first. Depends on wave B (registry API + attach stream) and 0189 wave B (tabs contract). Appends the Process List tab to the observability module's `tabs.ts`: live process list (agent id, status, uptime — fed by `GET /api/team/processes` + `process.*` events on the existing EventSource) with an attach affordance linking to a stream view of the process output.

### Requirements
- [ ] R1 — Process List tab via the tabs-as-data contract (no shell edits); live status via registry API + `process.*` events. (Parent R7)
- [ ] R2 — Attach affordance: stream view rendering replay + live frames for a selected process. (Parent R7)
- [ ] R3 — Component tests; UI seam compliance; full gate green. (Parent R8, R9)
### Acceptance Criteria
```gherkin
Feature: Team process supervision

  Scenario: Process List tab shows live supervision state
    Given the board Observability module is open
    When the operator opens the Process List tab
    Then supervised processes render with live status
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0195's Design owns the full approach — this slice implements **Board**: append the Process List tab to the observability module's `tabs.ts` (0199's tabs-as-data contract — no shell edits): live list (agent id, status, uptime) fed by `GET /api/team/processes` plus `process.*` events on the board's existing EventSource; attach affordance opening a stream view that renders ring-buffer replay + live frames for the selected process. UI imports via `apps/web/src/ui.ts`. Depends on: 0208 (registry API + stream), 0199 (tabs contract). Completes parent 0195 together with 0207–0209.
### Plan
- [ ] Process List tab via `tabs.ts` append: live list from registry API + `process.*` events (R1).
- [ ] Attach affordance: stream view with replay + live frames (R2).
- [ ] Component tests; seam compliance; gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R3).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

G2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
