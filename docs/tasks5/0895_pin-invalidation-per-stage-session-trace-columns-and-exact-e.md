---
schema_version: 1
name: Pin invalidation, per-stage session trace columns, and exact E6 run-to-session mapping for pinned stages
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.556Z
updated_at: "2026-09-17T23:22:20.517Z"
feature_id: B7
priority: P1
tags:
  - workflow
  - trace
  - E6
  - B7
estimate_hours: 6

dependencies: ["0894", "0891"]
---

## 0895. Pin invalidation, per-stage session trace columns, and exact E6 run-to-session mapping for pinned stages

### Background

Task 7 pins one executor per role for the run. A pin can go stale when task 4's drain disables the executor mid-run, and nothing yet shows per-stage executor/session in the trace or feeds E6's run→session correlation (0 mapped rows today). Authority: `docs/design/session-pinned-dispatch.md` §4 (pin invalidation, trace), AC R6/R7/R8; feature E6 R2.

### Requirements

- [ ] R1. Before each `agent.run`, the pinned executor's current availability is read through the loader (cache-invalidated by task 4); if disabled, the role is re-resolved exactly once for the run, the trace records `pin-reresolved` with the owner/reason, and the stage starts a fresh session.
- [ ] R2. Each `agent.run` trace row carries `executor`, `sessionId` and `session: reused | fresh`; `spur workflow trace <run> --json` exposes them and the table renders them.
- [ ] R3. For a stage that resumed a pinned session, the E6 correlation records the exact run → session mapping (no heuristic match) using the session id the agent accepted; a resumed stage yields one mapped row.
- [ ] R4. Tests cover the mid-run disable path (re-resolve once, second disable fails the stage with the ADR-118 outcome), trace fields, and the E6 mapping row; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B7 scenarios R6, R7, R8.

- [ ] AC1 — The trace shows executor and session per stage (req: R2)
- [ ] AC2 — A pin is re-resolved when its executor is disabled mid-run (req: R1)
- [ ] AC3 — Stage cost attributes to the executor through the session mapping (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: invalidation is a read of the same loader the drain invalidates, not a subscription — one pin check per stage is cheap and needs no event plumbing (docs/design/session-pinned-dispatch.md §4). Re-resolve happens once per run per role: a second disable means the ladder is exhausted for that tier and the stage should fail loudly rather than hunt. Trace columns are the measurement the whole program depends on; E6 gets its first exact rows from resumed stages. Mutation policy: `agent-run.ts` pre-spawn check, trace projection (`progress-projection.ts` / trace renderer), E6 correlation writer, tests; no workflow YAML changes beyond what task 7 declared.

### Plan

1. Read design §4 (invalidation, trace), task 7's pin shape, the trace projection code, and E6's correlation writer.
2. Add the pre-spawn availability read + single re-resolve; record the trace note.
3. Add the three trace fields end to end (action result → projection → CLI table/JSON).
4. Wire the exact E6 mapping for resumed stages; write the tests.
5. Run `cd packages/app && bun test tests/workflow/` and `cd apps/cli && bun test tests/commands/workflow*` then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
