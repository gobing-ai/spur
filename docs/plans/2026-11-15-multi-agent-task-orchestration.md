---
kind: plan
title: Multi-agent task orchestration on one fleet kernel
status: approved
created_at: 2026-11-15
updated_at: 2026-11-15
related:
  - docs/00_ADR.md#adr-022
  - docs/00_ADR.md#adr-126
  - docs/00_ADR.md#adr-127
  - docs/00_ADR.md#adr-140
  - docs/00_ADR.md#adr-145
  - docs/00_ADR.md#adr-148
  - docs/design/fleet-task-turn-execution.md
  - docs/design/a2a-member-transport.md
  - docs/plans/2026-11-14-a2a-agent-orchestration-brainstorm.md
tags: [plan, fleet, orchestration, worktree, merge-queue, a2a]
needs_design: true
---

# Multi-agent task orchestration on one fleet kernel

## 0. Conclusion

Spur already has the right pieces. They sit in two orchestrators that never meet:

| | Fleet GTD (`StrategyRuntime`) | Skill batch (`/sp:dev-runall --mode parallel`) |
| --- | --- | --- |
| Driver | Deterministic code, fenced, crash-safe, receipt-based | An LLM working through ~1,800 lines of prose and bash |
| Concurrency | **1**. Any in-flight dispatch blocks every other candidate | N worktrees (default 2) |
| Isolation | None. Members write the project tree | A worktree per task (ADR-127) |
| Integration | None | Rebase, then `--ff-only`, deferred feature sync |
| Scheduler | Priority, then wbs, plus an L4 dependency check | `scheduleBatch`: waves plus file-overlap edges |
| Agents | Any fleet member: local warm, attached, A2A remote | Subprocesses of the host session only |

**Recommendation:** make the fleet runtime the single orchestration kernel and move the batch skill's good parts into code inside it:

1. **A worktree per write dispatch.** This replaces the project-wide write serialization. "One writer per worktree" becomes the thing that allows N writers instead of the thing that limits them to one.
2. **A deterministic merge queue.** Rebase, gate the *rebased* tree, ff-only, persist evidence, sync features. This replaces the landing prose.
3. **`scheduleBatch` eligibility inside `gtdStrategy`.** A dependency counts as met only once it is *integrated*, and file overlap adds serialization.
4. **`/sp:dev-runall --mode parallel` becomes a thin client.** It authorizes the set, then follows receipts. The two prose references for worktree setup and landing are deleted.

No new FSM (ADR-022), no new transport (the inbox stays the only one, ADR-143), no change to `task-pipeline.yaml`. Each task stays one pipeline run that one coder member drives end to end.

## 1. Objective and outcome

**Goal:** an operator marks a set of tasks. Spur runs them on several coding agents at once (local Claude, Codex or Pi members, attached sessions, remote A2A members) and lands each one on the base branch with a passing gate receipt. The orchestration mechanics never pass through LLM context.

**Done when:**

- A fixture batch with 3 independent tasks, 1 dependency chain and 1 file overlap runs on 2 coder members.
- The E2E receipt shows overlapping execution windows for the independent tasks.
- The receipt shows strict ordering for the chain and the overlapping pair.
- Every landing is ff-only on a gated tree, and the run leaves no orphan worktree.
- The parallel path in `/sp:dev-runall` has no git commands left in skill prose.
- Wall time for the batch, measured on the existing `fleet-e2e --perf` lane, is at most 0.6× the serial-fleet baseline.

## 2. Review findings (by severity)

### High

