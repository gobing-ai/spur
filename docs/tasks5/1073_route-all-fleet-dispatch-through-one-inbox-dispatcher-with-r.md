---
schema_version: 1
name: Route all fleet dispatch through one inbox dispatcher with receipt waits and a non-blocking GTD tick
status: done
template: feature-impl
created_at: 2026-10-04T20:30:28.484Z
updated_at: "2026-10-05T03:50:10.139Z"
feature_id: G71

priority: P1
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-runall-g71-302b/.spur/memory/evidence/1073-verdict.json
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

- [x] R1. One `FleetDispatcher` in `packages/app` (extracted from `fleet-dispatch.ts`) enqueues a keyed inbox message plus prompt artifact and waits on the `coordination_runs` receipt linked by `requestMessage`, as one call, pinned to the member occupant; `expectFile` stays a post-condition only.
- [x] R2. A wait timeout returns `outcome-unknown`; it is never mapped to failed or not-sent.
- [x] R3. `strategy.tick()` runs `reconcile()` once, then a pure `select()`, claims the write slot for the member, and calls `FleetDispatcher.enqueue` without waiting; `runTraced` is removed from the loop.
- [x] R4. `strategy.observe()` on `agent.invoke.exit` reads the receipt: done, retry with a new attempt key bounded by `MAX_DISPATCH_ATTEMPTS` only on a definite failed/not-started receipt, or hold on outcome-unknown; it releases the slot.
- [x] R5. Workflow `agent.run --agent fleet` and the strategy share the dispatcher; no other fleet dispatch path remains.

### Acceptance Criteria

- [x] AC1 — Fleet work is dispatched only through the inbox
- [x] AC2 — Completion is the coordination receipt

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

One inbox dispatcher now owns fleet dispatch, and completion is the `coordination_runs` receipt
(R1, R2, R5). `FleetDispatcher` is the single primitive: `enqueue` sends one keyed idempotent inbox
message and returns its `messageId`; `receipt` reads the newest run row for that message whose
`spec_id` IS the pinned occupant and maps `exited` → `completed`, `errored` → `failed`, a
settled-`failed` inbox row with no run row → `not-started`, anything else → null; `awaitReceipt`
polls that read and a stop without a definite receipt — deadline OR abort — is `outcome-unknown`,
never `failed` and never `not-started`, because the member may still be working (R2). The workflow
stage (`packages/app/src/workflow/fleet-dispatch.ts`) keeps its role resolution, prompt artifact and
optional `expectFile`, but the wait is the receipt: `expectFile` is now a post-condition checked only
after `completed`, and a missing artifact is `failed` with reason `missing-artifact`. The
`FleetDispatchResult` union drops `dispatched`/`timeout` for
`completed | failed | not-started | outcome-unknown | unavailable`, and the action maps the last of
those to `ok:false` with an error text that deliberately avoids `/timeout/i` so
`classifyTerminalReason` closes the run `interrupted` — the resumable reason — instead of
`failed-timeout`.

The GTD orchestrator no longer runs member work (R3, R4). `StrategyRuntime.tick` reconciles once,
asks the pure strategy over one snapshot, then per decision claims the write slot and enqueues one
keyed message with `requestKey: fleet:task:<wbs>:<n>`; it never awaits a run. `observe` is the other
half: it reads the receipt for the member holding the write slot, and on a definite receipt validates
the holder generation and releases the slot, so retry needs no code — freshness picks the task up on
the next tick. Freshness itself is derived from the keyed dispatch rows in the database (the inbox
rows, which carry `request_key`, plus their receipts), so a restarted orchestrator rebuilds its
outstanding-work state on its first tick with no in-memory map; the attempt number is
`1 + count(fleet:task:<wbs>:* rows)`. A newest attempt with no definite receipt yields the new
`dispatch-in-flight` hold and blocks every other write dispatch, while a `completed` attempt or one
that exhausted `MAX_DISPATCH_ATTEMPTS` is simply no longer a candidate. `dispatchNext`, its second
`selectNext` per decision, the in-process `runTraced` dispatch and the `beforeDispatch` plumbing are
deleted; the loop's owner branch is now `observe` → `tick` → `recordIdleHold` only when nothing was
dispatched. While a dispatch waits to be claimed the orchestrator keeps the write slot alive with one
standby heartbeat timer per project (`WRITE_SLOT_TTL_MS / 3`), stopped when the member's own
`running` row appears, when the receipt settles, or on loop exit.

