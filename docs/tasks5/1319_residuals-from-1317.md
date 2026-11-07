---
schema_version: 1
name: Residuals from 1317
status: backlog
template: standard
created_at: 2026-11-07T08:49:08.491Z
updated_at: "2026-11-07T08:49:08.562Z"

---

## 1319. Residuals from 1317

### Background

Source task: 1317 (feature D3) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:4cd4a17e — packages/app/src/services/workflow-service.ts:555: Each `trace(runId)` read now issues one extra `traceRowById` (`packages/app/src/services/workflow-service.ts:555`), plus `getPid` for `running`/`pending` rows only. At the 1 s `--follow` cadence that is two small indexed reads per second; the listing branch (`packages/app/src/services/workflow-service.ts:558`) pays nothing, so no N-row listing owes N probes.
- review-finding:abe94b6e — packages/app/src/services/workflow-clean-ops.ts:60: `reapRun`'s `mergeMetadata` write (`packages/app/src/services/workflow-clean-ops.ts:64`) is not status-guarded; it is reached only after `interruptRun`'s guarded `WHERE status='running'` UPDATE returned an interrupted row, so the row was `running` at that instant.

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
