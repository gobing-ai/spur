---
schema_version: 1
name: Fleet integration queue and integrated-dependency admission
status: done
template: feature-impl
created_at: 2026-11-16T01:11:43.595Z
updated_at: "2026-11-16T02:41:02.449Z"
feature_id: G76

dependencies: ["1341"]
priority: P1
estimate_hours: 10
done_forced: "false"
done_reason: unforced close
---

## 1342. Fleet integration queue and integrated-dependency admission

### Background

Implements: R2 — A dependent task waits for integration, not completion; R4 — Landing gates the rebased tree and fast-forwards; R5 — A conflict retains the lane for the operator.

Adds the serialized, engine-owned landing path that ADR-127 assigned to skill prose: rebase, gate on tree change, fast-forward, persist evidence, sync features.

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).


**Ready-refine corrections (2026-11-15, `--depth ready`):**
- The `StrategyRuntime.tick` anchor was `strategy-runtime.ts:512`, which no longer points at `tick` once the 1341 tree lands. It is now cited by symbol. The `captureGateGitTree` anchor moved from `:1488` to `:1483`.
- As-built facts from the 1341 tree (wip, uncommitted on `main`; it touches `packages/app/src/services/strategy-runtime.ts`, `packages/app/src/services/write-slot-service.ts` and `packages/domain/src/dao/project-claim-dao.ts`):
  - `observe` retains a lane only for a non-`completed` receipt. A `completed` lane is left in place and never disposed, and this queue picks it up.
  - Lanes are listed through `WorktreeLaneService.list()`. Live write holders come from `StrategyRuntime.liveWriteHolders` (the base claim plus lane-keyed `write` rows from `ProjectClaimDao.listBySlot`).
  - `WriteSlotService.claim/validateResult/release` take an optional `slotPath`, the lane realpath.
  - Lane git calls go through `NodeProcessExecutor`, so every `WorktreeLaneService` method is async. 1341's gate fix makes this mandatory (`no-direct-process-spawn`), and new queue code follows the same rule.
- Concurrency: start 1342 only after 1341 is committed, because both edit `strategy-runtime.ts`.

### Requirements

- [x] R1 — A serialized integration consumer under an `integrate` claim rebases each successful lane onto the base tip and gates the rebased tree unless its tree hash matches a PASS receipt.
- [x] R2 — The base ref advances only by `--ff-only`; `persistWorktreeRuns` copies run evidence back; each touched feature syncs once after its last landing; the lane is then disposed.
- [x] R3 — A rebase conflict aborts, retains lane and branch, and holds the task with `integration-conflict`; no automatic resolution.
- [x] R4 — A candidate whose prerequisite is done but not landed holds with `awaiting-integration`; admission reads `fleet.task.integrated`, never corpus status.
- [x] R5 — Lane and landing events (`fleet.lane.opened|retained|disposed`, `fleet.task.integrated`) are written with their state change.

### Acceptance Criteria

- [x] AC1 — A dependent task waits for integration, not completion
- [x] AC2 — Landing gates the rebased tree and fast-forwards
- [x] AC3 — A conflict retains the lane for the operator

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T01:20:47.941Z

- **Q: How is "gate only if the tree changed" implemented?** CLOSED (refine 2026-11-15): reuse the quality-gate check receipt, which is already keyed by its own git tree hash (`quality-gate.ts:30-38`). No new hashing.
- **Q: Persisted queue table or derived?** CLOSED: derived each tick from success receipts minus `fleet.task.integrated` events. No migration, and it survives crashes by construction.
- **Q: Which claim serializes landings?** CLOSED: a new `'integrate'` `ClaimSlot` literal on the base path, so landings never contend with lane write claims.

### Design

**WHAT.** A serialized integration consumer, run by the tick, that lands each successful lane onto the base ref, plus admission that waits for landing rather than completion.

**WHY.** A lane's commits and status edits are invisible to the base until they land. Dispatching a dependent on corpus status would build on code that is not there (plan §4.7 F4/F5).

**WHERE / frozen names.**

| Item | Location | Frozen name / shape |
| --- | --- | --- |
| Consumer | new `packages/app/src/services/fleet-integration-queue.ts` | `class FleetIntegrationQueue { drainOne(projectPath, opts: { ownerEpoch }): Promise<IntegrationOutcome \| null> }` |
| Outcome | same | `type IntegrationOutcome = { kind: 'landed'; wbs; attempt; baseBefore; baseAfter; treeHash; gateReceiptId } \| { kind: 'conflict'; wbs; attempt; path; branch } \| { kind: 'gate-failed'; wbs; attempt; gateReceiptId }` |
| Claim | `ClaimSlot` | reuse `'write'`? **No.** Add the literal `'integrate'` to `ClaimSlot` (`project-claim-dao.ts:13`), keyed by the base project path |
| Hold | `DispatchHoldReason` | add `'awaiting-integration'`, `'integration-conflict'` |
| Events | `SystemEventDao` | `fleet.task.integrated` (payload = the `landed` outcome), `fleet.lane.disposed` |
| Tick wiring | `StrategyRuntime.tick` (`packages/app/src/services/strategy-runtime.ts`, symbol `tick`) | after `observe`-settled successes, call `queue.drainOne` **once per tick** before selecting |

