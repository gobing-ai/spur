---
schema_version: 1
name: Move the self-draining agent loop out of the agent CLI into a spur-app loop service
status: done
template: feature-impl
created_at: 2026-09-26T05:53:31.176Z
updated_at: "2026-09-28T23:31:48.811Z"
feature_id: G67

dependencies: ["0967"]
priority: P2
estimate_hours: 6
---

## 0968. Move the self-draining agent loop out of the agent CLI into a spur-app loop service

### Background

Source: `/sp:dev-review apps --focus all` (2026-09-25), architecture candidate **C1** (wrong seam and poor test surface), part 2 of 2. Base commit `872024cd2`. **Depends on task 0967.** Re-anchor the line numbers below after that task lands; the symbols are stable.

`spur agent loop` (`runAgentLoop`, `apps/cli/src/commands/agent.ts:1444-1728`) is about 285 lines of orchestration in a CLI transport. It is backed by loop-only helpers in the same file:

| Symbol | Line | Role |
| --- | --- | --- |
| `DEFAULT_LOOP_POLL_MS`, `AgentLoopRuntime` (exported) | :1196-1211 | backstop default, test seam |
| `parseLoopPoll` | :1213 | `--poll` flag parsing (stays in CLI) |
| `loopSleep` | :1241 | abortable sleep |
| `formatReconcileReport` | :1260 | reconcile run-log text (0834 R2) |
| `WAKE_EVENT_NAMES`, `WakeSource`, `WakeResult`, `WAKE_FOLLOW_BATCH`, `waitForWake` | :1284-1344 | 0839 R4/R5 wake-then-drain, forward-only cursor |
| `IDLE_HOLD_EVENT`, `makeFleetRuntime`, `recordIdleHold` | :1346-1420 | 0839 R3 idle hold, deduped by hold key |
| `runAgentLoop` | :1444 | orchestrator claim + heartbeat (`ProjectClaimDao`, `CLAIM_TTL_MS/3`), reconcile, member-mode resolution, wake loop, orchestrator `dispatchNext` via `svc.runTraced('/sp:dev-run <task> --auto')`, member drain via `drainIntoPrompt` (:892) → persistent send or `svc.run`, `settleClaimedMessages` (:753), shutdown release |

CLI-only collaborators the loop reaches:
- `attachSystemEventLedger` (`apps/cli/src/system-event-ledger.ts:53`);
- `makeService` / `makeCheckService` from `./task` (inside `makeFleetRuntime`);
- `drainIntoPrompt` / `drainAgentSelector` (:892 / :943; also used by `runAgentRun`);
- `settleClaimedMessages` (:753; also used by `runAgentRun`).

Existing behavior tests drive the loop through a real `CliContext`:
- `apps/cli/tests/commands/agent-loop-wake.test.ts` (486 lines);
- `agent-loop-member-session.test.ts` (545 lines);
- the loop cases in `agent.test.ts` and `agent-team.test.ts`.

These tests are the behavior lock for this refactor.

### Requirements