- **H1. The fleet is serial by construction.** One in-flight keyed dispatch holds every other candidate (`packages/app/src/services/strategy-runtime.ts:281-284`). The write slot is one `'write'` claim per project path (`packages/app/src/services/write-slot-service.ts:70,126`). With N coder members declared, N−1 sit idle, so the "fleet" adds availability but no throughput.
- **H2. Fleet writes have no isolation or integration stage.** Members run `/sp:dev-run <wbs> --auto` against the project tree (`strategy-runtime.ts`, the dispatch body). Nothing creates a branch, gates a merge result or lands work. You cannot lift H1 safely until this exists.
- **H3. Worktree lifecycle is LLM-executed.** `execution-batch.md`, `execution-parallel-isolation.md`, `execution-worktree-setup.md` and `execution-worktree-landing.md` add up to 1,807 lines. No production code runs `git worktree add`; the only matches are in tests.
  - This conflicts with ADR-140 §1 and §6: "engine-owned leases … not driver prose".
  - It repeats the overhead ADR-140 measured: 32% of run time went to the driver.
- **H4. Two schedulers with different correctness rules.** `gtdStrategy` treats a dependency as met once it is *done* (`firstBlockingPrerequisite`). ADR-127 requires it to be *integrated*. `scheduleBatch` (`packages/app/src/workflow/plan-projection.ts:418`) has the overlap edges; the fleet does not. Once fleet concurrency is above 1, a dependent task could start against a base that lacks its prerequisite.

### Medium

- **M1. Task corpus visibility once work moves into worktrees.** A member flips task status in its own branch, so the base tree sees no `wip` or `done` until integration. The strategy must treat "dispatched, not integrated" as in-flight using `dispatchAttempts`, which already exist, and never using the corpus status. Get this wrong and the same task is dispatched twice.
- **M2. A2A write results stop at a branch name.** A remote fenced member returns `metadata.remoteBranch`; Spur records it and never fetches it (ADR-148 amendment 1337, `packages/app/src/services/a2a-member-transport.ts:271`). So a remote writer cannot complete an orchestrated task today.
- **M3. Allocation is role-blind past `coder`.** Allocation accepts only `role: coder` or the `assignee` field (`strategy-runtime.ts:287-292`). This is fine for v1 because reviewer routing belongs inside the pipeline (see §4.4), but it is undocumented as a choice.
- **M4. The gate is host-wide.** ADR-140 §6 serializes full gates host-wide (task 1127). Concurrent implementers will queue on the gate, so the gain comes from overlapping the implement phase, not the gate phase. Size the throughput expectation accordingly; this is why the target is 0.6×, not 1/N.

### Low

- **L1.** `persistWorktreeRuns` and `withWorktreeRunLease` exist in code but only the skill calls them. They are the right primitives to reuse.
- **L2.** `docs/plans/2026-06-25-feature-orchestration-layer.md` (proposed, June) overlaps this plan's goal. Mark it superseded.

## 3. Premises and dependencies

- **Verified:**
  - Fleet dispatch, receipts, fencing (`ownerEpoch`, `strategyVersion`), warm turns, attached occupants and two-install A2A write dispatch are all shipped (ADR-145, 146, 148; task 1337).
  - `task-pipeline.yaml` v9 is stable.
- **Verified:**
  - `withWorktreeRunLease` already leases a `'worktree'` slot for each worktree realpath during `task-pipeline` runs (`packages/app/src/services/workflow-worktree-lease.ts:23-30`).
  - `scheduleBatch` already computes waves and overlap edges.
- **Assumption, unverified:**
  - Members run inside the working directory they are dispatched with.
  - Attached sessions (ADR-146) cannot change directory and therefore cannot take worktree write work. They would stay limited to read and review turns.
  - Verify this against `attached-turn-dispatch.ts` in P1.
- **Assumption:** the host-wide gate lock (M4) stays. Raising gate parallelism is out of scope.
- **Operator decisions:** Q1–Q5 decided 2026-11-15 (§6).

## 4. Target design

### 4.1 Kernel: one scheduling owner, N write lanes

`StrategyRuntime.tick` stays the only scheduler: one fenced owner, serialized ticks (G74). Changes:

- Replace the global hold at `strategy-runtime.ts:281` with **lane admission**. A candidate is admitted when all of these hold:
  - Its prerequisites are **integrated**: the dependency's landing receipt exists, not merely `status: done`.
  - It shares no declared file with any in-flight candidate. Reuse the `scheduleBatch` overlap rule rather than reimplementing it.
  - Writer lanes in use are fewer than `maxWriters`, and an idle coder member exists.