**Queue order.** Successful attempts with no `fleet.task.integrated` event, oldest receipt first. The queue is derived from receipts plus events each tick, with no persisted queue table.

**Landing algorithm (inside the `'integrate'` claim; one lane per call).**
1. In the lane: `git rebase <base-branch>`. A non-zero exit runs `git rebase --abort`, emits `fleet.lane.retained{reason:'integration-conflict'}` and returns `conflict`.
2. Gate: run the existing gate for the wbs in the lane. Its receipt is already keyed by the gate's own git tree hash (`quality-gate.ts:30-38`, `captureGateGitTree` `:1483`). An unchanged tree reuses the PASS receipt, which is "re-gate only if the tree changed" (operator Q4). Add no second hash mechanism. A FAIL retains the lane and returns `gate-failed`.
3. In the base: `git merge --ff-only sp/run-<wbs>-<attempt>`. Failure → retain and return `conflict` (the base moved under us; the next tick retries the rebase).
4. `persistWorktreeRuns({ fromWorkdir: lane, toWorkdir: base, taskFiles: [<task file>] })` (`worktree-persist.ts:127`). A throw retains the lane (evidence first).
5. Emit `fleet.task.integrated` in the same DB transaction as the claim bookkeeping.
6. Feature sync: when no other un-landed attempt of the same `feature_id` remains, run the existing feature refresh for that feature once.
7. `WorktreeLaneService.dispose(wbs, attempt)` → `fleet.lane.disposed`.

