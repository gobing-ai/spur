---
template: feature-impl
schema_version: 1
name: Workspace module implementation (gated on approved workspace design)
description: ""
status: blocked
type: task
profile: standard
feature_id: G3
parent_wbs: null
priority: P3
tags: [approach-c,collaboration,board,gated]
dependencies: []
created_at: 2026-07-03T23:35:28.260Z
updated_at: 2026-07-03T23:44:29.208Z
---

## 0197. Workspace module implementation (gated on approved workspace design)

### Background

Cycle position P7b — the capstone (decision D3, docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). Implements the Workspace module per the ratified workspace design (ADR + docs/design/workspace-design.md from the P7a design task). A workspace binds a git work-folder, an agent team (feature G2 supervision), and per-agent inboxes (feature G1 IPC) into one collaborative unit, surfaced as a board module with tabbed views composing the team-process, inbox, and task surfaces.

THIS TASK IS GATED: it stays in backlog until (1) the P7a design task's ADR + design doc are approved by the operator, and (2) the G1 (inbox IPC) and G2 (team supervision) tasks are done — it composes their shipped APIs. Its Design and Plan sections are intentionally deferred to be authored FROM the approved design doc at refinement time (via /sp:dev-refine), not invented here; authoring them now would guarantee drift against the ratified design. Requirements below capture the stable outer contract from feature G3's acceptance criteria; the refinement pass expands them against the approved design.

### Requirements
- [ ] R1 — Workspace definition surface per the approved design (config or CLI) binding an existing git folder, agent specs, and inbox scoping.
- [ ] R2 — Board module `workspace` (auto-discovered WebModule) listing workspaces with work folder, team roster, and per-agent inboxes.
- [ ] R3 — Tabbed views per the approved design composing team-process (G2), inbox (G1), and workspace-scoped task views.
- [ ] R4 — Inbox isolation enforced per the design's scoping rule (messages inside workspace A never reach workspace B inboxes) with tests proving it.
- [ ] R5 — Server API per the design sketch; contracts in packages/contracts where contract-bound; CF entrypoint unaffected.
- [ ] R6 — Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`; end-to-end manual pass: define a workspace, autostart its team, exchange messages, drive a task — all from the board.
### Acceptance Criteria
```gherkin
Feature: Workspace module

  Scenario: A workspace binds a git folder and a team
    Given a workspace is defined with an existing git folder and agent specs
    When the board Workspace module loads
    Then the workspace lists its work folder, team roster, and per-agent inboxes

  Scenario: Workspace tabs compose the collaboration surfaces
    Given a workspace is open on the board
    When the operator switches tabs
    Then team-process, inbox, and workspace-scoped task views render per the approved design

  Scenario: Workspace inboxes are isolated
    Given two workspaces with distinct agent teams
    When agents in the first workspace message each other
    Then no inbox in the second workspace receives those messages
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**GATED — design intentionally deferred.** This is the cycle capstone (decision D3). Its Design and Plan are NOT authored here by intent: they must be derived from the RATIFIED workspace design (task 0196's `docs/design/workspace-design.md` + ADR entry), and authoring them before ratification guarantees drift against the approved shapes. Task 0196's final plan step rewrites this task's Requirements/Design from the approved design via `spur task update 0197 --section ... --from-file`, after which this task goes through normal refinement (`/sp:dev-refine 0197`) and unblocks.

**Gate conditions (all three):**
1. Task 0196 done — ADR + design doc approved by the operator.
2. Task 0193 (Inbox IPC / feature G1) done — workspace composes its message API + events.
3. Task 0195 (Team supervision / feature G2) done — workspace composes its supervisor registry + attach transport.

**Stable outer contract (what will not change regardless of design detail):** the feature G3 acceptance criteria — a workspace binds an existing git folder + agent team + per-agent inboxes; a board module surfaces it with tabs composing team-process, inbox, and workspace-scoped task views; workspace inboxes are isolated per the design's scoping rule; CF entrypoint unaffected; full verification gate green.
### Plan
- [ ] WAIT: gate conditions met (0196 approved; 0193 and 0195 done).
- [ ] Receive refreshed Requirements/Design from 0196's closing step (authored FROM the ratified design doc).
- [ ] Run `/sp:dev-refine 0197` to expand the ratified design into a full implementation plan; decompose into subtasks (`--parent 0197`) per the design's natural waves (definition surface, server API, board module, isolation tests).
- [ ] Implement per the refined plan; full gate green (`bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check`).
- [ ] End-to-end manual pass: define a workspace, autostart its team, exchange messages, drive a task — all from the board; evidence in Testing.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

G3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-03T23:44:29.208Z todo → blocked (system)
