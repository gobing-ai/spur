---
schema_version: 1
name: Per-project write-slot lease with ownerEpoch and strategyVersion fencing
status: todo
template: feature-impl
created_at: 2026-09-12T04:53:38.724Z
updated_at: "2026-09-12T05:20:19.191Z"
feature_id: G62
priority: P2
tags:
  - g6-program

dependencies: ["0835"]
---

## 0837. Per-project write-slot lease with ownerEpoch and strategyVersion fencing

### Background

No per-process lease or leader primitive exists. `generation` is monotonic per spec inside one
database, and a restarted supervisor mints a fresh `SPUR_RUN_ID` per child without linking it to the
previous child's run (`packages/app/src/services/supervisor-service.ts:206-220`); the shared-generation
refinement is explicitly deferred in source (`packages/app/src/services/agent-service.ts:1080-1084`).
See `docs/reports/g6-runtime-inventory.md` §5.2.5.

Meanwhile the repository invariant is one writer per working tree (AGENTS.md, Conventions &
boundaries), so fleet size can never equal write capacity — the fleet needs a real slot, not a
convention.

The strategy prototype models the target mechanics and proves them negatively as well as positively:
forcing a second writer throws `single-writer`, and a result from a replaced owner is downgraded to
`stale-owner-rejected` without advancing the task
(`docs/reports/g6-strategy-prototype.md` §3.1).

**Premise check — R6's storage decision is resolved upstream.** Task 0836 creates the Spur-local
`project_claims` table (migration `0044_spur_cli_project_claims`) with a `(project_path, slot)`
composite primary key and the `owner_epoch` / `strategy_version` columns already declared. This task
adds the `'write'` slot value on that table; it introduces **no new table and no new migration**.

**Premise check — capability evidence already exists.** R5's "capability evidence" is task 0706's
attestation vocabulary: `EXECUTION_CAPABILITY_AXES` including `fsWrite`, states
`['enforced','available','unavailable','unknown']`, and provenance
`['native-known','operator-configured','unattested']` (`packages/config/src/index.ts:209-265`). Task
0835 already resolves this into `ResolvedFleetMember.writeCapable`. There is nothing new to invent.

### Requirements

- **R1** — A durable per-project write-slot lease, one write slot per worktree in v1.
- **R2** — Claiming is atomic: no interleaving can produce two holders of the same slot.
- **R3** — Owner replacement increments `ownerEpoch`; a result arriving from a stale owner is recorded
  as a diagnostic and never advances a task.
- **R4** — Decisions are pinned to `strategyVersion`: a decision taken before a strategy change is
  declared stale at claim time and re-evaluated instead of dispatched.
- **R5** — A read-only assignment may run concurrently with a held write slot only when the member's
  `fsWrite` attestation proves it does not write. Unknown never grants.
- **R6** — Storage is additive and reversible, on the table 0836 already creates. No second migration.

### Acceptance Criteria

