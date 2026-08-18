---
template: standard
schema_version: 1
name: "Team lifecycle over supervisor: self-drain keep-alive, autostart, and the no-auto-restart gap"
description: ""
status: done
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T04:29:04.883Z"
updated_at: "2026-08-18T04:42:47.316Z"
---

## 0253. Team lifecycle over supervisor: self-drain keep-alive, autostart, and the no-auto-restart gap

### Background
**Wayfinder ticket (grilling)** for feature M.

DD-2 chose the self-draining wrapper (`agent run --agent <id> --drain --continue`, already the
`SupervisorService` default wrapper). But the supervisor has NO auto-restart (it records exit and
drops the entry after 60s), and the ts-infra scheduler is disabled in `.spur/config.yaml`
(`bootstrap.scheduler.enabled: false`). This ticket defines what the "team scheduler" actually is.

**Blocked by:** 0250 (needs the team/autostart shape). See `supervisor-service.ts`.
### Requirements
R1. Name the keep-alive owner: the supervisor loop vs the ts-infra scheduler (recommend supervisor + a lightweight monitor; enable the scheduler only if a timed cadence is actually needed).
R2. Autostart flow on `spur serve` / `spur team up` — which members start, in what order.
R3. Restart policy on member exit (today: none) — decide none / bounded backoff / max-retries.
R4. Drain cadence: purely reactive (the `--continue` loop) vs a timed nudge.
R5. Graceful team stop reuses `SupervisorService.stop` (SIGTERM → 3s → SIGKILL).
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Loop wrapper** (per member — replaces the single-shot `defaultWrapperArgv`):

```
while running:
    batch = drainPending(memberId)           # queued → injected, atomic (ts-db)
    if batch.nonEmpty:
        agent run --agent <memberId> --continue   # prompt = batch prepended
    else:
        sleep(pollInterval)                  # idle; countPending()==0
# process stays alive + attachable (0255); exits only on stop / kill / crash
```

**Supervisor restart policy** (abnormal exit only):

```
on handle.exited(code):
    if stopping:          mark 'stopped';  done
    if code == 0:         mark 'exited'    # loop shouldn't exit clean unless told
    else:                                  # crash
        failures += 1
        if failures > 5 (in window):  mark 'errored'; surface; give up
        else:  delay = min(2^failures * base, 30s);  after delay → start(memberId)
```

**Autostart derivation** (shared by serve-boot + `team up`):

```
resolveAutostartSet(config):
    for team in config.agent.team:
        for member in team.members:
            if (member.autostart ?? team.autostart ?? false): yield memberId
env SPUR_TEAM_AUTOSTART (if set): union / override
→ supervisor.startAutostart(ids)             # existing method, declaration order
```

**Status lifecycle:**

```
member:  (spawn) → running ⇄ (crash → backoff → running) → errored | stopped | exited
message: queued → injected (drainPending) → [delivered (optional ack via markDelivered)]
```
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Resolved via grilling** (3 forks) — team lifecycle over the existing supervisor + drain; mechanics in **### Design**.

| Fork | Decision |
|---|---|
| Keep-alive / continuous drain | **Loop wrapper (persistent) + supervisor restart-on-crash** — the wrapper loops `drainPending → run agent → idle-sleep`; one persistent, attachable process per member; the supervisor restarts only on abnormal crash |
| Crash policy | **Bounded backoff (exp, cap 30s) + max-retries (5 consecutive / window) → mark `errored`** and surface in status/board |
| Autostart wiring | **Derive the autostart set from `agent.team.*.autostart` at serve-boot + `team up`; `SPUR_TEAM_AUTOSTART` env stays an override** |

**Requirements resolution:**
- **R1 — Keep-alive owner:** the **supervisor** (`SupervisorService`, in-memory registry) owns member liveness for v1; the ts-infra scheduler is NOT used (reserved for a future timed cadence). One owner of process state avoids split-brain liveness.
- **R2 — Autostart flow:** a shared `resolveAutostartSet(config)` yields members with effective autostart true across `agent.team.*`; called by serve-boot (augmenting the raw env read at `apps/server/src/bootstrap.ts:44`) and by `team up`'s best-effort start (the 0252 handoff). Env unions/overrides; start order = config declaration order.
- **R3 — Crash policy:** replace the current no-restart behaviour (`packages/app/src/services/supervisor-service.ts:177` — records exit, drops after 60s) with restart-on-abnormal-exit: exponential backoff capped at 30s, max 5 consecutive failures in a rolling window → stop, mark `errored`. Normal loop iterations are NOT crashes (the loop lives inside one process).
- **R4 — Drain cadence:** the loop idle-sleeps when `countPending()==0` (short configurable poll) and re-iterates immediately after a non-empty drain. No central tick.
- **R5 — Graceful stop:** reuse `SupervisorService.stop` (SIGTERM → 3s → SIGKILL, `packages/app/src/services/supervisor-service.ts:193`) per member; `stopAll` on shutdown; `team down` delegates here.

