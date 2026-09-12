---
schema_version: 1
name: Commit-after-confirm delivery and bounded failure marking in the agent drain path
status: done
template: feature-impl
created_at: 2026-09-12T04:45:29.914Z
updated_at: "2026-09-12T05:54:03.798Z"
feature_id: G61

---

## 0831. Commit-after-confirm delivery and bounded failure marking in the agent drain path

### Background

G6's runtime inventory proved two delivery defects with runnable probes
(`docs/reports/g6-runtime-inventory.md` §3). Both were re-verified against the current tree during
refinement; the line anchors and one claim are corrected below.

- **Probe 1 (UNMET)** — the drain claims inbox rows *before* the invocation is spawned.
  `runAgentRun` calls `drainIntoPrompt` at `apps/cli/src/commands/agent.ts:491`, which claims the
  rows at `:568` (`TeamService.drainPending` → `InboxMessageDao.drainPending`, flipping
  `queued → injected` and incrementing `injectAttempts`), and only then spawns via `svc.run` at
  `:508`. `runAgentLoop` repeats the same order at `:730` / `:732`. A spawn failure therefore
  commits consumption first and the work is lost.
- **Probe 2 (UNMET)** — `runAgentLoop` discards the exit code: `await svc.run(prompt, rewritten, deps)`
  at `apps/cli/src/commands/agent.ts:732` ignores its return value. The row stays `injected`
  forever, a re-drain finds nothing, and the loss is silent to long-lived loops.

**Correction (refinement, premise check).** The inventory's claim that `InboxMessageDao.markFailed`
has "no caller anywhere in the codebase" is wrong. `TeamOrchestrator.flushInbox` in
`@gobing-ai/ts-ai-runner` calls `markDelivered` / `markFailed` for the **live stdin-injection**
delivery path. What has no caller is the **CLI drain path** — `spur agent run --drain` and
`spur agent loop` never mark delivered, never mark failed, and never release. The engine already
demonstrates the settle semantics this task brings to the drain path.

Verified primitives in `@gobing-ai/ts-db` 0.4.62 (`InboxMessageDao`):

- `drainPending(toId, {limit=100})` is a single conditional `UPDATE … AND status = 'queued'`, so the
  at-most-once claim (probe 4, MET) is a property of the SQL and must not be weakened.
- `inbox_messages` already carries `injectAttempts` (incremented on every claim) and `injectError`.
- `markDelivered(msgId)` and `markFailed(msgId, error)` exist. `markFailed` is **terminal** and takes
  **no attempt count** — attempts are already recorded by the claim.
- There is **no release/requeue verb**: nothing can return an `injected` row to `queued`. That is the
  one missing primitive behind probe 1.

Characterization probes live in `apps/cli/tests/commands/agent-team.test.ts:619-819`
("G6 characterization (0828)") and must flip from asserting today's broken behavior to asserting the
fixed contract.

### Requirements

- **R1** — Delivery is finalized only after the invocation is accepted: a message claimed by a drain
  whose invocation never starts is released back to `queued` and stays redeliverable.
- **R2** — Delivery state and run outcome stay separate. An invocation that **started** settles the
  message `delivered` regardless of its exit code; the run's failure is the run's to report (task
  0833). `markFailed` is reserved for delivery that cannot be completed.
- **R3** — Attempts are bounded by the existing `injectAttempts` counter. A message that exhausts its
  budget is marked `failed` with a reason — a queryable terminal state, not an infinite retry.
- **R4** — Long-lived loops (`spur agent loop`) observe the same contract as one-shot
  `spur agent run --drain`; the loop keeps iterating after a failure without losing the row.
- **R5** — Acceptance is detected from the `agent.invoke.start` lifecycle event, never inferred from
  an exit code (exit 2 is both a pre-spawn validation failure and a legitimate agent exit).
- **R6** — Ships default-on with no compatibility flag; the prior behavior is silent data loss and is
  not worth preserving behind a branch. Recorded as a recommendation in Q&A — Robin may override.