- `WriteSlotService` keys the `'write'` claim by **worktree realpath**, not project path. Its docstring already says "one write slot per worktree in v1"; today a project has exactly one worktree, so in practice this means minting new worktrees. The `ownerEpoch` and `strategyVersion` fencing does not change.
- New hold reasons, which form a closed set:
  - `awaiting-integration`: a prerequisite is done but has not landed.
  - `file-overlap`: names the conflicting in-flight wbs.
  - `writer-cap`.
  - `integration-conflict`.

### 4.2 Worktree lane service (code, replaces setup prose)

`packages/app/src/services/worktree-lane-service.ts` (new):

- `open(wbs, attempt)` → `git worktree add -b sp/run-<wbs>-<attempt> <path> <baseTip>`. The path sits under a configured root, defaulting to `../<repo>.spur-lanes/`. Then it bootstraps `.spur/` and takes the lease. It is idempotent on `(wbs, attempt)`.
- `retain(lane, reason)` and `dispose(lane)`. A lane is disposed only after a landing receipt; on failure or conflict it is retained.
- Startup `reconcile()`: compare the claim rows with `git worktree list --porcelain`. Release dead leases, prune orphan lanes that never produced a commit, and flag the rest as retained.

The dispatch body is unchanged (`/sp:dev-run <wbs> --auto`). The `cwd` is now the lane. The pipeline's existing `withWorktreeRunLease` and `deferFeatureSync` then apply as they already do for linked worktrees.

### 4.3 Integration queue (code, replaces landing prose)

This is a serialized consumer: an `'integrate'` claim on the base repo, driven by the tick, not a new daemon. Per landed-candidate receipt:

1. `git rebase <baseTip>` in the lane. On conflict: abort, retain the lane, hold with `integration-conflict`, emit an event. **There is no auto-resolve** (ADR-127).
2. **Gate the rebased tree** if its tree hash differs from the gated receipt (ADR-140 §7). If the base did not move, the existing receipt is reused at no cost. This is the merge-queue invariant: test what you land, not what you branched from.
3. `git merge --ff-only` into the base, then `persistWorktreeRuns` (run rows and evidence) back to the base `.spur`.
4. Emit the landing receipt (`fleet.task.integrated`). Waiting dependents are now eligible.
5. After the last integration that touches a feature, run feature sync once (ADR-127, ADR-119).
6. `dispose(lane)`.

Not in v1: speculative or batched merge queues (bors and Zuul style, where N stacked candidates are gated together and the queue bisects on failure). Add one only if the receipts show the per-candidate re-gate dominating wall time.

### 4.4 Roles: the coder drives the pipeline; review routes by role inside it

Two options were weighed.

**Rejected:** the orchestrator splits stages across members, with a coder for implement and a reviewer member for review. That is a second FSM over `task-pipeline.yaml`'s states and violates ADR-022 and ADR-140 §1.

**Recommended:**

- One coder member owns the whole pipeline run in its lane.
- The pipeline's `review` `agent.run` (`role: reviewer`) resolves to a fleet reviewer member when one is declared, using the existing ADR-126 and ADR-148 dispatch-by-name and role path.
- The distinct-executor rule for P0 and P1 is then met by construction.
- The reviewer reads the lane (read-only work), so remote A2A reviewers need no write fencing.

### 4.5 Remote writers (A2A)

`remoteBranch` becomes an integration-queue input:

- `git fetch <remote> <branch>` into `sp/remote-<wbs>-<attempt>`.
- Then the same steps 1–6 as a local lane.
- The remote has already fenced its own tree (`urn:spur:write-fencing:v1`). Spur's gate on the rebased tree is the trust boundary, so a remote's self-reported pass is never accepted (ADR-138).
- Remote config (which remote, and fetch credentials) comes from the operator's git config. Spur stores no credentials.

### 4.6 Front door

`/sp:dev-runall --mode parallel` changes to:

