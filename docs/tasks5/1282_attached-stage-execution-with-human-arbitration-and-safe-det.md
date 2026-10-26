---
schema_version: 1
name: Attached stage execution with human arbitration and safe detach
status: done
template: feature-impl
created_at: 2026-10-22T07:00:38.146Z
updated_at: "2026-10-26T00:15:53.676Z"
feature_id: G75
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1281", "1275"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1282-verdict.json
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

- [x] R1. Readiness ready/busy/blocked/draining is explicit for a bound member; a human turn starts busy and only a safe yield plus completed handshake advertises ready.
- [x] R2. No fleet turn is delivered to a busy or blocked occupant; operator-answer waits keep tasks queued.
- [x] R3. A ready, stage-eligible occupant runs keyed stages through the G74 turn contract (1275 `dispatchTurn` with the member pin); only current correlated completion with valid artifacts succeeds; a delivered inbox message never completes a stage.
- [x] R4. Detach (`spur agent leave` on a bound member) drains: stops new assignment, waits up to a bound for the active turn, preserves outcome-unknown work for reconciliation and never kills the human-owned process; late results after lease transfer are diagnostic only.

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

- [x] 1. Failure cases first — busy; blocked input; idle without handshake; reply without correlated terminal; disconnect after acceptance; late completion after transfer; detach during work: covered by `attached-turn-dispatch.test.ts` (8 cases) + `attached-stage.test.ts` (6 cases). (Reviewer stage on a warm attached session rides the unchanged 1275 warm path — attached replaces only the attached transport.)
- [x] 2. Readiness + handshake + selection rule — `strategy-runtime.ts` `attachedGap` + `memberAttachments` seam (fail-closed); `fleet-guest-service.ts` pin fence + handshake-once.
- [x] 3. `createAttachedTurnDispatcher` over the 1275 seam — `packages/app/src/services/attached-turn-dispatch.ts` (keyed enqueue through `FleetDispatcher.enqueue`; completion only on the correlated reply; `outcome-unknown` on deadline/abort).
- [x] 4. Drain on leave — `leave.ts` `--drain-timeout` (default `ATTACHED_DRAIN_GRACE_MS`) + `beginMemberDrain`/`memberDrainSettled`; never signals the process.
- [x] 5. Skill update + E2E — `plugins/sp/skills/fleet-join/SKILL.md` attached loop contract; E2E green; `spur-check` runs at the pipeline gate.

### Solution

**Change map**

Production:
- `packages/app/src/services/fleet-guest-service.ts` — see `packages/app/src/services/fleet-guest-service.ts:105`, `:544`, `:553`, `:576`, `:618`. `MemberBinding` += `handshakeAt`/`draining`/`drainingAt`; `ATTACHED_DRAIN_GRACE_MS = CLAIM_TTL_MS` (30s); `MemberPin`/`MemberPinResult`; `fenceMemberReport`, `beginMemberDrain` (idempotent), `memberDrainSettled` (settled = no `claimed` inbox rows), `fenceMemberPin` (handshake written once, earliest kept; `stageEligible → true` at the handshake — a pin-matched report proves the session reads its inbox, so stages reach it through the pull loop regardless of the bind-time wake probe); `isMemberBinding` widened.
- `packages/app/src/services/strategy-runtime.ts` — see `packages/app/src/services/strategy-runtime.ts:215`, `:304`, `:615`. `DispatchHoldReason` += `member-busy`; `MemberAttachmentState {handshake, draining, stageEligible}`; `StrategyContext.memberAttachments` + runtime seam (fail-closed: a read error treats every occupant as un-handshook and warns); `attachedGap` (reported working / draining / handshake pending / pull-only / other lifecycle); a gap-holding occupant yields hold `member-busy` with the gap named (AC1, AC2-before-handshake).
- `packages/app/src/services/attached-turn-dispatch.ts` (NEW) — see `packages/app/src/services/attached-turn-dispatch.ts:116`, `:213`. the 1275 `dispatchTurn` seam over the attached transport: enqueues the keyed request through the single `FleetDispatcher.enqueue` path, then resolves ONLY on the reply whose body JSON `{requestId, attempt, ownerEpoch, occupancyGeneration}` matches the binding pin (R3); unparseable/foreign/stale evidence is diagnostic-only; deadline/abort → `outcome-unknown` (R2); `lastTurn()` → `AttachedTurnReceipt{mode:'attached', occupant:'attached'}` (AC3).
- `apps/cli/src/commands/agent/report.ts` — see `apps/cli/src/commands/agent/report.ts:55`, `:70`, `:95`. `--pin <ownerEpoch>:<occupancyGeneration>`; a bound member refuses pinless (usage error) and stale-pin reports (exit 2) before any lifecycle write; a match fences `fenceMemberReport` (handshake) then proceeds to `reportLifecycle`; plain guests byte-for-byte unchanged.
- `apps/cli/src/commands/agent/leave.ts` — see `apps/cli/src/commands/agent/leave.ts:43`, `:47`. a bound member's leave drains: `beginMemberDrain` → poll `memberDrainSettled` within `--drain-timeout <ms>` (default `ATTACHED_DRAIN_GRACE_MS`) → retire through the 1281-fenced path; an unsettled turn stays resumable and no process is ever signalled (R4/AC4); plain guests unchanged.
- `apps/cli/src/commands/agent/shared.ts` (wiring) — see `apps/cli/src/commands/agent/shared.ts:615`. `makeFleetRuntime` supplies the `memberAttachments` seam from real record reads; without it the strategy could never hold (AC1/AC2 are production-enforced, not test-only).
- `packages/app/src/index.ts` (wiring) — export the new dispatcher + pin types.
- `plugins/sp/skills/fleet-join/SKILL.md` — attached occupant contract: report `working`/`idle` with `--pin`; a stage-request reply body MUST be the JSON correlation payload (+`artifact`); a plain reply never completes a stage; leave drains, never kills.