- **R7** — The 0828 probes are rewritten as regression tests asserting the fixed behavior; probe 4
  (competing consumers, MET) keeps asserting at-most-once claiming.

### Acceptance Criteria


```gherkin
Feature: Commit-after-confirm delivery and bounded failure marking

  @core
  Scenario: Delivery is finalized after the invocation is accepted
    Given one queued message for an agent
    When the drain path prepares the run and the invocation fails to start
    Then the message is not left consumed-without-execution
    And a retry can still deliver it within the bounded attempt budget

  @core
  Scenario: A failing invocation is durably recorded
    Given a drained message whose invocation throws or exits nonzero
    When the agent loop handles the failure
    Then the message is marked failed with its attempt count
    And the failure is visible to the operator without reading stderr

  @core
  Scenario: Attempts are bounded
    Given a message that has exhausted its attempt budget
    When delivery is attempted again
    Then it rests in a queryable terminal failed state rather than retrying forever

  @core
  Scenario: Long-lived loops observe the same contract
    Given a long-lived agent loop draining its queue
    When one invocation fails
    Then the loop keeps iterating and the message is not lost

  @core
  Scenario: Competing consumers still claim at most once
    Given two consumers draining the same queue
    When both attempt to claim one message
    Then exactly one claim succeeds
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:04:15.556Z

- **Compatibility flag (G61 open decision) — closed as: no flag, default-on.** The behavior being
  replaced is silent message loss. A flag that preserves it adds a branch whose only purpose is to
  keep losing work, and every long-lived loop would have to opt in to correctness. Robin owns the
  final call and may reinstate a flag; the implementation assumes default-on.
- **Attempt budget is a constant, not config.** `MAX_INJECT_ATTEMPTS = 3`. Deferred to config only
  if a deployment shows it must vary.
- **Delivery vs run outcome — closed.** An invocation that started settles the message `delivered`
  even when it exits nonzero. This corrects the original R2 wording, which would have re-created the
  single-status conflation G61 exists to remove. Run failure is task 0833's receipt, not a message
  state.
- **Deferred to 0834 (owner: this program).** Rows already stranded at `injected` by the pre-fix
  build are reconciled at restart, not by this task.

### Design

**WHAT.** Give the CLI drain path a settle step, so a claimed message ends in exactly one of
`delivered`, `queued` (released for retry), or `failed` (budget exhausted) — never stranded at
`injected`.

**WHY.** `drainPending`'s atomic conditional UPDATE is correct and must be kept (it is what makes
probe 4 pass). The defect is not the claim; it is that nothing ever settles the claim afterwards.
Peeking before spawning would fix probe 1 by breaking probe 4 — two consumers could read the same
rows. So: keep claim-first, add release.

**WHERE.**

| Layer | Change |
| --- | --- |
| `@gobing-ai/ts-db` (`~/xprojects/ts-libs`, `InboxMessageDao`) | additive `release(msgIds)` verb |
| `packages/app/src/services/team-service.ts` | passthroughs beside `drainPending` (`:356`) |
| `apps/cli/src/commands/agent.ts` | `drainIntoPrompt` (`:543-577`), `runAgentRun` (`:491-519`), `runAgentLoop` (`:707-737`), new settle helper |
| `apps/cli/tests/commands/agent-team.test.ts` | probes `:619-819` flipped to regressions |

**Frozen names.**

- `InboxMessageDao.release(msgIds: string[]): Promise<number>` — `UPDATE inbox_messages SET
  status = 'queued', updated_at = ? WHERE id IN (…) AND status = 'injected'`; returns the affected
  count; leaves `injectAttempts` and `injectError` untouched; emits `message.requeued`.
- `TeamService.releasePending(msgIds: string[])`, `TeamService.settleDelivered(msgIds: string[])`,
  `TeamService.settleFailed(msgIds: string[], error: string)`.
- `drainIntoPrompt` return shape gains `claimed: string[]` — the ids returned by the claim.
- `settleClaimedMessages(context, claimed, outcome)` in `agent.ts`, where
  `outcome: 'accepted' | 'not-started'`.
- `MAX_INJECT_ATTEMPTS = 3` — a module constant in `agent.ts`, not config (the value does not vary
  per deployment; promote to config only if a real need appears).

**Precedence (the settle decision).**

1. Invocation observed starting (`agent.invoke.start` seen for the run) → `settleDelivered(claimed)`.
   The exit code is irrelevant to delivery.
2. Invocation never started (spawn threw, selector validation failed, executor disabled/dangling) and
   the row's `injectAttempts < MAX_INJECT_ATTEMPTS` → `releasePending(claimed)`.
3. Invocation never started and `injectAttempts >= MAX_INJECT_ATTEMPTS` →
   `settleFailed(claimed, reason)`.

**Acceptance signal.** `runAgentRun` already builds an `EventBus` at `:472` and threads it into
`context.agentService({ events: bus })` at `:480`. Subscribe to `agent.invoke.start` on that bus and
treat "at least one start observed" as acceptance. `runAgentLoop` currently calls
`context.agentService()` with no bus (`:724`) — give it the same bus so both callers share one
acceptance rule.

**Anti-patterns — do not implement.**

- Do not replace the atomic claim with a peek-then-claim read; that silently breaks probe 4.
- Do not mark a message `failed` because the agent exited nonzero. That conflates delivery with run
  outcome and re-creates the single-status defect G61 exists to remove.
- Do not reset `injectAttempts` on release — the counter *is* the budget.
- Do not retry inside one loop iteration. Release, and let the next iteration redeliver.
- Do not detect acceptance from the `svc.run` exit code, and do not parse stderr.
- Do not add a Spur-local `inbox_messages` migration. That table is ts-db's; `release` is an additive
  facade change in `~/xprojects/ts-libs`.

**Handoff.** Task 0833 consumes the settled `delivered` ids to write the run↔message receipt; task
0834 consumes `failed` rows and exhausted budgets for restart reconciliation and operator surfaces.
Neither may re-own the settle decision.

### Plan

- [x] 1. Add `release(msgIds)` to `InboxMessageDao` in `~/xprojects/ts-libs` with its `message.requeued`
   event; unit-test the `AND status = 'injected'` guard (a `queued` or `delivered` row is untouched).
   Publish and bump the workspace dependency. (R1)
- [x] 2. Add `releasePending` / `settleDelivered` / `settleFailed` passthroughs to `TeamService` beside
   `drainPending` (`packages/app/src/services/team-service.ts:356`). (R1, R2, R3)
- [x] 3. Return `claimed: string[]` from `drainIntoPrompt` and thread it through both call sites. (R1)
- [x] 4. Subscribe to `agent.invoke.start` on the run bus in `runAgentRun`; give `runAgentLoop` the same
   bus so acceptance is detected identically in both. (R4, R5)
- [x] 5. Implement `settleClaimedMessages` with the three-way precedence and `MAX_INJECT_ATTEMPTS`; call it
   from `runAgentRun` and `runAgentLoop` in a `finally` so an abort still settles. (R1, R2, R3)
- [x] 6. Flip probe 1 and probe 2 in `apps/cli/tests/commands/agent-team.test.ts:619-819` to assert the
   fixed contract; leave probe 4 asserting at-most-once. (R7)
- [x] 7. Add regressions: released row is redelivered on the next drain with `injectAttempts` preserved;
   budget exhaustion lands `failed` with a reason; a started-but-nonzero run settles `delivered`;
   the loop keeps iterating after a spawn failure. (R2, R3, R4)
- [x] 8. `cd apps/cli && bun test tests/commands/agent-team.test.ts`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->
- `~/xprojects/ts-libs/packages/db/src/inbox-message-dao.ts`: additive `release(msgIds)` —
  `UPDATE ... SET status='queued' WHERE id IN (...) AND status='injected'`; `injectAttempts`/
  `injectError` untouched (the claim counter IS the budget), `message.requeued` event emitted.
  Published as `@gobing-ai/ts-db@0.4.64` (GHA Trusted Publishing via aggregate tag, run
  34675557095); spur catalog bumped to `^0.4.64` (+ ts-* family aligned at `^0.4.63` to keep
  one EventBus copy), `bun install` regenerates bun.lock. All part of this task's diff.
- `packages/app/src/services/team-service.ts`: `releasePending(msgIds)`, `settleDelivered(msgIds)`
  (per-id `markDelivered`), `settleFailed(msgIds, error)` (per-id `markFailed`); empty lists no-op.
- `apps/cli/src/commands/agent.ts`: `drainIntoPrompt` returns `claimed: string[]`
  (~:560–640); `MAX_INJECT_ATTEMPTS = 3`; exported `settleClaimedMessages(context, claimed,
  outcome)` — outcome `'accepted'` → settleDelivered; `'not-started'` → rows still `injected`:
  `injectAttempts >= 3` → settleFailed("... never started ..."), else releasePending (already-
  settled rows skipped). Acceptance detected via `bus.on('agent.invoke.start')` on the run bus —
  never from exit code (exit 2 is both validation failure and legitimate agent exit).
  `runAgentRun` (~:545–625) creates the bus, flips `invocationStarted`, tracks `claimed`
  immediately after the drain, settles in `finally` before `ledger.flush()`. `runAgentLoop`
  (~:730–780) same bus + per-iteration try/finally so released rows redeliver next iteration.

**Change map (authoritative)**: apps/cli/src/commands/agent.ts:460 (MAX_INJECT_ATTEMPTS), apps/cli/src/commands/agent.ts:471 (settleClaimedMessages), apps/cli/src/commands/agent.ts:584/820 (settles in finally), packages/app/src/services/team-service.ts:379/390/401 (releasePending/settleDelivered/settleFailed), ~/xprojects/ts-libs/packages/db/src/inbox-message-dao.ts:213-235 (release verb), apps/cli/tests/commands/agent-team.test.ts:690-886 (regressions).
- Acceptance semantics (Design Q&A): started-but-nonzero → delivered (state transition IS the
  confirmation); started+unresponsive → delivered (progress-gate separate); settled-only-rows
  that no longer exist or aren't `injected` are skipped without error.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | delivery finalized only after invocation accepted; never-started claim released to queued, redeliverable: apps/cli/src/commands/agent.ts:471-503 (settleClaimedMessages: not-started → releasePending; guarded `status='injected'`), ~/xprojects/ts-libs/packages/db/src/inbox-message-dao.ts:213-235 (release: UPDATE ... SET status='queued' WHERE id IN (...) AND status='injected', injectAttempts untouched), packages/app/src/services/team-service.ts:379-382; test apps/cli/tests/commands/agent-team.test.ts:690-729 (released back to queued, redeliverable, attempts preserved) |
| R2 | MET | delivery state separate from run outcome: started invocation settles delivered regardless of exit; markFailed reserved for never-started: apps/cli/src/commands/agent.ts:477-479 (accepted → settleDelivered only), packages/app/src/services/team-service.ts:390-406; test apps/cli/tests/commands/agent-team.test.ts:781-821 (start-then-nonzero-exit → status delivered, exit code irrelevant) |
| R3 | MET | bounded by injectAttempts; exhausted budget → failed with queryable reason, MAX_INJECT_ATTEMPTS=3: apps/cli/src/commands/agent.ts:460 (MAX_INJECT_ATTEMPTS=3), :486-502 (injectAttempts >= 3 → settleFailed with reason "delivery not accepted: invocation never started after 3 inject attempts"); test apps/cli/tests/commands/agent-team.test.ts:731-779 (loop burns 3 attempts → status failed, injectAttempts=3, reason asserted) |
| R4 | MET | long-lived loop observes same contract; keeps iterating after failure without losing row: apps/cli/src/commands/agent.ts:790-825 (loop: same bus, per-iteration try/finally settle, released rows redeliver next drain); test apps/cli/tests/commands/agent-team.test.ts:731-779 (loop keeps iterating; redelivery within budget then terminal failed) |
| R5 | MET | acceptance from `agent.invoke.start` lifecycle event, never exit code: apps/cli/src/commands/agent.ts:525-533 (runAgentRun bus.on('agent.invoke.start')) and :791-798 (runAgentLoop same); exit-code-independent settle at :583-585 and :818-821; exit-2 pre-spawn validation path returns before svc.run yet still settles in finally (:566-574, :581-585) |
| R6 | MET | default-on, no compatibility flag: git diff HEAD shows no flag/config addition in apps/cli/src/commands/agent.ts or team-service.ts; settle is unconditional in both runAgentRun (:584) and runAgentLoop (:820) |
| R7 | MET | 0828 probes rewritten as regressions; probe 4 keeps at-most-once: apps/cli/tests/commands/agent-team.test.ts:619-654 (header: flipped by 0831), :655-688 (was probe 1 → delivered), :690-729 (release regression), :853-886 (probe 4 competing consumers at-most-once retained); fresh run: bun test tests/commands/agent-team.test.ts → 35 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Delivery is finalized after the invocation is accepted | MET | test | apps/cli/tests/commands/agent-team.test.ts:690-729 (pre-spawn validation-failure run releases row to queued, injectAttempts preserved, redelivered next drain); code apps/cli/src/commands/agent.ts:471-503 |
| A failing invocation is durably recorded | MET | test | apps/cli/tests/commands/agent-team.test.ts:731-779 (status failed, injectAttempts=3, queryable reason via injectError/settle reason); code packages/app/src/services/team-service.ts:401-406 |
| Attempts are bounded | MET | test | apps/cli/tests/commands/agent-team.test.ts:729-779 (no further redelivery after budget exhausted); code apps/cli/src/commands/agent.ts:460,491 |
| Long-lived loops observe the same contract | MET | test | apps/cli/tests/commands/agent-team.test.ts:731-779; code apps/cli/src/commands/agent.ts:790-825 |
| Competing consumers still claim at most once | MET | test | apps/cli/tests/commands/agent-team.test.ts:853-886; SQL guard ~/xprojects/ts-libs/packages/db/src/inbox-message-dao.ts:130-150 (conditional UPDATE ... AND status='queued') |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

**Verdict: PASS** (reviewer sp-super-reviewer, 2026-09-12, @ HEAD 3761051f9 + uncommitted diff;
profile=auto, mode=safety).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | — | No P1–P3 findings: all 7 requirements verified against 6 changed code/test files; R1–R7 traced to fresh passing tests (see below). Findings below are advisory-only. | `apps/cli/src/commands/agent.ts:459-495` |
| 2 | P4 (advisory) | housekeeping | Zero-byte untracked scratch files `probe.disc`, `probe-equals-if-any` sit in the working tree; do not include them in the task commit (`.spur/host/` is pipeline staging, also untracked). | `probe.disc`, `probe-equals-if-any` |
| 3 | P4 (advisory) | architecture | `settleClaimedMessages` reaches `InboxMessageDao.getById` directly while settle/release go through `TeamService` — two inbox access paths in one helper. Pragmatic (no TeamService.getById); fine to leave. | `apps/cli/src/commands/agent.ts:478-479` |
| 4 | P4 (advisory) | efficiency | Exhausted-budget settle calls `settleFailed` per id (N sequential `markFailed` calls + N `message.failed` events). Bounded by drain limit 100; batch only if exhaustion becomes common. | `apps/cli/src/commands/agent.ts:487-490` |
| 5 | P4 (advisory) | correctness | If `settleClaimedMessages` itself throws inside either `finally`, it would shadow the original run result/exception. Low likelihood (plain DAO updates); acceptable for now. | `apps/cli/src/commands/agent.ts:581-583`, `:822-824` |
| 6 | P4 (advisory) | usability (tests) | `captureInvokeStart` monkey-patches `EventBus.prototype.on` globally; contained by per-test `restore()` in `finally` and bun's sequential in-file execution, but it is a global seam — keep one instance at a time. | `apps/cli/tests/commands/agent-team.test.ts:637-658` |

Residual risk (recorded, not blocking): the attempt budget is enforced at settle time, not in the
claim SQL, so a released row is claimed up to exactly `MAX_INJECT_ATTEMPTS` times before resting
`failed` — that matches R3 and the frozen design (claim must stay unconditional for probe 4).
`history_etl_deepseek` expectation updates in the two domain tests are ripple from the approved
ts-libs family bump (importer registry grew to 16 tables), not 0831 logic.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | claim-then-release: `settleClaimedMessages` `not-started` path → `releasePending` (guard `status='injected'`) — `apps/cli/src/commands/agent.ts:478-486`, `~/xprojects/ts-libs/packages/db/src/inbox-message-dao.ts:213-231`; test asserts release + redelivery with attempts preserved (`apps/cli/tests/commands/agent-team.test.ts:690-712`) |
| R2 | MET | started invocation settles `delivered` regardless of exit; `settleFailed` reserved for never-started — `agent.ts:472-475`, `packages/app/src/services/team-service.ts:384-396`; test `start-then-exit-7 → delivered` (`agent-team.test.ts:781-812`) |
| R3 | MET | `MAX_INJECT_ATTEMPTS = 3` (`agent.ts:459`); exhaustion → `settleFailed` with queryable reason; test: loop burns 3 attempts → `failed`, `injectAttempts=3`, reason contains "never started" (`agent-team.test.ts:729-753`) |
| R4 | MET | loop shares the acceptance rule (same bus) and settles per-iteration in `finally`; released row redelivers next iteration; loop-keeps-iterating asserted (`agent.ts:789-824`, `agent-team.test.ts:729-753`) |
| R5 | MET | acceptance = `bus.on('agent.invoke.start')` in both call sites; exit code never consulted for delivery (`agent.ts:525-533`, `:796-799`); real emitter confirmed at `~/xprojects/ts-libs/packages/ai-runner/src/ai-runner.ts:232` (sync handlers run inside `emit` before first await — flag flips before `svc.run` resolves) |
| R6 | MET | no compatibility flag anywhere in the diff; default-on in both `runAgentRun` and `runAgentLoop` |
| R7 | MET | 0828 probes 1/2 flipped to regressions; probe 4 retained asserting at-most-once claim (`agent-team.test.ts:853-886`); all frozen names present: `release`, `releasePending`, `settleDelivered`, `settleFailed`, `claimed: string[]`, `settleClaimedMessages(context, claimed, outcome)` |

Anti-pattern checks (Design): no peek-then-claim (claim SQL untouched, probe 4 green); nonzero run
never marks `failed` (R2 test proves the opposite); `injectAttempts` not reset on release
(`ts-libs .../inbox-message-dao.ts:213-231` sets only `status`/`updated_at`); no in-iteration retry
(release, redeliver next iteration); no Spur-local inbox migration (engine-only change, published
`@gobing-ai/ts-db@0.4.64`).

Fresh verification evidence (run during this review): `bun test tests/commands/agent-team.test.ts`
→ 35 pass / 0 fail; full `apps/cli` `bun test` → 1041 pass / 0 fail; `packages/domain` dao+analytics
tests (incl. both bumped expectations) → 229 pass / 0 fail; `tsc --noEmit` → exit 0.

**Next:** dispose advisories at commit time (exclude `probe.disc`/`probe-equals-if-any`); proceed
to 0833 (receipt) — it consumes the settled `delivered` ids and must not re-own the settle decision.

### References

- Parent feature: [G61 — Durable project command and result loop](../features/G61_durable-project-command-and-result-loop.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Complete interaction loop"
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §3 probes 1, 2, 4; §5.3 "Delivery confirm-after-run"
- Existing probes: `apps/cli/tests/commands/agent-team.test.ts:611–819`

### History

- 2026-09-12T04:57:17.551Z backlog → todo (system)
- 2026-09-12T05:36:23.450Z todo → wip (system)
- 2026-09-12T05:53:22.949Z wip → testing (system)
- 2026-09-12T05:54:03.798Z testing → done (system)