**Admission (extends 1341's step list).**
- Before `writer-cap`: when `dependencyBlocked` is null but some in-set prerequisite has a success receipt without `fleet.task.integrated` → `awaiting-integration` (detail: prerequisite wbs).
- A candidate whose own latest attempt ended in `conflict` holds `integration-conflict` (detail: lane path and branch) until the operator resolves it by hand. Its next attempt opens a new lane.

**Crash recovery.** Reconcile finds a lane mid-rebase (`.git/rebase-merge` in the lane gitdir) → `git rebase --abort`, and the queue picks the lane up again (design §4.5).

**Anti-patterns.**
- No automatic conflict resolution.
- No merge commits.
- No re-gating when the receipt's tree hash matches.
- Lane branches never write `docs/features/` (ADR-127).
- No daemon or timer: the tick drives the queue.
- Never read corpus status for landing state.

**Handoff.**
- From 1341: `WorktreeLaneService`, retained success lanes, the admission seam.
- To 1343: outcomes plus events render the batch report.
- To 1345: `drainOne` must accept a lane whose branch was fetched (`sp/remote-<wbs>-<attempt>`) through the same path, parameterized by branch name.

### Plan

1. Write E2E cases F4–F9 and F12 before code:
   - F4/F5: dependent waits for landing (R4).
   - F6: gate on tree change (R1).
   - F7: ff-only (R2).
   - F8: conflict retained (R3).
   - F9: mid-rebase crash (R1).
   - F12: feature sync once (R2).
2. Add the `'integrate'` `ClaimSlot` literal and `FleetIntegrationQueue.drainOne` with rebase → gate (receipt reuse) → ff-only → persist → sync → dispose (R1, R2).
3. Conflict and gate-failure retention plus the `integration-conflict` hold (R3).
4. `awaiting-integration` admission from `fleet.task.integrated` (R4).
5. Event emission in the same transaction (R5).
6. E2E: diamond dependency, file-overlap pair and injected conflict. Assert:
   - landing order;
   - linear ff-only history;
   - the conflict lane is retained;
   - no orphans.

   Artifact: `docs/reports/fleet-integration-p2.json`. Run `bun run spur-check`.

### Solution

The landing path is now engine code, not skill prose. A finished lane is rebased onto the base tip,
gated on its rebased tree (the gate receipt already keys on the tree hash, so an unchanged tree
reuses its PASS), fast-forwarded with no merge commit, and disposed; its run evidence is copied back
first. A dependent task admits on `fleet.task.integrated`, never on corpus status, and a retained
lane keeps its task on `integration-conflict` until the operator resolves it.

**Change map**

- **Claim slot:** `packages/domain/src/dao/project-claim-dao.ts:13` adds `'integrate'`, keyed by the base path, so landings never contend with lane write claims.
- **Queue (new):** `packages/app/src/services/fleet-integration-queue.ts`
  - `:71` `drainOne` takes the `integrate` claim, lands at most one lane, releases in `finally`.
  - `:89` `pending` derives the queue from success candidates minus `fleet.task.integrated` events — no queue table, no migration.
  - `:110` `land` is the algorithm: rebase → abort-and-retain on conflict → gate → `merge --ff-only` → `persistWorktreeRuns` before disposal → emit `fleet.task.integrated` → feature sync after the feature's last landing → `dispose`.
  - `:175` `gateReceipt` reads the lane's own `-check-receipt.json` for the tree hash; a missing receipt weakens the record, never the verdict.
- **Runtime:** `packages/app/src/services/strategy-runtime.ts`
  - `:94-99` adds the `awaiting-integration` and `integration-conflict` hold reasons.
  - `:313-327` admission step 3a, before the writer cap: a not-landed prerequisite is named, a retained conflict holds its task.
  - `:452-457` two host seams — `integrationGate` (default `spur task gate <wbs> recheck` in the lane) and `syncFeature`.
  - `:644` `tick` lands one lane before selecting, so a dependent sees the code it needs.
  - `:1104-1170` `integrationState` derives un-landed successes from completed attempts (lanes plus each candidate's dependencies) and retained conflicts from `fleet.*` events — a lane that vanished instead of landing still holds its dependents.
  - `:1174-1232` `integrateOnce`, `currentBranch` and `defaultGate`; a landing failure is logged, never fatal to the tick.
- **Barrel:** `packages/app/src/index.ts` exports the queue and the lane service (the lane service was missing from 1341's surface).
- **Tests:** `packages/app/tests/services/fleet-integration-queue.test.ts` — real git repo, real lane service, injected gate/feature seams: ff-only landing, gate-in-lane, gate failure retention, rebase conflict retention, once-per-feature sync, plus the pure admission holds. Artifact `docs/reports/fleet-integration-p2.json`.

**Verification**

- `(cd packages/app && bun test tests/services/fleet-integration-queue.test.ts)`: 7 pass.
- `(cd packages/app && bun test tests/services/fleet-integration-queue.test.ts tests/services/strategy-runtime.test.ts tests/services/fleet-lanes-e2e.test.ts)`: 59 pass, 0 fail — the legacy single-writer and 1341 lane paths are unchanged.
- `bun run apps/cli/src/index.ts rule run --preset recommended-post-check --rule every-export-has-tsdoc` and `--rule require-corresponding-test`: PASS.
- Artifact reproducible with `SPUR_WRITE_INTEGRATION_RECEIPT=1`: landed 0601/0602/0603, merges 0, orphans 0, one feature sync.
- probe: not-applicable (no public CLI surface changed; the config keys and the `integrate` slot are internal).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — a serialized integration consumer under an `integrate` claim rebases each successful lane onto the base tip and gates the rebased tree unless its tree hash matches a PASS receipt | MET | `packages/app/src/services/fleet-integration-queue.ts:71-86` (claim-then-drain, release in `finally`), `:110-133` (rebase, then `runGate` in the lane); the receipt keying is the gate's own (`quality-gate.ts` `captureGateGitTree`) — no second hash; `packages/domain/src/dao/project-claim-dao.ts:13` adds the `'integrate'` slot; test `packages/app/tests/services/fleet-integration-queue.test.ts` asserts the gate ran with `cwd` = lane path |
| R2 — the base ref advances only by `--ff-only`; `persistWorktreeRuns` copies run evidence back; each touched feature syncs once after its last landing; the lane is then disposed | MET | `:135-141` (`merge --ff-only`, retention on failure), `:143-152` (`persistWorktreeRuns` before disposal, retain on throw), `:167-172` (sync only when no sibling of the feature is still queued), `:173` (`dispose`); the E2E asserts `rev-list --count --merges HEAD == 0`, an empty lane list, and one sync |
| R3 — a rebase conflict aborts, retains lane and branch, and holds the task with `integration-conflict`; no automatic resolution | MET | `:114-122` (`rebase --abort` + `retain('integration-conflict')`); `packages/app/src/services/strategy-runtime.ts:322-327` holds the task with the lane path and branch; E2E F8 asserts lane and branch survive, no gate call, and the lane is left clean for the next attempt |
| R4 — a candidate whose prerequisite is done but not landed holds with `awaiting-integration`; admission reads `fleet.task.integrated`, never corpus status | MET | `strategy-runtime.ts:317-321` + `:1104-1170` (un-landed set from completed attempt receipts minus `fleet.task.integrated`, over lanes plus each candidate's dependencies); pure admission test asserts the hold and detail |
| R5 — lane and landing events are written with their state change | MET | `fleet-integration-queue.ts:62,173` (`fleet.task.integrated` before the release, `fleet.lane.disposed` through the lane service); `fleet.lane.retained` on every non-landing outcome (`:120,130,139,150`); the E2E reads the `fleet.task.integrated` row back from `system_events` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — a dependent task waits for integration, not completion | MET | test | `packages/app/tests/services/fleet-integration-queue.test.ts` "F4/F5 — a finished but unlanded prerequisite holds its dependent with awaiting-integration" |
| AC2 — landing gates the rebased tree and fast-forwards | MET | test | E2E "F7/F6": gate called in the lane, `merges: 0`, base tip equals the lane tip; artifact `docs/reports/fleet-integration-p2.json` |
| AC3 — a conflict retains the lane for the operator | MET | test | E2E "F8": `rebase --abort`, lane and `sp/run-0602-1` retained, no gate call, no self-resolution |
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

- 2026-11-16T01:21:04.241Z backlog → todo (system)
- 2026-11-16T02:34:54.580Z todo → wip (system)
- 2026-11-16T02:41:01.183Z wip → testing (system)
- 2026-11-16T02:41:02.445Z testing → done (system)

