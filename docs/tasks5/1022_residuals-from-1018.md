---
schema_version: 1
name: Residuals from 1018
status: backlog
template: feature-impl
created_at: 2026-09-30T22:23:18.934Z
updated_at: "2026-09-30T22:23:19.155Z"
feature_id: A9

---

## 1022. Residuals from 1018

### Background

Source task: 1018 (feature A9) — deferred residuals filed by residual-scan settle.

- review-finding:281ceac3 — scripts/commands/script-contract-check.ts:595: single-line block comments (trimmed text starting with `/*`, e.g. `/** Opens DB via import('bun:sqlite') */`) are not skipped by the trimmed `//`/`*` rule and would produce a false `db-import` finding (probe-verified); this third comment shape is missing from the declared ponytail note, which lists only trailing comments on code lines and template-string content

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
