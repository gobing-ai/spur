---
schema_version: 1
name: Prototype rest and GTD dispatch traces with capacity and restart failures
status: done
template: feature-impl
created_at: 2026-09-11T18:07:39.271Z
updated_at: "2026-09-12T04:16:35.850Z"
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

- [x] AC-1 (R1): Given fake tasks, instances and input events, when the documented workspace test command runs, then request-to-result traces carry project/request/instance/run correlation and distinguish answers, holds and assignments.
- [x] AC-2 (R2): Given each listed fault/race case, when its event sequence runs, then expected final state and dispatch counts are asserted, snapshots restore strategy, and ambiguous work is held rather than blindly replayed.
- [x] AC-3 (R3): Given competing writers, repeated roles, unauthorized/unready work, idle ticks and a zero exit without verification, when selection/completion is evaluated, then all named invariants are enforced by failing assertions.
- [x] AC-4 (R4): Given the report and executable traces, when downstream planning consumes them, then the reused owners, simulated guarantees, missing production seams, and scope boundaries are explicit and consistent with 0828.

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

Test-local simulation only. Re-verification corrected unsafe behavior; no production API or schema changes.

- `apps/cli/tests/fixtures/g6/strategy-prototype.ts:257` — explicit question answer/hold, independent from task dispatch; request IDs remain opaque.
- `apps/cli/tests/fixtures/g6/strategy-prototype.ts:324` — replacement retains ambiguous writers and slots; exit-only results also hold rather than replay.
- `apps/cli/tests/fixtures/g6/strategy-prototype.ts:511` — result identity includes task and owner epoch; persisted counters prevent restart ID/generation collisions.
- `apps/cli/tests/fixtures/g6/strategy-prototype.ts:351` — per-event before/after snapshots and fake-call deltas, optional supplied clock; capability and numeric WBS gates.
- `apps/cli/tests/commands/g6-strategy-prototype.test.ts:485` — regression cases reproduced the defects before the fix; 23 tests now pass.
- `docs/reports/g6-strategy-prototype.md:127` — re-audit corrections, traces and remaining simulated-only recovery boundary.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/commands/g6-strategy-prototype.test.ts:531` — question answer vs assignment/hold and event snapshots; workspace `bun test tests/commands/g6-strategy-prototype.test.ts` exit 0. |
| R2 | MET | `apps/cli/tests/commands/g6-strategy-prototype.test.ts:485` — replacement holds reservation; forged task/epoch results rejected; restart counters persist. All 23 tests / 109 assertions pass. |
| R3 | MET | `apps/cli/tests/commands/g6-strategy-prototype.test.ts:545` — numeric WBS, capability gates; existing tests cover authorization, rest races, single writer, idle and verified completion. Same test command exit 0. |
| R4 | MET | `docs/reports/g6-strategy-prototype.md:127` — corrected traces, missing production seams and explicit safe-hold limit reviewed; trace snapshot assertions at `apps/cli/tests/commands/g6-strategy-prototype.test.ts:531` pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 (R1) | MET | test | `apps/cli/tests/commands/g6-strategy-prototype.test.ts:531` — question answer vs assignment/hold and event snapshots; workspace `bun test tests/commands/g6-strategy-prototype.test.ts` exit 0. |
| AC-2 (R2) | MET | test | `apps/cli/tests/commands/g6-strategy-prototype.test.ts:485` — replacement holds reservation; forged task/epoch results rejected; restart counters persist. All 23 tests / 109 assertions pass. |
| AC-3 (R3) | MET | test | `apps/cli/tests/commands/g6-strategy-prototype.test.ts:545` — numeric WBS, capability gates; existing tests cover authorization, rest races, single writer, idle and verified completion. Same test command exit 0. |
| AC-4 (R4) | MET | test | `docs/reports/g6-strategy-prototype.md:127` — corrected traces, missing production seams and explicit safe-hold limit reviewed; trace snapshot assertions at `apps/cli/tests/commands/g6-strategy-prototype.test.ts:531` pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | task-check | — | spur task check 0829 --strict-core --json exit 0 before record; repeated after record. |
| P4 | design-conformance | — | Frozen safe-hold, request correlation, restored state, explicit fake answer and event snapshot contract exercised; synchronous selection models queued-unstarted at the existing intercept. |
| P4 | fix-artifacts | — | Rewrote .spur/run/0829-verify-answer.txt lines 1-30; derived .spur/run/0829-verdict.json; red log .spur/run/g6-verifyall/0829-red.log and green log 0829-tests.log. |
| P4 | typecheck | — | bun run --filter @gobing-ai/spur typecheck exit 0. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

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

