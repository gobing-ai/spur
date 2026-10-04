---
schema_version: 1
name: Route all fleet dispatch through one inbox dispatcher with receipt waits and a non-blocking GTD tick
status: todo
template: feature-impl
created_at: 2026-10-04T20:30:28.484Z
updated_at: "2026-10-04T20:58:03.560Z"
feature_id: G71

priority: P1
estimate_hours: 8
---

## 1073. Route all fleet dispatch through one inbox dispatcher with receipt waits and a non-blocking GTD tick

### Background

Implements G71 R1 and R2 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 items 1 and 3; ADR-126 amendment A4, ADR-057 amendment A1).

Verified state (2026-10-04, main @ 8b7e94dd2):

- C2: the GTD orchestrator dispatches with `runTraced('/sp:dev-run <wbs> --auto')` inside the planner process (`packages/app/src/services/agent-loop-service.ts:386`, `strategy-runtime.ts` `dispatchNext`). It is serial and blocking; the coder member only labels the executor.
- C3: `agent.run executor: fleet` (0942) enqueues a keyed message and polls a file (`packages/app/src/workflow/fleet-dispatch.ts:59`, `:181`); nothing drains it (C1, task 1074), so it always times out.
- H3: `selectNext` calls `resume()`, which reconciles and writes, twice per decision.
- H4: the write slot is held by the planner process (`write-slot-service.ts`, `WRITE_SLOT_TTL_MS=30000`).
- Reuse: keyed idempotent `sendMessage`, the `coordination_runs` receipt linked by `requestMessage` (0833, `agent-service.ts:1284-1303`), occupant pins (ADR-075), `gtdStrategy` holds, `MAX_DISPATCH_ATTEMPTS`, slot fences.

**Refine corrections (2026-10-04)**

- `fleet-dispatch.ts` sends with a null sender (`sendMessage(null, member, …)`), and `replyToMessage` throws on a null `fromId` → the member could never reply → the dispatcher always sets `fromId`: the orchestrator instance id for strategy dispatches, `workflow:<runId>` for workflow dispatches.
- Fleet member runs record no `task_id`: `drainIntoPrompt` (`apps/cli/src/commands/agent.ts` ~880-925) sets no `task` flag, so the `runs.listByTaskId` freshness check in `selectNext` (`strategy-runtime.ts:418-481`) never sees fleet attempts → freshness comes from keyed dispatch rows `fleet:task:<wbs>:<n>` and their receipts, and the drain sets `task` from a claimed message's key.
- `waitForOccupant` (`occupant-wait.ts`) pins a run id, and no run id exists at enqueue time → the receipt wait polls `CoordinationRunDao.listByMessageId(messageId)` filtered to `spec_id === member` (the occupant pin).
- The workflow fleet branch maps a wait timeout to `reason: 'failed-timeout'` (`packages/app/src/workflow/actions/agent-run.ts` fleet branch), which contradicts R2 → `outcome-unknown` closes the run `interrupted` (resumable) through `classifyTerminalReason`, never a `failed-*` reason.
- Persistent-stdin members settle on send acceptance and write no `coordination_runs` row (`agent-loop-service.ts:427-449`), so a keyed dispatch to one would never get a receipt → resolved in 1074: a drained batch carrying a dispatch key always runs through `svc.run`.

### Requirements

- [ ] R1. One `FleetDispatcher` in `packages/app` (extracted from `fleet-dispatch.ts`) enqueues a keyed inbox message plus prompt artifact and waits on the `coordination_runs` receipt linked by `requestMessage`, as one call, pinned to the member occupant; `expectFile` stays a post-condition only.
- [ ] R2. A wait timeout returns `outcome-unknown`; it is never mapped to failed or not-sent.
- [ ] R3. `strategy.tick()` runs `reconcile()` once, then a pure `select()`, claims the write slot for the member, and calls `FleetDispatcher.enqueue` without waiting; `runTraced` is removed from the loop.
- [ ] R4. `strategy.observe()` on `agent.invoke.exit` reads the receipt: done, retry with a new attempt key bounded by `MAX_DISPATCH_ATTEMPTS` only on a definite failed/not-started receipt, or hold on outcome-unknown; it releases the slot.
- [ ] R5. Workflow `agent.run --agent fleet` and the strategy share the dispatcher; no other fleet dispatch path remains.

### Acceptance Criteria

- [ ] AC1 — Fleet work is dispatched only through the inbox
- [ ] AC2 — Completion is the coordination receipt

Task-local verification:

- A unit-level scenario with a stub member: tick returns before the member finishes; the receipt drives done.
- A timed-out wait yields `outcome-unknown`, and a following tick does not re-send.
- `rg runTraced packages/app/src/services/agent-loop-service.ts` finds no dispatch call.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-04T20:56:56.553Z

