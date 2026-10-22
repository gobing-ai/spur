---
schema_version: 1
name: Claude Code warm task-turn adapter
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.913Z
updated_at: "2026-10-22T16:26:08.597Z"
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

## 1276. Claude Code warm task-turn adapter

### Background

Implements: R3 — Claude Code completes keyed tasks in a warm process.
Work package E3. Runs after the correlated task-turn seam. Candidate transport: current stream-json CLI input/output framing (docs/design/fleet-task-turn-execution.md §5).
Rubric: E6 D1 L2 C1 R1 = 11 → own task (distinct protocol, independent review).

**Refine corrections (2026-10-22)**
- Claim "adapter selection in the Spur turn seam" → reality: protocol mechanics belong to ts-ai-runner (ADR-145); the 1284 facade defines a per-agent `TurnSessionDriver` registry. → resolution: the driver is written in ts-libs `packages/ai-runner/src/turn-drivers/claude-stream-json.ts` and released by Robin; Spur's part is the catalog bump, capability evidence and receipt rows. ts-libs edits authorized by Robin on 2026-10-22; publishing is his.
- Capability row is stale: `AGENT_SESSION_CAPABILITY.claude` (ts-libs `src/agents/shims.ts:533`) — verifiedAgainst 2.1.278, supportsPersistentStdin true (input framing only); observed on this host 2026-10-22: claude 2.1.306. → resolution: re-probe and update `verifiedAgainst` with the driver.
- Transport premise: `claude -p --input-format stream-json --output-format stream-json` with one `result` record (success/error subtype, session_id) per turn — **unverified against the installed binary**; step 1 records the observed record shapes as redacted fixtures before any parser is written.

### Requirements

- [ ] R1. Qualify the installed Claude Code binary/version for stream-json persistent input and output; record provenance in `verifiedAgainst` and the receipt.
- [ ] R2. Two related keyed tasks execute serially in one process with correlated terminal results and validated artifacts.
- [ ] R3. Distinguish final result success/error from partial output and process exit; acceptance alone never records success.
- [ ] R4. Independent review uses a fresh conversation (FRESH_SESSION_ROLES via 1275); unqualified versions keep resume/one-shot fallback with a named reason.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The qualified version is recorded with evidence (req: R1)
  Given the probed Claude Code binary
  When the driver's qualify() and the perf receipt run
  Then `verifiedAgainst` equals the probed version, transcripts exist under the ts-libs fixtures, and the receipt row records binary path and version

Scenario: AC2 — Two keyed tasks complete in one warm process (req: R2)
  Given the Claude driver replaying two recorded turns through a real child
  When two keyed tasks drain through the 1275 seam
  Then one process serves both, each receipt has its own native session/turn ids and a passing action contract

Scenario: AC3 — Only a final success result is success (req: R3)
  Given transcripts with an error-subtype result, partial output then exit, and exit before any record
  When each turn settles
  Then the outcomes are `failure`, `outcome-unknown` and `not-started` respectively, never `success`

Scenario: AC4 — Reviewer fresh and unqualified fallback (req: R4)
  Given a reviewer task, and a binary version not in `verifiedAgainst`
  When each dispatches
  Then the reviewer receipt names fallback `fresh-role` and the other names `unqualified-version`, each running once via resume/one-shot
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:41.979Z

- **Q: Where does the driver live?** CLOSED — ts-libs `packages/ai-runner/src/turn-drivers/claude-stream-json.ts`, registered in `TURN_SESSION_DRIVERS` (1284). Spur imports nothing agent-specific.
- **Q: Which versions qualify?** CLOSED — exactly the probed version(s) recorded in `verifiedAgainst`; `qualify()` refuses others with `unqualified-version`, and Spur falls back (resume via `--resume <id>` then one-shot) with that reason (1275).
- **Q: Release?** CLOSED — implementer stops at a green, committed, untagged ts-libs tree with version 0.6.1 (or next patch); Robin tags/publishes; Spur catalog bump + evidence follow in this task's last steps.
- **Q: Real-agent runs?** CLOSED — opt-in (`fleet-e2e --perf --real-agents --agents claude`); deterministic lane replays recorded fixtures.

### Design

**Driver:** ts-libs `packages/ai-runner/src/turn-drivers/claude-stream-json.ts` implementing `TurnSessionDriver` (1284). Reuse `claudeStreamJsonFrame` (`shims.ts:175`) for input; add a line decoder mapping the recorded `result` record to terminal (success subtype → `success`, error subtypes → `failure`), any earlier record → `output`/`accepted`; exit without `result` → per 1284 R4.
**Session id:** taken from observed records only; never inferred.
**Rejected:** a new SDK dependency; disabling hooks/skills to speed startup.
**Invariants:** per-version qualification; fresh reviewer context; no Spur-side protocol parsing.

### Plan

1. Qualification spike: probe `claude --version` and the persistent protocol on the installed binary; capture redacted transcripts (two turns, an error turn, a cancel) to ts-libs `packages/ai-runner/tests/fixtures/turn-drivers/claude/*.jsonl`. No parser before fixtures.
2. Failure cases first in ts-libs `tests/turn-drivers/claude.test.ts`: two serial turns; error-subtype result; partial output then exit (outcome-unknown); exit before first record (not-started); malformed JSON line (contract-violation); result for a stale session id (diagnostic).
3. Implement `src/turn-drivers/claude-stream-json.ts`, register it, update `AGENT_SESSION_CAPABILITY.claude.verifiedAgainst`/note; fixture-replay tests pass through a real child (fake agent replaying the captured transcript).
4. ts-libs `bun run spur-check`; commit `feat(ai-runner): claude turn-session driver`; version 0.6.1 (or next patch); CHANGELOG. Handoff note in Solution; **Robin releases**.
5. Spur: bump catalog to the released version; run `bun run fleet-e2e --perf` (deterministic) and, opt-in, `--real-agents --agents claude`; warm rows replace `unsupported` in `docs/reports/fleet-perf-receipt.json`.
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
- ts-libs anchors: `packages/ai-runner/src/agents/shims.ts:533` (capability rows), `:175` (`claudeStreamJsonFrame`).

### History
