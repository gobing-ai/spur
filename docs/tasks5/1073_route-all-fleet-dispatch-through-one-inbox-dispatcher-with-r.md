---
schema_version: 1
name: Route all fleet dispatch through one inbox dispatcher with receipt waits and a non-blocking GTD tick
status: backlog
template: feature-impl
created_at: 2026-10-04T20:30:28.484Z
updated_at: "2026-10-04T20:32:59.545Z"
feature_id: G71

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

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

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
