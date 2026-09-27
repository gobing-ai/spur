---
schema_version: 1
name: Move the G66 member session out of the agent CLI into a spur-app MemberSession service
status: wip
template: feature-impl
created_at: 2026-09-26T05:53:30.523Z
updated_at: "2026-09-27T06:11:05.087Z"
feature_id: G67

---

## 0967. Move the G66 member session out of the agent CLI into a spur-app MemberSession service

### Background

Source: `/sp:dev-review apps --focus all` (2026-09-25), architecture candidate **C1** (wrong seam and poor test surface), part 1 of 2. Base commit `872024cd2` (branch `fix/apps-review-minors`). Part 2 (the loop itself) is the sibling task under G67 and depends on this one.

The G66 member session (task 0896, observability 0897) lives entirely in the CLI transport, `apps/cli/src/commands/agent.ts`, as free functions that take a `CliContext`:

| Symbol | Line | Uses from CliContext |
| --- | --- | --- |
| `MemberSessionMode`, `MemberSessionResetReason`, `MemberAgentProcess` (exported), `MemberSession`, `MAX_CONSECUTIVE_FAILED_DRAINS` | :973-1011 | — |
| `memberAgentBinary(spec, context)` | :1018 | `agentConfig?.executors` |
| `selectsPersistentStdinDispatch(argv)` (exported) | :1037 | — |
| `memberDispatchCommand(spec, canonical, persistentStdin)` | :1051 | — |
| `resolveMemberSessionMode(spec, context)` | :1081 | `agentConfig`, `output.error` (the `member-persistent-stdin-unwired` warning) |
| `memberProcessOptions(spec, context)` | :1108 | `agentConfig`, `env` |
| `ensureMemberProcess(context, recipient, spec, session, runtime)` | :1137 | `runtime.memberProcessFactory` |
| `resetMemberSession(context, recipient, session, reason, detail)` | :1161 | `getDb` (`SystemEventDao` insert `MEMBER_SESSION_RESET_EVENT`), `output.error` |
| `drainedSessionId(context, runId)` | :1189 | `getDb` (`RunSessionDao.getByRunId`, exact rows only) |

The session state is also mutated inline inside `runAgentLoop` (:1444-1728):
- :1540-1561 mode resolution, the `recordMemberSession` ledger mirror and the `member-no-session` warning;
- :1636-1685 the persistent send and the resume `session-id` flag;
- :1690-1708 the failed-drain counter, the reset at the limit and resume-id capture;
- :1715-1721 the `operator` reset on shutdown.

Why it matters:
- ADR-021 says orchestration belongs in `packages/app`.
- Today the session can only be tested by driving the whole loop through a real `CliContext` (`apps/cli/tests/commands/agent-loop-member-session.test.ts`, 545 lines).
- No other transport (the server fleet surfaces, G6x) can reuse it.

`packages/app/package.json` already lists `@gobing-ai/ts-ai-runner` and `@gobing-ai/spur-domain` (verified on the review date), so no new dependency is needed.

### Requirements

- [ ] R1. `packages/app/src/services/member-session.ts` owns everything in the Background table:
  - the types, `MAX_CONSECUTIVE_FAILED_DRAINS` and `selectsPersistentStdinDispatch`;
  - a `MemberSession` class holding the loop-lifetime state (`mode`, resume `id`, live `process`, consecutive failed-drain count);
  - that class's methods for mode resolution, ensure-process, reset, resume-id capture and failed-drain accounting.

  `apps/cli/src/commands/agent.ts` declares none of these symbols afterwards.
- [ ] R2. The service depends on a structural `MemberSessionDeps` object, not on `CliContext`. `CliContext` must satisfy it (or satisfy it with a one-line adapter).
- [ ] R3. `runAgentLoop` in the CLI uses the class at the five sites listed in Background. Every stderr line, ledger event (`MEMBER_SESSION_RESET_EVENT` payload `{reason, mode, ...detail}`, `recordMemberSession` rows), exit code and `AgentLoopRuntime.memberProcessFactory` seam behaves byte-for-byte as before.
- [ ] R4. `packages/app/tests/services/member-session.test.ts` covers, without a `CliContext` or a spawned agent:
  - persistent / resume / one-shot resolution, including the `member-persistent-stdin-unwired` degrade;
  - the `restart` reset on a dead process;
  - the `failed-drains` reset at exactly `MAX_CONSECUTIVE_FAILED_DRAINS` with the counter restarting;
  - resume-id capture from an exact `run_sessions` row and no capture from an inexact row;
  - the `operator` reset only when there is live state.
