---
schema_version: 1
name: Prototype rest and GTD dispatch traces with capacity and restart failures
status: done
template: feature-impl
created_at: 2026-09-11T18:07:39.271Z
updated_at: "2026-09-11T23:53:02.176Z"
feature_id: G6
priority: P1
tags:
  - wayfinder:prototype

dependencies: ["0828"]
---

## 0829. Prototype rest and GTD dispatch traces with capacity and restart failures

### Background

Robin approved G6's strategy defaults on 2026-09-11: rest prevents new dispatch while active work finishes; GTD selects already-authorized eligible tasks; v1 uses Spur-managed loops. This task provides a runnable design simulation, not production orchestration.

0828 must first supply `docs/reports/g6-runtime-inventory.md`, especially its Runtime path, Fault probes and Handoff sections. The current tree has no demonstrated durable orchestrator request/result loop. Its accepted role vocabulary is scribe/coder/reviewer/planner, so the simulation uses a planner-role instance explicitly bound as orchestrator rather than claiming a literal orchestrator role already works.

### Requirements

- [x] R1. Build a deterministic local simulation of project-scoped human request → answer/hold/assignment → fake workflow outcome → orchestrator result with explicit correlation and state snapshots.
- [x] R2. Demonstrate duplicate input/results, rest versus dispatch races, restart with persisted strategy, stale-owner rejection, disabled/unavailable executors, unmet task dependencies, exhausted capacity, and missing completion receipts without external agents.
- [x] R3. Enforce one write slot per project, exact-instance assignment among duplicate roles, authorization/readiness gates, no model calls on idle ticks, and verified-task completion distinct from process exit.
- [x] R4. Deliver runnable traces and a strategy contract distinguishing current reusable primitives from simulated proposals; record each missing implementation seam and the stable handoff for production planning.

Out of scope: a production scheduler, workflow engine, daemon, plugin loader, broker, live agent process, real task transition, public role/CLI/API/config changes, or alteration of 0828's factual findings.

### Acceptance Criteria

- [x] R1: Given fake tasks, instances and input events, when the documented workspace test command runs, then request-to-result traces carry project/request/instance/run correlation and distinguish answers, holds and assignments.
- [x] R2: Given each listed fault/race case, when its event sequence runs, then expected final state and dispatch counts are asserted, snapshots restore strategy, and ambiguous work is held rather than blindly replayed.
- [x] R3: Given competing writers, repeated roles, unauthorized/unready work, idle ticks and a zero exit without verification, when selection/completion is evaluated, then all named invariants are enforced by failing assertions.
- [x] R4: Given the report and executable traces, when downstream planning consumes them, then the reused owners, simulated guarantees, missing production seams, and scope boundaries are explicit and consistent with 0828.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T23:05:55.729Z

Ready-depth refinement, 2026-09-11:
- CLOSED — rest drains active work; GTD selects already-authorized eligible tasks. Robin approved these defaults.
- CLOSED — The orchestrator is an explicit binding to a planner-role instance in this simulation. The current production role enum does not accept orchestrator.
- CLOSED — Deterministic test-local ordering is priority/WBS for tasks and stable instanceId for equally eligible instances; production task readiness remains owned by existing workflows.
- CLOSED — Restart in this task means reloading a persisted-state model into a fresh controller; actual DB/process recovery guarantees must remain separately evidenced by 0828 or later implementation tests.
- DEFERRED — Production storage fields, new event producers and an exact role/config extension belong to the implementation design after the evidence is reviewed; this task supplies the evidence rather than approving the API.

### Design

#### WHAT / WHY / WHERE

Create the simulator only under `apps/cli/tests/fixtures/g6/strategy-prototype.ts`, exercised by `apps/cli/tests/commands/g6-strategy-prototype.test.ts`. Publish commands and compact traces in `docs/reports/g6-strategy-prototype.md`. No new production API or dependency. Test-local functions/types are not an approved product contract.

Use a supplied clock and event sequence, fake executors, and a state snapshot reloaded into a fresh controller. Reuse the proven primitives from 0828 where available; isolate missing primitives as explicitly simulated behavior. Never claim that a pure-model check proves SQLite atomicity, operating-system crash recovery, or a real agent's behavior.

#### Frozen behavioral contract

