---
schema_version: 1
name: "Persistent fleet member sessions in spur agent loop: persistent-stdin, resume-by-id and one-shot modes with deliberate reset on restart and on repeated failed drains"
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.557Z
updated_at: "2026-09-19T06:50:54.813Z"
feature_id: G66
priority: P2
tags:
  - fleet
  - agent-loop
  - session
  - G66
estimate_hours: 8

dependencies: ["0889"]
---

## 0896. Persistent fleet member sessions in spur agent loop: persistent-stdin, resume-by-id and one-shot modes with deliberate reset on restart and on repeated failed drains

### Background

`runAgentLoop` (`apps/cli/src/commands/agent.ts`) calls `svc.run(prompt, rewritten, deps)` per drained message: a fresh one-shot subprocess with no memory of the previous message. The runner's `TeamAgentProcess` (start/stop/send) is imported by the coordination service but not on the member path. Authority: `docs/design/session-pinned-dispatch.md` §6, AC R1–R4/R7; capability record from task 2.

### Requirements

- [x] R1. `runAgentLoop` keeps `memberSession = {{ mode: 'persistent'|'resume'|'one-shot', id?, dir?, process? }}` for the loop's lifetime; mode is chosen from the executor's capability record: `supportsPersistentStdin` → `persistent`, else `supportsResumeById` → `resume`, else `one-shot`.
- [x] R2. `persistent` starts one `TeamAgentProcess` at loop start and feeds each drained prompt through `send()`; process exit is reported to the supervisor with the existing restart policy; `resume` passes the previous drain's session id to `AgentService.run`.
- [x] R3. `one-shot` emits exactly one warning per member lifetime (`member-no-session`), not per drain.
- [x] R4. Supervisor restart, `spur agent stop` + `start`, and `MAX_CONSECUTIVE_FAILED_DRAINS` (constant 3) consecutive failed drains reset the session; the loop's run record names the reset reason (`restart` | `operator` | `failed-drains`).
- [x] R5. Reconcile-before-first-drain (0834) and the settle guarantees (0831) are untouched: a resumed session never causes a settled message to be redelivered (regression test).
- [x] R6. Tests in `apps/cli/tests/commands/agent*` cover all three modes with a stubbed runner, the reset reasons, and the failed-drain counter; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature G66 scenarios R1, R2, R3, R4, R7.

