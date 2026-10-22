---
schema_version: 1
name: Attached stage execution with human arbitration and safe detach
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.146Z
updated_at: "2026-10-22T16:36:57.825Z"
feature_id: G75
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1281", "1275"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 12
---

## 1282. Attached stage execution with human arbitration and safe detach

### Background

Implements: R4 — Human work retains session ownership until an explicit safe yield; R5 — Attached stages produce the same validated receipts as supervised stages.
Work packages B4 + B5. Depends on the G74 correlated keyed task-turn seam and the declared-member binding task.
Rubric: E10 D1 L3 C2 R2 = 18 → own task (force: R=high).

**Refine corrections (2026-10-22)**
- Claim "occupant readiness on the binding record consumed by the existing selector" → reality: member lifecycle already exists — `spur agent report working|idle|blocked` (`apps/cli/src/commands/agent/report.ts:94`) → `recordLifecycle` (`agent-coordination-service.ts`) → `MemberLifecycleState` read in the strategy snapshot (`strategy-runtime.ts:713–720`). → resolution: readiness maps onto it (busy=working, ready=idle-after-handshake, blocked=blocked); `draining` is internal to `leave`, so no new report value (a new enum value would need consent).
- Claim "stage execution reuses the G74 seam" → the seam is `AgentExecutionOptions.dispatchTurn` (frozen in 1275); fleet `outcome-unknown` already maps to resumable `interrupted` (`agent-run.ts:477`) and holds dispatch (`strategy-runtime.ts:668`).
- Design §5 forbids injecting fleet work into a busy human turn and killing a human-owned process.

### Requirements

- [ ] R1. Readiness ready/busy/blocked/draining is explicit for a bound member; a human turn starts busy and only a safe yield plus completed handshake advertises ready.
- [ ] R2. No fleet turn is delivered to a busy or blocked occupant; operator-answer waits keep tasks queued.
- [ ] R3. A ready, stage-eligible occupant runs keyed stages through the G74 turn contract (1275 `dispatchTurn` with the member pin); only current correlated completion with valid artifacts succeeds; a delivered inbox message never completes a stage.
- [ ] R4. Detach (`spur agent leave` on a bound member) drains: stops new assignment, waits up to a bound for the active turn, preserves outcome-unknown work for reconciliation and never kills the human-owned process; late results after lease transfer are diagnostic only.

### Acceptance Criteria

```gherkin
Scenario: AC1 — R4 — Human work retains session ownership until an explicit safe yield (req: R1, R2)
  Given a bound occupant that reported `working` (human turn) and a runnable keyed task for its member
  When the strategy ticks
  Then the task stays queued with hold reason naming the busy member, and nothing is delivered to the occupant

Scenario: AC2 — Ready requires yield plus handshake (req: R1)
  Given a bound occupant that reports `idle` without completing the handshake
  When the strategy ticks
  Then it is not selectable; after the handshake completes, it is

Scenario: AC3 — R5 — Attached stages produce the same validated receipts as supervised stages (req: R3)
  Given a ready attached occupant and a keyed stage
  When the stage runs through the attached turn contract and the occupant replies with a message but no correlated terminal
  Then the stage is not complete; when the correlated terminal arrives with a valid artifact, the receipt matches a supervised receipt's fields plus `occupant: attached`

Scenario: AC4 — Detach drains and preserves uncertainty (req: R4)
  Given an attached occupant with an accepted, unfinished turn
  When `spur agent leave` runs and the occupant then disconnects
  Then no new work is assigned, the turn ends `outcome-unknown` and holds reconciliation, the process is not signalled, and a later completion from the old generation is diagnostic only
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:26:03.925Z

- **Q: How does an attached occupant receive a stage turn?** CLOSED — through its inbox: the dispatcher sends a keyed request (existing `fleet:task:*` key) and the occupant's `wait --inbox` loop runs it; completion is the correlated reply carrying `{requestId, attempt, ownerEpoch, occupancyGeneration}` plus the artifact, validated by the same action contract. A `dispatchTurn` implementation `createAttachedTurnDispatcher` wraps this so 1275's executor path is unchanged.
- **Q: New readiness surface?** CLOSED — none; `agent report` states + an internal handshake flag on the binding record. A `draining` report value is not added.
- **Q: Drain bound?** CLOSED — `ATTACHED_DRAIN_GRACE_MS = CLAIM_TTL_MS` (30 s); after it, the turn is `outcome-unknown`.
- **Q: Native steering?** CLOSED — not used for ordinary arrivals (design §5).

### Design

**Files:** `packages/app/src/services/attached-turn-dispatch.ts` (new: `createAttachedTurnDispatcher` → `WarmTurnDispatch` from 1275); `strategy-runtime.ts` (selectable = bound ∧ handshake ∧ lifecycle idle ∧ `stageEligible`); `fleet-guest-service.ts` (`memberBinding.handshakeAt`, `draining`); `apps/cli/src/commands/agent/leave.ts` (drain for bound members); `apps/cli/src/commands/agent/report.ts` (accept only when host binding pin matches, design §4); `plugins/sp/skills/fleet-join/SKILL.md` (attached loop: report working on human turns, idle after yield; reply format with correlation).
**Invariants:** reviewer independence (FRESH_SESSION_ROLES), worktree write controls and executor attestation unchanged; one active task per member; old-generation results never release a write lease.
**Rejected:** native steering for ordinary arrivals; a second scheduler; killing/adopting the host process.
**Tests:** `packages/app/tests/services/attached-turn-dispatch.test.ts` + `apps/cli/tests/commands/agent/attached-stage.test.ts` (fixture occupant child process driving the CLI).

### Plan

1. Failure cases first: busy; blocked input; idle without handshake; reply without correlated terminal; disconnect after acceptance; late completion after transfer; detach during work; reviewer stage on a warm attached session.
2. Readiness + handshake + selection rule.
3. `createAttachedTurnDispatcher` over the 1275 seam.
4. Drain on leave.
5. Skill update; E2E per failure case; `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G75 R4–R5; design `docs/design/fleet-attached-occupants.md` §5; ADR-146, ADR-145.
- Anchors: `report.ts:94`; `strategy-runtime.ts:668,708,713–720`; `agent-run.ts:477`; `fleet-dispatch.ts:70`.
- Depends on 1281, 1275. Consumer 1283.

### History
