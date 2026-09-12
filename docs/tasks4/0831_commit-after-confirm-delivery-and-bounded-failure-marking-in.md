---
schema_version: 1
name: Commit-after-confirm delivery and bounded failure marking in the agent drain path
status: todo
template: feature-impl
created_at: 2026-09-12T04:45:29.914Z
updated_at: "2026-09-12T05:04:15.556Z"
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

1. Add `release(msgIds)` to `InboxMessageDao` in `~/xprojects/ts-libs` with its `message.requeued`
   event; unit-test the `AND status = 'injected'` guard (a `queued` or `delivered` row is untouched).
   Publish and bump the workspace dependency. (R1)
2. Add `releasePending` / `settleDelivered` / `settleFailed` passthroughs to `TeamService` beside
   `drainPending` (`packages/app/src/services/team-service.ts:356`). (R1, R2, R3)
3. Return `claimed: string[]` from `drainIntoPrompt` and thread it through both call sites. (R1)
4. Subscribe to `agent.invoke.start` on the run bus in `runAgentRun`; give `runAgentLoop` the same
   bus so acceptance is detected identically in both. (R4, R5)
5. Implement `settleClaimedMessages` with the three-way precedence and `MAX_INJECT_ATTEMPTS`; call it
   from `runAgentRun` and `runAgentLoop` in a `finally` so an abort still settles. (R1, R2, R3)
6. Flip probe 1 and probe 2 in `apps/cli/tests/commands/agent-team.test.ts:619-819` to assert the
   fixed contract; leave probe 4 asserting at-most-once. (R7)
7. Add regressions: released row is redelivered on the next drain with `injectAttempts` preserved;
   budget exhaustion lands `failed` with a reason; a started-but-nonzero run settles `delivered`;
   the loop keeps iterating after a spawn failure. (R2, R3, R4)
8. `cd apps/cli && bun test tests/commands/agent-team.test.ts`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G61 — Durable project command and result loop](../features/G61_durable-project-command-and-result-loop.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Complete interaction loop"
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §3 probes 1, 2, 4; §5.3 "Delivery confirm-after-run"
- Existing probes: `apps/cli/tests/commands/agent-team.test.ts:611–819`

### History

- 2026-09-12T04:57:17.551Z backlog → todo (system)