- [x] AC1 — Consecutive drains resume the member's session (req: R1)
- [x] AC2 — A persistent-stdin agent runs as one long-lived process (req: R2)
- [x] AC3 — An agent without session support falls back to one-shot with one warning (req: R3)
- [x] AC4 — A restart starts a fresh session deliberately (req: R4)
- [x] AC5 — Repeated failed drains reset a poisoned session (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: session continuity is an agent-memory property; delivery state stays in the DB (docs/design/session-pinned-dispatch.md §6). Mode selection reads the capability record so the loop has no per-agent branches. `TeamAgentProcess` is reused rather than a new process wrapper — it already exists in the runner and is imported by Spur. The failed-drain threshold is a constant: the design gives no reason to vary it. Mutation policy: `apps/cli/src/commands/agent.ts` (`runAgentLoop`), `packages/app/src/services/agent-service.ts` if `run` needs a session-id parameter surface, tests; no snapshot/process-entry fields (task 10), no supervisor policy changes.

### Plan

1. Read design §6, `runAgentLoop` end to end, `TeamAgentProcess` and `AgentService.run`'s session handling; read 0834/0831 tests.
2. Add `memberSession` and mode selection; implement `persistent` via `TeamAgentProcess` and `resume` via session id.
3. Add the one-per-lifetime warning, the reset rules and the failed-drain counter with reason recording.
4. Write the tests including the no-redelivery regression.
5. Run `cd apps/cli && bun test tests/commands/agent*` then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Persistent fleet member sessions in the spur agent loop (G66, design `docs/design/session-pinned-dispatch.md` §6). `runAgentLoop` (apps/cli/src/commands/agent.ts:1268) now keeps `memberSession = { mode, id?, process? }` for the loop's lifetime (apps/cli/src/commands/agent.ts:1335); the mode resolves once from the executor's runner capability record (`supportsPersistentStdin` → persistent, `supportsResumeById` → resume, else one-shot) via `spec.executor ?? spec.type` plus the project executor-entry `agent` mapping (apps/cli/src/commands/agent.ts:904, apps/cli/src/commands/agent.ts:916). No supervisor policy, snapshot, or process-entry fields changed.

What changed (all in `apps/cli/src/commands/agent.ts`):
- Session types + reset-reason contract (apps/cli/src/commands/agent.ts:856), bounded failure budget `MAX_CONSECUTIVE_FAILED_DRAINS = 3` (apps/cli/src/commands/agent.ts:894).
- Persistent mode (R2): one `TeamAgentProcess` per member per loop lifetime built through the shared `buildAgentCommand` seam; drained prompts inject via `send()` (apps/cli/src/commands/agent.ts:1459); a successful send IS the 0831 delivery acceptance. Process exit between drains resets the session (reason `restart`, exit code in payload) and the next drain starts a fresh process (apps/cli/src/commands/agent.ts:964) — the supervisor restart policy is untouched. Test seam `AgentLoopRuntime.memberProcessFactory` (apps/cli/src/commands/agent.ts:1036).
- Resume mode (R1): the drain's run id is captured from `agent.invoke.exit` correlation; the next drain passes `'session-id'` from the exact run→session mapping (apps/cli/src/commands/agent.ts:1486, apps/cli/src/commands/agent.ts:1016). Delivery stays DB-settled (0831/0834) so a resumed session never redelivers a settled message (R5).
- One-shot mode (R3): unchanged behavior plus exactly one `member-no-session` stderr warning per member (loop-process) lifetime.
- Deliberate resets (R4): reason-named `fleet.member-session-reset` ledger rows + stderr report for `restart`, `operator` (loop teardown with an active session), and `failed-drains` with counter restart (apps/cli/src/commands/agent.ts:1506, apps/cli/src/commands/agent.ts:988). Reconcile-before-first-drain (0834) and settle guarantees (0831) untouched.

Deviation: the persistent process starts lazily at the first drained prompt rather than at loop start — avoids idle agent processes for members that never drain under a declared fleet; "one process alive across drains" still holds.

Tests: new `apps/cli/tests/commands/agent-loop-member-session.test.ts` (8 tests, stubbed runner via mock `agentService` + the process-factory seam): resume two-drain session-id propagation without redelivery (apps/cli/tests/commands/agent-loop-member-session.test.ts:250), persistent one-process/two-sends with no `svc.run` (apps/cli/tests/commands/agent-loop-member-session.test.ts:286), process-exit restart reset + fresh process (apps/cli/tests/commands/agent-loop-member-session.test.ts:328), one-shot lifetime warning (apps/cli/tests/commands/agent-loop-member-session.test.ts:368), operator reset on teardown (apps/cli/tests/commands/agent-loop-member-session.test.ts:396), 3-failed-drains poisoned-session reset (R7, apps/cli/tests/commands/agent-loop-member-session.test.ts:412), executor-entry indirection writer→omp (apps/cli/tests/commands/agent-loop-member-session.test.ts:454), idle no-churn smoke (apps/cli/tests/commands/agent-loop-member-session.test.ts:488). Multi-drain sequencing is deterministic via a FIFO hold/gate on the mock run (a drain claims the whole inbox, and the exit-row wake must not race the test's enqueues).

Verification: `bun test tests/commands/agent-loop-member-session.test.ts` 8/8 pass (1.2s); `agent-loop-wake.test.ts` still 15/15; `tsc --noEmit` clean; `biome check` clean on both touched files.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Loop-lifetime `memberSession` `apps/cli/src/commands/agent.ts:1487`; mode resolved ONCE via `resolveMemberSessionMode` `apps/cli/src/commands/agent.ts:1060-1079` (`supportsPersistentStdin` argv-gated → `resume` → `one-shot`) and `memberAgentBinary` `apps/cli/src/commands/agent.ts:999-1003`. Resume second-drain `session-id` `apps/cli/src/commands/agent.ts:1650-1653`. Test: `apps/cli/tests/commands/agent-loop-member-session.test.ts:251-274` (this turn: 10/10 member-session file + 25 team file, 35 pass / 0 fail). |
| R2 | MET | Persistent: `ensureMemberProcess` `apps/cli/src/commands/agent.ts:1116-1132` + `process.send(prompt)` `apps/cli/src/commands/agent.ts:1617-1631`; `stdinFramer` from shim `apps/cli/src/commands/agent.ts:1098-1103`. Lazy-start deviation documented in Solution (process starts at first drain, not loop start). Test: `apps/cli/tests/commands/agent-loop-member-session.test.ts:373-417` (1 process, 2 stdin sends, 0 executor runs). |
| R3 | MET | One `member-no-session` warning at mode resolution `apps/cli/src/commands/agent.ts:1533-1538`. Test: `apps/cli/tests/commands/agent-loop-member-session.test.ts:287` (exactly one warning across two drains). |
| R4 | MET | `MAX_CONSECUTIVE_FAILED_DRAINS = 3` `apps/cli/src/commands/agent.ts:992`; `resetMemberSession` `apps/cli/src/commands/agent.ts:1140-1158` writes `MEMBER_SESSION_RESET_EVENT` (`packages/domain/src/dao/member-session.ts:26`, import `apps/cli/src/commands/agent.ts:34`). Reasons: `restart` `apps/cli/src/commands/agent.ts:1124-1126`, `operator` `apps/cli/src/commands/agent.ts:1698-1699`, `failed-drains` `apps/cli/src/commands/agent.ts:1670-1674`. Tests: operator `:315`, failed-drains `:331`, restart `:445`. |
| R5 | MET | Reconcile-before-first-drain still at `apps/cli/src/commands/agent.ts:1488-1495`; settle via `settleClaimedMessages` `apps/cli/src/commands/agent.ts:1660`. Resume two-drain test `:251` asserts distinct prompts and no redelivery. `apps/cli/tests/commands/agent-team.test.ts` G61 settle suites (this turn, included in 35 pass). |
| R6 | MET | This turn: `cd apps/cli && bun test tests/commands/agent-loop-member-session.test.ts tests/commands/agent-team.test.ts` → 35 pass / 0 fail; `bun test tests/commands/agent.test.ts tests/commands/agent-server.test.ts` → 55 pass / 0 fail. `bun run spur-check` exit 0: biome 1021 files, 7-workspace typecheck, 46 pre-check rules, **8577 pass / 0 fail across 486 files**, 2 post-check rules. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Consecutive drains resume the member's session | MET | test | `apps/cli/tests/commands/agent-loop-member-session.test.ts:251-274` drain1 no session-id, drain2 `session-id='sess-1'`; impl `apps/cli/src/commands/agent.ts:1650-1653` + capture `apps/cli/src/commands/agent.ts:1675-1682`. This turn: pass. |
| R2 — A persistent-stdin agent runs as one long-lived process | MET | test | `apps/cli/tests/commands/agent-loop-member-session.test.ts:373-417` (omp executor, 1 start, 2 stdin sends, 0 `svc.run`); argv gate `:423-443` + `selectsPersistentStdinDispatch` `apps/cli/src/commands/agent.ts:1024-1031`. This turn: pass. |
| R3 — An agent without session support falls back to one-shot with one warning | MET | test | `apps/cli/tests/commands/agent-loop-member-session.test.ts:287` exactly one `member-no-session` across 2 drains; impl `apps/cli/src/commands/agent.ts:1533-1538`. This turn: pass. |
| R4 — A restart starts a fresh session deliberately | MET | test | Restart: `apps/cli/tests/commands/agent-loop-member-session.test.ts:445` (`restart` + exitCode + respawn). Operator: `:315`. Impl `apps/cli/src/commands/agent.ts:1124-1126`, `:1698-1699`. This turn: pass. |
| R7 — Repeated failed drains reset a poisoned session | MET | test | `apps/cli/tests/commands/agent-loop-member-session.test.ts:331` three consecutive failures then `{reason:'failed-drains', failedDrains:3}`; impl `apps/cli/src/commands/agent.ts:1670-1674` + constant `:992`. This turn: pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Attempt-3 fresh review (sp-super-reviewer, fresh session, run inline-G66-20260918T204139): **APPROVE** (functional PASS · SECUA PASS · architecture PASS). Full report: `.spur/run/inline-G66-20260918T204139-review-answer.txt`.

| Priority | Dimension | Finding | Location | Disposition |
|----------|-----------|---------|----------|-------------|
| P2 | correctness | Attempt-2 blocker: shims emitted one-shot print argv, persistent dispatch premise contradicted | upstream shims / `apps/cli/src/commands/agent.ts:930` | **Remediated + artifact-verified**: overlaid runner 0.4.68 wires claude `-p --input-format stream-json` + pi/omp `--mode rpc` with per-shim `persistentStdinProtocol.frame`; selector-authoritative `selectsPersistentStdinDispatch` argv gate + honest `member-persistent-stdin-unwired` degrade closes the regression class permanently |
| P2 | correctness | Tests verified stubs, not the real builder/framer path | `apps/cli/tests/commands/agent-loop-member-session.test.ts:372` | **Closed**: omp end-to-end drives real resolver+builder+real shim framer; agent-team adds the 0831 send-failure redelivery regression |
| P3 | correctness | Orphaned JSDoc stacked above `selectsPersistentStdinDispatch`; `resolveMemberSessionMode` undocumented | `apps/cli/src/commands/agent.ts:1054-1062` | **Closed**: orphaned block moved onto `resolveMemberSessionMode`; `selectsPersistentStdinDispatch` keeps its own JSDoc |
| P4 | architecture | ~170-line member-session lifecycle block in already-large agent.ts | `apps/cli/src/commands/agent.ts:890-1100` | Accepted for G66; extract is a later refactor, not ship criteria |
| P4 | correctness | Exit-vs-send microtask race: send() write-only ok into a dying process | `apps/cli/src/commands/agent.ts:1517-1545` | Accepted design ceiling, bounded by 3-strike reset; send==acceptance per 0831 |
| P4 | correctness | Unreachable double-warning edge | mode resolution path | Accepted; unreachable in practice |

Attempt-3 evidence: 48/48 loop suites, 25/25 doctor-baseline consumer, tsc rc=0, biome clean, full gate 8527 tests PASS (`.spur/run/0896-test-gate.log`). P3 JSDoc close: biome check `apps/cli/src/commands/agent.ts` clean; `bun test tests/commands/agent-loop-member-session.test.ts` 10/10 this turn.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T16:30:11.334Z todo → wip (system)
- 2026-09-18T21:08:01.359Z wip → testing (system)
- 2026-09-18T21:10:16.607Z testing → done (system)

