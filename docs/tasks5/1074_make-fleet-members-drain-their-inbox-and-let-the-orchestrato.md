---
schema_version: 1
name: Make fleet members drain their inbox and let the orchestrator converse
status: backlog
template: feature-impl
created_at: 2026-10-04T20:30:36.790Z
updated_at: "2026-10-04T20:33:16.811Z"
feature_id: G71

dependencies: ["1073"]
---

## 1074. Make fleet members drain their inbox and let the orchestrator converse

### Background

Implements G71 R3 and R4 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 items 2 and 4; decisions D1, D2, D4).

Verified state (2026-10-04):

- C1: when a fleet is declared, member loops never drain; they only `recordIdleHold` (`packages/app/src/services/agent-loop-service.ts:371`, `:413`, `:475`). Messages to members and to the orchestrator are never consumed.
- The drain path already exists: `drainPending` → `MemberSession` → `settleDelivered`/`releasePending`/`settleFailed`; `drainIntoPrompt` builds the "Pending messages:" block and threads `requestMessage` into `executeRun` (`apps/cli/src/commands/agent.ts` ~885–925; `delivery-reconciler.ts`).
- `coordination_runs` has no `session_id` column (`packages/domain/src/migrations.ts:167`); the run→agent-session mapping is `history_run_session` (`:220`, ADR-059).
- The resume session id is known only after the first drain (`member-session.ts:168`, `:310`).

### Requirements

- [ ] R1. Delete the fleet bypass at `agent-loop-service.ts:371`: every member loop takes the drain → `MemberSession` → settle path.
- [ ] R2. While a drained run carrying a dispatch key is live, the member heartbeats the write slot claimed for it (D4); TTL expiry stays with the reconciler.
- [ ] R3. On loop start the member seeds its resume session from the last exact `history_run_session.session_id` joined by `run_id` to its latest `coordination_runs` row.
- [ ] R4. The orchestrator loop drains its own inbox before the strategy tick on each wake and answers through `replyToMessage`; the LLM never decides dispatch (D2).

### Acceptance Criteria

- [ ] AC1 — Members drain their inbox and hold the write slot
- [ ] AC2 — The orchestrator converses through its inbox

Task-local verification:

- A member loop with a pending keyed message drains, executes and settles it; the slot heartbeat renews while the run is live.
- A restarted member loop resumes the session id recorded for its last exact run.
- An operator message to the orchestrator is replied to before the tick runs.

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

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History