Private model fields: projectPath, instanceId, role, executor, requestId, messageId, taskId, runId, generation, ownerEpoch, strategyVersion and attemptId. Optional taskId is absent for questions. Separate receipt/delivery, disposition, run outcome and task verification. Use a planner-role instance with an explicit orchestrator binding; do not extend the production role schema.

On submission, deduplicate by projectPath + requestId and preserve immutable request content; reuse with different content is an error. For GTD select only authorized, ready, dependency-satisfied tasks, ordered by existing task priority then WBS. Select an idle, role-compatible, enabled and sufficiently constrained concrete instance by stable instanceId as the tie-break. Claim instance and the project's write slot together against the current ownerEpoch/strategyVersion. A stale decision must re-evaluate instead of dispatching. Read-only assignments require explicit capability evidence, not a role-name assumption.

Rest increments strategyVersion and stops future starts, including queued unstarted assignments. Existing running assignments finish; their slot remains owned until their outcome is reconciled. For ambiguous execution, retain the task/write reservation and show outcome-unknown; expiry alone must not cause unsafe replay. Replacement increments ownerEpoch, rejects old-owner results as authoritative updates, and retains them as diagnostic evidence.

Replay a saved snapshot into a fresh controller to demonstrate persisted strategy and unfinished assignment recovery. Deduplicate outcomes by attemptId; late results must match instance/run/generation ownership before advancing work. Process exit can finish a run; only an explicit verified workflow outcome can complete a task. A notification failure must leave a result discoverable in durable-model state for reconciliation.

Wake only on human input, strategy change, relevant task/capacity change, or a result. Idle ticks produce zero fake model calls and zero dispatches. An empty/exhausted eligible set records an actionable hold reason. Strategy extension is selection/disposition over the same gate; no alternate execution path.

#### Dependency and evidence contract

0828 is the authority for current behavior and availability. If its Handoff contradicts the proposed mechanics, keep its finding, simulate the missing requirement explicitly, and document the production seam rather than editing 0828's report. Its completion is an execution prerequisite; it is not required to refine these prototype requirements.

Save initial state, input sequence, selected identity, claim versions, fake-call counts and final state for each test. The suite must fail on duplicate assignment, cross-project delivery, dispatch after rest, double writer ownership, stale-owner advancement, or exit-as-task-success. Report the boundary between simulated policy and proven runtime.

Execution budget: implement the bounded event cases, avoiding new architecture; checkpoint code, unmet cases and command receipts under `.spur/run/0829/` after 60 minutes if incomplete. Continue from the checkpoint; do not convert partial coverage to PASS. Production mutationPolicy: none; report/prototype/test changes satisfy requireDiff.

### Plan

- [x] R1/R4: Load approved G6 and the completed 0828 Handoff; map available versus simulated primitives and record dependency provenance.
- [x] R1/R3: Build the smallest event-driven fake controller with request correlation, deterministic selection, versioned ownership and a project write slot.
- [x] R2/R3: Add table-driven input sequences covering every required race/failure; reload snapshots to model restart and assert model/dispatch counts.
- [x] R2/R4: Run `bun test tests/commands/g6-strategy-prototype.test.ts` inside apps/cli; retain readable event traces and name model-only guarantees.
- [x] R4: Publish the strategy report, minimal extension boundary and remaining production decisions; verify all R-items before closing the prototype task.

### Solution

- apps/cli/tests/fixtures/g6/strategy-prototype.ts — test-only deterministic event-driven fake controller implementing the frozen behavioral contract (strategy-prototype.ts:215 `G6StrategyPrototypeController.process` event switch; :325 `wakeAndSelect`; :366 `selectGtdAssignment` GTD priority→WBS gates; :403 `pickInstance` role/enable/capability filters with stable instanceId tie-break; :422-441 `claimAndAssign` atomic instance+write-slot claim against ownerEpoch/strategyVersion with duplicate-assignment (:429-433), single-writer write-slot guard (:425-426, slot release :534) and no-dispatch-after-rest (:424) guards; :473 `handleResult` — attemptId dedup (:478-482), cross-project orphan rejection, stale-owner downgrade, durable persist-before-notification (mirrors 0828 probe 6), exit-only vs task-completed split with taskOutcome derivation at :526; :273-281 rest drain dropping queued future starts; :302-311 tick = zero model calls/dispatches; :317 `record`/(:188 `getProject`) slot-claim bookkeeping; :601-615 `unsafeForceAssignment` guard tripwires; :575 `snapshot`/(:618 `restoreController`) for restart).
- apps/cli/tests/commands/g6-strategy-prototype.test.ts — 17 table-driven cases covering every R2 case (duplicate input, duplicate results, rest-vs-dispatch race via select/claim intercept, restart from snapshot into a fresh controller, stale-owner rejection after replacement, disabled/unavailable executors, exhausted capacity, unmet dependencies, missing/failed completion receipts, cross-project delivery) plus guard tripwires proving the "must FAIL on" guarantees.
- docs/reports/g6-strategy-prototype.md — run commands, one-shot readable trace command + captured output, per-case trace table, reused-vs-simulated strategy contract (provenance to 0828 §3 probes / §5 Handoff), and the 8 missing production seams with remaining decisions for production planning.

