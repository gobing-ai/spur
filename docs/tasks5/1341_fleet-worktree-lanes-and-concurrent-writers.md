---
schema_version: 1
name: Fleet worktree lanes and concurrent writers
status: todo
template: feature-impl
created_at: 2026-11-16T01:10:54.672Z
updated_at: "2026-11-16T01:21:03.778Z"
feature_id: G76

priority: P1
estimate_hours: 10
---

## 1341. Fleet worktree lanes and concurrent writers

### Background

Implements: R1 — Independent tasks run concurrently in isolated lanes; R3 — Overlapping declared files serialize; R6 — Crash recovery leaves no orphan or duplicate lane.

Lifts the fleet from one writer per project to up to `agent.fleet.maxWriters` writers, each in its own worktree lane, replacing the global in-flight hold at `packages/app/src/services/strategy-runtime.ts:281`.

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).

**Refine corrections (2026-11-15)**

- "write slot keyed by lane realpath" → the member heartbeat keys the slot by its loop `projectPath` (`agent-loop-service.ts:38-56`), and the per-project DB is `.spur/spur.db` (`packages/config/src/index.ts:41`) → the Design pins lane claims in the **base** DB keyed by lane realpath, with the member heartbeating the lane key.
- "dispatch with cwd = lane" → the inbox message has no cwd field, and the member loop runs at `deps.cwd` (`agent-loop-service.ts:651-653`) → the cwd is derived from the request key, with no wire change.

### Requirements

- [ ] R1 — WorktreeLaneService (packages/app) opens `sp/run-<wbs>-<attempt>` lanes under `agent.fleet.laneRoot`, idempotent per (wbs, attempt), and is the only orchestration code running `git worktree`.
- [ ] R2 — The write slot is keyed by lane realpath; `agent.fleet.maxWriters` (default 1) and `agent.fleet.laneRoot` validate in packages/config (operator consent 2026-11-15).
- [ ] R3 — Lane admission replaces the global `dispatch-in-flight` hold with `writer-cap` and `file-overlap` holds (reusing the `scheduleBatch` overlap rule); dispatch attempts, not base-tree status, decide in-flight.
- [ ] R4 — Tick-host start reconciles claims, attempts and `git worktree list` (design §4.5).
- [ ] R5 — Whether attached occupants (ADR-146) can run in a lane cwd is verified and recorded in design §5.

### Acceptance Criteria

- [ ] AC1 — Independent tasks run concurrently in isolated lanes
- [ ] AC2 — Overlapping declared files serialize
- [ ] AC3 — Crash recovery leaves no orphan or duplicate lane

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T01:20:47.538Z

- **Q: Does `maxWriters: 1` keep the in-tree path (design §4.6)?** CLOSED (refine 2026-11-15): lane mode is on only when `agent.fleet.maxWriters` is **present**. An absent key keeps today's in-tree path byte-for-byte, and `1` means one lane. Why: zero behaviour change for existing operators, and no third config key (Q5 approved exactly two).
- **Q: How does the member learn the lane cwd without a wire change?** CLOSED: the lane path is derived deterministically from the request key `fleet:task:<wbs>:<attempt>` plus project config (`laneForRequestKey`). There is no inbox migration. The ceiling is that it works only for members sharing the filesystem. Remote members land through 1345.
- **Q: Where do "declared files" come from?** CLOSED: a deterministic `declaredTaskFiles` over backticked existing paths in Design and Plan. Today the dev-runall skill extracts them by LLM (`execution-batch.md:221-222`). A task declaring nothing never overlaps, and a real collision then surfaces as `integration-conflict` (1342). ponytail: regex extractor; upgrade to a frontmatter `files:` key if collisions show up in receipts.
- **Q: Can attached occupants (ADR-146) work in a lane (R5)?** CLOSED: no. A bound occupant's session belongs to a human host whose workspace is fixed at bind time. `fleet-guest-service.ts:704-709` keys the occupant on its physical cwd. In lane mode, write candidates allocate only plain members, and occupants stay eligible for review and read turns. Record this in design §5.

### Design

**WHAT.** Up to `agent.fleet.maxWriters` concurrent write dispatches, each in its own git worktree lane, admitted by the tick instead of the global in-flight hold.

**WHY.** `gtdStrategy` holds every candidate while any keyed attempt lacks a receipt (`packages/app/src/services/strategy-runtime.ts:240-243,280-283`), and `WriteSlotService` keeps one `'write'` claim per project path (`write-slot-service.ts:124-131`). ADR-149 makes the lane the isolation unit.

**WHERE / frozen names.**

