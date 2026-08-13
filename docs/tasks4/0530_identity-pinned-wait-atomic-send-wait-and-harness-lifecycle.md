---
template: feature-impl
schema_version: 1
name: "Identity-pinned wait, atomic send-wait, and harness lifecycle"
description: ""
status: done
type: task
profile: standard
feature_id: G4
parent_wbs: null
priority: P1
tags: []
dependencies: ["0529"]
ac_numbering: task-local
created_at: "2026-08-13T04:48:31.584Z"
updated_at: "2026-08-13T07:47:04.560Z"
---

## 0530. Identity-pinned wait, atomic send-wait, and harness lifecycle

### Background
Implements G4 R4–R7 (ADR-057 wave 2). Depends on 0529 occupant pins. Today `agent loop` polls 2s and `message watch` polls; nothing waits on `agent.invoke.exit` for a pinned `runId`. This task adds `spur agent wait` and `spur message send --wait`, harness lifecycle from first-class events, and typed errors — all on existing nouns.

Does not land Board SSE, screen detection, `blocked` without a first-class signal, or a protocol-version ping.
### Requirements
- [x] R4. `spur agent wait <specId> [--run <runId>] [--until <token>...] [--timeout <ms>] [--json]` uses 0529 `getOccupant`. Default `--until` is `idle`. Pin is `specId+runId+generation` from the snapshot at wait start (`--run` defaults to the spec’s latest run). Replacement or generation bump → error `run_replaced` or `occupant_gone` (exit 1). From a non-working occupant, no matching event and no status change within `min(timeout_ms, 5000)` → `wait_stalled` (exit 1). Caller `--timeout` elapsed → `timeout` (exit 1). Usage → exit 2.
- [x] R5. `spur message send --wait --until injected|invoke-exit [--timeout <ms>]` snapshots occupant **before** `TeamService.sendMessage`, then waits on that pin in the **same** CLI process. Default `--until` is `invoke-exit`. A later occupant cannot satisfy it. Enqueue is not rolled back if the wait later fails.
- [x] R6. `OccupantLifecycle` projector: `working` iff latest cataloged event for `runId` is `agent.invoke.start`; `idle` iff `agent.invoke.exit` and `TeamService.countPending(specId)===0`; `blocked` iff a first-class blocked signal exists (none in this task → never `blocked`). No screen/OSC matching.
- [x] R7. Same-commit: CLI `--json` error `{ error: { code, message } }` with codes `occupant_gone|run_replaced|wait_stalled|timeout`; `plugins/sp/skills/spur-cli/references/agent.md` + `message.md`; `docs/04_DESIGN.md` signatures. No oRPC wait unless Board already has a team procedure for it — **do not add oRPC wait in this task**. No Board-only wait. Operator consent for these flags is granted by ADR-057 / G4 (do not block on a second consent loop).
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
Wave 2 landed as commit `f9af0dc5` (12 files, +1384/−25). Change map:

- **`packages/app/src/services/occupant-wait.ts`** (new) — R4/R6 core:
  - `OccupantPin` (`specId+runId+generation`) at `packages/app/src/services/occupant-wait.ts:20`, `WaitUntil`/`SendWaitUntil`/`OccupantLifecycle` at `:27-37`, `WaitError` + codes at `:44`.
  - `projectLifecycle(latestInvokeEvent, pendingCount)` — pure projector (R6) at `:65`: latest `agent.invoke.start` → `working`; latest `agent.invoke.exit` → `idle` iff `countPending(specId)===0`, else `unknown` (exit with a queued inbox will re-invoke); no events/other → `unknown`. `blocked` is never projected (no first-class signal in this task).
  - `snapshotOccupant(deps, specId, {runId?})` at `:131` — reads occupant + latest invoke event + pending count at wait start; throws `occupant_gone` when no occupant exists.
  - `waitForOccupant(deps, {pin, until, timeoutMs, stallMs, signal})` at `:167` — polls every `POLL_INTERVAL_MS=100` (`:55`). Identity re-check each tick: occupant gone → `occupant_gone`; `runId`/`generation` mismatch → `run_replaced`. `invoke-exit` satisfied by an exit at/after snapshot sequence; other targets via `satisfies`. Non-working start with no progress inside `min(timeoutMs, DEFAULT_STALL_MS=5000)` → `wait_stalled`; caller deadline → `timeout`; SIGINT abort → `timeout`.
  - Deps injected as callbacks (`getOccupant`, `countPending`, `latestInvokeEvent`, `now`, `sleep`) — pure, testable. `satisfies('blocked')` is always false.