- [ ] R5. `MemberAgentProcess` and `selectsPersistentStdinDispatch` stay importable from `apps/cli/src/commands/agent` (a re-export), so `agent-loop-member-session.test.ts:29` compiles with no edit.

### Acceptance Criteria

Graduates feature G67 scenarios R1 and R2 (exact titles below); the numbered rows are the verify lens. G67 R3 and R4 belong to task 0968.

- [ ] AC1 — R1 — Member session logic is an application service (req: R1, R3, R5)
- [ ] AC2 — R2 — The member session is testable without a CLI context (req: R2, R4)

**Verify lens**

- **AC1**
  - `rg -n "function (memberAgentBinary|memberDispatchCommand|resolveMemberSessionMode|memberProcessOptions|ensureMemberProcess|resetMemberSession|drainedSessionId)|MAX_CONSECUTIVE_FAILED_DRAINS =" apps/cli/src` returns nothing, and the same names resolve in `packages/app/src/services/member-session.ts`.
  - `(cd apps/cli && bun test tests/commands/agent-loop-member-session.test.ts tests/commands/agent-loop-wake.test.ts tests/commands/agent.test.ts tests/commands/agent-team.test.ts)` passes.
  - `git diff 872024cd2 -- apps/cli/tests` is empty.
- **AC2**
  - `(cd packages/app && bun test tests/services/member-session.test.ts)` passes and covers every R4 case.
  - `rg -n "CliContext|apps/cli" packages/app/src/services/member-session.ts` returns nothing.
  - `bun run spur-check` is green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T05:53:40.343Z

- **Q:** A class or free functions? **A:** A class. The session is mutable loop-lifetime state (mode, id, process, failed-drain counter) that the loop threads through five call sites today as a mutable object literal (`const memberSession: MemberSession = { mode: 'one-shot' }`, :1508). A class holds it plus its deps, so a call site becomes `session.reset('operator')` instead of `resetMemberSession(context, recipient, memberSession, 'operator')`.
- **Q:** Move the failed-drain counter in too? **A:** Yes. `recordDrain(failed: boolean)` owns the counter, the reset at the limit and the resume capture that follows a successful drain. Those are G66 R4/R7 session rules, not loop mechanics.
- **Q:** Where do warnings go? **A:** To `deps.warn(message)`. The CLI passes `(m) => context.output.error(m)`. The message strings move verbatim.
- **Q:** Keep the `memberProcessFactory` test seam on `AgentLoopRuntime`? **A:** Yes. The CLI forwards `runtime.memberProcessFactory` into `MemberSessionDeps.processFactory`. The public `AgentLoopRuntime` shape is unchanged.
- **Q:** Should this task also move `drainIntoPrompt` / `drainAgentSelector`? **A:** No. They are inbox drain mechanics used by `runAgentRun` as well. They belong to the loop task or stay put.

### Design

**Module: `packages/app/src/services/member-session.ts`.** It is a move, not a rewrite: keep every doc comment (the G66 R-references are the WHY).

```ts
export type MemberSessionMode = 'persistent' | 'resume' | 'one-shot';
export type MemberSessionResetReason = 'restart' | 'operator' | 'failed-drains';
export interface MemberAgentProcess { /* verbatim from agent.ts:989 */ }
export const MAX_CONSECUTIVE_FAILED_DRAINS = 3;
export function selectsPersistentStdinDispatch(argv: readonly string[]): boolean; // verbatim

export interface MemberSessionDeps {
    /** `agentConfig?.executors`: executor name → agent binary lookup. */
    executors: readonly { name: string; agent?: string }[];
    env: Record<string, string | undefined>;
    getDb(): Promise<DbAdapter>;
    warn(message: string): void;
    processFactory?: (options: AgentProcessOptions) => MemberAgentProcess; // default: new TeamAgentProcess
}

export class MemberSession {
    mode: MemberSessionMode = 'one-shot';
    id?: string;
    process?: MemberAgentProcess;
    constructor(private readonly deps: MemberSessionDeps, readonly recipient: string) {}
    binary(spec: AgentSpec): string;                   // memberAgentBinary
    resolveMode(spec: AgentSpec): MemberSessionMode;   // resolveMemberSessionMode; sets this.mode, returns it
    ensureProcess(spec: AgentSpec): Promise<MemberAgentProcess>; // ensureMemberProcess + memberProcessOptions
    reset(reason: MemberSessionResetReason, detail?: Record<string, unknown>): Promise<void>;
    /** Failed-drain budget + resume capture (agent.ts:1690-1708). */
    recordDrain(failed: boolean, exitRunId: string | undefined): Promise<void>;
    hasLiveState(): boolean;                           // process !== undefined || id !== undefined
}
```

