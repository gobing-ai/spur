---
schema_version: 1
name: Derive agent instances from agent.fleet, drop the instance store and sync fleet docs
status: backlog
template: feature-impl
created_at: 2026-10-04T20:30:38.690Z
updated_at: "2026-10-04T20:33:17.986Z"
feature_id: G72

dependencies: ["1074", "1078"]
---

## 1079. Derive agent instances from agent.fleet, drop the instance store and sync fleet docs

### Background

Implements G72 R3 and R4 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §2.1 M4, M7; §3.2 items 9 and 10; decision D3; ADR-086 amendment A3).

Verified state (2026-10-04):

- M4: the `agent_instances` table (`packages/domain/src/migrations.ts:976-998`) and `AgentInstanceStore`/`createFileAgentInstanceStore` (exported at `packages/app/src/index.ts:69`) have zero callers; the `team_id` column and index survive.
- `.spur/agents/*` specs are materialized as untracked scratch; members can resolve from `agent.fleet` via `FleetService.resolve`.
- `packages/config/src/loader.ts:359` holds the retired `agent.team` guard and stays.
- M7: `docs/design/spur-team-mode-design.md` (557 lines) describes the retired daemon and is linked from `docs/04_DESIGN.md`.
- ADR amendments already landed (057, 086, 121, 126, new 132); this task syncs the satellites.

### Requirements

- [ ] R1. Add a drop migration for `agent_instances` (next four-digit prefix) and delete `AgentInstanceStore`, `createFileAgentInstanceStore` and `agent-instance.ts`.
- [ ] R2. Members resolve their spec from `agent.fleet` at loop start; `.spur/agents/` materialization is removed.
- [ ] R3. Update `03_ARCHITECTURE` (fleet topology), `docs/design/fleet-config-declaration.md` §5, and `docs/design/inter-agent-control-plane.md` §11 to the inbox-only fleet.
- [ ] R4. Mark `spur-team-mode-design.md` superseded, delink it from `04_DESIGN.md`, update `adr-supersession.test.ts`, and add an ADR-116 current-reading note.

### Acceptance Criteria

- [ ] AC1 — Agent instances are derived, not stored
- [ ] AC2 — Docs describe the inbox-only fleet

Task-local verification:

- A database migrated from a pre-drop snapshot has no `agent_instances` table, and `spur agent loop --spec <member>` resolves from config.
- `rg AgentInstanceStore packages apps` returns nothing.
- The doc-sync and ADR-supersession checks pass.

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
