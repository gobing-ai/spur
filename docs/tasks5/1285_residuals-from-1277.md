---
schema_version: 1
name: Residuals from 1277
status: backlog
template: standard
created_at: 2026-10-24T21:22:53.599Z
updated_at: "2026-10-24T21:22:53.704Z"

---

## 1285. Residuals from 1277

### Background

Source task: 1277 (feature G74) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:b535812b — docs/reports/fleet-perf-receipt.json:450: Regenerating the perf receipt flipped the claude warm row from qualified to `unsupported` — host 2.1.309 vs the driver-pinned 2.1.308 (`docs/reports/fleet-perf-receipt.json:450-459`) — so the committed receipt no longer evidences 1276's qualified-claude row for G74. The probe is honest and the Pi change did not cause it, but the evidence loss is real.
- review-finding:ee400b53 — scripts/commands/fleet-e2e-perf.test.ts:210: The stub-absence assertion cannot prove absence: `Bun.file(...)` reports size 0 for a missing path (`scripts/commands/fleet-e2e-perf.test.ts:210`), so the `toBe(0)` check passes for both an absent and an empty stub. The `agent: pi` and `not.toContain('agent: claude')` assertions still carry the selected-agent behaviour, and the smoke write is correctly gated on `!options.realAgents`.

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