```gherkin
Feature: Per-project write-slot lease with ownerEpoch and strategyVersion fencing

  @core
  Scenario: R4 — One writer per worktree
    Given a project whose write slot is held
    When a second write-capable dispatch is attempted for the same worktree
    Then the dispatch is refused with a capacity hold
    And a read-only assignment proceeds only with capability evidence

  @core
  Scenario: R5 — Stale decisions and replaced owners cannot act
    Given a dispatch decision taken before a strategy change or owner replacement
    When the claim is attempted
    Then the decision is declared stale and re-evaluated
    And a result arriving from the replaced owner is recorded as a diagnostic without advancing the task

  @core
  Scenario: Claiming is atomic across instance and slot
    Given two claimants racing for the same write slot
    When both claim at once
    Then exactly one holds the slot and no interleaving produces two holders
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:20:19.190Z

- **R6 lease storage — CLOSED: 0836's `project_claims` with `slot: 'write'`.** The row shape a write
  slot needs — one mutable holder per (project, slot), with an epoch and an expiry — is exactly the row
  0836 already creates, and `owner_epoch` / `strategy_version` were declared there so this task adds no
  migration. Extending `coordination_runs` was the alternative on G62's open list; it is append-per-run
  history keyed by `run_id` and would have to be scanned to answer "who holds the slot now".
- **Slot count — CLOSED: exactly one, not configurable.** One writer per working tree is a repository
  invariant (AGENTS.md § "Conventions & boundaries"), not a tuning parameter. A config knob would let
  an operator configure their way into corruption.
- **Read-only concurrency — CLOSED: proven-absent `fsWrite` only.** The 0706 vocabulary distinguishes
  `'unavailable'` (proven) from `'unknown'` (unattested); only the former runs concurrently. Trusting
  the role name would let `reviewer` bypass the single-writer invariant by naming convention.
- **Lock duration — CLOSED: TTL plus heartbeat, not hold-until-done.** A crashed holder must not wedge
  the project; expiry with a rising `ownerEpoch` is what makes takeover safe and the late result
  identifiable. This is the prototype's `stale-owner-rejected` case (`g6-strategy-prototype.md` §3.1).
- **Stale result handling — CLOSED: diagnostic, never a transition.** Task advancement belongs to
  `task-pipeline.yaml` verification. A rejected result that silently advanced a task would be worse
  than the race it came from.
- **Deferred (owner: 0838).** Minting `strategyVersion` and mapping `ClaimRefusal` to hold reasons.
- **Deferred (owner: G63 0844).** Operator-facing rendering of refusals.

### Design

**WHAT.** A `WriteSlotService` over 0836's `ProjectClaimDao` using `slot: 'write'`, plus a
decision-token shape that carries `ownerEpoch` and `strategyVersion` from decision time to claim time
so a stale decision cannot dispatch and a stale owner cannot report.

**WHY fencing rather than a longer lock.** Holding a lock across a coding-agent run means the slot is
released only by that process succeeding — a crashed agent would wedge the project forever. Expiry plus
a monotonically increasing epoch lets a new owner take over safely while still making the old owner's
late result identifiable and rejectable. That is exactly the failure the prototype named
`stale-owner-rejected`.

**WHERE.**

| Layer | Change |
| --- | --- |
| `packages/domain/src/dao/project-claim-dao.ts` | `'write'` slot usage; `strategyVersion` on claim (columns exist from 0836) |
| `packages/app/src/services/write-slot-service.ts` (new) | claim / validate / release |
| `packages/app/src/services/fleet-service.ts` | `writeCapable` consumed here |

**Frozen names.**

```ts
// packages/app/src/services/write-slot-service.ts
interface DispatchDecision {
    projectPath: string;
    instanceId: string;          // spec id, verbatim
    ownerEpoch: number;          // orchestrator epoch observed when the decision was taken
    strategyVersion: number;     // strategy version observed when the decision was taken
    requiresWrite: boolean;      // from ResolvedFleetMember.writeCapable (0835)
    taskId?: string;
}
type ClaimRefusal =
    | 'slot-held'                // another live holder (R1, R2)
    | 'stale-owner'              // decision.ownerEpoch < current orchestrator epoch (R3)
    | 'stale-strategy'           // decision.strategyVersion < current strategy version (R4)
    | 'write-capability-unproven'; // requiresWrite false but fsWrite not attested read-only (R5)
