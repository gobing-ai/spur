---
schema_version: 1
name: Guest lease renewal and exact agent process identity
status: done
template: feature-impl
created_at: 2026-10-22T07:00:38.139Z
updated_at: "2026-10-22T19:47:29.359Z"
feature_id: G75
priority: P1
tags:
  - fleet
  - performance

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1279-verdict.json
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

- [x] R1. A bounded renewal owner keeps a 30-second guest lease alive through 90-second work with no inbox wait, using the existing lease DAO epoch fence (`FleetGuestService.heartbeat`), renewing every `GUEST_LEASE_TTL_MS / 3`.
- [x] R2. Record the actual agent process identity (PID plus birth time and executable where the host exposes it); the short-lived CLI PID never implies agent liveness.
- [x] R3. Renewal stops on identity loss, fence failure or explicit leave; PID reuse or process death cannot transfer the identity.
- [x] R4. Same proven session rejoins idempotently; a colliding identity is refused; existing join/wait/leave defaults unchanged; no new public noun, verb or flag.

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
- `packages/app/src/services/fleet-guest-service.ts`: `GuestRecord` gains optional `processStartedAt`, `executable`, `identity: 'verified' | 'unverified'`, `renewerPid` (additive, versioned by optional fields; `read()` tolerant as today).
- `apps/cli/src/commands/agent/join.ts`: resolve identity before `join`; after success with verified identity and no live renewer, spawn the detached renewer; record `renewerPid`. Marker branch at command entry.
- `leave`: unchanged contract; the renewer notices the missing record.

