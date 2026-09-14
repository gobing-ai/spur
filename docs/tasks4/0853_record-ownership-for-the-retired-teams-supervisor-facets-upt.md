---
schema_version: 1
name: Record ownership for the retired Teams supervisor facets (uptime, live activity, team up/down)
status: backlog
template: feature-impl
created_at: 2026-09-14T06:06:21.909Z
updated_at: "2026-09-14T06:06:50.537Z"
feature_id: G64

---

## 0853. Record ownership for the retired Teams supervisor facets (uptime, live activity, team up/down)

### Background

retired surface onto a Projects capability — Workspace → the project summary in the Projects header,
Inbox → Conversation (0841), Teams → the roster and member terminal (Agents, 0842). The 0842 roster
is a declared-vs-observed design, so three facets that `TeamsShell`'s SupervisorTab (0378) owned
retired with the shell and have no successor or owner today:

- **Per-member uptime (0378 R3).** The supervisor roster showed each member's uptime derived from the
  process start time. `AgentsView` shows declared and observed facts (status, pid, exit code) but no
  uptime; `uptime` has no occurrence in `apps/web/src`.
- **Live last-activity (0378 R4).** The roster kept each member's last activity fresh from the board's
  planning SSE stream. `apps/web/src/modules/projects/MemberDetail.tsx:60-77` reads
  `/api/events/history` once on open and carries an explicit `ponytail:` note that a live SSE tail
  was not added; only the Features and Observability modules subscribe to event streams.
- **Team up/down Board controls (0378 R5).** Both Board callers were deleted with the tab, while
  `POST /api/team/:team/up` and `/down` survive (`apps/server/src/modules/team/index.ts:250,280`) with
  no caller. G63's CLI story moved `up` to fleet materialization at serve start and `down` to
  `spur agent stop` (0848), so the Board control's removal may be intended — but no record says so.

Captured by the 0849 review pass 2 as a P2 (major) finding: 0849's `R2` requires that "no Board
capability becomes unreachable", and these three facets are unreachable with no owner. This task is
the owner; whether each returns or is formally dropped is the operator decision it records.

### Requirements

- **R1** — Each of the three facets (uptime, live last-activity, team up/down) gets an explicit
  operator decision: reinstate on a surviving Board surface, or record the removal with its reason.
- **R2** — Any reinstatement respects the frozen tab contracts of the surface it lands on — Projects'
  three tabs (Conversation, Agents, Work) are fixed by 0840; do not add a fourth silently.
- **R3** — Do not re-introduce a second event-stream subscriber for the roster if the existing
  `useProjectContext` poll can carry the fact; the design preference is one poll tick for both facts
  (0842 Design).
- **R4** — If `POST /api/team/:team/up|down` ends with no caller anywhere, that is a server-surface
  removal decision, not a silent orphan: name it here and route it to the owning noun's task.

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

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

- Raised by: [0849 review](../tasks4/0849_retire-workspace-inbox-and-teams-board-routes-with-redirects.md) pass 2, P2 (major), 2026-09-14
- Retirement that dropped them: [G64](../features/G64_retire-workspace-inbox-teams-and-spur-team.md); task 0849
- Deleted surface: `apps/web/src/modules/teams/SupervisorTab.tsx` (0378 R3/R4/R5), `tests/modules/teams/components.test.tsx`
- Surviving server routes: `apps/server/src/modules/team/index.ts:250,280` (`up`/`down`)
- Surviving Board surfaces: `apps/web/src/modules/projects/AgentsView.tsx`, `MemberDetail.tsx`
- CLI successors for the team verbs (0848): fleet materialization at serve start; `spur agent stop`
- Sibling residual: task 0852 (process watch list)

### History
