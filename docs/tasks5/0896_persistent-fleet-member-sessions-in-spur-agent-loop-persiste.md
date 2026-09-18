---
schema_version: 1
name: "Persistent fleet member sessions in spur agent loop: persistent-stdin, resume-by-id and one-shot modes with deliberate reset on restart and on repeated failed drains"
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.557Z
updated_at: "2026-09-18T21:10:16.607Z"
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
| R1 | MET | Loop-lifetime `memberSession` agent.ts:1393; mode resolved ONCE from the runner capability record via executor-entry `agent` indirection: memberAgentBinary agent.ts:905, resolveMemberSessionMode agent.ts:966-990 (`supportsPersistentStdin` → `resume` → `one-shot`, argv-gated); executor-indirection (writer→omp) exercised in the real-argv-gate test agent-loop-member-session.test.ts:372 (passes, 8/8 fresh) |
| R2 | MET | Persistent: one `TeamAgentProcess`-shaped process per member, drained prompts via `send()` agent.ts:1517-1541 with ensureMemberProcess agent.ts:1022-1038 and `stdinFramer` wiring memberProcessOptions agent.ts:993-1011 (shim `persistentStdinProtocol.frame`: shims.js:49/128/257; TeamAgentProcess.send frames via stdinFramer — dist/team-agent-process.js:100). Resume: drain passes `'session-id': memberSession.id` agent.ts:1551-1553, captured from the E6 exact run→session row (drainedSessionId agent.ts:1067-1073, capture agent.ts:1575-1578). Process exit between drains → `restart` reset + fresh spawn agent.ts:1029-1033 (supervisor restart policy untouched). Declared deviation (recorded in Solution): process starts lazily at first drained prompt — "one process alive across drains" still holds and is test-asserted |
| R3 | MET | One-shot mode unchanged + exactly one `member-no-session` warning at mode resolution (loop lifetime), agent.ts:1432-1439; test agent-loop-member-session.test.ts:286 asserts exactly 1 warning across 2 drains |
| R4 | MET | MAX_CONSECUTIVE_FAILED_DRAINS=3 constant agent.ts:895; single-writer resetMemberSession agent.ts:1046-1065 writes reason-named `fleet.member-session-reset` rows (MEMBER_SESSION_RESET_EVENT agent.ts:898): `restart` on process-exit agent.ts:1029-1033 (exitCode in payload), `operator` on loop teardown agent.ts:1592-1595, `failed-drains` with counter restart agent.ts:1569-1578. Tests: operator agent-loop-member-session.test.ts:314 (`{reason:'operator',mode:'resume'}`), restart agent-loop-member-session.test.ts:444 (`restart` row + exitCode 1 + respawn, no stop-into-corpse), failed-drains agent-loop-member-session.test.ts:330 |
| R5 | MET | Resume adds ONLY the session-id flag (agent.ts:1551-1553); settlement still rides settleClaimedMessages with `invocationStarted` (agent.ts:1546-1551, 0831 semantics untouched); reconcile-before-first-drain (0834) untouched and still reported — regression test agent-loop-member-session.test.ts:250: two distinct prompts each ran once, all rows `delivered`, stdout contains `reconcile: scanned=`; agent-team.test.ts:288 additionally proves once-consumed stays once-delivered (follow-up drain count 0) |
| R6 | MET | Tests in apps/cli/tests/commands/agent*: fresh `bun test tests/commands/agent` → 119 pass / 0 fail across 8 files (includes new 8-test member-session suite + agent-loop-wake 15 + agent-team 25); `bunx tsc --noEmit` (apps/cli) rc=0; full quality gate PASS per attempt-3 record .spur/run/0896-test-gate.log (8527 tests / 484 files + recommended-post-check rules pass) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Consecutive drains resume the member's session | MET | test | agent-loop-member-session.test.ts:250: drain 1 fresh, drain 2 `session-id='sess-1'` (run[0] undefined / run[1] sess-1), via impl agent.ts:1551-1553 + capture agent.ts:1575-1578; deterministic FIFO hold/gate rig (test :170-210) removes wake races |
| AC2 — A persistent-stdin agent runs as one long-lived process | MET | test | (a) command: probe of the real `buildAgentCommand` persistent path emits stdin-dispatch argv for pi/omp (`--mode rpc`) and claude (`-p --input-format stream-json --output-format stream-json`); shim source shims.js:15-27 (claude persistent branch), :124/:253 (pi/omp `--mode rpc`), per-shim frames :3-4 wired at :49/:128/:257; (b) test agent-loop-member-session.test.ts:372 drives BOTH drains through ONE fixture process over the REAL resolver+builder+framer: 1 start, 2 stdin sends, 0 executor runs, no unwired warning, teardown `{reason:'operator',mode:'persistent'}`; agent-team.test.ts:288 repeats on the claude path (1 process, prompt via stdin, runs=0); (c) restart/respawn test :444 covers liveness loss. Attempt-2 argv premise closed; argv gate (:930 + fixture test :422) permanently guards the one-shot-print regression class |
| AC3 — An agent without session support falls back to one-shot with one warning | MET | test | agent-loop-member-session.test.ts:286: fresh run per drain, both runs without session-id, exactly ONE `member-no-session` naming the binary; impl agent.ts:1432-1439 (lifetime = loop process) |
| AC4 — A restart starts a fresh session deliberately | MET | test | Supervisor-restart path: agent-loop-member-session.test.ts:444 — dead process → `restart` reset (exitCode in payload) → fresh process, no send into corpse; operator path: test :314 — stop/teardown → `operator` reset with mode recorded; impl agent.ts:1029-1033, :1046-1065, :1592-1595 |
| AC5 — Repeated failed drains reset a poisoned session | MET | test | agent-loop-member-session.test.ts:330: three consecutive failed drains (exit 1) — poisoned session still resumes sess-1→sess-2 until the limit, then exactly one `{reason:'failed-drains',mode:'resume',failedDrains:3}` row and the counter restarts (teardown adds no row); impl agent.ts:1569-1578 + constant agent.ts:895 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Attempt-3 fresh review (sp-super-reviewer, fresh session, run inline-G66-20260918T204139): **APPROVE** (functional PASS · SECUA PASS · architecture PASS). Full report: `.spur/run/inline-G66-20260918T204139-review-answer.txt`.

