---
schema_version: 1
name: Restore Board reachability for the retired process watch list (executions + filters)
status: backlog
template: feature-impl
created_at: 2026-09-14T05:54:18.081Z
updated_at: "2026-09-14T06:17:06.827Z"
feature_id: G64

---

## 0852. Restore Board reachability for the retired process watch list (executions + filters)

### Background

Task 0849 (G64) retired the Board modules `workspace`, `inbox`, and `teams` with redirects into
Projects. Its Design mapped each retired surface onto a Projects capability — Workspace → the project
summary in the Projects header, Inbox → the Conversation tab (0841), Teams → the roster and member
terminal on the Agents tab (0842). The Teams **process watch list** was not part of that mapping and
therefore retired with its shell:

- `apps/web/src/modules/teams/ProcessesTab.tsx` (`0262` supervised rows, `0264` registry one-shot
  rows, `0267` running-only + team filters, no-matches empty state) was deleted with the module.
- `GET /api/team/processes` still serves `executions` — the full `ts-runtime` `ProcessRegistry` watch
  list (`apps/server/src/modules/team/index.ts:40-72`) — but after 0849 `apps/web` has **zero**
  readers of `executions`: `parseProcessList` in `MemberTerminal.tsx` narrows only the supervised
  fields, and no surviving view lists registry one-shots.
- The supervised half stays reachable: `AgentsView` polls the same endpoint and renders each
  roster member's observed status (`data-agents-view`), so *which declared members are running* is
  covered. What is gone is the *watch list* view: one-shot executions, and the 0267 filters.

Captured by the 0849 review as a P2 (major) finding: `R2`'s clause "no Board capability becomes
unreachable" is unestablished for this sub-facet, and retiring it silently would be a surface
reduction no operator owned. This task is the owner.

### Requirements

- **R1** — The surviving Board exposes the registry one-shot (`executions`) rows that
  `GET /api/team/processes` already returns, or the removal of that facet is recorded as an explicit
  operator decision on this task.
- **R2** — If a view is added, it lives on a surface whose tab contract allows it (Projects' three
  tabs are frozen by 0840: Conversation, Agents, Work) — do not silently add a fourth Projects tab.
- **R3** — The `0267` filter behaviors (running-only, team filter, no-matches empty state) either
  return with the view or are explicitly dropped with a recorded reason.
- **R4** — No duplicate reader of `/api/team/processes`: reuse `parseProcessList` or extend it; do not
  stand up a second parse path.
- **R5** — Cover the `0262 AC` supervised-row test group too, not only the `0267` filters (`0849
  review pass 3` flagged it as unowned): the deleted `tests/modules/teams/components.test.tsx` had
  three supervised-row cases — rows rendered from `/api/team/processes`, registry one-shots shown
  alongside them, and the empty state — and only the filters are named by R3 today.

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

- Raised by: [0849 review](../tasks4/0849_retire-workspace-inbox-and-teams-board-routes-with-redirects.md) P2 (major), 2026-09-14
- Retirement that dropped it: [G64](../features/G64_retire-workspace-inbox-teams-and-spur-team.md); task 0849
- Server contract: `GET /api/team/processes` → `apps/server/src/modules/team/index.ts:40-72` (`executions`, `executionsCount`)
- Deleted view: `apps/web/src/modules/teams/ProcessesTab.tsx` (0262/0264/0267), tests `tests/modules/teams/components.test.tsx` (0267 filter suite)
- Surviving consumer: `apps/web/src/modules/projects/MemberTerminal.tsx` (`parseProcessList`), roster view `apps/web/src/modules/projects/AgentsView.tsx`

### History
