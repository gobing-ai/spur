---
template: feature-impl
schema_version: 1
name: "Demote the self-observation heartbeat to diagnostic tier and replace the flat ledger cap with per-prefix retention quotas"
description: ""
status: done
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "retention", "data-plane"]
dependencies: ["0367"]
created_at: "2026-07-29T00:14:03.002Z"
updated_at: "2026-07-29T04:49:43.536Z"
---

## 0368. Demote the self-observation heartbeat to diagnostic tier and replace the flat ledger cap with per-prefix retention quotas

### Background

A live histogram of all 10,000 rows in .spur/spur.db (spanning 2026-07-22 to 2026-07-29) shows `queue.job.enqueued` (2,986), `queue.job.completed` (2,986), and `scheduler.job.executed` (2,986) account for 8,958 rows — 89.8 percent of the entire ledger. That triple is the once-per-minute internal prune job observing itself. Against it, `task.*` holds 901 rows, `feature.*` 112, and `process.*`/`message.*` a combined 4. `SystemEventsTab` loads the newest 100 rows (SystemEventsTab.tsx:44), so the operator's window is statistically ~90 heartbeat rows. The cause is a single flat cap: `SystemEventTap` calls `dao.prune(SYSTEM_EVENTS_CAP)` with one global 10,000 constant (system-event-tap.ts:6, :86) and `SystemEventDao.prune` deletes oldest-first across all prefixes, so the loudest producer evicts every quiet one. No amount of UI work in J4 is visible until this is fixed.

### Requirements
- [x] R1. Move the three prune-job heartbeat entries (`queue.job.enqueued`, `queue.job.completed`, `scheduler.job.executed`) to the `diagnostic` tier so they neither persist nor stream unless the diagnostic toggle is on.
- [x] R2. Replace the single flat cap in `SystemEventDao.prune` with per-prefix retention quotas so exceeding one prefix's quota can never delete rows of a prefix that is under its own.
- [x] R3. Source quotas from configuration with a documented per-prefix default fallback; no compiled-in constant as the only knob.
- [x] R4. Keep prune failures non-fatal: a missing or unmigrated `system_events` table must log and return, never throw to the caller.
- [x] R5. Preserve the existing insert-time prune backstop behaviour and its return-count contract used by tests.
- [x] R6. Verify against a seeded ledger that mirrors the observed 90/10 noise ratio, asserting low-volume rows survive high-volume pressure.
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
**Forced verifyall result: PASS**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/event-names.ts:88-93`; `packages/app/tests/services/system-event-tap.test.ts:307-316` |
| R2 | MET | `packages/domain/src/dao/system-event-dao.ts:133-171`; `packages/domain/tests/dao/system-event-dao.test.ts:178-212` |
| R3 | MET | `packages/app/src/services/system-event-retention.ts:34`; `packages/app/tests/services/system-event-retention.test.ts:8-45` |
| R4 | MET | `packages/domain/src/dao/system-event-dao.ts:142-176`; `packages/domain/tests/dao/system-event-dao.test.ts:254-261` |
| R5 | MET | `packages/app/src/services/system-event-tap.ts:111-117`; `packages/app/src/services/system-event-emitter.ts:69-75` |
| R6 | MET | `packages/domain/tests/dao/system-event-dao.test.ts:446-492` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — The self-observation heartbeat leaves the default tier | MET | test | `packages/app/tests/services/system-event-tap.test.ts:307-316` |
| R2 — Per-prefix retention protects low-volume signal from high-volume noise | MET | test | `packages/domain/tests/dao/system-event-dao.test.ts:178-212,446-492` |
| R3 — Retention quotas are configuration, not compiled constants | MET | test | `packages/app/tests/services/system-event-retention.test.ts:8-45` |
| R4 — Retention degrades safely on an unmigrated ledger | MET | test | `packages/domain/tests/dao/system-event-dao.test.ts:254-261` |

**Fresh command:** `bun run test` → 3,878 pass, 0 fail, 11,951 assertions; exit 0.

**Coverage:** root per-file line/function ≥90% gate passed.

**SECUA:** no blocker/major; prefix-scoped deletion and defensive configuration parsing remain correct.

**Fix-pass disclosure:** `.spur/run/0368-verdict.json:1-75` regenerated; this Testing section replaced stale evidence only.
### Review
| Priority | Finding | Location | Status |
|---|---|---|---|
| P1 | (none) | — | — |
| P2 | (none) | — | — |
| P3 | `resolveRetentionQuotas` silently drops negative/non-integer env values rather than warning — advisory only, operators get the documented default fallback and boot never aborts | `packages/app/src/services/system-event-retention.ts:29` | accepted |
| P4 | (none) | — | — |

**Verdict:** PASS. Requirements R1–R6 all MET; AC R1–R4 all MET; SECUA PASS; coverage 100% on `system-event-retention.ts` and `system-event-dao.ts` prune paths.
### References

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T01:48:00.292Z todo → testing (system)
- 2026-07-29T01:54:19.422Z testing → done (system)