1. Resolve and freeze the set.
2. Run `spur task batch-plan order --json` for preview and cycle refusal.
3. Tag the set `fleet:auto` through `spur task`.
4. Ensure a tick host (Q2).
5. Follow `system_events` and receipts until the set is terminal, then render the existing batch report.

`--mode sequential` stays as it is, as the no-fleet path. The skill references shrink to the driver loop.

### 4.7 Failure catalogue (each one needs an E2E case before code; per AGENTS.md)

| # | Failure | Required behaviour |
| --- | --- | --- |
| F1 | Crash after `worktree add`, before dispatch | `reconcile()` reuses the lane for the same `(wbs, attempt)`; no second lane |
| F2 | Member dies mid-turn (outcome-unknown) | Lane retained, no re-dispatch until reconciled (ADR-126 A4) |
| F3 | Two ticks race to admit overlapping files | The fenced single owner plus the overlap check inside the same tick; the second is held `file-overlap` |
| F4 | Base moves between gate and land | Tree hash differs → re-gate before ff-only |
| F5 | ff-only refused (base moved during the gate) | Loop back to rebase; bounded by `MAX_DISPATCH_ATTEMPTS` semantics |
| F6 | Rebase conflict | Abort, retain, `integration-conflict`, operator decision |
| F7 | Crash mid-rebase or mid-merge | `reconcile()` detects `.git/rebase-merge` in the lane, aborts, re-queues; the base is never left half-merged because ff-only is atomic |
| F8 | Dependent admitted before prerequisite landed | Impossible: admission reads landing receipts, not corpus status (H4, M1) |
| F9 | Corpus status read from the base tree shows `todo` for a dispatched task | Ignored; `dispatchAttempts` is authoritative (M1) |
| F10 | Disk or worktree exhaustion | `writer-cap` plus an explicit `open()` failure → `not-started`, re-dispatchable |
| F11 | Remote branch missing or fetch fails | `not-started` on the integration step; a writing remote turn is never replayed |
| F12 | Gate flake on the rebased tree | Normal gate remediation inside a fresh pipeline `--continue` in the same lane |

## 5. Execution sequence

Each phase is one feature-scoped slice with tasks created through `spur task` after approval. Every phase ends on an E2E proof artifact under `docs/reports/`.

1. **P0. Decide and record (docs only).**
   - Answer Q1–Q5.
   - Write ADR-149: "The fleet runtime is the one orchestration kernel; write dispatch is worktree-isolated and lands through a gated queue". It amends ADR-127 (the orchestrator moves from skill to code) and G71 R1.
   - Write the design satellite `docs/design/fleet-orchestration-lanes.md` with §4.1–4.7 as its contract.
   - Mark `2026-06-25-feature-orchestration-layer.md` superseded.
2. **P1. Lanes + N writers (depends on P0).**
   - `WorktreeLaneService`.
   - Write slot keyed per worktree.
   - Lane admission replaces the global hold.
   - `maxWriters` with default 1, so behaviour is unchanged until it is set.
   - Verify the attached-occupant cwd premise.
   - **E2E:** 3 independent tasks on 2 coders produce overlapping `fleet.dispatch` windows. Cases F1, F2, F3 and F10 pass.
   - **Artifact:** `docs/reports/fleet-lanes-p1.json`.
3. **P2. Integration queue + integrated-dependency admission (depends on P1).**
   - **E2E:** a diamond dependency, a file-overlap pair and an injected conflict. Assert landing order, ff-only history, the retained conflicting lane, and no orphans. Cases F4–F9 and F12 pass.
4. **P3. Thin `dev-runall` (depends on P2; can overlap P4).**
   - Rewrite the parallel section of `execution-batch.md`.
   - Delete `execution-worktree-setup.md`, `execution-worktree-landing.md` and `execution-parallel-isolation.md`, leaving one pointer.
   - **E2E:** `/sp:dev-runall --mode parallel` on the P2 fixture produces the same batch report built from receipts.
   - Measure the prose line delta.
