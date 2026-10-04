---
schema_version: 1
name: Let a live session join the fleet as a guest occupant after a Codex parity spike
status: backlog
template: feature-impl
created_at: 2026-10-04T20:30:39.562Z
updated_at: "2026-10-04T20:33:18.600Z"
feature_id: G73

dependencies: ["1074", "1080"]
---

## 1081. Let a live session join the fleet as a guest occupant after a Codex parity spike

### Background

Implements G73 R2 and R3 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 items 13 and 14; decision D6, `spur agent join`/`leave` consented; ADR-121 amendment A2; ADR-057 amendment A1).

Joining by pid is impossible (TIOCSTI is disabled on Linux 6.2+ and restricted on macOS), and ADR-057 forbids injection. A guest instead pulls work: `spur agent wait --inbox` in a skill loop, plus a Claude `Stop` hook returning `{"decision":"block","reason":...}` with pending inbox messages so work arrives at turn end. Codex support is unverified: herdr installs Codex SessionStart/UserPromptSubmit/Stop hooks, but whether a Codex Stop hook can block is unknown, and `codex app-server` may serve as a persistent member mode.

### Requirements

- [ ] R1. Spike first: record go/no-go with evidence for (a) Codex `Stop` hook block/continue and (b) `codex app-server` as a persistent `MemberSession` mode, in the task Solution and a short note under `docs/plans/`.
- [ ] R2. `spur agent join --role <r> [--id <id>]` registers a guest occupant (pid, session id, executor) with a heartbeat lease; `spur agent leave` or lease expiry releases it. Guests are never supervised or restarted.
- [ ] R3. Guests are addressable by concrete id only; role resolution counts declared members only; stages with `requiresCapabilities` never route to a guest without attestation.
- [ ] R4. A `fleet-join` skill in `plugins/sp` loops `spur agent wait --inbox` (re-armed before the Bash tool's ~10-minute limit) → work → `spur message reply`; a Claude Stop hook delivers pending inbox messages via `decision: block` only for a joined session.
- [ ] R5. A guest holds the write slot only through its heartbeat.

### Acceptance Criteria

- [ ] AC1 — Codex parity is decided by evidence
- [ ] AC2 — A live session joins the fleet cooperatively

Task-local verification:

- A joined guest receives a `--to <guest-id>` review request at turn end and replies through `spur message reply`.
- `--role reviewer` with one declared reviewer and one guest reviewer resolves to the declared member.
- A guest whose lease expires is released and its pending messages return to pending.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History
