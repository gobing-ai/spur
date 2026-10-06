---
schema_version: 1
name: Dispatch a task created after the fleet loops start, and finalize a killed member turn
status: todo
template: feature-impl
created_at: 2026-10-05T23:56:25.473Z
updated_at: "2026-10-06T00:15:34.534Z"
feature_id: G71

priority: P1
ac_altitude: task-local
---

## 1091. Dispatch a task created after the fleet loops start, and finalize a killed member turn

### Background

Task 1077's end-to-end harness (`scripts/commands/fleet-e2e.ts`) reaches 8 of 9 steps; `kill-redispatch`
fails. The first review of that session (`docs/reports/2026-10-05-fleet-e2e-kill-leg-findings.md`) named
two findings, K1 and K2. A re-verification on 2026-10-05 (fresh `fleet-e2e --keep` run
`spur-fleet-e2e-1791245124960` plus 13 kept scratch DBs, read through `inbox_messages`,
`coordination_runs` and `fleet.idle-hold` events) shows the evidence was misread. Verdicts:

**K1 (late-created task is never dispatched): DROPPED as framed.** Its premise is false. The
orchestrator loop wakes on `task.created` and `task.updated` (`WAKE_EVENT_NAMES`,
`packages/app/src/services/agent-loop-service.ts:170-178`) and on the `--poll` backstop. Every kept run
shows the late task being *evaluated* on each tick:
- Early runs hold it `0002:not-ready`. The hang task lacked AC and Design; the harness has since fixed that.
- Every later run holds it `0002:no-idle-instance` with detail `unresolved-deliveries; reconcile prior results before dispatch (1 ambiguous)`.

The planner's `tick for 0002` turns also exit normally. The real cause is N1 below.

