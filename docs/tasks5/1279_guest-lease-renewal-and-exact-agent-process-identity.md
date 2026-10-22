---
schema_version: 1
name: Guest lease renewal and exact agent process identity
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.139Z
updated_at: "2026-10-22T16:36:42.405Z"
feature_id: G75
priority: P1
tags:
  - fleet
  - performance

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 6
---

## 1279. Guest lease renewal and exact agent process identity

### Background

Implements: R1 — A live session keeps exact identity and its lease throughout active work.
Work package B1. Design: docs/design/fleet-attached-occupants.md §3; ADR-146. Evidence: apps/cli/src/commands/agent/join.ts, wait.ts; packages/app/src/services/fleet-guest-service.ts; packages/domain/src/dao/project-claim-dao.ts.
No dependency on G74; useful guest hardening on its own.
Rubric: E6 D1 L2 C1 R1 = 11 → own task.

**Refine corrections (2026-10-22)**
- Claim "short-lived CLI PID" → confirmed: `join.ts` records `pid: flags.pid ?? process.pid` (the CLI's own PID); `FleetGuestService.join` (`packages/app/src/services/fleet-guest-service.ts:143`) writes it to `coordination_runs.processId` (`:198`) and the record (`:207`).
- Lease mechanics: `GUEST_LEASE_TTL_MS = CLAIM_TTL_MS` (`fleet-guest-service.ts:21`) = 30 000 ms (`packages/domain/src/dao/project-claim-dao.ts:19`); `heartbeat` (`:219`) is epoch-fenced; renewal today happens only in `wait --inbox` (`apps/cli/src/commands/agent/wait.ts:47`) and the Stop hook (`superskill hook run sp fleet-guest-stop`, `plugins/sp/hooks/hooks.json:87`).
- Claim "renewal helper started by the participation skill / host integration" → reality: there is **no** `spur agent heartbeat` verb (agent verbs: doctor, dogfood, join, leave, list, loop, report, run, start, status, stop, trace, usage, wait) and governance forbids plugin scripts / new public or hidden CLI surface without consent (`docs/design/harness-surface-governance.md` §2). → resolution: reuse the established async-worker precedent — `join` re-invokes itself detached with an env marker (as `SPUR_ASYNC_WORKER=1` in `apps/cli/src/commands/workflow/shared.ts:31,68–83`, bin via `apps/cli/src/workflow/resolve-spur-bin.ts:47`). No new noun, verb or flag.
- No process-identity helper exists in the tree (searched `lstart`/birth) → new small helper in `packages/app`.

### Requirements

- [ ] R1. A bounded renewal owner keeps a 30-second guest lease alive through 90-second work with no inbox wait, using the existing lease DAO epoch fence (`FleetGuestService.heartbeat`), renewing every `GUEST_LEASE_TTL_MS / 3`.
- [ ] R2. Record the actual agent process identity (PID plus birth time and executable where the host exposes it); the short-lived CLI PID never implies agent liveness.
- [ ] R3. Renewal stops on identity loss, fence failure or explicit leave; PID reuse or process death cannot transfer the identity.
- [ ] R4. Same proven session rejoins idempotently; a colliding identity is refused; existing join/wait/leave defaults unchanged; no new public noun, verb or flag.

### Acceptance Criteria

```gherkin
Scenario: AC1 — R1 — A live session keeps exact identity and its lease throughout active work (req: R1)
  Given a guest joined from a long-lived fixture "agent" process with renewal enabled (TTL shortened via test seam to keep the run fast, same ratios)
  When 3× TTL elapses with no `wait --inbox` and no Stop hook
  Then the `guest:<id>` claim is still live with the same owner epoch and `expire()` does not retire it

Scenario: AC2 — The record names the agent process, not the CLI (req: R2)
  Given `spur agent join` run from a shell child of the fixture agent
  When the record is read
  Then `pid` is the fixture agent's PID with `processStartedAt` and `executable` set, or `identity: 'unverified'` with `pid: null` when no ancestor matches — never the exited CLI PID

Scenario: AC3 — Renewal stops on death, PID mismatch, fence loss or leave (req: R3)
  Given a renewing guest
  When the agent process exits, or its PID is observed with a different start time, or another holder takes the claim, or `spur agent leave` runs
  Then the renewer exits within one interval, makes no further heartbeat, and the lease expires or is released normally

Scenario: AC4 — Rejoin and collision behave as today (req: R4)
  Given a live guest
  When the same session rejoins, and a different session joins with the same id
  Then the first renews idempotently (one renewer, not two) and the second exits 2 with `collision`; `join --help` lists no new option
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:52.405Z

- **Q: What runs the renewal?** CLOSED — `spur agent join` spawns a detached copy of itself (same bin/argv via `resolveSpurArgv`, env `SPUR_GUEST_RENEWER=<guest-id>`), exactly like the async workflow worker; the marker branch runs `GuestLeaseRenewer.run()` and never joins. If review or `sp-script-placement` objects, the alternative (a hidden flag) needs Robin's consent — escalate, do not add it silently.
- **Q: How is the agent process found?** CLOSED — walk ancestors from `process.ppid` (max 8 hops) until the executable basename matches the executor (`claude`, `codex`, `pi`, `omp`, …) or `--pid` was given; fingerprint `{pid, startedAt, executable}` from `ps -o ppid=,lstart=,comm= -p <pid>` (macOS/Linux). No match → `identity: 'unverified'`, no renewer, existing wait/Stop renewal only (reported in JSON).
- **Q: Interval?** CLOSED — `GUEST_LEASE_TTL_MS / 3` (10 s), mirroring the owner timer (`agent-loop-service.ts:356`).
- **Q: Kill anything on loss?** CLOSED — never; the renewer only stops itself.

### Design

**Files:**
- `packages/app/src/services/process-identity.ts` (new): `readProcessIdentity(pid)`, `findAgentAncestor(startPid, executors)`, `sameProcess(a, b)` — `ps` via the existing process executor seam; pure parsing tested on fixtures.
- `packages/app/src/services/guest-lease-renewer.ts` (new): `GuestLeaseRenewer({ guests: FleetGuestService, identity, intervalMs, clock })`.run(guestId, signal) — loop: read record (gone → stop); `sameProcess(record identity, live)` (false → stop); `heartbeat(id)` (false → stop); sleep interval.
- `fleet-guest-service.ts`: `GuestRecord` gains optional `processStartedAt`, `executable`, `identity: 'verified' | 'unverified'`, `renewerPid` (additive, versioned by optional fields; `read()` tolerant as today).
- `apps/cli/src/commands/agent/join.ts`: resolve identity before `join`; after success with verified identity and no live renewer, spawn the detached renewer; record `renewerPid`. Marker branch at command entry.
- `leave`: unchanged contract; the renewer notices the missing record.

**Tests:** `packages/app/tests/services/guest-lease-renewer.test.ts` (E2E with a real long-lived fixture process + in-memory SQLite) and `apps/cli/tests/commands/agent/join-renewal.test.ts` (spawned CLI, real detached renewer).
**Invariants:** leases and message claims separate; guests message-only; no daemon (renewer lifetime ≤ agent lifetime).
**Rejected:** always-on daemon; adopting/killing an unrelated PID; raising the TTL.

### Plan

1. Failure cases first: TTL overrun with no wait; PID reuse (same PID, different start); agent death; fence loss (claim taken); leave; double rejoin spawning two renewers; unverified identity.
2. `process-identity.ts` + parser fixtures.
3. `guest-lease-renewer.ts` + record fields.
4. `join.ts` identity resolution, detached spawn, marker branch.
5. E2E: 3×TTL beyond, crash and leave release; `join --help` unchanged.
6. Update `plugins/sp/skills/fleet-join/SKILL.md` (renewal is automatic; `identity: unverified` means keep looping `wait`) and `docs/design/fleet-attached-occupants.md` §3 (mechanism named).
7. Focused tests in `packages/app` and `apps/cli`; `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G75 R1; design `docs/design/fleet-attached-occupants.md` §3; ADR-146; governance `docs/design/harness-surface-governance.md` §2.
- Anchors: `fleet-guest-service.ts:21,143,198,207,219,245`; `project-claim-dao.ts:13,19`; `wait.ts:47,63`; `hooks.json:87`; `workflow/shared.ts:31,68–83`; `resolve-spur-bin.ts:47`.
- Consumers: 1280, 1281.

### History
