---
schema_version: 1
name: Conversation-independent orchestrator scheduling tick
status: done
template: feature-impl
created_at: 2026-10-22T07:00:34.912Z
updated_at: "2026-10-25T03:36:07.045Z"
feature_id: G74
priority: P1
tags:
  - fleet
  - performance

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1274-verdict.json
---

## 1274. Conversation-independent orchestrator scheduling tick

### Background

Implements: R2 — Task dispatch progresses during an orchestrator conversation.
Work package E1. Observed: packages/app/src/services/agent-loop-service.ts awaits runDrain({replyInstruction}) before strategyRuntime.observe/tick, so a long chat delays dispatch.
No dependency on the runner facade; independently useful.
Rubric: E5 D1 L1 C1 R1 = 9 → own task.

**Refine corrections (2026-10-22)**
- Claim "awaits runDrain before observe/tick" → confirmed at `packages/app/src/services/agent-loop-service.ts:588` (`await runDrain({ replyInstruction: true })`), then `strategyRuntime.observe` `:596` and `tick` `:597`. Design doc cites `:587` and the keyed-bypass comment at `:464` — actual `:588` / `:465` (line drift only).
- Other anchors: `runDrain` `:469`, keyed check `:480`, persistent-stdin unkeyed branch `:486`, `waitForWake` `:571`, owner timer `:335` (CLAIM_TTL_MS/3 at `:356`), `WAKE_EVENT_NAMES` `:177`, persistent shutdown `:627`.
- **Reference implementation exists (not landed):** `git stash@{0}` (SHA `6202ee391be6d33e8c83ae86160cf7d9e9e8a6ba`; untracked test in `stash@{0}^3`) and the equivalent `.spur/run/1274-reference.patch` (477 lines, `git apply --check` clean on `main` at 88b0ecc9c). It passed 20/20 app tests, 78/78 CLI loop tests, biome and tsc in-session; the full gate hit only the sandbox-environmental failures listed in Plan. Implementer may apply it as the starting point but must re-verify every AC — it is evidence, not a certified result.

### Requirements

