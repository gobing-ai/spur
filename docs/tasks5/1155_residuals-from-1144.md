---
schema_version: 1
name: Residuals from 1144
status: backlog
template: standard
created_at: 2026-10-10T04:46:26.734Z
updated_at: "2026-10-10T04:46:27.004Z"

---

## 1155. Residuals from 1144

### Background

Source task: 1144 (feature E2) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:a0b2d47a — packages/app/src/services/history-service.ts:99 (duplicate of :116-122): Stranded duplicate TSDoc: the "Result of a history import operation …" block at :99-105 is a leftover copy of the real `HistoryImportResult` doc at :116-122, left dangling above `ImportScopeEstimate` by the gate remediation (`.spur/run/adb3ff0d-…-test-fix-answer.txt`). TS resolves the nearest block, so both exports stay documented and `every-export-has-tsdoc` is green — the copy is dead text that mis-describes `ImportScopeEstimate`.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
