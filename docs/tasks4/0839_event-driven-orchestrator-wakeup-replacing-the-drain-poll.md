---
schema_version: 1
name: Event-driven orchestrator wakeup replacing the drain poll
status: done
template: feature-impl
created_at: 2026-09-12T04:53:38.725Z
updated_at: "2026-09-13T08:04:45.511Z"
feature_id: G62
priority: P2
tags:
  - g6-program

dependencies: ["0838", "0833"]
---

## 0839. Event-driven orchestrator wakeup replacing the drain poll

### Background

`runAgentLoop` drains on every iteration and sleeps `--poll` (default `DEFAULT_LOOP_POLL_MS = 2000`,
`apps/cli/src/commands/agent.ts:638`) when the queue is empty (`:707-738`). The approved design requires
waking on specific events and costing nothing while idle
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Strategy and capacity" — "No runnable
work should produce a durable reason and a bounded/event-driven wakeup, not a hot LLM polling loop").

**Premise correction, made during implement-ready refinement.** This task's original framing — "that is
a hot loop for an orchestrator that holds a model" — is wrong about the current code, and the frozen
design must not rest on it. The loop body at `apps/cli/src/commands/agent.ts:730-735` is:

```ts
const { prompt, flags: rewritten } = await drainIntoPrompt(undefined, context, { ...flags, drain: true });
if (prompt !== undefined) { await svc.run(prompt, rewritten, deps); } else { await sleep(pollMs); }
```

The model is invoked **only** on a non-empty drain, so R2's "idle wakeups cost no model call" already
holds today. The three real defects are narrower and are what this task fixes:

1. **One wake source.** The loop only ever notices inbox messages. A strategy change, a capacity change,
   or an arriving completion receipt cannot wake it — it will sit until the next 2 s tick regardless.
2. **Silent sleep.** The `else` branch records nothing, so an operator cannot tell an idle orchestrator
   from a wedged one (R3).
3. **Unconditional drain.** Every 2 s the loop issues a write-intent drain query whether or not anything
   changed; that is the cost to remove (R4).

**Premise check — the wake mechanism already exists.** `followSystemEventsAfter`
(`packages/app/src/services/system-event-follow.ts:44`) is an async generator over the `system_events`
ledger with `FOLLOW_POLL_INTERVAL_MS = 100` (`:29`); `SystemEventDao.follow(afterSequence, limit)` and
`latestSequence()` back it (`packages/domain/src/dao/system-event-dao.ts:398`, `:420`). The loop already
reads that ledger for invoke events (`readLatestInvokeEvent`, `apps/cli/src/commands/agent.ts:741`).

**Premise check — two of the four wake sources have no event today.** `message.sent` and
`agent.invoke.exit` are cataloged (`packages/app/src/services/event-names.ts:271`, `:280-281`). Nothing
is emitted when the strategy changes (0838) or when a claim is taken or released (0836/0837).

**Premise check — the producer dependency is real.** The completion receipt from task 0833 is written in
the same `AgentService.executeRun` exit sink that emits `agent.invoke.exit`, so the receipt is durable
before the wake fires. Without 0833 there is no "result arrived" fact to wake on, which is why
`docs/reports/g6-strategy-prototype.md` §4.8 records the wakeup surface as simulated.

### Requirements

- **R1** — Wake sources are explicit and enumerable: human request, strategy change, task or capacity
  change, and completion receipt. Each has a named ledger event.
- **R2** — Idle wakeups cost no model call and no dispatch. (Already true of the model call; this task
  must not regress it while adding sources.)
- **R3** — When nothing is runnable, a durable, operator-readable hold reason is recorded instead of a
  silent sleep — and recorded on change, not on every wake.
- **R4** — The 2000 ms unconditional drain is replaced by a wake-then-drain: the drain runs only after a
  wake, not on a fixed tick.
- **R5** — The cutover is safe for already-promoted long-lived loops: `--poll` survives as a backstop
  timeout so an existing `spur agent loop` keeps consuming its queue with no manual migration.