- [x] R1. `packages/app/src/services/agent-loop-service.ts` exports an `AgentLoopService` (or `runAgentLoopCore`) that owns:
  - the orchestrator claim, heartbeat and release;
  - the reconcile-before-first-drain step and its report text;
  - the orchestrator resume;
  - member-session setup (via 0967's `MemberSession`);
  - the wake-then-drain loop (`waitForWake`, `loopSleep`, the wake constants);
  - orchestrator `dispatchNext`;
  - the member drain and settle sequence;
  - idle-hold recording with key dedupe;
  - the `ownershipLost` exit code (2).
- [x] R2. The service depends on a structural `AgentLoopDeps` object, not on `CliContext`. CLI-only collaborators are injected as functions: the ledger attach, the drain, the settle, the strategy-runtime factory, the spec listing, and the `write`/`error` output sinks. No module under `packages/app/src` imports from `apps/`.
- [x] R3. `runAgentLoop` in the CLI keeps its exported signature `(context, flags, runtime?, deps?) => Promise<number>`. It validates `--spec` (exit 2 with the same message), parses `--poll`, builds `AgentLoopDeps` from the context, and returns the service's exit code. Every stdout/stderr line, ledger row, exit code and `AgentLoopRuntime` field is unchanged.
- [x] R4. The existing loop tests pass with no assertion edits: `agent-loop-wake`, `agent-loop-member-session`, and the loop cases in `agent.test.ts` and `agent-team.test.ts`.
- [x] R5. `packages/app/tests/services/agent-loop-service.test.ts` unit-covers, with stub deps and an in-memory DB:
  - `waitForWake` returns on the first wake event, consumes non-wake rows, never replays a row, and falls back to `backstop-timeout` at the deadline and on abort;
  - the idle hold writes one row per distinct hold key and resets after a non-empty drain;
  - a not-accepted persistent send settles `not-started`;
  - ownership loss exits 2 and releases the claim.

### Acceptance Criteria

Graduates feature G67 scenarios R3 and R4 (exact titles below); the numbered rows are the verify lens.

- [x] AC1 — R3 — The agent loop is an application service (req: R1, R2, R3)
- [x] AC2 — R4 — Loop behavior is unchanged (req: R4, R5)

**Verify lens**

- **AC1**
  - `rg -n "function (waitForWake|recordIdleHold|loopSleep|formatReconcileReport)|WAKE_EVENT_NAMES =|IDLE_HOLD_EVENT =" apps/cli/src` returns nothing.
  - `rg -n "from '(\.\./)+.*apps/|CliContext" packages/app/src/services/agent-loop-service.ts` returns nothing.
  - `runAgentLoop` in `apps/cli/src/commands/agent.ts` is at most ~60 lines: flag checks, the deps object, the service call.
- **AC2**
  - `(cd apps/cli && bun test tests/commands/agent-loop-wake.test.ts tests/commands/agent-loop-member-session.test.ts tests/commands/agent.test.ts tests/commands/agent-team.test.ts)` passes.
  - `git diff <0967 commit> -- apps/cli/tests` shows no changed `expect(` lines (moving an import is allowed).
  - `(cd packages/app && bun test tests/services/agent-loop-service.test.ts)` passes and covers every R5 case.
  - `bun run spur-check` is green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T05:53:43.379Z

- **Q:** Why inject `drain`, `settle`, `attachLedger` and the strategy-runtime factory instead of moving them too? **A:** Scope. `drainIntoPrompt` and `settleClaimedMessages` are shared with `runAgentRun`. `attachSystemEventLedger` is a CLI module. `makeFleetRuntime` needs the CLI's `makeService`/`makeCheckService`. Moving them is a separate deepening step: record it as a follow-up note, not in this diff. Injection keeps this task a pure move with a fixed test lock.
- **Q:** Should `parseLoopPoll` / `--spec` validation move? **A:** No. Flag parsing is transport work. The service takes `{ recipient, pollMs, flags }`, already validated. It still needs the raw `flags`, because the drain rewrites them (`spec-id`, `agent`, `requestMessage`).
- **Q:** Where do the output lines go? **A:** To `deps.write(text)` (stdout: the reconcile report) and `deps.error(text)` (stderr: warnings, delivery failures, idle-hold failures). The strings move verbatim.
- **Q:** Is a class or a function better? **A:** Either works. Pick one `run()` entry point. The loop's local state (cursor, lastHoldKey, invocationStarted, lastExitRunId) stays local to the run, not on instance fields, so a service instance is not accidentally reused across loops. Record the choice in Solution.
- **Q:** Should the server run this loop now? **A:** No. That is out of scope (G67 Scope Out). This task only makes it possible.

### Design

**Module: `packages/app/src/services/agent-loop-service.ts`.** Move the code verbatim with its comments (the 0831/0834/0839/G66 references are the WHY). Only change `context.x` to `deps.x`.

```ts
export interface AgentLoopDeps {
    cwd: string;
    getDb(): Promise<DbAdapter>;
    write(text: string): void;               // stdout
    error(text: string): void;               // stderr
    /** Per-loop bus-bound agent service (context.agentService({events: bus})). */
    agentService(bus: SystemEventBus): Pick<AgentService, 'run' | 'runTraced'>;
    fleet: FleetService;
    makeStrategyRuntime(): Promise<StrategyRuntime>;          // was makeFleetRuntime(context)
    listAgentSpecs(): Promise<AgentSpec[]>;                   // AgentCoordinationService(context).listAgentSpecs
    reconciler: Pick<DeliveryReconciler, 'reconcile'>;
    drain(flags: Record<string, string | boolean>): Promise<{ prompt?: string; flags: Record<string, string | boolean>; claimed: string[] }>;
    settle(claimed: string[], outcome: 'accepted' | 'not-started'): Promise<void>;
    attachLedger(bus: SystemEventBus): Promise<{ flush(): Promise<void>; unsubscribe(): void }>;
    memberSession: MemberSessionDeps;                         // from task 0967
}
export interface AgentLoopRunInput {
    recipient: string; pollMs: number; flags: Record<string, string | boolean>;
    runtime?: AgentLoopRuntime; runDeps?: AgentRunDeps;
}
export async function runAgentLoopCore(deps: AgentLoopDeps, input: AgentLoopRunInput): Promise<number>;
```

- Moves: `DEFAULT_LOOP_POLL_MS`, `AgentLoopRuntime` (exported; the CLI re-exports its type), `loopSleep`, `formatReconcileReport`, the wake block and the idle-hold block.
- `recordIdleHold` calls `deps.makeStrategyRuntime()` inside its existing try, so a bare project degrades as before.
- `runAgentLoop` is the body of :1444-1728 minus the `--spec` check and `parseLoopPoll`.
- Construct the `EventBus` inside the core. `deps.agentService(bus)` binds it, so the `agent.invoke.start` / `agent.invoke.exit` listeners see the same bus as the runner (0831 R4).

**CLI (`apps/cli/src/commands/agent.ts`).** `runAgentLoop(context, flags, runtime = {}, deps?)`:
1. Run the `--spec` check verbatim (:1450-1454).
2. `pollMs = parseLoopPoll(flags.poll)`.
3. Build `AgentLoopDeps`:
   - `agentService: (bus) => context.agentService({ events: bus })`;
   - `fleet: new FleetService({...})` (moved from :1460);
   - `makeStrategyRuntime: () => makeFleetRuntime(context)` (`makeFleetRuntime` stays in the CLI because it needs `./task`);
   - `listAgentSpecs: () => new AgentCoordinationService(context).listAgentSpecs()`;
   - `reconciler: new DeliveryReconciler(context)`;
   - `drain: (f) => drainIntoPrompt(undefined, context, { ...f, drain: true })`;
   - `settle: (c, o) => settleClaimedMessages(context, c, o)`;
   - `attachLedger: (bus) => attachSystemEventLedger(bus, context)`;
   - `memberSession: {... as in the member-session task}`.
4. `return runAgentLoopCore(deps, { recipient, pollMs, flags, runtime, runDeps: deps })`. Rename the local variable to avoid shadowing the `deps?: AgentRunDeps` parameter.
5. Keep `export type { AgentLoopRuntime }` from `agent.ts` so the tests' imports hold.

**Invariants (behavior lock).**
- The wake cursor only moves forward (never replays a seen row).
- An idle wake costs no model call.
- Claimed rows always settle in `finally`, even on abort.
- One idle-hold row per distinct hold key.
- The orchestrator claim is released on exit.
- Ownership loss → exit 2.
- `operator` reset only when the session has live state.

**Rejected alternatives.**
- Moving `drainIntoPrompt`, `settleClaimedMessages` and `attachSystemEventLedger` in the same diff: they are shared with `runAgentRun`, and it doubles the blast radius. Note it as a follow-up instead.
- Rewriting the loop as a state machine: out of scope, and it would break the pure-move test lock.

### Plan

- [x] Confirm that task 0967 is `done`, then re-read `agent.ts` and re-anchor the Background lines.
- [x] Create `agent-loop-service.ts` (Design) by moving the code verbatim, and export it from `packages/app/src/index.ts`.
- [x] Thin `runAgentLoop` in the CLI (Design, CLI steps 1-5) and remove the imports that become unused.
- [x] Add `packages/app/tests/services/agent-loop-service.test.ts` covering the R5 cases: an in-memory `SystemEventDao` for `waitForWake`, and stub `drain`/`settle`/`agentService`.
- [x] Focused tests:
  - `(cd packages/app && bun test tests/services/agent-loop-service.test.ts tests/services/member-session.test.ts)`
  - `(cd apps/cli && bun test tests/commands/agent-loop-wake.test.ts tests/commands/agent-loop-member-session.test.ts tests/commands/agent.test.ts tests/commands/agent-team.test.ts)`
- [x] Gates: `bun run spur-check`. Run the AC1 `rg` probes and the AC2 `git diff` probe and paste their output. Known flake: `agent-run-fleet` R3 has a 5s timeout under full-suite load. Re-run it in isolation and record the result.
- [x] Record the follow-up note (move drain, settle and ledger-attach into `packages/app`) in Review as out-of-scope.
- [x] One commit: `refactor(agent): move the self-draining agent loop into spur-app (<wbs>)`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:0` |
| `apps/cli/src/commands/agent.ts:1021` |
| `apps/cli/src/commands/agent.ts:1023` |
| `apps/cli/src/commands/agent.ts:1039` |
| `apps/cli/src/commands/agent.ts:1046` |
| `apps/cli/src/commands/agent.ts:1063` |
| `apps/cli/src/commands/agent.ts:1065` |
| `apps/cli/src/commands/agent.ts:11` |
| `apps/cli/src/commands/agent.ts:14` |
| `apps/cli/src/commands/agent.ts:16` |
| `apps/cli/src/commands/agent.ts:17` |
| `apps/cli/src/commands/agent.ts:21` |
| `apps/cli/src/commands/agent.ts:32` |
| `apps/cli/src/commands/agent.ts:36` |
| `apps/cli/src/commands/agent.ts:38` |
| `apps/cli/src/commands/agent.ts:42` |
| `apps/cli/src/commands/agent.ts:5` |
| `apps/cli/src/commands/agent.ts:968` |
| `apps/cli/src/commands/agent.ts:996` |
| `packages/app/src/index.ts:74` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-loop-service.ts:255` `runAgentLoopCore` owns the orchestrator claim (`packages/app/src/services/agent-loop-service.ts:271`), heartbeat, release (`packages/app/src/services/agent-loop-service.ts:480`) and the ownershipLost exit 2 (`packages/app/src/services/agent-loop-service.ts:470`) |
| R2 | MET | `packages/app/src/services/agent-loop-service.ts:44` structural `AgentLoopDeps`; probe `rg -n "from '(\.\./)+.*apps/\|CliContext" packages/app/src/services/agent-loop-service.ts` → none |
| R3 | MET | `apps/cli/src/commands/agent.ts:1028` `runAgentLoop` keeps its signature, 40 lines: flag checks, deps object, service call |
| R4 | MET | `(cd apps/cli && bun test tests/commands/agent-loop-wake.test.ts tests/commands/agent-loop-member-session.test.ts tests/commands/agent.test.ts tests/commands/agent-team.test.ts)` → 90 pass / 0 fail; `git diff 0eaad428a~1 0eaad428a -- apps/cli/tests` has no `expect(` edits |
| R5 | MET | `packages/app/tests/services/agent-loop-service.test.ts:37`, `packages/app/tests/services/agent-loop-service.test.ts:51`, `packages/app/tests/services/agent-loop-service.test.ts:57`, `packages/app/tests/services/agent-loop-service.test.ts:65`, `packages/app/tests/services/agent-loop-service.test.ts:127`, `packages/app/tests/services/agent-loop-service.test.ts:141`, plus new mid-loop heartbeat-loss case `packages/app/tests/services/agent-loop-service.test.ts:160` (exit 2 + claim released; fails when the exit code is mutated) → 7 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — The agent loop is an application service | MET | command | AC1 probes in `apps/cli/src` and the service → none; `packages/app/src/services/agent-loop-service.ts:255`; `apps/cli/src/commands/agent.ts:1028` is 40 lines |
| R4 — Loop behavior is unchanged | MET | test | CLI loop suites 90 pass / 0 fail; `packages/app/tests/services/agent-loop-service.test.ts:160` and the other service cases 7 pass / 0 fail; no `expect(` edits in `apps/cli/tests` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: G67 (parent G6). Depends on task 0967.
- Review source: `/sp:dev-review apps --focus all`, 2026-09-25, candidate C1 (part 2/2); base commit `872024cd2`.
- ADR-021. Tasks 0258 R6 (loop wrapper), 0831 (delivery acceptance/settle), 0834 R2 (reconcile before first drain), 0838/0839 (strategy runtime, wake-then-drain, idle hold), 0896 (G66).

### History

- 2026-09-26T05:53:52.891Z backlog → todo (system)
- 2026-09-28T22:28:47.199Z todo → wip (system)
- 2026-09-28T22:28:47.841Z wip → testing (system)
- 2026-09-28T22:29:16.050Z testing → done (system)

