---
schema_version: 1
name: Residuals from 0994
status: backlog
template: feature-impl
created_at: 2026-09-28T19:12:57.473Z
updated_at: "2026-09-28T19:12:57.748Z"
feature_id: D62

---

## 0995. Residuals from 0994

### Background

Source task: 0994 (feature D62) — deferred residuals filed by residual-scan settle.

- review-finding:97ffe86c — plugins/sp/scripts/wrapup-steps.ts:279: Hand-copied verdict matcher with no drift guard: the copy is verbatim (ADR-065), but its `Testing` slice uses `#{2,4}` where the canonical `extractTestingSection` (`packages/app/src/services/task-record.ts:275-289`) uses `#{1,6}`. Reachable divergence: an h1 `# Testing` heading, or an h4 subheading before the Verdict line, reads as no verdict on the plugin side while the app sees one. Both degrade to honest `UNKNOWN` and `renderTesting` writes the Verdict line first, so no wrong `PASS` is reachable today.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Derive from the linked feature or refined task scope. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Do not leave placeholder AC here. -->

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

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
