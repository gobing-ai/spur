---
kind: design
title: Fleet orchestration lanes — worktree-isolated writers and a gated merge queue
status: accepted
created_at: 2026-11-15
updated_at: 2026-11-15
related:
  - docs/00_ADR.md#adr-149-the-fleet-runtime-is-the-one-orchestration-kernel-write-dispatch-is-worktree-isolated-and-lands-through-a-gated-queue
  - docs/features/G76_parallel-fleet-orchestration-worktree-lanes-and-a-gated-merge-queue.md
  - docs/plans/2026-11-15-multi-agent-task-orchestration.md
  - docs/design/fleet-task-turn-execution.md
  - docs/design/a2a-member-transport.md
tags: [fleet, orchestration, worktree, merge-queue]
---

# Fleet orchestration lanes — worktree-isolated writers and a gated merge queue

## 1. Issue and scope

**Status:** accepted design (ADR-149). Nothing in this document is implemented yet. Feature G76 owns delivery.

Today the fleet runs one writer at a time, and parallel work exists only in the skill-driven batch.

- **The fleet is serial.** One in-flight keyed dispatch holds every other candidate (`packages/app/src/services/strategy-runtime.ts:281-284`), and there is one `'write'` claim per project path (`packages/app/src/services/write-slot-service.ts:70,126`).
- **Fleet writes are not isolated.** Members write the project tree, and nothing integrates their work.
- **Parallel work lives in skill prose.** `/sp:dev-runall --mode parallel` isolates and lands tasks through skill references (`plugins/sp/skills/spur-dev/references/execution-*.md`) that the LLM driver executes.

This design defines the following, per ADR-149:

- lane admission
- the lane lifecycle
- the integration queue
- crash reconciliation
- the client contract for `dev-runall`

The contract for `task-pipeline.yaml`, the inbox and A2A wire behaviour does not change.

## 2. Context and constraints

- **Single fenced owner.** The scheduling tick has exactly one fenced owner (G74, [fleet task turns](fleet-task-turn-execution.md)), and fencing uses `ownerEpoch` and `strategyVersion`.
- **Done is a receipt.** Completion is the validated receipt, not transport acceptance. An outcome-unknown writing turn is never replayed (ADR-126 A4, ADR-145).
- **Worktree run leases already exist.** `withWorktreeRunLease` leases a `'worktree'` claim for each linked-worktree realpath during `task-pipeline` runs (`packages/app/src/services/workflow-worktree-lease.ts:23-30`).
- **Evidence copy-back already exists.** `persistWorktreeRuns` copies run rows and evidence back to the invoking tree (`packages/app/src/services/worktree-persist.ts`).
- **Overlap edges already exist.** `scheduleBatch` derives file-overlap serialization edges (`packages/app/src/workflow/plan-projection.ts:418`).
- **Gates serialize host-wide.** A host-wide lock serializes full gates (ADR-140 §6), so concurrency gains come from overlapping implementation work.
- **Lane branches stay out of generated regions.** A lane branch writes its own task file and never writes generated corpus regions. Feature sync is deferred to the base (ADR-127, ADR-119).

## 3. Solution

```text
tick (fenced owner)
  ├─ select:   gtdStrategy candidates (fleet:auto, todo|wip, priority→wbs)
  ├─ admit:    integrated prerequisites ∧ no declared-file overlap ∧ lane free ∧ idle coder
  ├─ open:     WorktreeLaneService.open(wbs, attempt) → lane path, write slot keyed by lane realpath
  ├─ dispatch: FleetDispatcher.enqueue(/sp:dev-run <wbs> --auto[ --continue], cwd = lane)
  ├─ observe:  terminal receipt → success ⇒ enqueue integration; failure ⇒ retain lane
  └─ integrate (serialized, 'integrate' claim on base repo):
       rebase → gate if tree hash changed → ff-only → persistWorktreeRuns → feature sync → dispose
```

- **Admission** replaces the global `dispatch-in-flight` hold.
  - *In flight* means a dispatch attempt that has no terminal receipt, or a successful attempt that has no landing receipt.
  - The base tree's task status is never consulted for in-flight state, because a lane's status edits stay invisible until that lane lands.
- **`WorktreeLaneService`** (`packages/app`) is the only code that runs `git worktree` for orchestration.
  - Branch: `sp/run-<wbs>-<attempt>`.
  - Path: `<laneRoot>/<repo>-<wbs>-<attempt>`.
  - It bootstraps `.spur/`, then takes the lane write slot.
- **Integration queue.** The tick drives a serialized consumer. It is not a daemon.
  - A remote A2A `remoteBranch` result is fetched into `sp/remote-<wbs>-<attempt>` and then follows the same path as a local lane.
- **Roles.** The coder member drives the whole pipeline run.
  - The pipeline's `role: reviewer` stage resolves to a declared reviewer member, using the existing ADR-126/148 role path, in a fresh conversation.
  - Without a reviewer member, the current executor resolution applies.
- **Tick host.** This is `spur self serve` when running. Otherwise `/sp:dev-runall --mode parallel` runs the same tick in a foreground loop, under the same fencing. A second host loses the fence and exits.

## 4. Contract and compatibility

### 4.1 Config (project layer, `agent.fleet`)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `maxWriters` | integer ≥ 1 | `1` | Upper bound on concurrent write lanes. `1` keeps today's serial behaviour |
| `laneRoot` | path | `../<repo-name>.spur-lanes` | Parent directory for lanes, resolved against the project path. It must lie outside the repository tree |

