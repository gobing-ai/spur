---
schema_version: 1
name: Residuals from 1190
status: cancelled
template: standard
created_at: 2026-10-14T05:04:42.341Z
updated_at: "2026-10-14T05:05:25.119Z"

---

## 1205. Residuals from 1190

### Background

Source task: 1190 (feature F43) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:159e3782 — packages/app/src/services/planning-admission.ts:149,193,313; packages/app/src/services/task-check.ts:1222,1243; packages/app/src/services/task-service.ts:1224,1604-1608; packages/app/src/workflow/idea-handoff.ts:275,283; packages/app/src/workflow/lifecycle-adapter.ts:451: The `deprecated` freeze predicate and the `spur task update <wbs> todo` hint are re-spelled as literals in 8 source sites (no `isFrozen` / un-deprecate-hint helper); the remediation added an instance rather than converging them, so the next surface added can silently omit the guard. Non-blocking: design §4.2's guard table is the SSOT enumerating the surfaces.

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

- 2026-10-14T05:05:25.119Z backlog → cancelled (system)