**Barrels and follow-on edits (required by the workspace rules, still this task's surface):** `packages/app/src/index.ts`, `apps/cli/src/commands/agent/index.ts` (new services/exports must come through the app barrel), `packages/app/tests/services/fleet-guest-service.test.ts` (claim-key normalization fixture).

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

| File | Change | Why |
| --- | --- | --- |
| `packages/app/src/services/process-identity.ts:1-127` | New: `ProcessIdentity` (pid + `ps` `lstart` birth time + executable + parent), `parseProcessIdentity`, `createPsProcessIdentityReader`, `sameProcess`, `findAgentAncestor` (bounded 8-hop walk) | A pid alone cannot prove liveness — pid reuse is exactly the failure R3 names, so the fingerprint pairs the pid with a stable birth time. `lstart`, not `etime`, because `etime` drifts between reads. |
| `packages/app/src/services/guest-lease-renewer.ts:1-99` | New: `GuestLeaseRenewer.run()` renewal loop, `GuestRenewalStopReason`, `DEFAULT_RENEWER_MAX_LIFETIME_MS` (12 h) | The renewal owner the lease never had. Bounded by record + fingerprint + lifetime cap; a transient ledger error skips a tick instead of ending renewal (a renewer that dies on one locked write is worth nothing). |
| `packages/app/src/services/fleet-guest-service.ts:35-65` | `GuestRecord` gains `identity: 'verified' \| 'unverified'`, `processStartedAt`, `executable`, `renewerPid`, `renewerStartedAt`; `read()` defaults an older record to `unverified` | Additive, versioned by optional fields: a pre-G75 record never claimed a verified process, so it must not read as one. |
| `packages/app/src/services/fleet-guest-service.ts:261-270` | `attachRenewer(id, {pid, startedAt})` | The renewer records itself, so a rejoin sees a live owner and spawns no second renewer (AC4). |
| `packages/app/src/services/fleet-guest-service.ts:369-379` | Claims now key on `normalizeProjectPath(cwd)`; `leaseTtlMs` test seam | The renewer is a separate process whose cwd the OS reports physically (`/private/var/…` vs `/var/…`), so a symlinked cwd fenced the renewer out of its own claim. The TTL seam keeps the 3×TTL scenario fast without changing the renewal ratio. |
| `apps/cli/src/commands/agent/join.ts:24-38` | `GUEST_RENEWER_ENV` marker + `_testRenewerArgv` seam | Re-invoking the same bin/argv with an env marker is the established async-worker pattern (ADR-065/governance: no new public or hidden flag). |
| `apps/cli/src/commands/agent/join.ts:60-95` | Marker branch → `runGuestRenewer`; identity resolved before `join`; verified identities call `ensureRenewer` | The renewer branch never joins, so it cannot create a second guest. The record now carries the agent pid or none at all — never the exited CLI pid (AC2). |
| `apps/cli/src/commands/agent/join.ts:109-183` | `resolveGuestIdentity`, `runGuestRenewer` (self-attach + stop line), `ensureRenewer` (one live owner), `spawnGuestRenewer` (`nohup` + `NodeProcessExecutor`) | Spawn uses the `ProcessExecutor` seam, never `child_process.spawn`. POSIX-only by construction: without `ps` no identity verifies, so no renewer is ever started on such a host. |
| `apps/cli/src/commands/agent/join.ts:192` | `--pid` help: "Agent process id to record (defaults to the matching agent ancestor)" | The flag keeps its name; its documented meaning now matches what the record holds. No new option (AC4). |
| `packages/app/src/index.ts:395-400, 543-554, 692` | Barrel exports for the two new services + `shQuote` | Cross-workspace rule: anything the CLI uses comes through `@gobing-ai/spur-app`. |
| `packages/app/tests/services/process-identity.test.ts`, `packages/app/tests/services/guest-lease-renewer.test.ts` | New suites: parser fixtures with spaces, PID reuse, ancestor walk/hop budget; renewal past 3×TTL, death, reuse, leave, fence, transient error, lifetime cap | The Plan's failure list, each item one test. The TTL is injected (900 ms) so 3×TTL runs in seconds at the real `TTL/3` ratio, against a real `sleep` child rather than a fixture fingerprint. |
| `apps/cli/tests/commands/agent/join-renewal.test.ts` | CLI E2E: verified `--pid`, unverified fallback (no pid claimed), real detached renewer + rejoin keeps one, `join --help` unchanged, marker branch with no record and with a dead agent | Proves the renewal path end-to-end through the real CLI, not just the service seam. |
| `packages/app/tests/services/fleet-guest-service.test.ts:23-24` | Fixture cwd is `realpath`-resolved | Follows the claim-key normalization above; assertions unchanged. |
| `plugins/sp/skills/fleet-join/SKILL.md`, `docs/design/fleet-attached-occupants.md` §3 | Renewal is automatic; `identity: 'unverified'` means keep looping `wait`; mechanism named | Surface truth without a new command. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/guest-lease-renewer.ts:55` renews at `TTL / 3`; `packages/app/tests/services/guest-lease-renewer.test.ts:96` proves 3× TTL with no inbox wait and `expire()` retiring nothing |
| R2 | MET | `packages/app/src/services/process-identity.ts:59` reads the `ps` fingerprint (pid + `lstart` + executable); `apps/cli/tests/commands/agent/join-renewal.test.ts:71` proves the record names the agent process, `:88` proves the `pid: null` fallback |
| R3 | MET | `packages/app/src/services/process-identity.ts:96` compares birth time, not the pid; `packages/app/tests/services/guest-lease-renewer.test.ts:130` covers death, pid reuse, leave and fence loss |
| R4 | MET | `apps/cli/tests/commands/agent/join-renewal.test.ts:103` proves one renewer across a rejoin; `:140` proves `join --help` gained no option; collision behavior unchanged at `packages/app/src/services/fleet-guest-service.ts:200` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R1 — A live session keeps exact identity and its lease throughout active work (req: R1) | MET | test | `packages/app/tests/services/guest-lease-renewer.test.ts:96` |
| AC2 — The record names the agent process, not the CLI (req: R2) | MET | test | `apps/cli/tests/commands/agent/join-renewal.test.ts:71` |
| AC3 — Renewal stops on death, PID mismatch, fence loss or leave (req: R3) | MET | test | `packages/app/tests/services/guest-lease-renewer.test.ts:131` |
| AC4 — Rejoin and collision behave as today (req: R4) | MET | test | `apps/cli/tests/commands/agent/join-renewal.test.ts:103` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: MEDIUM

#### Review Report — 1279

**Scope:** 1279 diff (12 files, +996/−17) against the task's Requirements R1–R4 and AC1–AC4
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | `defaultSleep` re-implements the abort-aware sleep that `loopSleep` already exports; swapping it mid-run would move the tree hash under a PASS receipt for a 12-line dedupe | `packages/app/src/services/guest-lease-renewer.ts:100` | ACCEPTED |
| 2 | P4 (advisory) | correctness | the renewer-liveness check accepts an absent `renewerStartedAt` as "alive" for whatever process holds the pid; unreachable through `attachRenewer`, and the branch errs toward not spawning a duplicate owner | `apps/cli/src/commands/agent/join.ts:151` | ACCEPTED |
| 3 | P4 (advisory) | usability | no blank line between `runGuestRenewer` and the following doc comment | `apps/cli/src/commands/agent/join.ts:145` | ACCEPTED |

##### Verified evidence

- Full quality gate (`spur self exec check`, tier `full`) green on this tree: `.spur/run/1279-test-gate.status` = `PASS`, receipt `.spur/run/1279-check-receipt.json`.
- Targeted suites run directly: `bun test tests/services/process-identity.test.ts tests/commands/agent/join-renewal.test.ts` in `packages/app` / `apps/cli`, plus the whole `packages/app/tests/services/` sweep (3905 pass, 0 fail).
- Security: the detached renewer quotes every argv element through `shQuote` (`apps/cli/src/commands/agent/join.ts:172`) and passes the guest id as an environment value, never as shell text, so a hostile `--id` cannot inject a command; `--role` is still validated against `GUEST_ROLES` (`packages/app/src/services/fleet-guest-service.ts:183`); nothing in the change signals, adopts or kills a process (`packages/app/src/services/process-identity.ts:1`).

##### Residual risk (named, not blocking)

- `FleetGuestService.read()` returns null for a parse/read failure and the renewer reads that as `record-gone`. A torn read during a concurrent `attachRenewer` write would end renewal until the next rejoin; the lease then falls back to the pre-existing `wait --inbox`/Stop renewal, so the failure mode is the old behavior, not a regression.
- Renewal is POSIX-only by construction (identity comes from `ps`). On a host without `ps` no identity verifies, so no renewer starts and the guest keeps the documented pull-only contract; `plugins/sp/skills/fleet-join/SKILL.md` now states it.
- The renewer is a detached process that inherits the caller's environment (as `spawnAsyncWorkflowWorker` already does) and never writes it anywhere.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/guest-lease-renewer.ts:55` renews at `TTL/3`; `packages/app/tests/services/guest-lease-renewer.test.ts:96` proves 3× TTL with no inbox wait |
| R2 | MET | `packages/app/src/services/process-identity.ts:59` reads the `ps` fingerprint; `apps/cli/tests/commands/agent/join-renewal.test.ts:71` proves the record names the agent process |
| R3 | MET | `packages/app/src/services/process-identity.ts:96` compares birth time, not the pid; `packages/app/tests/services/guest-lease-renewer.test.ts:130` covers death, reuse, leave and fence loss |
| R4 | MET | `apps/cli/tests/commands/agent/join-renewal.test.ts:103` proves one renewer across a rejoin and `:140` proves `join --help` gained no option |

**Next:** wrap 1279, then run 1280/1281 (`--next`).

### References

- Feature G75 R1; design `docs/design/fleet-attached-occupants.md` §3; ADR-146; governance `docs/design/harness-surface-governance.md` §2.
- Anchors: `fleet-guest-service.ts:21,143,198,207,219,245`; `project-claim-dao.ts:13,19`; `wait.ts:47,63`; `hooks.json:87`; `workflow/shared.ts:31,68–83`; `resolve-spur-bin.ts:47`.
- Consumers: 1280, 1281.

### History

- 2026-10-22T19:10:13.898Z todo → wip (system)
- 2026-10-22T19:42:20.788Z wip → testing (system)
- 2026-10-22T19:47:29.350Z testing → done (system)

