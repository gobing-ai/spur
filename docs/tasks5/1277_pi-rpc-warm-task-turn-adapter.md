---
schema_version: 1
name: Pi RPC warm task-turn adapter
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.914Z
updated_at: "2026-10-22T16:26:09.202Z"
feature_id: G74
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1275"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 6
---

## 1277. Pi RPC warm task-turn adapter

### Background

Implements: R4 — Pi completes keyed tasks in a warm process.
Work package E4. Runs after the correlated task-turn seam. Candidate transport: Pi RPC JSON records over stdio.
Rubric: E6 D1 L2 C1 R1 = 11 → own task.

**Refine corrections (2026-10-22)**
- Claim "adapter selection in the Spur turn seam" → reality: protocol mechanics belong to ts-ai-runner (ADR-145); the 1284 facade defines a per-agent `TurnSessionDriver` registry. → resolution: the driver is written in ts-libs `packages/ai-runner/src/turn-drivers/pi-rpc.ts` and released by Robin; Spur's part is the catalog bump, capability evidence and receipt rows. ts-libs edits authorized by Robin on 2026-10-22; publishing is his.
- Capability row is stale: `AGENT_SESSION_CAPABILITY.pi` (ts-libs `src/agents/shims.ts:533`) — verifiedAgainst 0.87.0; observed on this host 2026-10-22: PATH pi 1.4.0 (repository dependency version must be recorded separately). → resolution: re-probe and update `verifiedAgainst` with the driver.
- Transport premise: `pi --mode rpc` JSON records over stdio: a command response (acceptance) followed by agent activity events and an end-of-agent record — **unverified against the installed binary**; step 1 records the observed record shapes as redacted fixtures before any parser is written.

### Requirements

- [ ] R1. Record exact Pi executable provenance (PATH binary vs repository dependency versions) in `verifiedAgainst` and the receipt.
- [ ] R2. Two related keyed tasks execute serially in one process with correlated terminal outcomes and validated artifacts.
- [ ] R3. Command acceptance responses are distinguished from completed agent activity; fragmented and interleaved records parse deterministically.
- [ ] R4. Unqualified versions keep session/one-shot fallback with a named reason.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Pi provenance is exact (req: R1)
  Given the PATH pi and the repository dependency
  When qualification runs
  Then both paths and versions are recorded and only the qualified one is used by the driver

Scenario: AC2 — Two keyed tasks complete in one warm Pi process (req: R2)
  Given the Pi driver replaying two recorded turns through a real child
  When two keyed tasks drain through the 1275 seam
  Then one process serves both with correlated outcomes and passing action contracts

Scenario: AC3 — Acceptance is not completion; framing is deterministic (req: R3)
  Given transcripts with a command response then exit, a record split across chunks, and interleaved records
  When each settles
  Then the first is `outcome-unknown`, and the split/interleaved transcripts yield the same outcome as their unsplit form

Scenario: AC4 — Unqualified Pi falls back by name (req: R4)
  Given a version not in `verifiedAgainst`
  When a keyed task dispatches
  Then it runs once via session/one-shot with reason `unqualified-version`
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:45.206Z

- **Q: Where does the driver live?** CLOSED — ts-libs `packages/ai-runner/src/turn-drivers/pi-rpc.ts`, registered in `TURN_SESSION_DRIVERS` (1284). Spur imports nothing agent-specific.
- **Q: Which versions qualify?** CLOSED — exactly the probed version(s) recorded in `verifiedAgainst`; `qualify()` refuses others with `unqualified-version`, and Spur falls back (session resume then one-shot) with that reason (1275).
- **Q: Release?** CLOSED — implementer stops at a green, committed, untagged ts-libs tree with version 0.6.x (next patch); Robin tags/publishes; Spur catalog bump + evidence follow in this task's last steps.
- **Q: Real-agent runs?** CLOSED — opt-in (`fleet-e2e --perf --real-agents --agents pi`); deterministic lane replays recorded fixtures.

### Design

**Driver:** ts-libs `packages/ai-runner/src/turn-drivers/pi-rpc.ts`; reuse `piRpcFrame` (`shims.ts:248/374`) for input; bounded line buffer (1284: 1 MiB) for output; correlate records to the single active turn (one turn per session).
**Rejected:** treating the command response as completion.
**Invariants:** one active turn per worker; malformed framing → `contract-violation` deterministically.

### Plan

1. Qualification spike: probe `pi --version` and the persistent protocol on the installed binary; capture redacted transcripts (two turns, an error turn, a cancel) to ts-libs `packages/ai-runner/tests/fixtures/turn-drivers/pi/*.jsonl`. No parser before fixtures.
2. Failure cases first in ts-libs `tests/turn-drivers/pi.test.ts`: command response without completion (accepted, then exit → outcome-unknown); fragmented record across chunks; interleaved event and response records; error response (not-started); two serial turns; malformed record.
3. Implement `src/turn-drivers/pi-rpc.ts`, register it, update `AGENT_SESSION_CAPABILITY.pi.verifiedAgainst`/note; fixture-replay tests pass through a real child (fake agent replaying the captured transcript).
4. ts-libs `bun run spur-check`; commit `feat(ai-runner): pi turn-session driver`; version 0.6.x (next patch); CHANGELOG. Handoff note in Solution; **Robin releases**.
5. Spur: bump catalog to the released version; run `bun run fleet-e2e --perf` (deterministic) and, opt-in, `--real-agents --agents pi`; warm rows replace `unsupported` in `docs/reports/fleet-perf-receipt.json`.
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
- ts-libs anchors: `packages/ai-runner/src/agents/shims.ts:533` (capability rows), `:248`/`:374` (`piRpcFrame`).

### History
