---
schema_version: 1
name: Codex App Server warm task-turn adapter
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.915Z
updated_at: "2026-10-22T16:26:09.806Z"
feature_id: G74
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1275"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 8
---

## 1278. Codex App Server warm task-turn adapter

### Background

Implements: R5 — Codex completes keyed tasks through native thread and turn identity.
Work package E5. Runs after the correlated task-turn seam. Transport: Codex App Server stdio (initialize, thread/start|resume, turn/start, turn/completed).
Rubric: E7 D1 L2 C1 R1 = 12 → own task.

**Refine corrections (2026-10-22)**
- Claim "adapter selection in the Spur turn seam" → reality: protocol mechanics belong to ts-ai-runner (ADR-145); the 1284 facade defines a per-agent `TurnSessionDriver` registry. → resolution: the driver is written in ts-libs `packages/ai-runner/src/turn-drivers/codex-app-server.ts` and released by Robin; Spur's part is the catalog bump, capability evidence and receipt rows. ts-libs edits authorized by Robin on 2026-10-22; publishing is his.
- Capability row is stale: `AGENT_SESSION_CAPABILITY.codex` (ts-libs `src/agents/shims.ts:533`) — verifiedAgainst 0.155.1, supportsPersistentStdin false; observed on this host 2026-10-22: codex 0.163.0. → resolution: re-probe and update `verifiedAgainst` with the driver.
- Transport premise: Codex App Server over stdio (JSON-RPC: initialize → thread/start or thread/resume → turn/start → turn/completed with status) — **unverified against the installed binary**; step 1 records the observed record shapes as redacted fixtures before any parser is written.

### Requirements

- [ ] R1. Qualify the installed Codex binary/version App Server sequence; record provenance in `verifiedAgainst` and the receipt.
- [ ] R2. Two related keyed tasks run as native turns in one process; thread and turn ids link to each validated task receipt.
- [ ] R3. Native failed and interrupted turn statuses can never become successful task results; cancellation awaits terminal evidence.
- [ ] R4. Unqualified versions keep exec-resume/one-shot fallback with a named reason.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The App Server sequence is qualified with evidence (req: R1)
  Given the installed codex binary
  When qualification runs
  Then the recorded transcript shows initialize, thread start/resume, turn start and turn completion, and `verifiedAgainst` equals the probed version

Scenario: AC2 — Native ids link to receipts (req: R2)
  Given two keyed tasks on one Codex App Server process
  When both complete
  Then each receipt carries the same native thread id and distinct native turn ids, plus passing action contracts

Scenario: AC3 — Failed or interrupted never becomes success (req: R3)
  Given turns completing with failed and interrupted statuses, and a cancel
  When each settles
  Then outcomes are `failure`, `interrupted`, and the cancel resolves only after the native completion (or `outcome-unknown` after grace)

Scenario: AC4 — Unqualified Codex falls back by name (req: R4)
  Given a version not in `verifiedAgainst`
  When a keyed task dispatches
  Then it runs once via `exec resume`/one-shot with reason `unqualified-version`
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:48.650Z

- **Q: Where does the driver live?** CLOSED — ts-libs `packages/ai-runner/src/turn-drivers/codex-app-server.ts`, registered in `TURN_SESSION_DRIVERS` (1284). Spur imports nothing agent-specific.
- **Q: Which versions qualify?** CLOSED — exactly the probed version(s) recorded in `verifiedAgainst`; `qualify()` refuses others with `unqualified-version`, and Spur falls back (`exec resume <id>` then one-shot) with that reason (1275).
- **Q: Release?** CLOSED — implementer stops at a green, committed, untagged ts-libs tree with version 0.6.x (next patch); Robin tags/publishes; Spur catalog bump + evidence follow in this task's last steps.
- **Q: Real-agent runs?** CLOSED — opt-in (`fleet-e2e --perf --real-agents --agents codex`); deterministic lane replays recorded fixtures.

### Design

**Driver:** ts-libs `packages/ai-runner/src/turn-drivers/codex-app-server.ts`; JSON-RPC client over stdio: handshake = initialize (+ thread start/resume) → `handshake-failed` on refusal; `startTurn` = turn start; terminal = the recorded turn-completed status (completed → `success`, failed → `failure`, interrupted → `interrupted`). Method/field names come from the step-1 transcript, not from this text.
**Capability row:** set `supportsPersistentStdin` per evidence; keep the `exec resume` note for fallback.
**Rejected:** inferring identity from PID or a stored thread id.
**Invariants:** native ids recorded only when observed.

### Plan

1. Qualification spike: probe `codex --version` and the persistent protocol on the installed binary; capture redacted transcripts (two turns, an error turn, a cancel) to ts-libs `packages/ai-runner/tests/fixtures/turn-drivers/codex/*.jsonl`. No parser before fixtures.
2. Failure cases first in ts-libs `tests/turn-drivers/codex.test.ts`: failed turn status; interrupted turn status; cancel awaiting turn/completed; server exit mid-turn (outcome-unknown); initialize refusal (handshake-failed); two serial turns on one thread; notification for another thread (diagnostic).
3. Implement `src/turn-drivers/codex-app-server.ts`, register it, update `AGENT_SESSION_CAPABILITY.codex.verifiedAgainst`/note; fixture-replay tests pass through a real child (fake agent replaying the captured transcript).
4. ts-libs `bun run spur-check`; commit `feat(ai-runner): codex turn-session driver`; version 0.6.x (next patch); CHANGELOG. Handoff note in Solution; **Robin releases**.
5. Spur: bump catalog to the released version; run `bun run fleet-e2e --perf` (deterministic) and, opt-in, `--real-agents --agents codex`; warm rows replace `unsupported` in `docs/reports/fleet-perf-receipt.json`.
6. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G74; design `docs/design/fleet-task-turn-execution.md` §5; ADR-145.
- Depends on: 1275 (seam) → 1284 (facade). Receipt: 1273.
- ts-libs anchors: `packages/ai-runner/src/agents/shims.ts:533` (capability rows).

### History
