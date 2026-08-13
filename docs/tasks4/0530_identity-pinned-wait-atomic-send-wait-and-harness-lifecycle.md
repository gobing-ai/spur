---
template: feature-impl
schema_version: 1
name: "Identity-pinned wait, atomic send-wait, and harness lifecycle"
description: ""
status: todo
type: task
profile: standard
feature_id: G4
parent_wbs: null
priority: P1
tags: []
dependencies: ["0529"]
ac_numbering: task-local
created_at: "2026-08-13T04:48:31.584Z"
updated_at: "2026-08-13T05:47:50.940Z"
---

## 0530. Identity-pinned wait, atomic send-wait, and harness lifecycle

### Background
Implements G4 R4–R7 (ADR-057 wave 2). Depends on 0529 occupant pins. Today `agent loop` polls 2s and `message watch` polls; nothing waits on `agent.invoke.exit` for a pinned `runId`. This task adds `spur agent wait` and `spur message send --wait`, harness lifecycle from first-class events, and typed errors — all on existing nouns.

Does not land Board SSE, screen detection, `blocked` without a first-class signal, or a protocol-version ping.
### Requirements
- [ ] R4. `spur agent wait <specId> [--run <runId>] [--until <token>...] [--timeout <ms>] [--json]` uses 0529 `getOccupant`. Default `--until` is `idle`. Pin is `specId+runId+generation` from the snapshot at wait start (`--run` defaults to the spec’s latest run). Replacement or generation bump → error `run_replaced` or `occupant_gone` (exit 1). From a non-working occupant, no matching event and no status change within `min(timeout_ms, 5000)` → `wait_stalled` (exit 1). Caller `--timeout` elapsed → `timeout` (exit 1). Usage → exit 2.
- [ ] R5. `spur message send --wait --until injected|invoke-exit [--timeout <ms>]` snapshots occupant **before** `TeamService.sendMessage`, then waits on that pin in the **same** CLI process. Default `--until` is `invoke-exit`. A later occupant cannot satisfy it. Enqueue is not rolled back if the wait later fails.
- [ ] R6. `OccupantLifecycle` projector: `working` iff latest cataloged event for `runId` is `agent.invoke.start`; `idle` iff `agent.invoke.exit` and `TeamService.countPending(specId)===0`; `blocked` iff a first-class blocked signal exists (none in this task → never `blocked`). No screen/OSC matching.
- [ ] R7. Same-commit: CLI `--json` error `{ error: { code, message } }` with codes `occupant_gone|run_replaced|wait_stalled|timeout`; `plugins/sp/skills/spur-cli/references/agent.md` + `message.md`; `docs/04_DESIGN.md` signatures. No oRPC wait unless Board already has a team procedure for it — **do not add oRPC wait in this task**. No Board-only wait. Operator consent for these flags is granted by ADR-057 / G4 (do not block on a second consent loop).
### Acceptance Criteria
```gherkin
Feature: Inter-agent control plane

  Scenario: R4 — Wait pins occupant run and stalls without progress
    Given a wait started against specId `reviewer` and runId `R`
    When that occupant is replaced or generation increments
    Then the wait fails with `run_replaced` or `occupant_gone`
    And if no lifecycle event arrives inside the stall budget the wait fails with `wait_stalled`

  Scenario: R5 — Message send can wait atomically for a settled occupant
    Given `spur message send --to reviewer --wait --until invoke-exit`
    When the message is enqueued
    Then the same request snapshots the occupant before send and waits on that pin
    And a later occupant cannot satisfy the wait

  Scenario: R6 — Harness lifecycle is derived from first-class events
    Given cataloged `agent.invoke.start` and `agent.invoke.exit` for a runId
    When lifecycle is queried
    Then start maps to working and exit with an empty queued inbox maps to idle
    And blocked is reported only when a first-class blocked signal exists

  Scenario: R7 — Wait and send-wait share one contract across CLI and oRPC
    Given Wave 2 verbs land
    When an agent reads `sp:spur-cli` and the oRPC/CLI `--json` envelope
    Then method names, until values, and error codes match
    And no Board-only wait path exists
```
### Q&A
- **Q: Default timeout?** A: None on standalone wait. Send-wait stall budget 5s from non-working unless `--timeout` ≤ 5s. Closed 2026-08-12.
- **Q: Screen-scrape blocked?** A: No. Closed 2026-08-12.
- **Q: New wait noun?** A: No. Closed 2026-08-12.
- **Q: Extra ADR-051 consent gate before coding?** A: No. ADR-057 + G4 already accepted these flags. Closed 2026-08-12.
- **Q: oRPC wait in this task?** A: No. CLI only. Closed 2026-08-12.
### Design
WHAT: CLI wait + atomic send-wait + lifecycle projector. Assumes 0529 occupant + `coordination_runs`.