type ClaimOutcome = { ok: true; lease: ProjectClaim } | { ok: false; refusal: ClaimRefusal };
class WriteSlotService {
    claim(decision: DispatchDecision): Promise<ClaimOutcome>;
    validateResult(projectPath: string, instanceId: string, ownerEpoch: number): Promise<'accepted' | 'stale-owner-rejected'>;
    release(projectPath: string, instanceId: string): Promise<boolean>;
}
const WRITE_SLOT_TTL_MS = 30_000;
```

**Claim precedence (R2–R5), evaluated in this order, first refusal wins.**

1. Read the current orchestrator claim (`slot: 'orchestrator'`). If
   `decision.ownerEpoch < claim.ownerEpoch` → `stale-owner`. **Before** touching the write slot: a
   replaced owner must not even attempt to claim.
2. If `decision.strategyVersion < claim.strategyVersion` → `stale-strategy`; the caller re-evaluates
   under the current strategy rather than dispatching (R4).
3. If `!decision.requiresWrite`: verify the member's `fsWrite` state is `'unavailable'` — i.e. write
   is *proven absent*, not merely unlisted. `'unknown'` and an absent axis → `write-capability-unproven`
   (R5). Proven read-only assignments return `{ ok: true }` **without taking the slot**, which is what
   makes them concurrent.
4. Otherwise attempt `ProjectClaimDao.claim(projectPath, 'write', instanceId, WRITE_SLOT_TTL_MS)`. A
   `null` return → `slot-held` (R1, R2). The single `ON CONFLICT … WHERE` statement from 0836 is the
   atomicity (R2) — no read-then-write is added here.

**Stale-owner results (R3).** `validateResult` compares the reporting instance's `ownerEpoch` against
the live claim. A lower epoch returns `'stale-owner-rejected'`; the caller records a
`system_events` diagnostic (`SystemEventDao`, `packages/domain/src/dao/system-event-dao.ts:222`) with
the run and task ids and **does not advance the task**. Advancement stays with
`config/workflows/task-pipeline.yaml`; this service only refuses.

**Asymmetry, stated deliberately.** `requiresWrite: true` takes a slot; proven read-only does not.
The fleet can therefore run many readers alongside one writer, which is the only way capacity exceeds
one without breaking the one-writer-per-worktree invariant.

**Anti-patterns — do not implement.**

- Do not create a second lease table or a second migration; 0836's `project_claims` is the storage (R6).
- Do not infer read-only from the role name — `reviewer` is not proof; only an `fsWrite` attestation is.
- Do not treat `'unknown'` or an absent `fsWrite` axis as read-only. Missing data grants nothing.
- Do not hold the slot for the duration of a run without heartbeating — use `ProjectClaimDao.heartbeat`.
- Do not mutate task status from this service; a stale result is a diagnostic, not a transition.
- Do not make the slot count configurable in v1 — one write slot per worktree is the invariant, not a knob.
- Do not re-derive atomicity with `SELECT` then `INSERT`.

**Handoff.** 0838 mints `strategyVersion`, supplies `DispatchDecision`, and maps each `ClaimRefusal`
onto a hold reason. G63 0844 renders `slot-held` as `executor-unavailable`/capacity hold and
`stale-owner-rejected` as a diagnostic, never as progress.

### Plan

1. Extend `ProjectClaimDao.claim` to accept an optional `strategyVersion` written on insert and on
   takeover (column already exists from 0836). (R4, R6)
2. Add `packages/app/src/services/write-slot-service.ts` with `DispatchDecision`, `ClaimRefusal`,
   `ClaimOutcome`, `WriteSlotService`. (R1)
3. Implement the four-step claim precedence exactly in order, returning the first refusal. (R2–R5)
4. Implement `validateResult` and emit the stale-owner diagnostic through `SystemEventDao`; assert in
   test that no task status changes. (R3)
5. Implement `release` and wire `heartbeat` into the holder's run loop. (R1)
6. Tests, `packages/app/tests/services/write-slot-service.test.ts`: two concurrent write claims — one
   `ok`, one `slot-held`; a decision with a lower `ownerEpoch` → `stale-owner` and never reaches the
   slot; a lower `strategyVersion` → `stale-strategy`; `fsWrite: 'unavailable'` read-only runs
   concurrently with a held slot; `fsWrite: 'unknown'` → `write-capability-unproven`;
   `validateResult` from a replaced owner → `stale-owner-rejected` with a diagnostic and an unchanged
   task. (R2–R5)
7. `cd packages/app && bun test tests/services/write-slot-service.test.ts`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity"
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §3.1 guard tripwires (single-writer, stale-owner-rejected)
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §5.2.5 shared-generation gap
- Code: `packages/app/src/services/supervisor-service.ts:212-216`; `packages/app/src/services/agent-service.ts:1080-1084`
- Invariant: one writer per working tree (AGENTS.md § "Conventions & boundaries")

### History