Two seams carried the metadata the design needs. `InboxUnfinishedDao.listByRequestKeyPrefix` reads
keyed rows at any status (raw SQL stays in domain), `AgentCoordinationService.getMessage` exposes one
inbox row's status for the `not-started` branch, and `drainPending`/`getInbox` now surface
`requestKey` on `InboxEntry`; `drainIntoPrompt` uses it to set `flags.task` from a
`fleet:task:<wbs>:<n>` key, so a drained fleet dispatch fills `coordination_runs.task_id` and the
receipt is attributable. `WorkflowService` and the CLI's `makeFleetRuntime` both build the dispatcher,
so no caller can reach fleet dispatch except through it (R5); a host that wires no dispatcher makes
`tick` refuse loudly with a `no-idle-instance` hold rather than silently believing it dispatched.

The stage adapter deliberately consumes the dispatcher's **two seams separately** — `enqueue` and
`awaitReceipt` — instead of the one-call `dispatch`. A failed send and a failed wait are not the same
fact: only the first means nothing was queued, so only the first may resolve to `unavailable` and
unlock a declared `executorFallback: traditional`. Once the message has landed the member may already
be working, so a receipt-read failure resolves to `outcome-unknown` and the stage is never re-run. A
regression test pins this (`fleet-dispatch.test.ts`, "a receipt wait that throws AFTER a landed send
is outcome-unknown"); before the split, an enqueue that landed followed by a failed wait reported
`unavailable` and could execute the same member request twice.

| Change | Anchor |
| --- | --- |
| One `FleetDispatcher`: keyed enqueue, occupant-pinned receipt read, bounded receipt wait | `packages/app/src/services/fleet-dispatcher.ts:60` |
| Receipt mapping — `exited` → completed, `errored` → failed, settled-`failed` inbox row → not-started | `packages/app/src/services/fleet-dispatcher.ts:92` |
| A stop without a definite receipt is `outcome-unknown` (deadline and abort alike) | `packages/app/src/services/fleet-dispatcher.ts:113` |
| `outcome-unknown` text closes the run `interrupted`, checked before the `/timeout/i` rule | `packages/app/src/workflow/terminal-reason.ts:71` |
| Workflow fleet dispatch adapted onto the shared dispatcher; `expectFile` is a post-condition | `packages/app/src/workflow/fleet-dispatch.ts:134` |
| Action mapping: completed → done, failed/not-started → failed-agent, outcome-unknown → resumable | `packages/app/src/workflow/actions/agent-run.ts:400` |
| `tick` — resume once, claim, enqueue one keyed dispatch, never await a run | `packages/app/src/services/strategy-runtime.ts:418` |
| `observe` — read the receipt, validate the holder, release the slot | `packages/app/src/services/strategy-runtime.ts:486` |
| Attempt key + ordinal parse for `fleet:task:<wbs>:<n>` | `packages/app/src/services/strategy-runtime.ts:42` |
| Keyed freshness and the `dispatch-in-flight` hold reason | `packages/app/src/services/strategy-runtime.ts:80` |
| Standby write-slot heartbeat while a dispatch waits to be claimed | `packages/app/src/services/strategy-runtime.ts:532` |
| Keyed-prefix inbox read (raw SQL stays in domain) | `packages/domain/src/dao/inbox-unfinished-dao.ts:69` |
| `getMessage` — one inbox row for the `not-started` branch | `packages/app/src/services/agent-coordination-service.ts:328` |
| `requestKey` exposed on `InboxEntry` | `packages/app/src/services/agent-coordination-service.ts:149` |
| Loop owner branch: `observe` → `tick`, no in-process member run, heartbeat stopped on exit | `packages/app/src/services/agent-loop-service.ts:385` |
| A drained dispatch key names the task on the run receipt | `apps/cli/src/commands/agent.ts:916` |
| CLI wires the dispatcher into the strategy runtime | `apps/cli/src/commands/agent.ts:1021` |
| WorkflowService composes the dispatcher for the engine host | `packages/app/src/services/workflow-service.ts:1968` |
| `InboxEntry.requestKey` populated on the drain path | `packages/app/src/services/agent-coordination-service.ts:344` |

Test evidence: `packages/app/tests/services/fleet-dispatcher.test.ts` (new, 15 cases — replay,
errored, settled-failed inbox row, running, foreign occupant, deadline, arriving receipt, abort, the
real poll cadence, and `dispatch` composition), plus updated
`packages/app/tests/services/strategy-runtime.test.ts` (tick/observe/in-flight hold/keyed freshness/
attempt cap/standby heartbeat), `packages/app/tests/workflow/fleet-dispatch.test.ts`,
`packages/app/tests/workflow/agent-run-fleet.test.ts`,
`packages/app/tests/services/agent-loop-service.test.ts` and
`apps/cli/tests/commands/agent-loop-wake.test.ts` (the two G62 loop traces now assert the inbox
dispatch and the receipt-driven retry instead of an in-process executor).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/fleet-dispatcher.ts:60` (`enqueue` :74, receipt read :92); both callers share it — `packages/app/src/services/workflow-service.ts:1968` and `apps/cli/src/commands/agent.ts:1021`; tests in `packages/app/tests/services/fleet-dispatcher.test.ts` ("sends through the member occupant with the caller sender and the dispatch key", "a replayed key returns the original message id and is reported as a replay") |
| R2 | MET | `packages/app/src/services/fleet-dispatcher.ts:113`; `packages/app/src/workflow/terminal-reason.ts:71` maps the text to `interrupted`; tests "a deadline that passes with no receipt is outcome-unknown", "a timeout is outcome-unknown — never failed, never not-started (R2)", "an aborted wait stops immediately as outcome-unknown" |
| R3 | MET | `packages/app/src/services/strategy-runtime.ts:418`; tests "R1: tick enqueues one keyed dispatch per idle writer, claims the write slot, and never runs member work in-process" and "R1: a stale owner epoch fences the whole tick — nothing is claimed or enqueued"; `rg -n "dispatchNext" packages apps plugins scripts` is empty |
| R4 | MET | `packages/app/src/services/strategy-runtime.ts:486`; the `dispatch-in-flight` hold is `packages/app/src/services/strategy-runtime.ts:80`; tests "R1: a failed receipt retries under the attempt cap; a completed attempt is not a candidate", "R2: an outcome-unknown wait is not re-dispatched — absence of a receipt is not a failure", "R1/R4: observe releases the write slot once the receipt settles, and retry is freshness only" |
| R5 | MET | `packages/app/src/workflow/fleet-dispatch.ts:134` (adapter over the shared dispatcher) and `packages/app/src/workflow/actions/agent-run.ts:400`; `rg -n "\.runTraced\(" packages/app/src/services/agent-loop-service.ts` is empty (only the injected-service TYPE names it at `packages/app/src/services/agent-loop-service.ts:52`, no call site); `apps/cli/tests/commands/agent-loop-wake.test.ts` injects a throwing `runTraced` and the loop still dispatches through the inbox |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Fleet work is dispatched only through the inbox | MET | test | `apps/cli/tests/commands/agent-loop-wake.test.ts:449` asserts the orchestrator's only effect is the keyed row `fleet:task:0841:1` plus the write slot, with `runTraced` replaced by a throwing stub; `packages/app/tests/services/strategy-runtime.test.ts` asserts tick enqueues and no member work runs in-process |
| AC2 — Completion is the coordination receipt | MET | test | `packages/app/tests/services/fleet-dispatcher.test.ts` maps an `exited` run row linked to the message to `completed`, `errored` to `failed`, and a settled-failed inbox row with no run row to `not-started`; `packages/app/tests/services/strategy-runtime.test.ts` releases the write slot from that receipt and never re-dispatches an `outcome-unknown` wait |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of the 1073 diff (21 files: the new `fleet-dispatcher.ts` plus its callers and the adapted
suites). Dimensions: functional traceability (R1–R5), SECUA, architecture depth.

## Findings

| Severity | Finding | Disposition |
| --- | --- | --- |
| P2 (major) | `dispatchToFleet` drove the dispatcher's one-call `dispatch` inside a single `try`, so a receipt-read failure AFTER a successful enqueue resolved to `unavailable` — the exact value that authorizes a declared `executorFallback: traditional` re-run while the member already held the same request. Double execution of member work. Found during this review pass, before verify. | Fixed in the reviewed diff: the adapter consumes the two seams separately (`packages/app/src/workflow/fleet-dispatch.ts:31`) — only a failed `enqueue` is `unavailable`, a failed `awaitReceipt` is `outcome-unknown`. Pinned by `tests/workflow/fleet-dispatch.test.ts` "a receipt wait that throws AFTER a landed send is outcome-unknown — never a fallback-eligible unavailable". |
| P2 (pre-existing, repaired to unblock the repo gate) | `apps/web/src/modules/projects/conversation.ts` measured 92.31% functions / 7.98% lines, failing `bunfig.toml`'s per-file 90/90 threshold with zero failing tests — identical at base `a23da10e3`, so unrelated to G71. | Repaired by appending 4 cases to the existing `conversation.test.ts` (its original 13 cases preserved verbatim); the module now measures 100%/100%. Landed as its own commit `83cad96bb`. |
| P3 (minor) | `awaitReceipt` with no declared `timeoutMs` waits unbounded (`Number.POSITIVE_INFINITY`), mirroring subprocess semantics — a stage that omits `timeoutMs` on the fleet surface hangs instead of failing. | Accepted: every fleet `agent.run` in `task-pipeline.yaml` declares `${vars.stepTimeoutMs}`. Residual risk only for a future caller that omits it. |
| P3 (minor) | `tick` reads the keyed attempts twice per dispatched task (once in `selectFrom` for the snapshot, once in `tick` for the next attempt ordinal). | Accepted: one extra indexed read per dispatch, no correctness impact; deliberately not shared state. |
| P3 (minor) | `readAttempts` computes `count` over every prefix-matching row but derives `latest` only from well-formed ordinals, so a malformed key inflates the next attempt number by one. | Accepted: the ordinal only bounds `MAX_DISPATCH_ATTEMPTS`, and a malformed key is skipped rather than read as attempt 1 — the safe direction. |
| P4 (advisory) | `observe` releases the write slot on any definite receipt for the holder without correlating the receipt's `task_id` to the decision. | Accepted: one write slot plus an occupant-pinned read already make the holder/receipt pairing exact; a task check would be redundant state. |
| P4 (advisory) | `classifyTerminalReason`'s new `/outcome[-_ ]?unknown/i` rule is substring-based, so unrelated error text containing "outcome unknown" now maps to `interrupted`. | Accepted and intentional: the phrase is the fleet waiter's own vocabulary, and `interrupted` is the recoverable reason. |

No open P1; the single P2 in the authored code was repaired inside the reviewed diff.

## Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 one `FleetDispatcher` (keyed enqueue + receipt wait, occupant-pinned) | MET | `packages/app/src/services/fleet-dispatcher.ts:60`; 15 cases in `tests/services/fleet-dispatcher.test.ts`; both callers share it (`workflow-service.ts:1968`, `agent.ts:1021`) |
| R2 a wait timeout is `outcome-unknown`, never failed/not-sent | MET | `fleet-dispatcher.ts:113`; terminal mapping `terminal-reason.ts:71`; tests "a deadline that passes…", "a timeout is outcome-unknown…", "an aborted wait…" |
| R3 `tick` resumes once, selects purely, claims, enqueues, never awaits | MET | `strategy-runtime.ts:418`; tests "tick enqueues one keyed dispatch…", "a stale owner epoch fences the whole tick…"; `rg dispatchNext` empty |
| R4 `observe` reads the receipt, retries only on a definite receipt, releases the slot | MET | `strategy-runtime.ts:486`; `dispatch-in-flight` hold `packages/app/src/services/strategy-runtime.ts:80`; tests "a failed receipt retries under the attempt cap…", "observe releases the write slot…" |
| R5 workflow and strategy share the dispatcher; no other fleet dispatch path | MET | `fleet-dispatch.ts:134`; no `runTraced` call site in the loop; the CLI loop test injects a throwing one and still dispatches through the inbox |

## Architecture depth

The change deepens rather than widens: one new module (`fleet-dispatcher.ts`, 125 lines) replaces two
independent dispatch paths; the strategy keeps an I/O-free `select` with the snapshot assembled by the
runtime; and the loop's owner branch loses its in-process executor plumbing entirely. No new
abstraction with a single implementation, no configuration surface added, and the fresh/one-shot role
rules plus the ADR-121 reviewer check are preserved unchanged. The one deliberate seam split
(`enqueue` vs `awaitReceipt`) is called out above and exists because the two failures are different
facts, not for reuse.

## Residual risk

- Task 1074 (member drain) is what actually settles a queued dispatch. Until it lands, an enqueued
  message waits in the member inbox — 1073's own Q&A records that as the expected intermediate state,
  and the batch's receipt-driven retry test exercises the receipt side rather than a full drain.
- The repo-wide gate's pass depends on host CPU availability: this run needed a quiet host after
  competing agent sessions starved every earlier attempt (recorded in the run log and `## Testing`).
  Same command, same tree, same tests: FAIL under load, PASS at 9960/0 on a quiet host.

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:37.679Z backlog → todo (system)
- 2026-10-04T23:52:35.749Z todo → wip (system)
- 2026-10-05T03:49:41.036Z wip → testing (system)
- 2026-10-05T03:50:10.135Z testing → done (system)

