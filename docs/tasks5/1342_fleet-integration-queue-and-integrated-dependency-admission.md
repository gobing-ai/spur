---
schema_version: 1
name: Fleet integration queue and integrated-dependency admission
status: todo
template: feature-impl
created_at: 2026-11-16T01:11:43.595Z
updated_at: "2026-11-16T01:21:04.241Z"
feature_id: G76

dependencies: ["1341"]
priority: P1
estimate_hours: 10
---

## 1342. Fleet integration queue and integrated-dependency admission

### Background

Implements: R2 — A dependent task waits for integration, not completion; R4 — Landing gates the rebased tree and fast-forwards; R5 — A conflict retains the lane for the operator.

Adds the serialized, engine-owned landing path that ADR-127 assigned to skill prose: rebase, gate on tree change, fast-forward, persist evidence, sync features.

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).

### Requirements

- [ ] R1 — A serialized integration consumer under an `integrate` claim rebases each successful lane onto the base tip and gates the rebased tree unless its tree hash matches a PASS receipt.
- [ ] R2 — The base ref advances only by `--ff-only`; `persistWorktreeRuns` copies run evidence back; each touched feature syncs once after its last landing; the lane is then disposed.
- [ ] R3 — A rebase conflict aborts, retains lane and branch, and holds the task with `integration-conflict`; no automatic resolution.
- [ ] R4 — A candidate whose prerequisite is done but not landed holds with `awaiting-integration`; admission reads `fleet.task.integrated`, never corpus status.
- [ ] R5 — Lane and landing events (`fleet.lane.opened|retained|disposed`, `fleet.task.integrated`) are written with their state change.

### Acceptance Criteria

- [ ] AC1 — A dependent task waits for integration, not completion
- [ ] AC2 — Landing gates the rebased tree and fast-forwards
- [ ] AC3 — A conflict retains the lane for the operator

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
| Tick wiring | `StrategyRuntime.tick` (`strategy-runtime.ts:512`) | after `observe`-settled successes, call `queue.drainOne` **once per tick** before selecting |

**Queue order.** Successful attempts with no `fleet.task.integrated` event, oldest receipt first. The queue is derived from receipts plus events each tick, with no persisted queue table.

**Landing algorithm (inside the `'integrate'` claim; one lane per call).**
1. In the lane: `git rebase <base-branch>`. A non-zero exit runs `git rebase --abort`, emits `fleet.lane.retained{reason:'integration-conflict'}` and returns `conflict`.
2. Gate: run the existing gate for the wbs in the lane. Its receipt is already keyed by the gate's own git tree hash (`quality-gate.ts:30-38`, `captureGateGitTree` `:1488`). An unchanged tree reuses the PASS receipt, which is "re-gate only if the tree changed" (operator Q4). Add no second hash mechanism. A FAIL retains the lane and returns `gate-failed`.
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:04.241Z backlog → todo (system)

