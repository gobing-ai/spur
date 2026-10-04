---
schema_version: 1
name: Remove team-era residue from fleet code, contracts and the Board
status: backlog
template: feature-impl
created_at: 2026-10-04T20:30:38.321Z
updated_at: "2026-10-04T20:33:05.880Z"
feature_id: G72

---

## 1078. Remove team-era residue from fleet code, contracts and the Board

### Background

Implements G72 R1 and R2 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §2.1 M1–M3, M5, M6; §3.2 items 7 and 8). Behaviour-preserving except `spur task assign`, which now goes through `TaskService`.

Verified state (2026-10-04):

- M1: `AgentCoordinationService.getStatus()` wraps ts-ai-runner `TeamOrchestrator` with no production caller; only `TeamStatusEntry` leaks into `agent.ts mapServerStatus` (`agent-coordination-service.ts:17`, `:226`, `:458`, `:642`).
- M2: `assignTask` writes task frontmatter with `MarkdownDocument`, bypassing `TaskService` (`agent-coordination-service.ts:491-499`), called by `spur task assign` (`apps/cli/src/commands/task.ts:1847`).
- M3: `RosterMember` carries `workspace`, `systemPrompt`, `command`, `autonomy`, `autostart`, which `FleetMemberSchema` never populates (`fleet-service.ts:150-156`).
- M5: `teamId` flows through `packages/contracts/src/fleet.ts:70,86`, `apps/server/src/modules/processes/index.ts:73,90`, and web `activity-history.ts`, `MemberTerminal.tsx`, `ProcessesView.tsx` (hidden Team filter).
- M6: team naming in `apps/cli/src/commands/agent.ts:751,832,1036`, `message.ts:630`, `fleet-service.ts` comments.

### Requirements

- [ ] R1. Delete `getStatus`, `orchestrator()`, the `TeamOrchestrator` import and `TeamStatus*` types; `mapServerStatus` uses the fleet status types.
- [ ] R2. `assignTask` writes through `TaskService.update`; `spur task assign` output is unchanged.
- [ ] R3. Delete the dead `RosterMember` fields.
- [ ] R4. Rename team-named locals, error text and stale comments to fleet terms; user-visible error text changes are listed in the task Solution.
- [ ] R5. Drop `teamId` from the fleet contract, the processes module, and the web Board (including the hidden Team filter) and update their tests; preserve any concurrent edits to `MemberDetail.tsx`/`MemberTerminal.tsx`.

### Acceptance Criteria

- [ ] AC1 — No team-era code residue remains
- [ ] AC2 — No teamId crosses the transport or the Board

Task-local verification:

- `rg -n "TeamOrchestrator|TeamStatus|teamId" packages apps --glob '!**/tests/**'` returns nothing.
- `spur task assign` still records the assignee, and the corpus write goes through `TaskService`.
- Server and web tests pass with the field removed.

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
