---
schema_version: 1
name: "Persistent fleet member sessions in spur agent loop: persistent-stdin, resume-by-id and one-shot modes with deliberate reset on restart and on repeated failed drains"
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.557Z
updated_at: "2026-09-17T23:22:20.783Z"
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

- [ ] R1. `runAgentLoop` keeps `memberSession = {{ mode: 'persistent'|'resume'|'one-shot', id?, dir?, process? }}` for the loop's lifetime; mode is chosen from the executor's capability record: `supportsPersistentStdin` → `persistent`, else `supportsResumeById` → `resume`, else `one-shot`.
- [ ] R2. `persistent` starts one `TeamAgentProcess` at loop start and feeds each drained prompt through `send()`; process exit is reported to the supervisor with the existing restart policy; `resume` passes the previous drain's session id to `AgentService.run`.
- [ ] R3. `one-shot` emits exactly one warning per member lifetime (`member-no-session`), not per drain.
- [ ] R4. Supervisor restart, `spur agent stop` + `start`, and `MAX_CONSECUTIVE_FAILED_DRAINS` (constant 3) consecutive failed drains reset the session; the loop's run record names the reset reason (`restart` | `operator` | `failed-drains`).
- [ ] R5. Reconcile-before-first-drain (0834) and the settle guarantees (0831) are untouched: a resumed session never causes a settled message to be redelivered (regression test).
- [ ] R6. Tests in `apps/cli/tests/commands/agent*` cover all three modes with a stubbed runner, the reset reasons, and the failed-drain counter; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature G66 scenarios R1, R2, R3, R4, R7.

- [ ] AC1 — Consecutive drains resume the member's session (req: R1)
- [ ] AC2 — A persistent-stdin agent runs as one long-lived process (req: R2)
- [ ] AC3 — An agent without session support falls back to one-shot with one warning (req: R3)
- [ ] AC4 — A restart starts a fresh session deliberately (req: R4)
- [ ] AC5 — Repeated failed drains reset a poisoned session (req: R4)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