5. **P4. Reviewer member routing (depends on P1).**
   - P0 and P1 reviews resolve to a declared reviewer member.
   - **E2E:** the receipt shows coder ≠ reviewer, and the reviewer turn is fresh (ADR-145).
6. **P5. Remote writer landing (depends on P2).**
   - `remoteBranch` feeds the integration queue.
   - **E2E:** extend the two-install fixture from 1337, where a remote fenced member's branch lands through the gate. Case F11 passes.
7. **P6. Measure (depends on P3).**
   - Add the `fleet-e2e --perf` batch lane, comparing serial-fleet, parallel-fleet and the old skill path.
   - Claim gains only from that receipt (ADR-145).

P3 and P4 can proceed in parallel after their prerequisites. P5 is optional for the local-only milestone.

## 6. Open questions (decide in P0)

**Operator decisions (2026-11-15):**

- Q1: per-worktree lanes.
- Q2: foreground tick loop.
- Q3: retire after parity.
- Q4: re-gate only when the tree changed.

Q5 (2026-11-15): config keys `agent.fleet.maxWriters` and `agent.fleet.laneRoot` approved; no status verb. P0 records: ADR-149, `docs/design/fleet-orchestration-lanes.md`, feature G76.

- **Q1. Writer concurrency model.**
  - **Recommended:** per-worktree lanes with `maxWriters` (default 1, operator raises it).
  - **Alternative:** keep serial writers and parallelize only review and read turns. This is lower risk but gives little throughput.
- **Q2. Who hosts the tick when `spur serve` is off?** ADR-148 made serve an accelerator.
  - **Recommended:** `dev-runall` runs the same `StrategyRuntime.tick` in a foreground loop, using the same fencing as serve.
  - **Alternative:** require serve for parallel runs.
- **Q3. Retire the in-session parallel path?**
  - **Recommended:** yes, after P3 proves parity.
  - `--mode parallel` without a declared fleet would then fall back to ephemeral subprocess members (`executor` = configured agents) in lanes, so the fleet config stays optional.
- **Q4. Gate policy at landing.**
  - **Recommended:** re-gate only when the rebased tree hash differs.
  - **Alternative:** always re-gate, which is safer but serial on the host-wide gate.
  - **Alternative:** a speculative batched queue (deferred).
- **Q5. Public surface.**
  - The plan needs **no new noun or verb**: tags, `batch-plan order` and existing events are enough.
  - It adds config keys `agent.fleet.maxWriters` and `agent.fleet.laneRoot`, which need consent under ADR-051.
  - Optionally, a read-only `spur task batch-plan status` could replace event tailing in the skill. Is it wanted?

## 7. Simplification ledger

- **Delete:** about 1,100 lines across the three worktree and isolation references, plus the parallel half of `execution-batch.md`.
- **Delete:** the global `dispatch-in-flight` hold, which is replaced by lane admission.
- **Reuse, not rewrite:**
  - `scheduleBatch` overlap rule
  - `withWorktreeRunLease`
  - `persistWorktreeRuns`
  - ADR-140 tree-hash receipts
  - `FleetDispatcher`
  - The A2A fencing check
- **Not added:**
  - A new FSM, transport or daemon
  - Orchestrator stage splitting
  - LLM judgment in the scheduling loop (the orchestrator member keeps conversation and escalation only)
  - Auto conflict resolution
  - A speculative merge queue

## 8. Risks and verification

- **Throughput is capped by the host-wide gate (M4).**
  - **Decision point:** if the P6 measurement shows the gate's share above 50%, open a separate gate-sharding decision. Do not weaken the gate.
- **The attached-occupant cwd premise fails.**
  - **Fallback:** attached sessions take review and read turns only, and writes go to supervised members. Scope shrinks; no redesign is needed.
- **Corpus divergence across lanes (M1).** Each task writes only its own task file plus deferred feature sync, which makes the regions disjoint by construction. P2 asserts that there are zero corpus conflicts across the fixture.
- **Verification** is the per-phase E2E artifact plus `bun run spur-check-feature` once per feature (ADR-119). Unit tests are added only where §4.7 names an isolated failure.