- **`apps/cli/src/commands/agent.ts`** — `spur agent wait <specId>` subcommand (R4) at `:85` / `runAgentWait` at `:503`: `--run`, `--until` (repeatable OR via `collectUntil`), `--timeout` (`parseTimeout`), `--json`. Default `--until idle`. Sole `--until blocked` → usage error exit 2 (no first-class signal). Snapshot once via `agentService.getOccupant`, pin generation, then `waitForOccupant` with `readLatestInvokeEvent` over `SystemEventDao.query({run_id, names:[start,exit], limit:1})`. First satisfied `--until` wins; `wait_stalled` is retried on the next target, terminal errors break. `--json` success `{satisfied, pin}`, failure `{error:{code,message}}` (exit 1 via `waitFail` at `:602`); plain text prints `code: message`.
- **`apps/cli/src/commands/message.ts`** — `message send --wait` (R5): `--wait` option at `:30`, `runMessageSend` at `:97` snapshots occupant via `getOccupant` **before** `sendMessage`, then waits on that pin in the same process. `--until injected|invoke-exit` (default `invoke-exit`). Enqueue is never rolled back on wait failure (matches design §6 step 7). `injected` uses `waitForPendingDrain` at `:429` (identity-checked pending-count drain with stall budget); `invoke-exit` reuses `waitForOccupant`. Same error envelope as `agent wait`.
- **Exports** — `packages/app/src/index.ts:144-166` re-exports occupant-wait types + values (verbatimModuleSyntax-safe `export type` split).
- **Docs (R7, T3 same-commit)** — `docs/04_DESIGN.md` §1.x signatures for both verbs + error codes; `plugins/sp/skills/spur-cli/references/agent.md` (`wait` verb, exit-code/error table) and `message.md` (`--wait` flags + envelope); `docs/design/inter-agent-control-plane.md` §§5–6 updated to "landed" with wave-2 poll note (0531 replaces the poll body with `followSystemEventsAfter`).

Key decisions: generation shared-semantics deferred to 0531 (first follow consumer); `--run` pins an explicit runId and fails `run_replaced` when the current occupant no longer matches (a completed-run pin resolves only if its target state is already satisfied at snapshot); `blocked` is a usage error, not a runtime state.
### Testing
Verification commands (all run from repo root, main branch, commit `f9af0dc5`):

| Command | Result |
| --- | --- |
| `bun run lint` (biome + 7-workspace typecheck) | pass |
| `bun run test` | 4970 pass / 0 fail across 277 files |
| `bun run test-cf` (Cloudflare Worker entry) | pass |
| `bun run build` | pass |
| `bun run corpus-check` (task/feature corpus sweep) | OK, no new errors |

Coverage claim (per-file line gate ≥ 90%):
- `packages/app/src/services/occupant-wait.ts` — **100% lines** (15 unit tests in `packages/app/tests/services/occupant-wait.test.ts`): projector (start→working, exit+empty→idle, exit+pending→unknown, no-events→unknown, blocked never), `satisfies`, `snapshotOccupant` (gone throws, explicit runId), `waitForOccupant` (match, `run_replaced` on runId+generation bump, `occupant_gone` mid-wait, `wait_stalled` non-working, `timeout` deadline, abort→timeout, `invoke-exit` at/after snapshot, initial-satisfied short-circuit).
- `apps/cli/src/commands/agent.ts` — **96.83% lines** (was 85.71 before seeded tests): CLI tests in `apps/cli/tests/commands/agent-wait.test.ts` — occupant_gone JSON envelope + plain text (exit 1), sole-`blocked` usage (exit 2), invalid `--until`/`--timeout` commander errors, seeded resolve paths (default idle, `--until working`, `--until invoke-exit`, `--run` pin), caller-timeout-wins `timeout` (exit 1).
- `apps/cli/src/commands/message.ts` — **94.12% lines** (was 59.63): tests in `apps/cli/tests/commands/message.test.ts` — `--wait` occupant_gone (JSON + plain), send without `--wait` unchanged, seeded `--until invoke-exit` resolve (exit 0, `wait.satisfied`), `--until injected` block-then-timeout (exit 1).
- `apps/cli/tests/spur-cli-parity.test.ts` — `wait` added to `EXPECTED_TIER_B_VERBS.agent`; Tier B flag parity test green (no phantom `--run`/`--until`/`--timeout`/`--wait`).

