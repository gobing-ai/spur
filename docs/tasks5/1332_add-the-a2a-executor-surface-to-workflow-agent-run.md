---
schema_version: 1
name: Add the a2a executor surface to workflow agent.run
status: cancelled
template: feature-impl
created_at: 2026-11-15T03:27:14.743Z
updated_at: "2026-11-15T04:02:03.098Z"
feature_id: G8
priority: P2
tags:
  - a2a
  - agent
  - executor
  - workflow
estimate_hours: 14

dependencies: []
---

## 1332. Add the a2a executor surface to workflow agent.run

### Background

Implements: R2 — A workflow step completes through a declared A2A endpoint; R3 — A2A terminal states map onto receipt outcomes; R4 — A wait timeout after the send is recorded as outcome unknown; R5 — A resumed run re-attaches to the recorded remote task; R6 — A send that never yields a task is not started; R7 — A step that mutates the worktree is refused on the a2a executor; R8 — Doctor reports A2A readiness; R9 — The inbox stays the only coordination transport inside the fleet; R10 — Endpoint credentials are read from the environment only.

Spur cannot dispatch an `agent.run` step to an agent it has no driver for or that runs elsewhere. ADR-148 (Proposed) permits A2A v1.0 as an outbound executor edge only. Contract: `docs/design/a2a-executor-edge.md`. Starting this task requires operator acceptance of ADR-148 (new step option and config key, ADR-051).

### Requirements

- [ ] R1 — `agent.a2a.endpoints` config: name to card reference, optional `authEnv` (variable name only) and `transport`.
- [ ] R2 — `agent.run` step option `a2a: <endpoint>` selects the a2a surface for that step only; `vars.executor` is unchanged.
- [ ] R3 — One `packages/app` service owns every `a2a` CLI call: send (async, with a deterministic messageId), task get, task cancel, card get.
- [ ] R4 — The remote task id and context id are persisted on the run before any wait; resume reads the task and never sends again.
- [ ] R5 — Task states map to receipt outcomes exactly as design section 4.3; a wait timeout is `outcome-unknown`.
- [ ] R6 — Undeclared endpoint, unreachable card, missing binary or unset auth variable yields `not-started` and a nonzero exit.
- [ ] R7 — A step with `a2a` that declares `expectFile(s)`, `requireDiff` or owned sections fails workflow validation before any send.
- [ ] R8 — The credential value reaches only the child process environment and is redacted from receipts, traces and logs.
- [ ] R9 — `spur agent doctor` reports the `a2a` binary version and each endpoint's card reachability and protocol version.
- [ ] R10 — Host, fleet and subprocess receipts and gate results are unchanged.

### Acceptance Criteria

- [ ] AC1 — A workflow step completes through a declared A2A endpoint
- [ ] AC2 — A2A terminal states map onto receipt outcomes
- [ ] AC3 — A wait timeout after the send is recorded as outcome unknown
- [ ] AC4 — A resumed run re-attaches to the recorded remote task
- [ ] AC5 — A send that never yields a task is not started
- [ ] AC6 — A step that mutates the worktree is refused on the a2a executor
- [ ] AC7 — Doctor reports A2A readiness
- [ ] AC8 — The inbox stays the only coordination transport inside the fleet
- [ ] AC9 — Endpoint credentials are read from the environment only

Task-local check: the E2E run against a local `a2a server --exec` leaves a repeatable receipt artifact.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: a fourth branch at the single surface-selection point (`normalizeAgentInvocation` in `packages/app/src/workflow/actions/agent-run.ts`), backed by one service that shells to the operator-installed `a2a` binary (`a2a send --async -o json --request-payload`, then `a2a task get -o json` on an interval). `ExecutorDispatchSurface` and `ReceiptExecutor` gain `'a2a'`; the receipt shape does not change.

Why: no new dependency, one module tied to the CLI grammar, and every existing post-condition, gate and trace keeps working because the surface ends in the same receipt.

Rejected: an A2A SDK dependency (new dependency for what the installed binary does); streaming (polling survives restart, and the baseline has not shown the interval matters); a run-wide `vars.executor=a2a` (would route mutating steps to an unfenced remote tree); a new `spur` verb (ADR-051).

Invariants: never re-send once a task id exists; read-only steps only; no secret at rest; unknown CLI output fails loudly with the binary version; a2a rows report usage as unavailable.

Key signatures (shape, not code): `send(endpoint, text, messageId) -> {taskId, contextId}`; `read(endpoint, taskId) -> {state, statusMessage, artifactText}`; `toReceipt(task | error) -> WorkItemReceipt`.

### Plan

- [ ] Write the failure list first (each row of design section 4.3 plus the four invariants) as E2E cases against a local `a2a server --exec` fixture and a stub that returns each non-completed state.
- [ ] Config schema and loader for `agent.a2a.endpoints`.
- [ ] Dispatch service with golden fixtures of `a2a` JSON output.
- [ ] Surface branch, admission refusal for mutating steps, task-id persistence and resume path.
- [ ] Doctor check.
- [ ] Update `docs/design/a2a-executor-edge.md` status and the workflow step reference; rebuild the CLI bundle.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-15T04:02:03.098Z todo → cancelled (system)

