---
schema_version: 1
name: Design upstream ts-dual-workflow-engine checkpoint/interruption contract (ts-libs packages/dual-workflow-engine) — prerequisite for 0901 R2 safe-resume
status: todo
template: issue
created_at: 2026-09-19T20:04:11.204Z
updated_at: "2026-09-19T20:04:27.923Z"
feature_id: D3

---

## 0902. Design upstream ts-dual-workflow-engine checkpoint/interruption contract (ts-libs packages/dual-workflow-engine) — prerequisite for 0901 R2 safe-resume

### Background

Captured from the creation title: "Design upstream ts-dual-workflow-engine checkpoint/interruption contract (ts-libs packages/dual-workflow-engine) — prerequisite for 0901 R2 safe-resume".

### Requirements

- [ ] R1. Pause/resume primitives on the released engine facade: an interruption contract that permits pausing a run and resuming WITHOUT skipping the current state's pending actions (engine 0.4.69 resume semantics skip current-state actions, which makes status-only paused restoration unsafe).
- [ ] R2. Side-effect/idempotency contract: classify action classes as exactly-once vs at-least-once-with-idempotency-key so hosts can persist durable state before interruption and re-run safely on resume.
- [ ] R3. Concurrent-ownership rules: a resumed run must never double-execute actions while the original owner may still be live (lease or fresh-run-ID semantics), and stale owners must fail loudly rather than race.
- [ ] R4. Release path: shipped in @gobing-ai/ts-dual-workflow-engine with semver bump + docs; spur-new then bumps its dependency and re-runs `/sp-dev-refine 0901 --depth ready` to freeze task 0901.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
