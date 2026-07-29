---
template: feature-impl
schema_version: 1
name: "Demote the self-observation heartbeat to diagnostic tier and replace the flat ledger cap with per-prefix retention quotas"
description: ""
status: todo
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "retention", "data-plane"]
dependencies: ["0367"]
created_at: "2026-07-29T00:14:03.002Z"
updated_at: "2026-07-29T00:25:19.082Z"
---

## 0368. Demote the self-observation heartbeat to diagnostic tier and replace the flat ledger cap with per-prefix retention quotas

### Background

A live histogram of all 10,000 rows in .spur/spur.db (spanning 2026-07-22 to 2026-07-29) shows `queue.job.enqueued` (2,986), `queue.job.completed` (2,986), and `scheduler.job.executed` (2,986) account for 8,958 rows — 89.8 percent of the entire ledger. That triple is the once-per-minute internal prune job observing itself. Against it, `task.*` holds 901 rows, `feature.*` 112, and `process.*`/`message.*` a combined 4. `SystemEventsTab` loads the newest 100 rows (SystemEventsTab.tsx:44), so the operator's window is statistically ~90 heartbeat rows. The cause is a single flat cap: `SystemEventTap` calls `dao.prune(SYSTEM_EVENTS_CAP)` with one global 10,000 constant (system-event-tap.ts:6, :86) and `SystemEventDao.prune` deletes oldest-first across all prefixes, so the loudest producer evicts every quiet one. No amount of UI work in J4 is visible until this is fixed.

### Requirements
- [ ] R1. Move the three prune-job heartbeat entries (`queue.job.enqueued`, `queue.job.completed`, `scheduler.job.executed`) to the `diagnostic` tier so they neither persist nor stream unless the diagnostic toggle is on.
- [ ] R2. Replace the single flat cap in `SystemEventDao.prune` with per-prefix retention quotas so exceeding one prefix's quota can never delete rows of a prefix that is under its own.
- [ ] R3. Source quotas from configuration with a documented per-prefix default fallback; no compiled-in constant as the only knob.
- [ ] R4. Keep prune failures non-fatal: a missing or unmigrated `system_events` table must log and return, never throw to the caller.
- [ ] R5. Preserve the existing insert-time prune backstop behaviour and its return-count contract used by tests.
- [ ] R6. Verify against a seeded ledger that mirrors the observed 90/10 noise ratio, asserting low-volume rows survive high-volume pressure.
### Acceptance Criteria
```gherkin
Scenario: R1 — The self-observation heartbeat leaves the default tier
Scenario: R2 — Per-prefix retention protects low-volume signal from high-volume noise
Scenario: R3 — Retention quotas are configuration, not compiled constants
Scenario: R4 — Retention degrades safely on an unmigrated ledger
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

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

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