Validation is by Zod in `packages/config`. A value outside these bounds fails config load and names the key. The operator approved both keys on 2026-11-15. No CLI noun or verb is added.

### 4.2 Hold reasons (closed set; additions to `strategy-runtime.ts`)

| Reason | Detail carried |
| --- | --- |
| `awaiting-integration` | The prerequisite wbs is done but not landed |
| `file-overlap` | The in-flight wbs and the shared path |
| `writer-cap` | Lanes in use / `maxWriters` |
| `integration-conflict` | Lane path and branch, both retained |

`dispatch-in-flight` stays only for the candidate's own unterminated attempt.

### 4.3 Events (system events, written in the same transaction as their state change)

| Event | When |
| --- | --- |
| `fleet.lane.opened` | A lane is created, or reused by reconciliation |
| `fleet.lane.retained` | A failure, conflict or outcome-unknown result leaves a lane in place |
| `fleet.lane.disposed` | A lane is removed after landing |
| `fleet.task.integrated` | The landing receipt: wbs, attempt, base before and after, tree hash, gate receipt id |

These events, together with the existing dispatch and receipt events, are all a client needs to render a batch report.

### 4.4 Invariants

1. Each attempt has at most one lane, and each lane has at most one writer.
2. The base ref advances only by fast-forward to a tree that has a PASS gate receipt.
3. A dependent is dispatched only after its prerequisite's `fleet.task.integrated` event.
4. No automatic conflict resolution, and no replay of an outcome-unknown writing turn.
5. A lane is disposed only after a landing receipt. Every other terminal outcome retains it.

### 4.5 Crash reconciliation (on tick-host start)

Reconciliation compares claim rows, dispatch attempts and `git worktree list --porcelain`:

- **Lane exists, attempt has no receipt:** reuse the lane, and do not open a second one.
- **Lane is mid-rebase or mid-merge:** abort the operation, then re-queue integration.
- **Lane exists with no attempt row and no commits:** prune it.
- **Claim held by a dead holder:** the claim TTL expires, then the claim is released through the existing claim fencing.

### 4.6 Compatibility

- When `maxWriters` is 1 and the lane service is enabled, fleet behaviour changes in two ways:
  - Writes happen in a lane, not in the project tree.
  - A landing step is added.
- Lane mode is on only when `agent.fleet.maxWriters` is present. An absent key keeps today's in-tree path unchanged; `maxWriters: 1` means one lane (task 1341 refinement, 2026-11-15).
- `/sp:dev-runall --mode sequential` is unchanged.
- The parallel-mode skill references are retired only after parity is proved (G76 R7).

## 5. Tradeoffs and open questions

- **Re-gate only on tree change.** This keeps landings cheap when the base has not moved. A bors- or Zuul-style speculative queue is deferred until receipts show that re-gating dominates (ADR-149).
- **Throughput.** The host-wide gate caps throughput, and the target is ≤ 0.6× serial-fleet wall time (G76 R10).
- **Attached occupants (ADR-146)** cannot work in a lane `cwd`: a bound occupant's workspace is fixed at bind time (`packages/app/src/services/fleet-guest-service.ts:704-709`). In lane mode they take only review and read turns (task 1341 refinement).
- **Lane cwd carrier.** The member derives the lane path from the request key `fleet:task:<wbs>:<attempt>` and the project config. There is no inbox or wire change. Remote members land through fetched branches (task 1345).
- **Feature sync.** Running sync after each feature's last landing, rather than once at the end of the batch, could interleave with later lanes. Those lanes never write generated regions, so ordering is safe. The R6 fixture asserts this.

## As built (tasks 1341–1346)

| Element | Where it landed |
| --- | --- |
| `maxWriters` / `laneRoot` config, lane mode gating | `packages/config/src/index.ts` `AgentFleetSchema`; `StrategyRuntime.laneMode` reads the declared section |
| Lane lifecycle (`open`/`retain`/`dispose`/`list`/`reconcile`, plus `open(wbs, attempt, { branch })` for a fetched remote branch) | `packages/app/src/services/worktree-lane-service.ts` |
| Admission (`writer-cap`, `file-overlap`, `awaiting-integration`, `integration-conflict`) | `packages/app/src/services/strategy-runtime.ts` (`gtdStrategy.select`) |
| Serialized landing (`integrate` claim, rebase → gate → `--ff-only` → persist → `fleet.task.integrated` → dispose; `not-started` for an unfetchable remote) | `packages/app/src/services/fleet-integration-queue.ts` |
| Foreground batch client, fleet-less refusal, ledger report | `packages/app/src/services/fleet-foreground-loop.ts` |
| Reviewer routing in the same lane (`cwd` in the work-item envelope + `{coder, reviewer, session}` receipt) | `packages/app/src/workflow/fleet-work-item.ts` |
| Throughput measurement (`--perf --modes batch`, receipt `docs/reports/fleet-perf-batch-<date>.json`) | `scripts/commands/fleet-e2e-batch-perf.ts` |

Two behaviours worth reading before changing this area: the queue is derived from receipts plus
`fleet.*` events each tick (no queue table), and a lane that vanished instead of landing still holds
its dependents, because the attempt's receipt — not the worktree — is the admission evidence.