**K2 (an unkeyed turn's run never finalizes after a kill): DROPPED as framed.** The unkeyed operator
message `/sp:dev-run <wbs> --auto` to a `persistent` member goes through the stdin path
(`agent-loop-service.ts:442-463`). By the 0831 contract ("acceptance is delivery"), that path writes **no
`coordination_runs` row**. Every kept DB shows the row `delivered` with no run row, so `runStatus` is
`null`, never `running`, and the harness poll (`fleet-e2e.ts:797-814`) cannot succeed by construction.

The harness comment saying "the restart's reconcile is what marks it interrupted" (`fleet-e2e.ts:794-796`)
describes code that does not exist: `DeliveryReconciler.reconcile()` only fails exhausted queued rows. The
keyed path does finalize on SIGTERM, because `AgentService.run` installs its own SIGTERM handler and its
`finally` calls `updateExit` (`agent-service.ts:1290-1302, 1705-1745`). The real gap is N2 below.

**N1 (new, product): one ambiguous unkeyed delivery wedges all GTD dispatch project-wide.**
1. `StrategyRuntime.resume()` reconciles *every* message to every fleet member, keyed or not (`strategy-runtime.ts:437-444`).
2. `DeliveryReconciler.classify` marks a `delivered` row with no run row as `outcome-unknown` (`delivery-reconciler.ts:79-84`).
3. The GTD gate then holds *every* candidate on *any* `outcome-unknown` row (`strategy-runtime.ts:655-669`).

So any operator or conversational message to a persistent member permanently blocks the fleet. The
harness's own fallback creates that message. The gate is also redundant for keyed rows, because two
narrower guards already exist:
- the per-task attempt state keeps an `outcome-unknown` attempt in flight (`dispatch-in-flight`, `strategy-runtime.ts:713-722`);
- `hasRunning` keeps a busy instance out of the idle set.

The hold detail names only a count, which is why this was misdiagnosed as a wake problem.

**N2 (new, product): a `running` run row whose loop died ungracefully is never finalized.** Only a graceful
`AgentService.run` exit writes `updateExit`. After SIGKILL, OOM or a crash, the row stays `running`
forever, with these effects:
- `hasRunning(spec)` (`coordination-run` DAO) keeps that instance out of the idle set permanently;
- the task's keyed attempt stays `dispatch-in-flight` forever;
- restarting the member does not recover, because no startup path finalizes the stale row.

**Harness (H): the kill leg asserts the wrong path.** `kill-redispatch` dispatches through an operator
unkeyed message plus planner nudges, as a workaround for the misread K1. That workaround is what triggers
N1, and it measures a receipt that the unkeyed path never writes. The strategy attempt-2 assertion was
replaced by explicit evidence.

1091 is the prerequisite of 1077: 1077 cannot reach 9 of 9 until N1, N2 and H land.

### Requirements

- [ ] R1. (N1) The GTD dispatch gate counts only fleet-keyed rows (`request_key` prefix `fleet:task:`). It ignores unkeyed traffic: an operator or conversational message to a member with no definite receipt never holds GTD dispatch. A keyed `outcome-unknown` row still holds dispatch, and the hold detail names the blocking message ids (not just a count).
- [ ] R2. (N2) A `coordination_runs` row left `running` by a member loop that died without a graceful exit (SIGKILL or crash) is finalized `errored` with `completed_at` set when that member's loop restarts, before the loop's first drain. The killed keyed attempt then has a definite receipt, and the instance is idle again.
- [ ] R3. (H) The `kill-redispatch` leg of `scripts/commands/fleet-e2e.ts` first sends the coder one unkeyed conversational message, so the stdin-delivered row from R1 exists. It then drives the hang task only through the strategy, with no operator dispatch message and no planner nudge:
  - the keyed attempt `fleet:task:<wbs>:1` hangs;
  - the coder loop is killed with SIGKILL and restarted;
  - the attempt-1 row reaches a terminal `runStatus`;
  - the strategy dispatches `fleet:task:<wbs>:2` on its own.

  The false comments are removed, the run reports 9 of 9, and `docs/reports/fleet-e2e-receipt.json` records it.

### Acceptance Criteria

```gherkin
Scenario: R1 — An unkeyed delivery without a receipt does not hold GTD dispatch
  Given a GTD fleet with a persistent coder member and a dispatchable fleet:auto task
  And an operator message to the coder that was delivered through stdin with no coordination run row
  When the orchestrator ticks
  Then the task is dispatched with a keyed fleet:task:<wbs>:1 inbox row
  And no fleet.idle-hold event carries the unresolved-deliveries detail

Scenario: R1 — A keyed delivery with an unknown outcome still holds dispatch and names itself
  Given a fleet:task keyed row that is delivered with no coordination run row
  When the orchestrator ticks
  Then candidates are held as no-idle-instance
  And the hold detail names that message id

Scenario: R2 — A run orphaned by an ungraceful member death is finalized on restart
  Given a coder loop running a keyed turn with a coordination run row in status running
  When the coder loop process is killed with SIGKILL and the loop is restarted
  Then before the restarted loop drains, that run row has status errored and completed_at set
  And the coder instance is idle for the strategy

Scenario: R3 — The harness proves kill and re-dispatch through the strategy
  Given the R1 and R2 fixes
  And an unkeyed conversational message already delivered to the persistent coder
  When bun scripts/spur-dev.ts fleet-e2e runs
  Then the hang task is dispatched as fleet:task:<wbs>:1 with no operator dispatch message
  And after SIGKILL and restart the attempt-1 row reaches a terminal runStatus
  And the strategy dispatches fleet:task:<wbs>:2 to the coder without an operator message
  And the receipt reports all nine steps passing
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-06T00:10:07.600Z

- **Q: Is K1 still valid?** No; dropped. The orchestrator wakes on `task.created`/`task.updated` and the backstop poll. The late task was evaluated every tick and held by N1, and earlier by `not-ready`.
- **Q: Is K2 still valid?** No; dropped as framed. The unkeyed persistent-stdin path never writes a run row (0831, by design). The real gaps are N1 (the gate counts unkeyed rows) and N2 (ungraceful death leaves `running`).
- **Q: Should unkeyed persistent deliveries get a run row?** No. The 0831 contract stays. GTD stops consulting unkeyed rows instead (R1).
- **Q: SIGTERM or SIGKILL in the harness?** SIGKILL. SIGTERM finalization already works through `AgentService.run`'s handler, and only SIGKILL exercises R2.
- **Q: Rename this task?** The title still reads as K1/K2. No `spur task update` flag renames a task, so it is left for the operator, who may rename it to "Unwedge GTD from unkeyed deliveries and reap orphaned member runs".

### Design

**Decisions (with the alternatives rejected):**

- **R1: filter the gate, do not reclassify.**
  - Change: carry `request_key` on `UnresolvedDelivery`, set from the row already read in `DeliveryReconciler.classify`. In `StrategyRuntime.selectFrom`'s GTD branch, compute `ambiguous` only over rows whose key starts with `FLEET_TASK_KEY_PREFIX`. Put those ids in the hold detail, e.g. `(1 ambiguous: <id>)`.
  - Rejected — make `classify` treat a stdin-accepted unkeyed row as settled: that changes inbox/`runStatus` semantics for every reader. The 0831 contract already defines acceptance as delivery for that path, and the reconciler only needs to stop being consulted for it by GTD.
  - Rejected — scope `resume()` to keyed rows: `classify`/`reconcile` also feed the read-only `strategy status` view, where unkeyed holds stay useful.
  - Rejected — remove the gate entirely: a keyed row `delivered` with no run row (a crash between claim and `svc.run`) is invisible to both `hasRunning` and an in-flight receipt read, so the gate stays as the only guard for that window.

- **R2: the member loop reaps its own spec's orphans at startup.**
  - Change: before the first drain, `agent-loop-service` calls a new `CoordinationRunDao` method. It sets every `status='running'` row for this `spec_id` to `errored`/`outcome='errored'`/`completed_at=now`, reusing `updateExit`'s column contract. It emits `agent.invoke.exit` for each row so the orchestrator wakes.
  - Premise to verify first (Plan step 1): the supervisor runs at most one loop per spec. That makes every `running` row for the spec at startup an orphan. If the premise fails, fall back to a liveness check on `coordination_runs.process_id` via `process.kill(pid, 0)`.
  - Rejected — the orchestrator reaping by pid liveness: it may run on another host, and pid reuse makes a remote check unsound.
  - Rejected — a TTL sweep: it races with legitimately long turns.

- **R3: the harness asserts the product path, not a workaround.**
  - Drop the operator `/sp:dev-run` send and the planner nudge loop. Keep one unkeyed `status?` message to the coder before the hang task is promoted; it is the E2E proof of R1. Wait on the keyed `fleet:task:<wbs>:1` row and the stub's hang record.
  - Kill with SIGKILL. SIGTERM finalization already works through `AgentService.run`'s handler, so SIGKILL is the case that proves R2.
  - Reap the orphaned stub child: kill the loop's process group, or record the stub pid in its prompt log and kill it in teardown.
  - Assert attempt-1 terminal, then attempt 2. `tick()` adds `--continue` iff the task is `wip`; assert the directive accordingly instead of hard-coding it.
  - Remove the false comments at `fleet-e2e.ts:761-766, 794-796`.
  - Add a correction note to `docs/reports/2026-10-05-fleet-e2e-kill-leg-findings.md` that points here; do not rewrite its history.

**Blast radius:**
- R1 touches the GTD branch only. Other strategies never read `unresolved`.
- R2 touches loop startup for every member. The write is idempotent and scoped to the loop's own `spec_id`.
- No schema change, no public CLI surface change, no new dependency.

### Plan

Failure modes are listed first, per AGENTS testing rules. The E2E harness is the primary proof; each failure mode below must make some check go red.

Failure modes to cover:
- F1: an unkeyed delivered row with no run row still holds GTD (the R1 regression).
- F2: a keyed `outcome-unknown` row no longer holds GTD (R1 over-relaxed).
- F3: the hold detail omits the blocking ids.
- F4: a SIGKILLed member's `running` row survives a restart (R2 regression).
- F5: startup reaping finalizes a *live* run of a concurrently running loop for the same spec (premise broken).
- F6: reaping does not wake the orchestrator, so re-dispatch waits for the backstop poll.
- F7: the orphaned stub child outlives teardown.
- F8: the harness still passes through an operator message (the assertion is not on the strategy path).

Steps:
1. [ ] Verify the one-loop-per-spec premise in `supervisor-service.ts`, or switch R2 to the `process_id` liveness design. Record the decision in Q&A.
2. [ ] R3 harness first, so it goes red on the product bugs: strategy-only dispatch, SIGKILL, process-group reap, attempt-1 terminal plus attempt-2 assertions, false comments removed. The step sends one unkeyed conversational message to the coder (`status?`) before promoting the hang task, so the E2E covers F1. Expect red: `0002:no-idle-instance … (1 ambiguous)` (F1), then F4 once R1 lands.
3. [ ] R1: add `requestKey` to `UnresolvedDelivery` in `delivery-reconciler.ts`, filter the GTD gate in `strategy-runtime.ts`, and list the ids in the detail. Add one strategy-runtime test with a seeded unkeyed `delivered` row and a keyed one (F1–F3).
4. [ ] R2: add the reap method to the `CoordinationRunDao`, call it at loop start before the first drain, and emit `agent.invoke.exit`. Add one in-memory DAO plus loop-start test with a seeded `running` row (F4–F6).
5. [ ] Re-run `bun scripts/spur-dev.ts fleet-e2e` until 9 of 9 (F7, F8), at least twice for repeatability. Commit the receipt.
6. [ ] Add a correction note to the findings report.
7. [ ] Gates: `bun run spur-check`, then `bun run spur-check-feature` (G71).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Prerequisite of task 1077 (feature G71). 1077 depends on 1091.
- Evidence: `docs/reports/2026-10-05-fleet-e2e-kill-leg-findings.md` (original K1/K2, superseded by Background), `docs/reports/fleet-e2e-receipt.json`, and the kept scratch project `spur-fleet-e2e-1791245124960` (re-verification run, 2026-10-05).
- Code: `packages/app/src/services/strategy-runtime.ts` (resume, GTD gate), `packages/app/src/services/delivery-reconciler.ts` (classify), `packages/app/src/services/agent-loop-service.ts` (wake set, stdin path, loop start), `packages/app/src/services/agent-service.ts` (SIGTERM finalization), `scripts/commands/fleet-e2e.ts` (kill leg).

### History

- 2026-10-06T00:15:34.534Z backlog → todo (system)