Behavioral notes:
- Stall-vs-timeout boundary: when `--timeout ≤ 5000`, the caller deadline wins (design §6) — asserted in the seeded agent-wait test (`timeout` code, not `wait_stalled`).
- `--until injected` with a live queued message and no drainer blocks until the caller deadline, then exits 1 `timeout` (enqueue already happened, not rolled back) — asserted.
- No test exercises a real external agent spawn; occupant + `system_events` rows are seeded via `CoordinationRunDao.insertStart` + `SystemEventDao.insert` into the same file DB the CLI opens (same `createMigratedDb({url})` path).
### Review
**SECUA + traceability review (2026-08-13). Verdict: PASS — ship.**

| Prio | Finding | Status |
| --- | --- | --- |
| P1 | None. R4–R7 satisfied with test evidence (15 occupant-wait unit tests + CLI error/usage/seeded-resolve tests + parity gate). | — |
| P2 | `snapshotOccupant` inside `waitForOccupant` re-reads the occupant although the CLI already pinned it — intentional: the loop's own snapshot seeds `lastSequence`/`wasWorking`. The redundant read is the 0531 follow-helper swap point. | accepted |
| P3 | `--run` with a non-current runId (completed pin) only resolves when the target state is already satisfied at snapshot; otherwise the first identity check yields `run_replaced`. Matches "fails fast on replacement". | accepted |
| P3 | `waitForPendingDrain` stall budget mirrors `waitForOccupant`'s but is not shared — 3 lines of duplication until 0531 unifies the poll bodies. | accepted |
| P3 | `blocked` accepted by `collectUntil` but rejected as sole target at usage time; in mixed lists (`--until idle --until blocked`) the unsatisfiable target is silently ignored. Harmless under OR semantics. | accepted |
| P4 | `bun.lock` + `package.json` carry a pre-existing `@gobing-ai/ts-*` 0.4.30→0.4.31 catalog bump from another session — excluded from commit `f9af0dc5`; left unstaged for the owning task. | excluded |
| P4 | Wave 3 (Board SSE, first-class blocked, follow helper) remains accepted design — satellite §9. | deferred |
| P4 | No oRPC wait, no Board-only wait, no new noun, no PTY reads, no stdout in the DAO — all task anti-patterns respected. | — |

**Traceability (R4–R7):**
- R4 ✓ — `agent wait` with pin, typed errors, stall/timeout semantics; unit + CLI tests.
- R5 ✓ — `message send --wait` snapshots before enqueue, same-process wait, no rollback; tests.
- R6 ✓ — `projectLifecycle` pure projector; `blocked` never projected.
- R7 ✓ — same-commit `--json` error envelope, `sp:spur-cli` references, `04_DESIGN.md` signatures, parity gate; no oRPC/Board wait.

**Disposition:** PASS. Residual risk low: the wait loop polls 100 ms against SQLite (fine for CLI-side waits); 0531 swaps the poll body for `followSystemEventsAfter` without changing the identity/stall/timeout contract.
### References
- Depends on 0529. Follow-on 0531. Feature G4 R4–R7; ADR-057; ADR-051 (noun: stay on agent/message).
- `docs/design/inter-agent-control-plane.md` §§5–7
- Catalog: `packages/app/src/services/event-names.ts` (`agent.invoke.start|exit`, `message.sent`)
- Assumes 0529: `getOccupant`, `getCoordinationRun`, `coordination_runs.generation`
### History
- 2026-08-13T07:45:41.424Z todo → wip (system)
- 2026-08-13T07:45:41.630Z wip → testing (system)
- 2026-08-13T07:46:38.915Z testing → done (system)