- `memberDispatchCommand`, `memberProcessOptions` and `drainedSessionId` become module-private helpers.
- `recordDrain`:
  - counter = failed ? counter + 1 : 0;
  - at the limit → `reset('failed-drains', {failedDrains: MAX_CONSECUTIVE_FAILED_DRAINS})` and counter = 0;
  - else, if mode is `resume` and `exitRunId` is set → look up the exact session id, set `this.id`, and mirror it with `recordMemberSession(db, recipient, {mode:'resume', id}).catch(() => undefined)`.

  This preserves the current order exactly.
- Keep in the loop for now (task 0968 may move it): the one-time `recordMemberSession(... {mode})` mirror and the `member-no-session` warning at loop start (:1549-1561). Or move them into a `start(spec)` method; the implementer picks one and notes it in Solution. The byte-for-byte output is what matters.
- Export everything from `packages/app/src/index.ts`.

**CLI edits (`apps/cli/src/commands/agent.ts`).**
- Delete :973-1195 except `AgentLoopRuntime` and the loop constants.
- Add `export { type MemberAgentProcess, selectsPersistentStdinDispatch } from '@gobing-ai/spur-app';` (R5).
- In `runAgentLoop`, `const memberSession = new MemberSession({ executors: context.agentConfig?.executors ?? [], env: context.env, getDb: () => context.getDb(), warn: (m) => context.output.error(m), ...(runtime.memberProcessFactory ? { processFactory: runtime.memberProcessFactory } : {}) }, recipient);`
- Replace the call sites:
  - :1547 → `memberSession.resolveMode(memberSpec)`;
  - :1558 → `memberSession.binary(memberSpec)`;
  - :1645 → `memberSession.ensureProcess(memberSpec)`;
  - :1690-1708 → `await memberSession.recordDrain(drainFailed, lastExitRunId)`;
  - :1719 → `if (memberSession.hasLiveState()) await memberSession.reset('operator').catch(() => undefined)`.
- Remove the imports that become unused (`RunSessionDao`, `MEMBER_SESSION_RESET_EVENT`, `getAgentSessionCapability`, `getAgentShim`, `TeamAgentProcess`, and so on). Biome flags any that are left.

**Invariant.** One `fleet.member-session-reset` ledger row per deliberate reset, carrying `{reason, mode, ...detail}`. The stderr line is `member session: reset for <recipient> (reason: <reason>)`.

**Rejected alternatives.**
- Passing `CliContext` into packages/app: that is the wrong-direction dependency.
- Splitting the persistent, resume and one-shot modes into three strategy classes: that is speculative, and the mode switch is a few lines.

### Plan

- [ ] Create `packages/app/src/services/member-session.ts` (Design) by moving the code verbatim, then export it from the barrel.
- [ ] Add `packages/app/tests/services/member-session.test.ts`: an in-memory SQLite `getDb` (per AGENTS.md DAO test guidance), a stub `MemberAgentProcess`, and executor fixtures modeled on `apps/cli/tests/commands/agent-loop-member-session.test.ts`. Cover the R4 cases.
- [ ] Rewire `runAgentLoop` (Design, CLI edits), add the R5 re-export and remove the dead imports.
- [ ] Focused tests: `(cd packages/app && bun test tests/services/member-session.test.ts)` and `(cd apps/cli && bun test tests/commands/agent-loop-member-session.test.ts tests/commands/agent-loop-wake.test.ts tests/commands/agent.test.ts tests/commands/agent-team.test.ts)`. Known load flake: `agent-run-fleet` R3 times out at 5s under a full-suite run and passes in isolation. Record it if it appears.
- [ ] Gates: `bun run spur-check`. Run the AC1 `rg` and `git diff` probes and paste their output.
- [ ] One commit: `refactor(agent): move the G66 member session into spur-app (<wbs>)`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

Review — 0967 (G67 R1/R2 extraction), lane `safety` (deterministic, diffstat 1086 changed lines).

**Verdict: PASS with notes.** No functional defect in the extraction. R1–R5 hold; the 90 CLI tests that pin the G66 member-session loop behavior pass unchanged.

#### Functional traceability