| Priority | Dimension | Finding | Location | Disposition |
|----------|-----------|---------|----------|-------------|
| P2 | correctness | Attempt-2 blocker: shims emitted one-shot print argv, persistent dispatch premise contradicted | upstream shims / `apps/cli/src/commands/agent.ts:930` | **Remediated + artifact-verified**: overlaid runner 0.4.68 wires claude `-p --input-format stream-json` + pi/omp `--mode rpc` with per-shim `persistentStdinProtocol.frame`; selector-authoritative `selectsPersistentStdinDispatch` argv gate + honest `member-persistent-stdin-unwired` degrade closes the regression class permanently |
| P2 | correctness | Tests verified stubs, not the real builder/framer path | `apps/cli/tests/commands/agent-loop-member-session.test.ts:372` | **Closed**: omp end-to-end drives real resolver+builder+real shim framer; agent-team adds the 0831 send-failure redelivery regression |
| P3 | correctness | Orphaned JSDoc stacked above `selectsPersistentStdinDispatch`; `resolveMemberSessionMode` undocumented | `apps/cli/src/commands/agent.ts:910-916`, `:967` | Non-blocking; note for the 0897 doc pass |
| P4 | architecture | ~170-line member-session lifecycle block in already-large agent.ts | `apps/cli/src/commands/agent.ts:890-1100` | Extract when 0897 needs fleet readback |
| P4 | correctness | Exit-vs-send microtask race: send() write-only ok into a dying process | `apps/cli/src/commands/agent.ts:1517-1545` | Accepted design ceiling, bounded by 3-strike reset; send==acceptance per 0831 |
| P4 | correctness | Unreachable double-warning edge | mode resolution path | Accepted; unreachable in practice |

Attempt-3 evidence: 48/48 loop suites, 25/25 doctor-baseline consumer, tsc rc=0, biome clean, full gate 8527 tests PASS (`.spur/run/0896-test-gate.log`).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T16:30:11.334Z todo → wip (system)
- 2026-09-18T21:08:01.359Z wip → testing (system)
- 2026-09-18T21:10:16.607Z testing → done (system)