**Key correctness fix (grounded, not averaged): drain must consume.**
`agent run --drain` currently reads via the NON-consuming `getInbox`/`inbox()` (`apps/cli/src/commands/agent.ts:303` → `dao.inbox`), so a loop would re-prepend the same messages every iteration. The DAO already ships the idempotent primitive — **`InboxMessageDao.drainPending(toId)`** atomically transitions `queued → injected` and returns the batch (ts-db `inbox-message-dao.ts:121`). The loop wrapper's `--drain` MUST call `drainPending`, not `inbox()`. `markDelivered` (`:156`) stays available for an optional agent-ack step.

**Grounding (verified from source 2026-07-14):**
- `packages/app/src/services/supervisor-service.ts:65` — `defaultWrapperArgv` (the single-shot wrapper to convert to a loop).
- `packages/app/src/services/supervisor-service.ts:177` — exit handler (records exit, drops after 60s; no restart — the gap).
- `packages/app/src/services/supervisor-service.ts:193` — `stop` (SIGTERM→3s→SIGKILL), reused for graceful stop.
- `apps/cli/src/commands/agent.ts:303` — `drainIntoPrompt` uses non-consuming `getInbox` (the idempotency bug).
- `~/xprojects/ts-libs/packages/db/src/inbox-message-dao.ts:121,156,198` — `drainPending` (queued→injected), `markDelivered`, `countPending` (idle signal).
- `apps/server/src/bootstrap.ts:44` — `SPUR_TEAM_AUTOSTART` env read (to augment with config derivation).

**Hands off to:**
- Implementation — loop-wrapper conversion; supervisor restart policy (backoff + max-retries + `errored`); `resolveAutostartSet(config)`; rewire `--drain` to `drainPending`.
- Attach-terminal ticket (0255) — attaches to the now-persistent loop process; restart-on-crash means the terminal must reconnect its SSE stream across a mid-session respawn.
### Testing
**N/A** — decision ticket, no code. Verification = citation accuracy + a confidence rating.

**Citation check (verified from source, 2026-07-14):** `inbox-message-dao.ts:121/156/198` (`drainPending`/`markDelivered`/`countPending`), `apps/cli/src/commands/agent.ts:303` (non-consuming `getInbox`), `supervisor-service.ts:65/177/193` (`defaultWrapperArgv` / no-restart exit / `stop`), `apps/server/src/bootstrap.ts:44` (`SPUR_TEAM_AUTOSTART`), `packages/app/src/services/agent-service.ts:295-351` (`--continue` = resume, single-shot). All confirmed.

**Confidence:**

| Claim / decision | Level | Basis |
|---|---|---|
| `--drain` uses non-consuming `getInbox`; `drainPending` is the idempotent primitive | HIGH | `apps/cli/src/commands/agent.ts:303` + `inbox-message-dao.ts:121` |
| Supervisor has no restart (records exit, drops after 60s) | HIGH | `packages/app/src/services/supervisor-service.ts:177` |
| `stop` = SIGTERM→3s→SIGKILL, reusable for graceful stop | HIGH | `packages/app/src/services/supervisor-service.ts:193` |
| `--continue` is resume (single-shot), not a loop | HIGH | `packages/app/src/services/agent-service.ts:295-351` |
| Autostart via `SPUR_TEAM_AUTOSTART` env at boot | HIGH | `apps/server/src/bootstrap.ts:44` |
| Loop-wrapper + restart-on-crash design | MEDIUM | sound; unproven until built + dogfooded (esp. attach-during-respawn) |
| Backoff/max-retries constants (30s cap, 5 retries) | MEDIUM | reasonable defaults; tune under load |
| Idle poll interval | LOW | placeholder; pick empirically |
| Orphan-process cleanup across `spur serve` restarts | LOW | unspecified — needs process-group kill or a pid ledger |
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-14T06:23:21.624Z todo → wip (system)
- 2026-07-14T06:30:37.306Z wip → testing (system)
- 2026-07-14T06:30:39.837Z testing → done (system)
