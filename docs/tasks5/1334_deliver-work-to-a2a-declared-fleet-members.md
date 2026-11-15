---
schema_version: 1
name: Deliver work to A2A-declared fleet members
status: todo
template: feature-impl
created_at: 2026-11-15T04:02:03.794Z
updated_at: "2026-11-15T08:09:19.283Z"
feature_id: G8
priority: P2
tags:
  - a2a
  - agent
  - fleet
  - transport
estimate_hours: 14

dependencies: ["1333"]
---

## 1334. Deliver work to A2A-declared fleet members

### Background

Implements: R3 — A member declared with an A2A card receives work over A2A; R4 — A2A task states map onto the existing receipt outcomes; R5 — An A2A wait that times out is outcome unknown and is never re-sent; R6 — A restarted dispatch re-attaches to the recorded remote task; R7 — Worktree-mutating work is refused for an A2A member; R10 — A2A credentials come from the environment only.

Spur cannot hand work to an agent it does not run itself. ADR-148 (Proposed) puts A2A v1.0 under the inbox as a member's turn driver, invisible to the user. Contract: `docs/design/a2a-member-transport.md` sections 3.3, 4.1, 4.2 and 4.3. Starting this task requires operator acceptance of ADR-148 decision 2 (member keys `a2a`/`authEnv`, the `a2a` binary as an optional prerequisite).

### Requirements

- [ ] R1 — `FleetMemberSchema` gains `a2a` (card host, URL or path) and `authEnv` (variable name only); `a2a` with `executor` is a validation error.
- [ ] R2 — One `packages/app` service owns every `a2a` CLI call: send (async, `messageId` = the request key), task get, task cancel, card get.
- [ ] R3 — An A2A member's claimed inbox message is completed by that service as the turn; with no `spur serve`, the same function runs in-process from the dispatch command.
- [ ] R4 — The remote task id and context id are stored on the coordination run before any wait; a restart reads the task and never sends again.
- [ ] R5 — Task states map to receipts exactly as design section 4.2; a deadline or transport error after a task id exists is `outcome-unknown`.
- [ ] R6 — Unreachable card, missing binary or unset auth variable yields `not-started` and a nonzero exit naming the member.
- [ ] R7 — Work declaring `expectFile(s)`, `requireDiff` or owned sections is refused for an A2A member before any send.
- [ ] R8 — The credential value reaches only the child process environment and is redacted from receipts, traces and logs.
- [ ] R9 — No flag, step option or run variable selects A2A; `ExecutorDispatchSurface` keeps its three values.
- [ ] R10 — The doctor line for an A2A member reports the binary version, card reachability and protocol version.

### Acceptance Criteria

- [ ] AC1 — A member declared with an A2A card receives work over A2A
- [ ] AC2 — A2A task states map onto the existing receipt outcomes
- [ ] AC3 — An A2A wait that times out is outcome unknown and is never re-sent
- [ ] AC4 — A restarted dispatch re-attaches to the recorded remote task
- [ ] AC5 — Worktree-mutating work is refused for an A2A member
- [ ] AC6 — A2A credentials come from the environment only

Task-local check: the E2E run against a local `a2a server --exec` leaves a repeatable receipt artifact.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**2026-11-15 — not started (batch 1331,1334,1337).** Cancelled at the batch level before implementation:
the remaining work is a member-loop turn-driver integration (an A2A member's claimed inbox message is
completed by the transport service inside `runDrain`) plus a coordination-run `contextId` persistence
path, the read-only admission check, a doctor line and a two-install E2E lane — a multi-hour feature
that a batch slot could not finish honestly. Prerequisites verified present for the next run:
ADR-148 decision 2 is Accepted, `a2a 0.4.0` is on PATH (`a2a send --async`, `task get`, `task cancel`,
`card get`), and both dependency tasks (1333, 1336) are `done`. Run it as its own `/sp-dev-run 1334`.

### Design

Approach: an A2A member is an ordinary fleet member whose turn driver shells to the operator-installed `a2a` binary (`a2a send --async -o json --request-payload`, then `a2a task get -o json` on an interval). The keyed inbox request stays the durable record; the existing claim, lease and receipt code is reused.

Why: A2A defines no idempotent delivery, durable receipt or write fencing, so it sits under the inbox rather than beside fleet; no new dependency; the user never sees it.

Rejected: a fourth `agent.run` surface (makes the transport user-visible); an A2A SDK dependency; wrapping local agents in `a2a server --exec` (cold per request, in-memory tasks, no session reuse); streaming (polling survives a restart).

Invariants: never re-send once a task id exists; read-only work only; no secret at rest; unknown CLI output fails loudly with the binary version; usage is reported unavailable.

Key signatures (shape, not code): `send(member, text, messageId) -> {taskId, contextId}`; `read(member, taskId) -> {state, statusMessage, artifactText}`; `toReceipt(task | error) -> FleetReceiptStatus + reason`.

### Plan

- [ ] Write the failure list first (each row of design section 4.2 plus the invariants) as E2E cases against a local `a2a server --exec` fixture and a stub returning each non-completed state.
- [ ] Member schema keys and validation.
- [ ] A2A turn service with golden fixtures of `a2a` JSON output.
- [ ] Wire it as the turn driver in the member loop and as the in-process path; task-id persistence and re-attach.
- [ ] Read-only admission refusal; doctor line.
- [ ] Update `docs/design/a2a-member-transport.md` status and the fleet config satellite; rebuild the CLI bundle.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