- [x] R1. The orchestrator conversation drain runs with its own in-flight state and never blocks the observe/tick loop.
- [x] R2. Wakes arriving during a held conversation coalesce and rerun selection after the current tick; no concurrent ticks, no lost arrivals.
- [x] R3. One fenced scheduling owner (owner epoch) remains; shutdown bounds both consumers (conversation grace = CLAIM_TTL_MS/3).
- [x] R4. Deterministic E2E: a 30-second held conversation with a newly runnable task dispatches it with p95 at most 1 second and no duplicate dispatch.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The tick runs while a conversation is held (req: R1, R4)
  Given an orchestrator loop whose conversation drain is held open for 30 s by a fake runner
  When a task becomes runnable and a wake event fires
  Then the task is dispatched within 1 s (p95 over the test's repetitions) and exactly once

Scenario: AC2 — Wakes during a tick coalesce without loss (req: R2)
  Given a tick in progress
  When three wake events arrive before it ends
  Then exactly one follow-up tick runs after it, no two ticks overlap, and every arrival's task is considered

Scenario: AC3 — Ownership and shutdown stay bounded (req: R3)
  Given a held conversation
  When the loop loses its owner epoch, or is shut down
  Then no tick runs without the current epoch, and shutdown returns within `conversationShutdownGraceMs` with the conversation aborted, never awaited indefinitely

Scenario: AC4 — Existing loop contracts are unchanged (req: R1, R3)
  Given the existing `agent-loop-service` test suite including the G71 R4 case
  When it runs against the change
  Then it passes, with the G71 R4 assertion updated only to the new non-blocking order
```

Feature scenario coverage (the detailed task-local scenarios above remain the behavior contract):

- [x] R2 — Task dispatch progresses during an orchestrator conversation

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:35.956Z

- **Q: Start from the stash/patch?** CLOSED — yes, apply `.spur/run/1274-reference.patch` (or `git stash apply stash@{0}`), then verify against AC1–AC4. Do not drop the stash; leave cleanup to Robin.
- **Q: Schedule once before the chat instead?** CLOSED — rejected; later arrivals would still stall behind the chat.
- **Q: Replace 100 ms ledger polling?** CLOSED — deferred until 1273's receipt shows it matters.
- **Q: Shutdown grace value?** CLOSED — `ORCHESTRATOR_CONVERSATION_SHUTDOWN_GRACE_MS = CLAIM_TTL_MS / 3` (10 s), injectable via `runtime.conversationShutdownGraceMs` for tests.

### Design

**File:** `packages/app/src/services/agent-loop-service.ts` only (+ tests).
- Replace the awaited `runDrain({ replyInstruction: true })` (`:588`) with a tracked, non-awaited conversation promise: at most one in flight; a wake during it sets `wokeDuringConversation` and the loop proceeds to `observe`/`tick`.
- `wakeNow` AbortController combined with the stop signal via `AbortSignal.any` so a wake ends `waitForWake` (`:571`) early.
- Ticks stay serialized among themselves (single loop body); coalescing = one follow-up pass per batch of wakes.
- Shutdown: abort the conversation, await it at most `ORCHESTRATOR_CONVERSATION_SHUTDOWN_GRACE_MS`, then continue the existing persistent shutdown (`:627`).
- Seam: `runtime.conversationShutdownGraceMs?: number` (tests only).

**Tests:** `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts` (new, 4 cases = AC1–AC3); update the G71 R4 case in `packages/app/tests/services/agent-loop-service.test.ts`.
**Invariants:** one scheduling owner (owner timer `:335`), strategy epochs, rest/idle hold semantics, ledger flush per pass.
**Rejected:** a second scheduler; concurrent ticks.

### Plan

1. Failure cases first (in the new test file): drain throws mid-tick; owner lost during chat; shutdown during chat; double/triple wake; held 30 s chat + runnable task.
2. Apply `.spur/run/1274-reference.patch`; read the diff fully; reconcile with `main` if anchors drifted.
3. Run focused: `(cd packages/app && bun test tests/services/agent-loop-orchestrator-tick.test.ts tests/services/agent-loop-service.test.ts)` and `(cd apps/cli && bun test tests/commands/agent)`.
4. `bun run spur-check`.

### Solution

- `packages/app/src/services/agent-loop-service.ts:92-97` — `runtime.conversationShutdownGraceMs` test seam; `ORCHESTRATOR_CONVERSATION_SHUTDOWN_GRACE_MS = CLAIM_TTL_MS / 3` (R3).
- `:381-389` — per-loop `conversation` promise slot, `wokeDuringConversation` flag, `wakeNow` AbortController (R1/R2).
- `:615-618` — `waitForWake` now waits on `AbortSignal.any([runtime.signal, wakeNow.signal])`, and a fired `wakeNow` is replaced before the next pass (R2: chat-end re-wake without losing the poll cursor).
- `:626-649` — the orchestrator drain starts but is NOT awaited: at most one in flight; wakes arriving during it only set the flag; the drain's `finally` clears the slot and aborts `wakeNow` so the queued inbox drains immediately; drain errors still log, never kill the loop (G71 R4 behavior preserved).
- `:680-697` — shutdown races the in-flight conversation against the grace timer, logs and releases ownership on timeout, then the existing persistent shutdown continues.
- Ticks remain serialized in the single loop body — no second scheduler, no concurrent ticks.
- Tests: `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts` (new; AC1–AC3 incl. the 30 s held-conversation p95 case), and the G71 R4 case in `agent-loop-service.test.ts` updated to the non-blocking order (drain starts first; all four events happen in one wake; observe precedes tick).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-loop-service.ts:690`; `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179`; fresh 30-second scheduler proof: held 30000 ms, p95 dispatch 103 ms, 21 dispatches, one concurrent tick. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/scheduler-30s-proof.test.ts --timeout 60000; exit 0, 4 pass. Re-audit artifact writes: .spur/run/1274-verify-answer.txt:1-40; .spur/run/1274-verdict.json:1-107. Final gate: .spur/run/1273-test-gate.log:599 (11697 pass). |
| R2 | MET | `packages/app/src/services/agent-loop-service.ts:690`; `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179`; fresh scheduler suite verifies coalesced wakes and the queued second conversation; 4 pass, 0 fail. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/scheduler-30s-proof.test.ts --timeout 60000; exit 0, 4 pass. |
| R3 | MET | `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:263`; `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:292`; fresh scheduler suite verifies bounded shutdown, owner release and exit 2 after ownership loss. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/scheduler-30s-proof.test.ts --timeout 60000; exit 0, 4 pass. |
| R4 | MET | `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179`; fresh 30-second proof: p95 103 ms (budget 1000 ms), 21 distinct task dispatches without duplicates; all four cases pass. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/scheduler-30s-proof.test.ts --timeout 60000; exit 0, 4 pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — The tick runs while a conversation is held (req: R1, R4) | MET | test | `packages/app/src/services/agent-loop-service.ts:690`; `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179`; fresh 30-second scheduler proof: held 30000 ms, p95 dispatch 103 ms, 21 dispatches, one concurrent tick. `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179`; fresh 30-second proof: p95 103 ms (budget 1000 ms), 21 distinct task dispatches without duplicates; all four cases pass. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/scheduler-30s-proof.test.ts --timeout 60000; exit 0, 4 pass. |
| Scenario: AC2 — Wakes during a tick coalesce without loss (req: R2) | MET | test | `packages/app/src/services/agent-loop-service.ts:690`; `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179`; fresh scheduler suite verifies coalesced wakes and the queued second conversation; 4 pass, 0 fail. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/scheduler-30s-proof.test.ts --timeout 60000; exit 0, 4 pass. |
| Scenario: AC3 — Ownership and shutdown stay bounded (req: R3) | MET | test | `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:263`; `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:292`; fresh scheduler suite verifies bounded shutdown, owner release and exit 2 after ownership loss. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/scheduler-30s-proof.test.ts --timeout 60000; exit 0, 4 pass. |
| Scenario: AC4 — Existing loop contracts are unchanged (req: R1, R3) | MET | test | `packages/app/src/services/agent-loop-service.ts:690`; `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179`; fresh 30-second scheduler proof: held 30000 ms, p95 dispatch 103 ms, 21 dispatches, one concurrent tick. `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:263`; `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:292`; fresh scheduler suite verifies bounded shutdown, owner release and exit 2 after ownership loss. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/scheduler-30s-proof.test.ts --timeout 60000; exit 0, 4 pass. |
| R2 — Task dispatch progresses during an orchestrator conversation | MET | test | `packages/app/src/services/agent-loop-service.ts:690`; `packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179`; fresh scheduler suite verifies coalesced wakes and the queued second conversation; 4 pass, 0 fail. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/scheduler-30s-proof.test.ts --timeout 60000; exit 0, 4 pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Inline super-reviewer pass over the 1274 diff (applied reference stash 6202ee39; worktree sp/runall-g74-53db).

**Traceability** — the orchestrator drain starts but is never awaited (`packages/app/src/services/agent-loop-service.ts:632`); at most one conversation in flight, wakes during it only record `wokeDuringConversation`; `waitForWake` observes `AbortSignal.any([stop, wakeNow])` (`:615`) so the chat's end re-wakes the loop immediately; ticks stay serialized in the single loop body; shutdown races the conversation against `ORCHESTRATOR_CONVERSATION_SHUTDOWN_GRACE_MS = CLAIM_TTL_MS / 3` with the `runtime.conversationShutdownGraceMs` seam (`:92-97`, `:680-697`). The G71 R4 case is updated to the new non-blocking order (`packages/app/tests/services/agent-loop-service.test.ts:516`).

**SECUA** — drain errors keep the loop alive (logged, never thrown); no new dependencies; the grace timer is always cleared; the flag/abort handshake has no unhandled rejection path (`.then(undefined, handler)`). Invariants preserved: single owner timer, strategy epochs, ledger flush per pass.

**Verification** — focused 20/20 (new file + loop suite), cli agent 189/189, full gate 11577/0 + coverage-provenance/post-check rules pass.

**Findings**

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | none | — |
| P2 | none | — |
| P3 | none | — |
| P4 | stale anchors in the task Background (`:587`/`:589` vs actual `:588`) | RESOLVED in the task's refine corrections; no code impact |

**Captured answer**

Confidence: HIGH

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | test packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179 — held chat, dispatch still runs (drain not awaited, packages/app/src/services/agent-loop-service.ts:632) |
| R2 | MET | test packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179 (burst wake, maxConcurrentTicks=1) and :231 (arrival during held chat drains at chat end) |
| R3 | MET | test packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:263 (bounded shutdown, grace seam 50ms) and :292 (owner lost stops ticks, exit 2); grace = CLAIM_TTL_MS/3 at packages/app/src/services/agent-loop-service.ts:97 |
| R4 | MET | test packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:224 (p95 of 20 iterations ≤ 1s), :229 (exactly-once, 21/21) |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — The tick runs while a conversation is held (req: R1, R4) | MET | test | packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179 — 60s backstop poll, wake-driven dispatch, p95 ≤ 1s (:224), no duplicates (:229) |
| AC2 — Wakes during a tick coalesce without loss (req: R2) | MET | test | packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:179 (burst) + :231 (post-chat drain) — every arrival considered, one follow-up pass, no overlap |
| AC3 — Ownership and shutdown stay bounded (req: R3) | MET | test | packages/app/tests/services/agent-loop-orchestrator-tick.test.ts:263 (shutdown returns within grace, claim released) + :292 (epoch loss → exit 2, no unowned tick) |
| AC4 — Existing loop contracts are unchanged (req: R1, R3) | MET | test | packages/app/tests/services/agent-loop-service.test.ts:516 (G71 R4 updated to non-blocking order) + command (cd packages/app && bun test …) 20/20, (cd apps/cli && bun test tests/commands/agent) 189/189 |

Verdict: PASS

### References

- Feature G74 R2; design `docs/design/fleet-task-turn-execution.md` §2 (E1); ADR-145.
- Reference: `.spur/run/1274-reference.patch`; `git stash@{0}` = `6202ee391be6d33e8c83ae86160cf7d9e9e8a6ba`.
- Anchors: `packages/app/src/services/agent-loop-service.ts:335,356,469,480,486,571,588,596,597,627`.

### History

- 2026-10-22T20:18:32.253Z todo → wip (system)
- 2026-10-22T20:28:07.691Z wip → testing (system)
- 2026-10-22T20:28:11.689Z testing → done (system)