| Item | Location | Frozen name / shape |
| --- | --- | --- |
| Config | `packages/config/src/index.ts` `AgentFleetSchema` (`:659`) | `maxWriters: z.number().int().min(1).optional()`, `laneRoot: z.string().min(1).optional()` |
| Lane service | new `packages/app/src/services/worktree-lane-service.ts` | `class WorktreeLaneService { open(wbs, attempt); retain(wbs, attempt, reason); dispose(wbs, attempt); reconcile(); list() }` |
| Pure helpers | same file | `laneBranch(wbs, attempt) = 'sp/run-<wbs>-<attempt>'`, `lanePath(projectPath, laneRoot, wbs, attempt) = <laneRoot>/<repo>-<wbs>-<attempt>`, `laneForRequestKey(projectPath, fleetCfg, key): string \| null` (parses `fleet:task:<wbs>:<n>`) |
| Claims | `packages/domain/src/dao/project-claim-dao.ts` | add `listBySlot(slot: ClaimSlot): Promise<ProjectClaim[]>`; lane write claim = `(projectPath: <lane realpath>, slot: 'write')` in the **base** DB |
| Holds | `strategy-runtime.ts` `DispatchHoldReason` | add `'writer-cap'`, `'file-overlap'` |
| Context | `StrategyContext` | add `lanes?: { maxWriters: number; inUse: Array<{ wbs: string; files: string[] }> }`; absent = legacy path |
| Declared files | new pure `declaredTaskFiles(content: string): string[]` in `packages/app/src/workflow/plan-projection.ts` | backticked repo-relative tokens in `### Design` + `### Plan` that exist on disk, normalized with the existing `normalizeTaskPath` |
| Events | `SystemEventDao` | `fleet.lane.opened`, `fleet.lane.retained` (payload: `{wbs, attempt, path, branch, reason?}`) |

**Algorithm (tick, lanes enabled).** Candidate order unchanged (priority → wbs). After the dependency gate (`:270`):
1. Own unterminated attempt → `dispatch-in-flight` (unchanged).
2. `inUse.length >= maxWriters` → `writer-cap` with detail `<inUse>/<maxWriters>`.
3. `declaredTaskFiles(candidate) ∩ inUse[i].files ≠ ∅` → `file-overlap` with detail `<wbs> <first shared path>` (same rule as `scheduleBatch` `:439-446`).
4. Allocate an idle coder (unchanged rule). On decision, `tick` calls `WorktreeLaneService.open(wbs, attempt)` **before** `slots.claim`, claims `'write'` keyed by the lane realpath, then enqueues the unchanged body. Admitted decisions append to `inUse` within the same select pass.

**Member cwd.** The dispatch message and inbox schema do not change. In `agent-loop-service.ts` (the keyed drain near `:651`), the member resolves `laneForRequestKey(...)`. If lanes are enabled and the lane directory exists, the turn runs with `cwd = lane` and `createWriteSlotHeartbeat` uses the lane realpath. Otherwise today's `deps.cwd` applies. The lane's own `.spur/spur.db` holds its run rows (the existing worktree contract). Inbox, claims and `coordination_runs` stay in the base DB through `deps.getDb`.

**observe().** Iterates `listBySlot('write')` (base DB) instead of the single base-path claim (`:609`). `selectFrom` subtracts every live lane holder from `idleInstances` (`:763`). On a terminal receipt it releases the lane claim, and **does not** dispose the lane: failure, `not-started` and outcome-unknown emit `fleet.lane.retained`. A success leaves the lane for 1342's queue.

**Reconcile (`resume`, write side only).** `WorktreeLaneService.reconcile()` diffs `git worktree list --porcelain` under `laneRoot` against attempt rows:
- A lane exists and its attempt has no receipt → keep it (re-emit `fleet.lane.opened` with `reused: true`).
- A lane has no attempt row and no commits beyond its base → `git worktree remove` plus branch delete.
- Mid-rebase or mid-merge → left for 1342.

Read-only `resume` (Board) never touches git.

**Anti-patterns.**
- Do not add an inbox column or change the dispatch body.
- Do not run `git worktree` outside `WorktreeLaneService`.
- Do not consult base-tree task status for in-flight state.
- Do not dispose a lane on any non-landing outcome.
- Do not touch `withWorktreeRunLease`: its `'worktree'` claim keeps fencing the pipeline inside the lane.

**Handoff.**
- 1342 consumes `WorktreeLaneService.dispose`, success-retained lanes and the `inUse` admission seam (adds `awaiting-integration`).
- 1343 drives `tick`/`observe` from a foreground loop.
- 1344 reuses the lane cwd for the reviewer turn.
- 1345 reuses the queue, not this task.

### Plan

1. Write the E2E failure cases first, against a temp fixture repo with fake-agent members:
   - F1 (two lanes write concurrently) and F2 (overlap serializes) → R3.
   - F3 (crash mid-dispatch reuses the lane) and F10 (orphan pruned) → R4.
2. Config keys `maxWriters`/`laneRoot` plus Zod bounds, with a config-load failure test naming the key (R2).
3. Add `WorktreeLaneService` `open`/`retain`/`dispose`/`reconcile` and the pure `lanePath`/`laneBranch`/`laneForRequestKey` helpers (R1, R4).
4. Add `ProjectClaimDao.listBySlot`, the lane-keyed write claim, and multi-holder `observe`/`selectFrom` (R2).
5. In `gtdStrategy`, add `writer-cap`/`file-overlap` admission and `declaredTaskFiles`. The absent `maxWriters` key keeps the legacy path; its existing `strategy-runtime` tests must stay green unchanged (R3).
6. Member-side lane cwd plus lane-keyed heartbeat in `agent-loop-service.ts` (R1).
7. Update design §5 with the attached-occupant decision (R5).
8. E2E: 3 independent tasks on 2 coders with `maxWriters: 2`. Artifact: `docs/reports/fleet-lanes-p1.json` (peak concurrent lanes = 2, zero orphans after a reconcile). Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:03.778Z backlog → todo (system)