- **Q: Where does outstanding-dispatch state live?** A: Only in the database: the keyed inbox rows plus their `coordination_runs` receipts. No in-memory map, so a restarted orchestrator rebuilds it on its first tick.
- **Q: How is the attempt number derived?** A: `n = 1 + count(inbox rows with request_key LIKE 'fleet:task:<wbs>:%')`. Keyed `sendMessage` dedupes a replayed key, so a crashed tick that re-enqueues the same attempt is idempotent.
- **Q: What stops a second writer while a message waits to be claimed?** A: `tick` holds every new write dispatch while any `fleet:task:*` dispatch is in flight (no terminal receipt), independent of the slot TTL. The slot stays the fence for result validation.
- **Q: Who heartbeats the slot before the member picks the message up?** A: The orchestrator loop, on an interval of `WRITE_SLOT_TTL_MS/3`, until a `running` receipt row appears. The member heartbeat is 1074 R2.
- **Q: Which terminal reason does a workflow `outcome-unknown` get?** A: Keep the 0937 enum closed. The action returns `ok:false` with `data.reason:'outcome-unknown'`, and `classifyTerminalReason` (`packages/app/src/workflow/terminal-reason.ts`) maps an error text containing `outcome-unknown` to `interrupted`. The text must not contain "timeout", because the `/timeout/i` rule at `:67` would win.
- **Deferred:**
  - wip candidates and `--continue` → 1075
  - the member drain → 1074. Between 1073 and 1074, enqueued work waits in member inboxes; this is expected, and 1077 proves the joined path.

### Design

**New module** `packages/app/src/services/fleet-dispatcher.ts`, exported from `packages/app/src/index.ts`:

```ts
export type FleetReceiptStatus = 'completed' | 'failed' | 'not-started' | 'outcome-unknown';
export interface FleetDispatchRequest {
    member: string;     // concrete instance id = occupant pin
    fromId: string;     // orchestrator instance id | `workflow:<runId>`
    body: string;       // strategy: `/sp:dev-run <wbs> --auto`
    requestKey: string; // `fleet:task:<wbs>:<n>` | `<runId>/<state>`
}
export interface FleetReceipt { status: FleetReceiptStatus; messageId: string; runId?: string }
export class FleetDispatcher {
    constructor(deps: {
        coordination: Pick<AgentCoordinationService, 'sendMessage' | 'getMessage'>;
        runs: Pick<CoordinationRunDao, 'listByMessageId'>;
        now?: () => number;
        sleep?: (ms: number) => Promise<void>;
    });
    enqueue(req: FleetDispatchRequest): Promise<{ messageId: string; replayed: boolean }>;
    /** Non-blocking; null while pending / claimed / running. */
    receipt(messageId: string, member: string): Promise<FleetReceipt | null>;
    /** Polls `receipt` every FOLLOW_POLL_INTERVAL_MS; deadline → outcome-unknown. */
    awaitReceipt(messageId: string, member: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<FleetReceipt>;
    dispatch(req: FleetDispatchRequest, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<FleetReceipt>;
}
```

**Receipt mapping** in `receipt()`:

| Evidence | Status |
| --- | --- |
| Newest `coordination_runs` row for the message with `spec_id === member`, `status = exited` | `completed` (+ `runId`) |
| Same row, `status = errored` | `failed` |
| No row, and the inbox row is settled `failed` | `not-started` |
| Anything else (pending, claimed, running) | `null` |
| `awaitReceipt` deadline passes while still `null` | `outcome-unknown` |

Add `AgentCoordinationService.getMessage(msgId)` only if absent. It reads the inbox row status through the existing ts-db inbox DAO.

**Keys and freshness**
- `InboxUnfinishedDao` (`packages/domain/src/dao/inbox-unfinished-dao.ts`) gains `listByRequestKeyPrefix(prefix)`: all statuses, newest first.
- `drainPending` exposes `requestKey` on `InboxEntry`; the ts-db row already carries it.
- `drainIntoPrompt` sets `flags.task = <wbs>` when a claimed message's key matches `^fleet:task:([^:]+):\d+$`, so fleet runs fill `coordination_runs.task_id`.

**StrategyRuntime** (`strategy-runtime.ts`)
- `tick(projectPath, { ownerEpoch, orchestratorId })`:
  1. Call `resume()` once (reconcile plus the default-strategy write).
  2. Run a pure `select(snapshot)` over the todo candidates, idle members, and each wbs's latest keyed attempt and its receipt.
  3. For each decision, call `slots.claim(decision)`, then `dispatcher.enqueue({ member, fromId: orchestratorId, body: '/sp:dev-run <wbs> --auto', requestKey: 'fleet:task:<wbs>:<n>' })`.
  4. Return `{ dispatched, holds }`. `tick` never awaits a run.
- Freshness per candidate wbs:

  | Latest keyed attempt | Result |
  | --- | --- |
  | None | Fresh (attempt 1) |
  | Receipt `null` | New hold reason `dispatch-in-flight`, added to `DispatchHoldReason`; it also blocks every other write dispatch |
  | `failed` or `not-started`, and `n < MAX_DISPATCH_ATTEMPTS` | Fresh (attempt `n+1`) |
  | `completed`, or attempts exhausted | Not a candidate (same as today) |
