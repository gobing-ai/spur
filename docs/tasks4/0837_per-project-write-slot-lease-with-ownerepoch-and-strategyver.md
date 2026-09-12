---
schema_version: 1
name: Per-project write-slot lease with ownerEpoch and strategyVersion fencing
status: done
template: feature-impl
created_at: 2026-09-12T04:53:38.724Z
updated_at: "2026-09-12T18:14:24.142Z"
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

**Premise corrections applied (mandatory).** (1) The spec's `:36` line referencing
`0044_spur_cli_project_claims` is a REFERENCE to 0836's claim table, not a migration of this task —
**0837 adds NO migration**; the table is live as registered step `0045_spur_cli_project_claims`
(`packages/domain/src/migrations.ts:1405`, drizzle mirror `drizzle/0045_spur_cli_project_claims.sql`).
Built on `ProjectClaimDao` and `FleetService.resolveOrchestrator` as directed. (2) Frozen spec names
are authoritative per the WHERE section — all frozen names shipped verbatim
(`DispatchDecision`, `ClaimRefusal`, `ClaimOutcome`, `WriteSlotService.claim/validateResult/release`,
`WRITE_SLOT_TTL_MS = 30_000`). One documented shape adjustment: `ClaimOutcome`'s ok branch is
`{ ok: true; lease?: ProjectClaim }` — the spec itself requires proven read-only claims to return ok
WITHOUT taking a slot, so the lease must be optional; the frozen refusal union and verdict strings
are unchanged.

**0836 advisory handoffs honored.** (a) `owner_epoch` is read as claim-generation: the
stale-owner test drives it through a RE-ENTRANT same-holder orchestrator claim (epoch 1 → 2) and a
decision pinned at 1 is refused `stale-owner` (`write-slot-service.test.ts:137`). (b)
`claim()`'s returned row treated as advisory: the service re-derives authority from holder identity
after a dao claim (`write-slot-service.ts:147-149`), and the dao fix below removes the ambiguity at
the source.

