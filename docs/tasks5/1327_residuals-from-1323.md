---
schema_version: 1
name: Residuals from 1323
status: backlog
template: standard
created_at: 2026-11-10T22:10:44.717Z
updated_at: "2026-11-10T22:10:44.874Z"

---

## 1327. Residuals from 1323

### Background

Source task: 1323 (feature D3) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:4df96b6a — packages/app/src/services/agent-run-executor.ts:689, packages/app/src/services/agent-run-executor.ts:812, packages/app/src/observability/agent-execution.ts:291: A `timeout-exhausted-skip` on the node's first attempt `continue`s the loop before any dispatch, so the first real dispatch runs at `attempt >= 1` and `lifecycle.start` (guarded `attempt === 0`) never executes: the run emits no `started` lifecycle event and no progress heartbeats for that entire dispatch. `finish` still emits (its guards tolerate a missing start), dispatch behavior and all recorded ladder/budget decisions are unaffected — observability-only. Suggested fix: a start-once flag instead of the `attempt === 0` guard.

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