- `observe(projectPath, { ownerEpoch })` runs on each wake. It reads `receipt()` for the latest in-flight attempt. When the receipt is terminal and the write-slot holder is that member, it calls `slots.validateResult(...)` and then `slots.release(...)`. Retry needs no extra code: freshness picks it up on the next `tick`.
- Delete `dispatchNext` and the second `selectNext` call (H3). `selectNext` becomes a read-only wrapper over `select` with `resume({ readOnly: true })`, used by `recordIdleHold` and inspection.
- Orchestrator slot heartbeat: while an in-flight dispatch has no `running` receipt row, run a `setInterval(WRITE_SLOT_TTL_MS/3)` that calls `ProjectClaimDao.heartbeat(projectPath, 'write', member, WRITE_SLOT_TTL_MS, ownerEpoch)`. Clear it when a running row appears, when the receipt is terminal, or on loop exit.

**Loop** (`agent-loop-service.ts:371-416`)
- The owner branch becomes `await runtime.observe(...)`, then `await runtime.tick(...)`, then `recordIdleHold` only when nothing was dispatched.
- Remove the `runTraced` dispatch and the `beforeDispatch` plumbing from the loop.
- The non-owner bypass stays until 1074.

**Workflow path**
- `dispatchToFleet` (`packages/app/src/workflow/fleet-dispatch.ts`) keeps its input shape, role resolution and prompt artifact. It now sends through `FleetDispatcher.dispatch` with `fromId: 'workflow:<runId>'` and key `<runId>/<state>`.
- `expectFile` is checked only after `completed`. A missing file is `failed` with reason `missing-artifact`.
- `FleetDispatchResult` becomes `completed | failed | not-started | outcome-unknown | unavailable`; `dispatched` and `timeout` are removed.
- `agent-run.ts` maps the result:

  | Result | Action outcome |
  | --- | --- |
  | `completed` | `ok:true`, `reason:'done'` |
  | `failed` or `not-started` | `ok:false`, `reason:'failed-agent'` |
  | `outcome-unknown` | `ok:false`, `reason:'outcome-unknown'`, error text `fleet dispatch outcome unknown (member <id>, message <id>)` |
- `terminal-reason.ts` maps that error to `interrupted`.
- `workflow-service.ts:1947-1966` builds the dispatcher instead of passing `waitForFile`.

**Invariants**
- One fleet dispatch path (R5).
- No member work runs inside the orchestrator process.
- A wait timeout never becomes failed (R2).

**Tests to update:**
- `packages/app/tests/services/{strategy-runtime,agent-loop-service}.test.ts`
- `packages/app/tests/workflow/{fleet-dispatch,agent-run-fleet,session-pinned-dispatch}.test.ts`
- `apps/cli/tests/commands/{g6-strategy-prototype,dispatch-inspect}.test.ts`
- new `packages/app/tests/services/fleet-dispatcher.test.ts`

**Concurrency:** none of these files are open in the other worktree (`sp/runall-e72-4191`, task 1069) or in the uncommitted `MemberDetail.tsx`.

### Plan

1. Write the failure list first (project rule) as `fleet-dispatcher.test.ts` cases:
   - replayed key → same `messageId`
   - errored row → `failed`
   - inbox row settled `failed` with no run row → `not-started`
   - deadline → `outcome-unknown`
   - a row with a different `spec_id` is ignored
   - abort signal stops the wait
2. Domain and service seams:
   - `InboxUnfinishedDao.listByRequestKeyPrefix`
   - `AgentCoordinationService.getMessage`, only if absent
   - `requestKey` on `InboxEntry`
3. Implement `FleetDispatcher`.
4. Workflow path:
   - rebuild `dispatchToFleet` on the dispatcher
   - update the `agent-run.ts` mapping
   - map `outcome-unknown` → `interrupted` in `terminal-reason.ts`
   - update the `workflow-service.ts` deps
   - update the fleet-dispatch, agent-run-fleet and session-pinned tests
5. `StrategyRuntime`:
   - add `tick`, `observe` and a pure `select`
   - add the `dispatch-in-flight` hold and keyed freshness
   - delete `dispatchNext`
   - make `selectNext` read-only
6. Loop owner branch: call `observe` then `tick`, add the slot heartbeat interval, and delete the `runTraced` call.
7. `drainIntoPrompt` sets `task` from a `fleet:task:` key.
8. Update the strategy-runtime, agent-loop-service, g6-strategy-prototype and dispatch-inspect tests. Add the stub-member scenario: tick returns before the member finishes, and the receipt drives done.
9. Gates:
   - `(cd packages/app && bun test tests/services/fleet-dispatcher.test.ts tests/services/strategy-runtime.test.ts tests/workflow)`
   - `rg -n runTraced packages/app/src/services/agent-loop-service.ts` returns nothing
   - `bun run spur-check`

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:37.679Z backlog → todo (system)