WHY: Loop/watch poll; nothing pins `runId`. Herdr-style two-step send/wait races.

WHERE:
- `packages/app/src/services/occupant-wait.ts` (new): `snapshotOccupant`, `projectLifecycle`, `waitForOccupant({ pin, until, timeoutMs, stallMs, follow })`.
- `apps/cli/src/commands/agent.ts`: `agent wait` command.
- `apps/cli/src/commands/message.ts`: `--wait` / `--until` / `--timeout` on `send`.
- Follow in this wave: poll `getOccupant` + `system_events` (`sequence > snap`) every 100ms. 0531 replaces the poll with `followSystemEventsAfter`.
- Tests: `packages/app/tests/services/occupant-wait.test.ts`; CLI tests under `apps/cli/tests/commands/`.

Frozen CLI:
```
spur agent wait <specId> [--run <runId>] [--until idle|working|invoke-exit|blocked]... [--timeout <ms>] [--json]
spur message send <body> --to <specId> [--from <id>] [--wait] [--until injected|invoke-exit] [--timeout <ms>] [--json]
```
`--until` repeatable (OR). Wait default `idle`. Send-wait default `invoke-exit`. No default timeout on standalone wait.

Frozen errors: `occupant_gone`, `run_replaced`, `wait_stalled`, `timeout`.

Algorithm (`waitForOccupant`): snapshot pin + `system_events.sequence`; if already satisfied return; mutate if send; loop until match / identity break / stall / timeout / abort. Long wait stays in CLI; `TeamService.sendMessage` stays non-blocking.

Anti-patterns: new noun; Board-only wait; screen detection; blocking `TeamService`; implementing 0531’s helper here (poll is OK); adding oRPC wait; `protocol_mismatch` ping.

Handoff from 0529: must have `getOccupant` / `getCoordinationRun` / `generation`. Handoff to 0531: replace poll body only.

Premise check (2026-08-12): `agent.invoke.start|exit` are cataloged (`event-names.ts:315-316`). `drainPending` exists. No `team attach` verb.
### Plan
1. R6 — `projectLifecycle` unit tests (start→working, exit+empty inbox→idle, no blocked).
2. R4 — `waitForOccupant` with fake clock/events: match, `run_replaced`, `wait_stalled`, `timeout`.
3. R4 — CLI `agent wait` wiring + `--json` errors.
4. R5 — `message send --wait` snapshots then enqueue then `waitForOccupant`.
5. R7 — `04_DESIGN` + `sp:spur-cli` agent.md/message.md + AGENTS.md “now shipped” for these two flags only.
6. Tests listed in Design. Do not add oRPC wait.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Depends on 0529. Follow-on 0531. Feature G4 R4–R7; ADR-057; ADR-051 (noun: stay on agent/message).
- `docs/design/inter-agent-control-plane.md` §§5–7
- Catalog: `packages/app/src/services/event-names.ts` (`agent.invoke.start|exit`, `message.sent`)
- Assumes 0529: `getOccupant`, `getCoordinationRun`, `coordination_runs.generation`
### History