Rationale: 0828 is the dependency authority; every primitive it shows as absent (idempotent request dedup, completion-receipt linking, per-project write-slot lease/ownerEpoch, rest semantics, verified-completion distinct from exit, capability evidence, selective wakeup) is simulated explicitly and named as a seam — none of its findings were contradicted or its report edited. The orchestrator is an explicit planner-role instance with `purpose: "orchestrator"`; the closed role vocabulary (scribe/coder/reviewer/planner) is untouched. No production API, dependency, or pipeline file changed; no production test altered.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/tests/fixtures/g6/strategy-prototype.ts:215 event-driven controller; dispatch correlation attemptId/runId/generation/ownerEpoch/strategyVersion at :441-444; answers/holds/assignments distinguished; trace command + captured output in docs/reports/g6-strategy-prototype.md §1 |
| R2 | MET | 17 table-driven tests in apps/cli/tests/commands/g6-strategy-prototype.test.ts: duplicate input/dedup by projectPath+requestId; attemptId dedup (:478-482); rest-vs-dispatch race intercept (:341-362); restart via snapshot :575 / restoreController :618; stale ownerEpoch rejection :503-511; disabled/unavailable + exhausted capacity; unmet dependencies; notification-failure reconciliation :560 |
| R3 | MET | single write slot per project in claimAndAssign :422-441 with single-writer guard; exact-instance via pickInstance :403-417 stable instanceId tie-break; authorization/readiness gates :395-401 (whyNotEligible); idle tick zero model calls/dispatches :302-311; verified-outcome-only completion vs exit :516-526; must-FAIL guards via unsafeForceAssignment tripwires :601-615 |
| R4 | MET | docs/reports/g6-strategy-prototype.md §2 reused-vs-simulated contract with 0828 provenance; §4 8 missing production seams; §5 remaining decisions; no contradiction with 0828 report (reviewer cross-checked); simulation boundary explicitly disclaims SQLite/crash/real-agent claims |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1-AC | MET |  | documented run command + trace carry project/request/instance/run correlation |
| R2-AC | MET |  | each fault case asserts final state and dispatch counts; snapshots restore strategy; ambiguous work held not replayed |
| R3-AC | MET |  | all named invariants enforced by failing assertions incl. tripwires |
| R4-AC | MET |  | owners/simulated guarantees/seams/scope explicit and consistent with 0828 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | secua-review | — | reviewer verdict PASS; P3 stale Solution refs fixed; P4 ×3 advisory (dead record no-op, queued-state vacuous, trace-table abridgment) |
| P4 | quality-gate | — | bun run spur-check exit 0 (twice); apps/cli typecheck + biome clean; 17/17 tests pass; full apps/cli suite 1033 pass |
| P4 | traceability-verify | — | per-requirement MET with file:line evidence |

### References

- [G6 map and approval](../features/G6_projects-and-agent-fleet-unification-design.md)
- [Approved interaction and strategy direction](../plans/2026-09-11-project-agent-fleet-brainstorm.md)
- [0828 — Runtime and migration investigation](0828_inventory-and-probe-project-fleet-identity-delivery-and-lega.md)
- [ADR-022 and ADR-057](../00_ADR.md)
- [Existing pin and lifecycle semantics](../design/inter-agent-control-plane.md)
- [Existing fake-executor loop tests](../../apps/cli/tests/commands/agent-team.test.ts)
- Required future input: `docs/reports/g6-runtime-inventory.md`, authored by 0828. Its absence today is the declared execution dependency, not proof it already exists.

### History

- 2026-09-11T23:33:13.342Z todo → wip (system)
- 2026-09-11T23:53:01.865Z wip → testing (system)
- 2026-09-11T23:53:02.176Z testing → done (system)