- **R6** — Tests assert zero model calls across repeated idle wakeups and a wake on each declared source.

### Acceptance Criteria

```gherkin
Feature: Event-driven orchestrator wakeup replacing the drain poll

  @core
  Scenario: R7 — Idle costs nothing
    Given no eligible work and no new input
    When the orchestrator idles across several wakeup intervals
    Then no model call and no dispatch occur
    And the current hold reason is readable by the operator

  @core
  Scenario: Each declared source wakes the orchestrator
    Given an idle orchestrator
    When a human request, a strategy change, a capacity change, or a completion receipt occurs
    Then the orchestrator wakes for that event

  @core
  Scenario: Existing loops keep working
    Given a long-lived loop promoted before this change
    When the wakeup path ships
    Then the loop continues to consume its queue without a manual migration step
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:24:00.274Z

- **R5 replace-versus-dedup — CLOSED: replace the tick, keep the flag.** The fixed-tick drain is removed
  and the drain moves behind the wake (R4); `--poll` survives with its name, default
  (`DEFAULT_LOOP_POLL_MS = 2000`) and parser as the backstop timeout, so an already-promoted
  `spur agent loop` keeps working at the same worst-case latency with no migration step. That satisfies
  the "existing loops keep working" scenario without leaving two drain paths to maintain.
- **Wake transport — CLOSED: the `system_events` ledger via `followSystemEventsAfter`.** The producers
  are other processes (an operator's `spur message send`, another agent's run exit), so an in-process
  `EventBus` cannot see them, and `AGENTS.md` forbids a second IPC transport. Ceiling stated plainly:
  the follow generator is itself a 100 ms indexed query (`FOLLOW_POLL_INTERVAL_MS`), so this is
  cheap-poll, not push — it costs one indexed read per 100 ms and no model call. If that ever shows up
  in a profile, the upgrade is a SQLite update hook or a notify socket, not a shorter interval.
- **Two new event names — CLOSED: `strategy.changed` and `fleet.capacity.changed`.** `message.sent` and
  `agent.invoke.exit` already cover the other two sources. These are catalog entries in
  `event-names.ts`, not `spur` CLI surface, so `docs/design/harness-surface-governance.md` consent does
  not apply; the catalog registration is part of the change.
- **Completion receipt wake — CLOSED: `agent.invoke.exit`, no third event.** Task 0833 writes the
  receipt in the same `AgentService.executeRun` exit sink that emits the event, so the receipt is
  durable before any consumer wakes. A separate `receipt.written` event would fire from the same line.
- **Hold recorded on change only — CLOSED.** Writing per wake would flood `system_events` in exactly the
  idle case this task exists to make cheap; `SystemEventDao.pruneQuotas` would then be doing cleanup for
  a problem we introduced.
- **R2 was already satisfied — NOTED, not a change.** The current loop guards `svc.run` behind
  `prompt !== undefined`, so no model call happens while idle today. This task's job is to preserve that
  while adding wake sources; the tests assert it so a later refactor cannot lose it silently.
- **Deferred (owner: G63 0844).** Operator-facing rendering of the recorded idle hold.

### Design

**WHAT.** Replace the fixed-tick drain in `runAgentLoop` with a wait on the `system_events` ledger
filtered to four wake events, keeping `--poll` as the backstop timeout, and record the idle hold reason
on transition.

**WHY the ledger rather than a new watcher.** `followSystemEventsAfter` already exists, already tails
`system_events` from a sequence, and the loop already reads that ledger for invoke events. A new
in-process `EventBus` subscription would not survive the process boundary — the events this loop must
wake on are produced by *other* processes (an operator's `spur message send`, another agent's run exit).
The ledger is the only shared, durable, cross-process fact source in the tree.

**WHERE.**

| Layer | Change |
| --- | --- |
| `packages/app/src/services/event-names.ts` | catalog `strategy.changed`, `fleet.capacity.changed` |
| `packages/app/src/services/strategy-runtime.ts` (0838) | emit `strategy.changed` on `setStrategy` |
| `packages/app/src/services/write-slot-service.ts` (0837) | emit `fleet.capacity.changed` on claim/release |
| `apps/cli/src/commands/agent.ts:707-738` | `runAgentLoop` body: wake-then-drain |

**Frozen names.**

```ts
// apps/cli/src/commands/agent.ts
const WAKE_EVENT_NAMES = [
    'message.sent',            // human request / orchestrator order   (existing)
    'strategy.changed',        // strategy change                      (new)
    'fleet.capacity.changed',  // task or capacity change              (new)
    'agent.invoke.exit',       // completion receipt (0833 writes it in the same sink)
] as const;
type WakeSource = (typeof WAKE_EVENT_NAMES)[number] | 'backstop-timeout';
interface WakeResult { source: WakeSource; sequence: number; }
async function waitForWake(dao: SystemEventDao, afterSequence: number, timeoutMs: number,
                           signal?: AbortSignal): Promise<WakeResult>;
