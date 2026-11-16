---
schema_version: 1
name: Route pipeline review to a declared fleet reviewer member
status: todo
template: feature-impl
created_at: 2026-11-16T01:11:45.935Z
updated_at: "2026-11-16T01:21:05.156Z"
feature_id: G76

dependencies: ["1341"]
priority: P2
estimate_hours: 4
---

## 1344. Route pipeline review to a declared fleet reviewer member

### Background

Implements: R8 — Review routes to a distinct reviewer member.

Keeps one coder per pipeline run while letting the `role: reviewer` stage run on a declared reviewer member, satisfying P0/P1 executor distinctness by construction.

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).

### Requirements

- [ ] R1 — When a reviewer member is declared, the pipeline review `agent.run` resolves to it through the existing ADR-126/148 role path; otherwise current executor resolution applies.
- [ ] R2 — The review turn starts a fresh conversation (ADR-145) and its receipt records coder and reviewer identities.
- [ ] R3 — The orchestrator never splits pipeline stages across members (ADR-022).

### Acceptance Criteria

- [ ] AC1 — Review routes to a distinct reviewer member

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T01:20:48.753Z

- **Q: How does the reviewer find the lane?** CLOSED (refine 2026-11-15): an optional `cwd` on the existing file-based work-item envelope, validated against `laneRoot`. There is no inbox schema change.
- **Q: Several reviewer members?** CLOSED: fail closed with `selector_ambiguous` (existing `resolveRoleTarget` contract). Load-balancing reviewers is deferred until receipts show reviewer queueing.

### Design

**WHAT.** When the project declares exactly one enabled `role: reviewer` fleet member, the pipeline's review `agent.run` (`config/workflows/task-pipeline.yaml:627-672`, `role: reviewer`) is dispatched to that member as a fresh turn in the **same lane**. Otherwise today's executor resolution is unchanged.

**WHY.** ADR-149 keeps one coder per pipeline run (ADR-022), while the P0/P1 distinctness gate (`task-pipeline.yaml:632-635`) is satisfied by construction when review runs on a different member.

**WHERE / frozen names.**
- **Member selection:** reuse `resolveRoleTarget(members, 'reviewer', AGENT_ROLE_NAMES, executorNames)` (`packages/app/src/services/fleet-selector.ts:47`). `selector_unmatched` → fall back to the current executor resolution (`agent-resolver.ts:809` `resolveRole`). `selector_ambiguous` → the review step fails closed with the resolver's message, never first-match.
- **Dispatch:** the existing workflow fleet path (`packages/app/src/workflow/fleet-dispatch.ts` → `FleetDispatcher.enqueue`/`awaitReceipt`). Do not add a new transport.
- **Lane cwd:** the fleet work-item envelope (`FleetWorkItem`, read in `packages/app/src/workflow/fleet-work-item.ts:105-120`) gains optional `cwd?: string`. The writer sets it to the running pipeline's lane. `runFleetWorkItem` uses `work.cwd` only when it resolves under the project's `laneRoot` (reuse 1341's `lanePath` root); anything else throws `Invalid fleet work-item envelope`. The envelope is written under the **base** project's run directory (the member reads `paths(<member cwd>, key)`).
- **Receipt:** the review step's action result records `{ coder: <implement executor spec>, reviewer: <member instanceId>, session: 'fresh' }` next to the existing `__agentRouting_implement`.
- **Write claim:** the reviewer dispatch is `requiresWrite: false` and takes no lane write slot. It writes only `.spur/run/<runId>-review-*` evidence in the lane.

**Anti-patterns.**
- The orchestrator does not split stages across members: only the review stage's own `agent.run` routes.
- Do not reuse the coder's session.
- No new config key: the role comes from the existing member `role`.

**Handoff.** It depends on 1341 for `laneRoot`/`lanePath`. 1343's report shows both identities.

### Plan

1. E2E: P1 fixture task with coder and reviewer members; assert distinct identities and fresh session in receipts.
2. Role resolution wiring.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:05.156Z backlog → todo (system)