| Req | Evidence | Status |
| --- | --- | --- |
| R1 | `packages/app/src/services/member-session.ts:29-319` owns the types, `MAX_CONSECUTIVE_FAILED_DRAINS`, `selectsPersistentStdinDispatch`, and `MemberSession` (`mode`/`id`/`process`/`failedDrains`) with `binary`/`resolveMode`/`start`/`ensureProcess`/`reset`/`recordDrain`/`hasLiveState`. `rg "function (memberAgentBinary\|memberDispatchCommand\|resolveMemberSessionMode\|memberProcessOptions\|ensureMemberProcess\|resetMemberSession\|drainedSessionId)\|MAX_CONSECUTIVE_FAILED_DRAINS =" apps/cli/src` → empty. | met |
| R2 | `MemberSessionDeps` (`:83`) = `executors`/`env`/`getDb`/`warn` + two optional seams. The CLI builds it in one object literal at `apps/cli/src/commands/agent.ts:1282` — the Design's sanctioned adapter. No `CliContext` import. | met |
| R3 | Five loop sites: `:1282` construct, `:1330` `start`, `:1413` `ensureProcess`, `:1434` resume-id flags, `:1449` `recordDrain`, `:1463-1464` `hasLiveState`/operator reset. Equivalence evidenced by `apps/cli/tests/commands/agent-loop-member-session.test.ts` (10 G66 cases) passing with zero test edits. | met |
| R4 | `packages/app/tests/services/member-session.test.ts` — 21 tests, no `CliContext`, no spawned agent. | met |
| R5 | `apps/cli/src/commands/agent.ts:965-975` re-exports; `agent-loop-member-session.test.ts:29` compiles unedited. | met |

#### SECUA

- **Security** — no new input surface; the spawn argv is built by the runner; `env` entries with `undefined` values are dropped before the spawn (tested). No secret handling added.
- **Efficiency** — spawn/reset cadence unchanged; `start()` resolves once per loop lifetime (`:1330`, before the `while` at `:1344`).
- **Correctness** — failed-drain counter, `restart` reset and ledger-write ordering match the base revision. The three "observability only" `.catch` fallbacks and the `member-persistent-stdin-unwired` degrade are now covered (function coverage 79.17% → 91.67% on the new file).
- **Usability** — warning strings and the reset stderr line are byte-identical; the `warn` sink maps to `context.output.error`.
- **Architecture** — dependency direction CLI → app (ADR-021); `rg "CliContext|apps/cli" packages/app/src/services/member-session.ts` → empty. The service is a deep module: 6 public methods behind a 6-field structural deps object.

#### Findings

- **P2 (process, not code)** — AC1's third verify lens (`git diff 872024cd2 -- apps/cli/tests is empty`) is unsatisfiable from the current branch base. Commits `789e464de` (release-ops timeout) and `aebde9a14` (worktree provenance persistence) changed `apps/cli/tests` between the review base `872024cd2` and this task's branch base `939789e5`. This task's own diff under `apps/cli/tests` is empty (`git diff HEAD -- apps/cli/tests` → no output). Re-anchor the lens to the branch base on the next refine.
- **P3 (run-level caveat)** — `--agent inline` cannot satisfy the review hop's executor-distinctness gate (`compareExecutorWith: implement`): implement and review share the host executor. A limitation of inline execution, not of this change.
- **P4** — the `sessionCapability` deps seam is an addition beyond the Design's `MemberSessionDeps`. It is what makes R4's `member-persistent-stdin-unwired` case executable at all: all three persistent-capable runner shims (`omp`/`pi`/`claude`) wire the stdin argv, so the degrade branch is otherwise unreachable without a runner that mis-declares the capability. Mirrors the existing `processFactory` seam. Recorded in Solution.
- **P4** — `MAX_CONSECUTIVE_FAILED_DRAINS` is re-exported from `agent.ts` for R5 compatibility but now has no in-repo consumer.

#### Residual risk

None in the extracted logic. The loop-side extraction (~9 further symbols) is the G67 sibling task's scope and is not silently deferred here.

### References

- Feature: G67 (parent G6 — Projects and agent fleet unification; G66 defined the member session).
- Review source: `/sp:dev-review apps --focus all`, 2026-09-25, candidate C1 (part 1/2); base commit `872024cd2`.
- ADR-021 (apps are thin transports). Tasks 0896 (G66 member session), 0897 (member session ledger rows), 0831 (delivery acceptance).
- Sibling: the G67 agent-loop extraction task depends on this one.

### History

- 2026-09-26T05:53:51.603Z backlog → todo (system)
- 2026-09-27T05:55:08.735Z todo → wip (system)