```

`DEFAULT_LOOP_POLL_MS = 2000` (`:638`) and `parseLoopPoll` (`:651`) are **kept verbatim**; `--poll` is
re-purposed from "idle sleep" to "backstop timeout" and keeps its name, default, and parsing (R5).

**Loop body, replacing `:730-735`.**

```ts
let cursor = await dao.latestSequence();
let lastHoldKey = '';
while (!runtime.signal?.aborted && …) {
    const wake = await waitForWake(dao, cursor, pollMs, runtime.signal);
    cursor = wake.sequence;
    const { prompt, flags: rewritten } = await drainIntoPrompt(undefined, context, { ...flags, drain: true });
    if (prompt !== undefined) { await svc.run(prompt, rewritten, deps); lastHoldKey = ''; }
    else { lastHoldKey = await recordIdleHold(context, recipient, wake.source, lastHoldKey); }
    iteration++;
}
```

The drain now runs **after** a wake instead of before a sleep — that is R4's "replaced, not wrapped".
The `prompt !== undefined` guard around `svc.run` is preserved exactly, which is how R2 stays true.

**Cursor initialization.** `cursor` starts at `latestSequence()` so a long-idle ledger does not fire a
spurious immediate wake, and advances to the observed sequence on every wake — including a backstop
timeout, where `waitForWake` returns the current `latestSequence()`. A wake therefore never replays the
same event, and a missed event is impossible because the cursor only moves forward past events the loop
has already seen.

**Backstop timeout (R5).** `waitForWake` resolves `{ source: 'backstop-timeout' }` after `pollMs` with
no matching event. The subsequent drain is identical to today's, so a loop promoted before this change
continues to consume its queue at the same worst-case latency with no migration step and no flag change.
A matching event simply makes it faster.

**Idle hold (R3).** `recordIdleHold` asks 0838's `StrategyRuntime.selectNext` for the current
`DispatchHold[]`, derives a stable key (sorted `wbs:reason` pairs, or `'idle'` when there are no
candidates), and writes one `system_events` row **only when the key differs from `lastHoldKey`**. A
steadily idle orchestrator therefore writes one row, not one per wake — an unconditional write would
turn a quiet loop into a ledger flood and re-create the cost this task removes.

**Anti-patterns — do not implement.**

- Do not keep a fixed-tick drain alongside the wake — the unconditional drain is the defect (R4).
- Do not remove or rename `--poll` / `DEFAULT_LOOP_POLL_MS`; promoted loops depend on them (R5).
- Do not move the `svc.run` call outside the `prompt !== undefined` guard, and do not invoke the model
  to decide whether there is work (R2).
- Do not write a hold row on every wake; write on change only (R3).
- Do not build an in-process `EventBus` subscription as the wake path — the producers are other
  processes.
- Do not add a daemon, a broker, a socket, or a file watcher; `AGENTS.md` § "Conventions & boundaries"
  forbids a second IPC transport.
- Do not start the cursor at 0; that replays the entire ledger on start.
- Do not wake on every event name — an unfiltered follow re-creates the hot loop with extra steps.

**Handoff.** G63 0844 renders the recorded idle hold as the Board's hold state; nothing else consumes
these events.

### Plan

1. Catalog `strategy.changed` and `fleet.capacity.changed` in
   `packages/app/src/services/event-names.ts` alongside the existing `agent.*` / `message.*` entries. (R1)
2. Emit `strategy.changed` from `StrategyRuntime.setStrategy` (0838) and `fleet.capacity.changed` from
   `WriteSlotService.claim` / `release` (0837). (R1)
3. Add `WAKE_EVENT_NAMES`, `WakeSource`, `WakeResult`, and `waitForWake` to
   `apps/cli/src/commands/agent.ts`, built on `followSystemEventsAfter` with a `pollMs` backstop. (R1, R5)
4. Replace the `runAgentLoop` body at `:730-735` with the wake-then-drain shape, initializing `cursor`
   from `latestSequence()`. (R4)
5. Add `recordIdleHold` writing one `system_events` row on hold-key change only, sourced from
   `StrategyRuntime.selectNext`. (R3)
6. Tests, `apps/cli/tests/commands/agent-loop-wake.test.ts` with an injected `runtime.signal` and
   `maxIterations`: five idle wakeups produce zero `svc.run` calls and zero dispatches; one
   `message.sent`, one `strategy.changed`, one `fleet.capacity.changed`, and one `agent.invoke.exit`
   each wake the loop exactly once; a backstop timeout with a queued message still drains it; a
   steady idle state writes exactly one hold row across repeated wakes; the cursor never replays. (R2, R6)
7. Update the `agent` reference under `plugins/sp/skills/spur-cli/references/` to describe `--poll` as
   the backstop timeout. (R5)
8. `cd apps/cli && bun test tests/commands/agent-loop-wake.test.ts`, then `bun run spur-check`.

### Solution

Wake-then-drain loop on the existing `system_events` ledger — no new transport, no daemon, **no new migration/drizzle file** (wake facts ride the cataloged ledger; `--poll` keeps promoted 0835 loops draining with no re-provisioning).

**Catalog + producers (R1).**
- `packages/app/src/services/event-names.ts:306-314` — `strategy.changed` + `fleet.capacity.changed` cataloged (agent family, metadata-only, producer override `fleet-strategy` / `write-slot`); presenters at `:809` / `:825` (doc-sync gate rows added to `docs/design/event-tracking.md` §11).
- `packages/app/src/services/strategy-runtime.ts:243-255` — `setStrategy` emits `strategy.changed` (actor `strategy-runtime`, payload `projectPath`/`strategy`/`version`) into the same db as the persisted row; read paths emit nothing.
- `packages/app/src/services/write-slot-service.ts:138-160` / `:203-218` — `claim` emits `fleet.capacity.changed` ONLY when the slot lease is taken (proven read-only claims emit nothing); `release` emits ONLY on an actual release.

**Consumer loop (R4, R5, R2).**
- `apps/cli/src/commands/agent.ts:793-801` — frozen `WAKE_EVENT_NAMES` + `WakeSource`/`WakeResult`; `waitForWake` at `:830-856` keyset-follows `sequence > cursor` at the shared follower cadence (`FOLLOW_POLL_INTERVAL_MS`), returns the first wake event or the `--poll` backstop snapshot (`latestSequence()`; abort returns promptly) — the cursor never replays a seen row. Built on `dao.follow` (the same query `followSystemEventsAfter` tails) because the frozen signature passes a dao, not a getDb factory; the ledger stays the only transport.
- `apps/cli/src/commands/agent.ts:979-1010` — `runAgentLoop` body: cursor starts at `latestSequence()` (no replay on start), wake → `cursor = wake.sequence` → drain; a prompt runs the agent and resets the hold key; an empty drain records the hold. `AgentLoopRuntime.sleep` seam removed (dead after the rewrite); `DEFAULT_LOOP_POLL_MS` (`:719`) repurposed as the backstop; `--poll` help text updated (`apps/cli/src/commands/shared-options.ts:61`).

**Idle holds (R3).**
- `apps/cli/src/commands/agent.ts:872-912` — `recordIdleHold` sources holds from 0838's `StrategyRuntime.selectNext` (runtime constructed over the loop's cwd db; `makeService`/`makeCheckService` exported from `apps/cli/src/commands/task.ts:1624`/`:1699` — precedent: `workflow.ts` imports `makeTaskLocator` from `./task`), writes one `fleet.idle-hold` `system_events` row on hold-key change ONLY (steady idle = one row, not one per wake; any construction/select failure is logged, never fatal). The event is deliberately uncataloged (0837 precedent `fleet.write-slot.stale-owner-rejected`); G63 0844 renders it.

**Dispositions (required).**
- (a) unchecked `row.strategy as StrategyName` casts (0838 read path): NOT changed — outside 0839's diff scope; the values are schema-constrained by the same single writer (`setStrategy`).
- (b) O(candidates×deps) dep-gate amplification: RESOLVED BY DESIGN — idle `selectNext` is now event-bounded (only on a wake), not every 2 s; per-wake runtime construction accepted (section matrix is cached); no snapshot cache added.
- (c) capacity-vs-priority iteration order: UNCHANGED — 0838's `selectNext` ordering is authoritative and untouched by this diff; the wake rewrite does not alter selection order.
- `message.sent` durability gap: DOCUMENTED, no code change — bare-CLI `TeamService` senders attach no ledger bus, so a CLI-side send writes no wake fact; Board/server senders persist it and the R5 backstop still drains every `--poll` ms.
- Heartbeat: no `ProjectClaimDao` heartbeat added — the loop holds no live write claim (`WriteSlotService.claim` has no CLI caller on this path).

#### 2026-09-13 forced re-audit

Re-audit repair: task.created, task.updated, and message.replied now wake the consumer. Plain CLI message senders persist metadata-only wake events when no bus is attached. Loop invocations attach/flush the existing ledger; abort is checked after waiting. The earlier CLI-sender durability-gap disposition is superseded. GTD dispatch integration remains a feature-level gap owned by the strategy/claim tasks, not proof supplied by synthetic wake rows.

Current per-requirement evidence and residuals are in Testing and `docs/reports/g62-verifyall-2026-09-13.md`. Earlier implementation-time anchors and completion statements above are historical; this re-audit supersedes them.

#### G62 closure — 2026-09-13

This implementation supersedes the unresolved gaps recorded in the preceding re-audit. Fleet wakes now drive managed selection and fenced dispatch while undeclared projects retain their legacy drain behavior. Arbitrary queued input cannot bypass fleet authorization. Owner and write-lease renewal are integrated; the ledger remains the wake transport and unchanged idle holds remain deduplicated.

Regression evidence is recorded in the refreshed Testing section. New changes are intentionally uncommitted for the operator's next step.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/commands/agent-loop-wake.test.ts:202` — plain sends persist wake events; `apps/cli/tests/commands/agent-loop-wake.test.ts:192` — creation, updates, and replies each wake the loop; `apps/cli/tests/commands/agent-loop-wake.test.ts:179` — strategy wake; `apps/cli/tests/commands/agent-loop-wake.test.ts:217` — capacity wake; `apps/cli/tests/commands/agent-loop-wake.test.ts:234` — completion wake; `bun run spur-check` (exit 0). Measured repository coverage: 98.99% lines, 99.21% functions. Evidence: G62 closure `.spur/run/g62-verifyall-20260913/spur-check-shippable.log` line 1 through EOF. Replaces Evidence: G62 re-audit `.spur/run/0839-verify-answer.txt` line 1 through EOF and `.spur/run/0839-verdict.json` line 1 through EOF; prior artifacts are preserved under the closure run directory. |
| R2 | MET | `apps/cli/tests/commands/agent-loop-wake.test.ts:282` — repeated idle wakes make zero model calls and no dispatch; `bun run spur-check` (exit 0). |
| R3 | MET | `apps/cli/tests/commands/agent-loop-wake.test.ts:282` — the hold is persisted once for an unchanged idle state; `apps/cli/tests/commands/agent-loop-wake.test.ts:306` — work starts a fresh idle stretch; `bun run spur-check` (exit 0). |
| R4 | MET | `apps/cli/tests/commands/agent-loop-wake.test.ts:333` — the consumer waits for a wake before draining and never replays consumed events; `bun run spur-check` (exit 0). |
| R5 | MET | `apps/cli/tests/commands/agent-loop-wake.test.ts:268` — legacy queued work continues on the unchanged poll backstop; `bun run spur-check` (exit 0). |
| R6 | MET | `apps/cli/tests/commands/agent-loop-wake.test.ts:282` — idle model-call count is asserted; `apps/cli/tests/commands/agent-loop-wake.test.ts:234` — named sources each have a consumer wake test; `apps/cli/tests/commands/agent-loop-wake.test.ts:202` — plain sends persist wake events; `apps/cli/tests/commands/agent-loop-wake.test.ts:192` — creation, updates, and replies each wake the loop; `apps/cli/tests/commands/agent-loop-wake.test.ts:179` — strategy wake; `apps/cli/tests/commands/agent-loop-wake.test.ts:217` — capacity wake; `apps/cli/tests/commands/agent-loop-wake.test.ts:234` — completion wake; `bun run spur-check` (exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — Idle costs nothing | MET | test | `apps/cli/tests/commands/agent-loop-wake.test.ts:282` — repeated idle wakes make zero model calls and no dispatch; `bun run spur-check` (exit 0). |
| Each declared source wakes the orchestrator | MET | test | `apps/cli/tests/commands/agent-loop-wake.test.ts:202` — plain sends persist wake events; `apps/cli/tests/commands/agent-loop-wake.test.ts:192` — creation, updates, and replies each wake the loop; `apps/cli/tests/commands/agent-loop-wake.test.ts:179` — strategy wake; `apps/cli/tests/commands/agent-loop-wake.test.ts:217` — capacity wake; `apps/cli/tests/commands/agent-loop-wake.test.ts:234` — completion wake; `bun run spur-check` (exit 0). |
| Existing loops keep working | MET | test | `apps/cli/tests/commands/agent-loop-wake.test.ts:268` — legacy queued work continues on the unchanged poll backstop; `bun run spur-check` (exit 0). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | repository-gate | — | `bun run spur-check` (exit 0): 8526 tests, 0 failures, 478 files; lint/typecheck and all 45 pre-rules plus 2 post-rules pass. |
| P4 | coverage | — | Coverage: 98.99% lines, 99.21% functions, measured by the repository gate. |
| P4 | cloudflare | — | `bun run test-cf` (exit 0): 1 test passed. |
| P4 | build | — | `bun run build` (exit 0); CLI linked and bundle regenerated. |
| P4 | design-conformance | — | Existing corpus, task checker, dependency gate, agent runner, reconciliation and event ledger remain the owners. No new public noun/verb, table, migration, dependency or workflow engine. |
| P4 | artifact-provenance | — | Canonical task answer/verdict replace the earlier failed audit; earlier artifacts are preserved in the closure run directory. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity"
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §4.8 simulated wakeup surface
- Code: `apps/cli/src/commands/agent.ts:706-745` (drain loop and `--poll` default)
- Producer dependency: task 0833 completion receipt supplies the result-arrived event

### History

- 2026-09-12T18:58:37.446Z todo → wip (system)
- 2026-09-12T19:51:06.014Z wip → testing (system)
- 2026-09-12T19:51:06.660Z testing → done (system)

