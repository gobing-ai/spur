---
schema_version: 1
name: Residuals from 1184
status: backlog
template: standard
created_at: 2026-10-13T00:24:49.589Z
updated_at: "2026-10-13T00:24:50.802Z"

---

## 1188. Residuals from 1184

### Background

Source task: 1184 (feature G631) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:1f570519 — apps/web/src/modules/projects/DatabaseView.tsx:468 (handler) and apps/web/src/modules/projects/DatabaseView.tsx:619 (input): The contains-filter input issues one server read per keystroke: `changeFilterValue` rewrites the `f` query key on every change and the rows URL is the fetch effect's dependency. Each read runs `SELECT COUNT(*)` over the filtered table plus the window select, executed synchronously on `bun:sqlite` inside the Bun server, so typing one term against `history_message` (~3.2M rows) blocks the shared event loop once per character. The two comparable server-driven filter boxes in this repo debounce 250 ms.

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
