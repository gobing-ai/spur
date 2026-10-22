---
schema_version: 1
name: Conversation-independent orchestrator scheduling tick
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.912Z
updated_at: "2026-10-22T16:26:14.450Z"
feature_id: G74
priority: P1
tags:
  - fleet
  - performance

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 3
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

- [ ] R1. The orchestrator conversation drain runs with its own in-flight state and never blocks the observe/tick loop.
- [ ] R2. Wakes arriving during a held conversation coalesce and rerun selection after the current tick; no concurrent ticks, no lost arrivals.
- [ ] R3. One fenced scheduling owner (owner epoch) remains; shutdown bounds both consumers (conversation grace = CLAIM_TTL_MS/3).
- [ ] R4. Deterministic E2E: a 30-second held conversation with a newly runnable task dispatches it with p95 at most 1 second and no duplicate dispatch.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G74 R2; design `docs/design/fleet-task-turn-execution.md` §2 (E1); ADR-145.
- Reference: `.spur/run/1274-reference.patch`; `git stash@{0}` = `6202ee391be6d33e8c83ae86160cf7d9e9e8a6ba`.
- Anchors: `packages/app/src/services/agent-loop-service.ts:335,356,469,480,486,571,588,596,597,627`.

### History