**ROOT-CAUSE FIX in the dao (found by the two-claimant race test).** 0836's `claim()` decided the
outcome from a separate `SELECT changes()` probe AFTER the write. On a shared adapter, interleaved
claimants yield between the two statements, so a claimant could read the OTHER claimant's change
count — observed as two racers both refused while a row was created (exactly the "no interleaving
produces two holders" AC inverted: no interleaving produced a DECIDED holder). Fixed at the source:
`claim()` is now ONE `INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING` statement
(`packages/domain/src/dao/project-claim-dao.ts:82-115`); `RETURNING` emits a row only when the
write landed, so a refusal reads `null` and a winner reads the row its own statement wrote.
RETURNING-through-queryFirst is precedented (`packages/domain/src/db.ts:315`). The same
two-statement pattern remains in `heartbeat`/`release` (`:135`, `:159`, 0836's frozen surface) —
their failure mode is fail-safe (a displaced holder is told false and stops), not an exclusivity
break; left for 0838's loop work to revisit if ever needed.

Change map (0837's own surface only; the uncommitted 0835+0836 tree was not otherwise touched):

- `packages/domain/src/dao/project-claim-dao.ts:79-115` — `claim()` gains optional
  `strategyVersion` (Plan step 1): written on insert AND on takeover
  (`strategy_version = excluded.strategy_version`, `:101`); omitted (0836 orchestrator callers)
  stays/lands NULL; the statement becomes single-shot RETURNING (above). Frozen callers
  (`claim(projectPath, slot, holder, ttl)`) unaffected — the 0836 suite (62 tests) stays green.
- `packages/app/src/services/write-slot-service.ts` (new) — frozen surface:
  `DispatchDecision` (:17), `ClaimRefusal` (:31), `ClaimOutcome` (:42),
  `WRITE_SLOT_TTL_MS = 30_000` (:50), `WriteSlotService` (:80).
  `claim` (:102) implements the four-step precedence in order, first refusal wins:
  stale-owner vs the orchestrator claim's `ownerEpoch` (:119-122, before touching the write slot;
  absent row reads epoch 0); stale-strategy vs the orchestrator claim's `strategyVersion`
  (:125-129, NULL fences nothing until 0838 mints); `requiresWrite: false` requires the member's
  resolved `fsWrite` attestation to be `'unavailable'` — proven absent via
  `FleetService.resolve` → `capabilityState` (:132-140; unknown/absent axis/absent member →
  `write-capability-unproven`; the role name is never consulted); otherwise the atomic dao claim
  (:143-149). Proven read-only returns `{ ok: true }` with no lease — the asymmetry that lets many
  readers run beside one writer. `validateResult` (:151): compares the reporter's epoch against the
  write claim; a lower epoch → `'stale-owner-rejected'` plus ONE `system_events` diagnostic
  (`fleet.write-slot.stale-owner-rejected`, :164, payload carries project/instance/epochs/holder,
  `run_id` + `entity_kind: 'task'`/`entity_id` from the optional `ResultRef` — the frozen
  two-arg call sites stay valid) and NEVER mutates task state; advancement stays with the workflow
  pipeline. A missing claim row fences nothing (the legitimate final result passes).
  `release` (:182) delegates to the holder-scoped dao delete. Heartbeating is the holder run
  loop's job via `ProjectClaimDao.heartbeat` — that loop is 0838/0839's; this service owns only
  claim/validate/release (Q&A: TTL plus heartbeat, not hold-until-done).
- `packages/app/src/index.ts:633-641` — barrel export of the new service + types.
- `packages/app/tests/services/write-slot-service.test.ts` (new) — 11 tests, harness mirroring
  `fleet-service.test.ts` (temp project, migrated in-memory db, fsWrite-attested executors):
  racing writers → exactly one holder (:116); re-entrant-epoch fencing → stale-owner, slot never
  touched (:137); strategy bump → stale-strategy (:150); NULL version fences nothing (:162);
  proven read-only concurrent with a held slot, slot untouched (:172); unknown axis + absent
  member → write-capability-unproven (:196); strategyVersion persisted on the lease + holder-scoped
  release + re-claim (:209); replaced owner's result → stale-owner-rejected + diagnostic with
  run/task ids, slot state unchanged (:229); current-generation accepted, epoch-0 rejected,
  released slot fences nothing (:255); path spellings resolve to the same slot (:271); diagnostic
  side-effect guard — the only write is the single system_events row, claim rows byte-identical
  (:291).

No CLI surface: the spec's WHERE table names only the domain dao, the app service, and
fleet-service consumption — flag-not-verb rule held, no public-surface change consented or needed.
Handoffs honored: 0838 mints `strategyVersion`, supplies `DispatchDecision`, maps `ClaimRefusal`
to hold reasons; G63 0844 renders refusals.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/write-slot-service.ts:50` `WRITE_SLOT_TTL_MS = 30_000`, one write slot per worktree (`claim` `slot: 'write'` `write-slot-service.ts:143-149`, holder-scoped `release` :182-187); tests: 11 pass / 0 fail fresh run (race `tests/services/write-slot-service.test.ts:116`, release+re-claim :209) |
| R2 | MET | ONE `INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING` decides and reports — `packages/domain/src/dao/project-claim-dao.ts:79-115` (no read-then-write); fresh race test: two concurrent claimants → exactly one holder, loser `slot-held` (`tests/services/write-slot-service.test.ts:116-135`) |
| R3 | MET | takeover bumps epoch `owner_epoch = project_claims.owner_epoch + 1` (`project-claim-dao.ts:100`); `validateResult` rejects lower epoch → ONE `system_events` diagnostic `fleet.write-slot.stale-owner-rejected` (`write-slot-service.ts:151-180`, event :164) and never mutates task state (guard test `tests/services/write-slot-service.test.ts:291-309`, replaced-owner test :229-253) |
| R4 | MET | `strategyVersion` written on insert AND takeover (`project-claim-dao.ts:101`); stale decision → `stale-strategy`, NULL fences nothing (`write-slot-service.ts:125-129`); fresh tests :150-160 (stale-strategy) and :162-171 (NULL no-op) |
| R5 | MET | proven read-only (`capabilityState === 'unavailable'`) runs WITHOUT the slot; unknown/absent member → `write-capability-unproven`, role name never consulted (`write-slot-service.ts:132-141`); fresh tests :172-186 (concurrent with held slot) and :196-206 (unknown/absent refused) |
| R6 | MET | no new migration: 0836's step `0045_spur_cli_project_claims` is the only `project_claims` migration (`packages/domain/src/migrations.ts:1405`, drizzle mirror `drizzle/0045_spur_cli_project_claims.sql`); 0837 adds the `'write'` slot value on that table only |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — One writer per worktree | MET | test | `packages/app/tests/services/write-slot-service.test.ts:116-135` second write dispatch refused `slot-held`; :172-186 read-only proceeds only with fsWrite attestation, slot untouched |
| R5 — Stale decisions and replaced owners cannot act | MET | test | `packages/app/tests/services/write-slot-service.test.ts:137-148` stale-owner refused before slot touched; :150-160 stale-strategy re-evaluated; :229-253 replaced owner → `stale-owner-rejected` + diagnostic, task state unchanged |
| Claiming is atomic across instance and slot | MET | test | `packages/app/tests/services/write-slot-service.test.ts:116-135` two `Promise.all` claimants → exactly one holder, loser `slot-held`, over the single-statement RETURNING claim (`project-claim-dao.ts:79-115`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0837

**Scope:** 0837 surface only — NEW `packages/app/src/services/write-slot-service.ts`, rewritten `ProjectClaimDao.claim()` (single-statement RETURNING), domain/app barrel exports, NEW `packages/app/tests/services/write-slot-service.test.ts` (11 tests). Settled 0835/0836 surfaces excluded from judgment.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | architecture | Fence read (precedence steps 1–2) and slot claim (step 4) are separate statements, so an orchestrator epoch/strategy bump can land between them; this is the spec-frozen precedence, and `validateResult` remains the authoritative fence — revisit re-claim discipline when 0838 wires the dispatch loop | `packages/app/src/services/write-slot-service.ts:107-116,127` |
| 2 | P4 (advisory) | security | `validateResult` fences on epoch only; a result reporting the current epoch from a non-holder would be accepted (frozen signature, spec defines the epoch as THE fence). If belt-and-braces is ever wanted, compare `instanceId` against the live `holderId` when a claim row exists — 0838 seam | `packages/app/src/services/write-slot-service.ts:159-161` |
| 3 | P4 (advisory) | correctness | `heartbeat`/`release` retain 0836's two-statement `SELECT changes()` probe; on a shared adapter the count can alias another statement — fail-safe direction (a displaced holder is told `false` and stops), untouched by this task, deferred to 0838's loop work as documented in `## Solution` | `packages/domain/src/dao/project-claim-dao.ts:135,159` |
| 4 | P4 (advisory) | correctness | Post-claim holder-identity recheck is unreachable under single-statement RETURNING semantics (a returned row always names the caller as holder); kept as documented defense-in-depth for 0836 advisory (b) — safe to drop if noise matters | `packages/app/src/services/write-slot-service.ts:136-138` |

No P1–P3 findings: all four 0837 files reviewed across the six dimensions; the one frozen-shape deviation (`ClaimOutcome.lease?` optional) is forced by the spec's own precedence step 3 (proven read-only returns ok WITHOUT a slot) and is documented in `## Solution`.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | durable one-slot-per-worktree lease on 0836's `project_claims` (`slot: 'write'`, `WRITE_SLOT_TTL_MS` constant, not a knob) — `packages/app/src/services/write-slot-service.ts:50,103-135` |
| R2 | MET | ONE `INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING` decides and reports (`packages/domain/src/dao/project-claim-dao.ts:92-107`); race test: two concurrent claimants → exactly one holder, loser `slot-held` (`write-slot-service.test.ts:117-136`) |
| R3 | MET | takeover bumps `owner_epoch` (`project-claim-dao.ts:100-104`); `validateResult` rejects a lower epoch, writes ONE `system_events` diagnostic with run/task ids, mutates no task state (`write-slot-service.ts:156-178`; structural guard test `write-slot-service.test.ts:292-309`) |
| R4 | MET | `strategyVersion` written on insert AND takeover (`project-claim-dao.ts:82,101`); NULL fences nothing (`write-slot-service.ts:112-116`, test `:163`); stale → `stale-strategy`, re-evaluation is the caller's job (0838 handoff) |
| R5 | MET | only proven-absent `fsWrite` (`capabilityState === 'unavailable'`) runs without the slot; unknown axis / absent member → `write-capability-unproven`; role name never consulted; proven read-only returns ok with NO lease (`write-slot-service.ts:118-125`, tests `:174-204`) |
| R6 | MET | no new migration — 0836's `0045_spur_cli_project_claims` lives (`packages/domain/src/migrations.ts:1405`); 0837 adds none |

##### Verification Evidence (fresh, this review)

- `bun test tests/services/write-slot-service.test.ts` (packages/app): **11 pass / 0 fail**, 32 expects.
- `bun test tests/dao/project-claim-dao.test.ts tests/dao/migrations.test.ts` (packages/domain): **62 pass / 0 fail** — 0836 suite green against the RETURNING rewrite.
- Gate artifact `.spur/run/0837-test-gate.status` = `rc=0`; log tail: **8118 pass / 0 fail**, 32,956 expects, 450 files; post-check rules all passed.
- SQLite semantics check: `queryFirst` returns `T | undefined` (`node_modules/@gobing-ai/ts-db/src/adapter.ts:43`) and the dao maps that to `null` refusal; RETURNING emits rows only for rows the calling statement itself inserted/updated, so a WHERE-failed conflict yields no row — genuinely atomic under concurrent claimants on one connection-serialized adapter, and under SQLite's write lock across processes.

**Next:** PASS clears the Phase 7 gate. Disposition — findings 1–2 are 0838's (dispatch-loop discipline, optional identity belt-and-braces); findings 3–4 are wrap residuals (fail-safe by design). No repair required in this task.

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity"
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §3.1 guard tripwires (single-writer, stale-owner-rejected)
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §5.2.5 shared-generation gap
- Code: `packages/app/src/services/supervisor-service.ts:212-216`; `packages/app/src/services/agent-service.ts:1080-1084`
- Invariant: one writer per working tree (AGENTS.md § "Conventions & boundaries")

### History

- 2026-09-12T17:29:59.623Z todo → wip (system)
- 2026-09-12T18:14:23.551Z wip → testing (system)
- 2026-09-12T18:14:24.142Z testing → done (system)