Tests (failure-matrix first):
- `packages/app/tests/services/attached-turn-dispatch.test.ts` — 8 cases: a matching reply certifies the turn and pins the receipt; unparseable body / foreign requestId / stale attempt / stale occupancy generation are diagnostic-only; a reply to a different message is invisible; abort and deadline produce `outcome-unknown`, never a definite failure.
- `apps/cli/tests/commands/agent/attached-stage.test.ts` — 6 E2E cases over the real CLI: `--pin` documented; pinless + stale refused with no handshake; match handshakes once (earliest kept) and the real attachments map reads stage-ready; plain guest pinless path unchanged; the strategy holds `member-busy` (handshake pending / draining) and dispatches once handshook; leave drain times out preserving the claimed request (R5), drains settled with nothing in flight, and plain guests carry no drain fields.

**Deviations from the written design** (both caught by the E2E): `stageEligible` flips to `true` at the handshake (the bind-time wake probe left probe-less hosts pull-only forever; the pin-matched report is the authoritative liveness proof). `leave --drain-timeout <ms>` added so operators and tests can bound the grace wait (default remains the 30s design value).

**Scope guard held:** `warm-turn-dispatch.ts` untouched — the new `AttachedTurnReceipt` is standalone per the task guard.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | fleet-guest-service.ts:641 sets handshakeAt once + stageEligible at pin-matched report; E2E apps/cli/tests/commands/agent/attached-stage.test.ts:202 (report → handshake → attachmentsFrom {handshake,draining,stageEligible}) |
| R2 | MET | strategy-runtime.ts:216 fences selection on memberAttachments; member-busy hold reason strategy-runtime.ts:74; tests: attached-stage drain/hold suite 8 pass, app strategy suite green |
| R3 | MET | attached-turn-dispatch.ts:92 parseReply, :165-198 correlated-only completion with replyMessageId receipt (occupant: attached); 10 unit tests incl. stale-pin/foreign-request/stale-attempt + receipt match |
| R4 | MET | apps/cli/src/commands/agent/leave.ts:43-55 beginMemberDrain + bounded --drain-timeout, never signals the process; fleet-guest-service.ts:553-559 drain with unknown-guest fallback; late replies after leave are stale-pin diagnostics only (attached-turn-dispatch.test.ts stale occupancy generation case) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R4 — Human work retains session ownership until an explicit safe yield (req: R1, R2) | MET | test | apps/cli/tests/commands/agent/attached-stage.test.ts — busy claim survives drain timeout, stays outcome-unknown/resumable (R5 guard) |
| AC2 — Ready requires yield plus handshake (req: R1) | MET | test | apps/cli/tests/commands/agent/attached-stage.test.ts:202 — idle-without-handshake not stage-eligible; after pin-matched report, stageEligible true |
| AC3 — R5 — Attached stages produce the same validated receipts as supervised stages (req: R3) | MET | test | packages/app/tests/services/attached-turn-dispatch.test.ts — only a correlated valid-pin reply certifies; receipt = supervised fields + occupant: attached (10 pass) |
| AC4 — Detach drains and preserves uncertainty (req: R4) | MET | test | apps/cli/tests/commands/agent/attached-stage.test.ts drain tests — no new work, turn stays outcome-unknown, no signal, drain settles via leave --drain-timeout |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Three-dimensional review (functional traceability + SECUA + architecture) over the 12-file change set; warm-turn path untouched.

- R1–R4 all MET with test/command evidence (full tables in the run's review answer/cert artifact).
- AC1–AC4 all MET: handshake fence apps/cli/tests/commands/agent/attached-stage.test.ts:202; correlated-only completion packages/app/tests/services/attached-turn-dispatch.test.ts; drain preserves outcome-unknown apps/cli/src/commands/agent/leave.ts:43-55, fleet-guest-service.ts:553-559.
- SECUA: no non-null assertions, no new dependencies, no secret handling; quality gate `spur self exec check` PASS (tree-hash receipt).
- Residual risk: none identified — uncertainty-preserving drain is test-enforced.

| Severity | Finding | Disposition |
| --- | --- | --- |
| P4 | No P1–P3 findings. Pipeline bookkeeping only: remediate re-entry clears `-review-answer.txt`, requiring a re-touch on resume (workflow scratch, no code impact). | accepted |

Confidence: HIGH
Verdict: PASS

### References

- Feature G75 R4–R5; design `docs/design/fleet-attached-occupants.md` §5; ADR-146, ADR-145.
- Anchors: `report.ts:94`; `strategy-runtime.ts:668,708,713–720`; `agent-run.ts:477`; `fleet-dispatch.ts:70`.
- Depends on 1281, 1275. Consumer 1283.

### History

- 2026-10-25T23:18:59.525Z todo → wip (system)
- 2026-10-26T00:14:20.687Z wip → testing (system)
- 2026-10-26T00:15:53.670Z testing → done (system)

