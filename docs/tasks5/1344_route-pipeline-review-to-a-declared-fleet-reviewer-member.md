---
schema_version: 1
name: Route pipeline review to a declared fleet reviewer member
status: done
template: feature-impl
created_at: 2026-11-16T01:11:45.935Z
updated_at: "2026-11-16T03:15:20.468Z"
feature_id: G76

dependencies: ["1341"]
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1344. Route pipeline review to a declared fleet reviewer member

### Background

Implements: R8 — Review routes to a distinct reviewer member.

Keeps one coder per pipeline run while letting the `role: reviewer` stage run on a declared reviewer member, satisfying P0/P1 executor distinctness by construction.

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).

### Requirements

- [x] R1 — When a reviewer member is declared, the pipeline review `agent.run` resolves to it through the existing ADR-126/148 role path; otherwise current executor resolution applies.
- [x] R2 — The review turn starts a fresh conversation (ADR-145) and its receipt records coder and reviewer identities.
- [x] R3 — The orchestrator never splits pipeline stages across members (ADR-022).

### Acceptance Criteria

- [x] AC1 — Review routes to a distinct reviewer member

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

When the project declares an enabled `role: reviewer` member, the pipeline's review `agent.run`
already resolved to it through the ADR-126/148 role path (`resolveMember` + `FRESH_SESSION_ROLES`,
`packages/app/src/workflow/fleet-dispatch.ts:134-176`). What was missing was the **tree**: a
pipeline running in a lane dispatched the review turn to a member whose own cwd was the base, so the
reviewer judged a tree the pipeline was not in and its receipt named nobody. Both gaps are closed
here, with no new transport and no new config key.

**Change map**

- **Envelope:** `packages/app/src/workflow/fleet-work-item.ts`
  - `:9-18` `FleetWorkItem.cwd` — the lane the turn must run in.
  - `:49-62` `isLaneCwd` — a cwd is accepted only when it is the project path or one of its declared lanes (`isProjectLane`, reusing 1341's lane root); anything else throws `Invalid fleet work-item envelope` instead of guessing a tree.
  - `:76-96` `writeFleetWorkItem` takes the dispatching tree (`lanePath`) and records it.
  - `:166-176` `runFleetWorkItem` validates the recorded cwd and runs the turn there (`runCwd`); `:178` shows the action receiving it.
  - `:59-96` `ReviewRoutingIdentity` + `coderIdentity`; `:196-203` a `role: reviewer` turn writes `.spur/run/<runId>/prompts/routing.json` = `{ coder, reviewer, session: 'fresh' }`, beside the pipeline's own `__agentRouting_implement`.
- **Writer side:** `packages/app/src/workflow/actions/agent-run.ts:446-459` records the dispatching tree in the envelope; `packages/app/src/services/agent-loop-service.ts:670` hands the member its base project + declared fleet section so the lane can be proven.
- **Tests:** `packages/app/tests/workflow/fleet-work-item.test.ts` — a declared lane cwd is accepted, the turn's own artifact lands in the lane, and the routing receipt records both identities with a fresh session; a foreign cwd is a malformed envelope.

**R3 (the orchestrator never splits stages).** No code is needed and none was added: only the review
stage's own `agent.run` routes by role, and the coder keeps the whole pipeline. The role comes from
the existing member `role`, so there is no new config key.

**Verification**

- `(cd packages/app && bun test tests/workflow/fleet-work-item.test.ts)`: 6 pass.
- `(cd packages/app && bun test tests/workflow/fleet-dispatch.test.ts tests/workflow/agent-run-fleet.test.ts tests/workflow/codex-warm-work-item.test.ts tests/services/agent-loop-service.test.ts)`: 78 pass, 0 fail — the role/fresh-session dispatch path is unchanged for in-tree runs.
- `every-export-has-tsdoc` PASS; `packages/app` typecheck and biome clean.
- probe: not-applicable (no public noun/verb/flag; the reviewer role is the existing member `role` field).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — when a reviewer member is declared, the pipeline review `agent.run` resolves to it through the existing ADR-126/148 role path; otherwise today's executor resolution applies | MET | `packages/app/src/workflow/fleet-dispatch.ts:134-176` (`resolveMember` by role, `FRESH_SESSION_ROLES` incl. `reviewer`); unchanged for in-tree runs — `packages/app/tests/workflow/fleet-dispatch.test.ts` + `agent-run-admission.test.ts` (99 pass across 4 related files); the review stage already declares `role: reviewer` (`config/workflows/task-pipeline.yaml:632`) |
| R2 — the review turn starts a fresh conversation and its receipt records coder and reviewer identities | MET | fresh: `fleet-dispatch.ts:149-158` refuses a reused-session candidate; identities: `packages/app/src/workflow/fleet-work-item.ts:196-203` writes `.spur/run/<runId>/prompts/routing.json` = `{coder, reviewer, session:'fresh'}` (coder read from `__agentRouting_implement`, `:66-79`); test "a declared lane cwd is accepted and becomes the turn cwd (G76 1344 R1/R2)" asserts the exact object |
| R3 — the orchestrator never splits pipeline stages across members | MET | by construction: only the review stage's own `agent.run` routes by role; no stage-splitting code was added, and the coder keeps the whole pipeline |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — review routes to a distinct reviewer member | MET | test | `packages/app/tests/workflow/fleet-work-item.test.ts` lane-cwd + routing-identity case; `packages/app/tests/workflow/actions/agent-run-admission.test.ts` "same P1 reviewer identity" and "missing P1 reviewer identity" rows (distinctness enforced before dispatch) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:05.156Z backlog → todo (system)
- 2026-11-16T03:10:41.725Z todo → wip (system)
- 2026-11-16T03:15:19.208Z wip → testing (system)
- 2026-11-16T03:15:20.464Z testing → done (system)

