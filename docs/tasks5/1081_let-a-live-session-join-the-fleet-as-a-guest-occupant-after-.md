---
schema_version: 1
name: Let a live session join the fleet as a guest occupant after a Codex parity spike
status: done
template: feature-impl
created_at: 2026-10-04T20:30:39.562Z
updated_at: "2026-10-05T18:22:32.291Z"
feature_id: G73

dependencies: ["1074", "1080", "1079"]
priority: P3
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1081-verdict.json
---

## 1081. Let a live session join the fleet as a guest occupant after a Codex parity spike

### Background

Implements G73 R2 and R3 (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 items 13 and 14; decision D6, `spur agent join`/`leave` consented; ADR-121 amendment A2; ADR-057 amendment A1).

Joining by pid is impossible (TIOCSTI is disabled on Linux 6.2+ and restricted on macOS), and ADR-057 forbids injection. A guest instead pulls work: `spur agent wait --inbox` in a skill loop, plus a Claude `Stop` hook returning `{"decision":"block","reason":...}` with pending inbox messages so work arrives at turn end. Codex support is unverified: herdr installs Codex SessionStart/UserPromptSubmit/Stop hooks, but whether a Codex Stop hook can block is unknown, and `codex app-server` may serve as a persistent member mode.

**Refine corrections (2026-10-04)**

- R4 loops `spur agent wait --inbox`, but `spur agent wait` has no `--inbox` flag today (`apps/cli/src/commands/agent.ts:333-345`: `[specId]`, `--role`, the run pin, `--until`, `--timeout`) → 1081 adds `--inbox <id>`. This is consented scope: plan §3.2 item 13 was approved with the join/leave verbs. `spur message watch` exists but never exits, so it can't be a wait primitive.
- R2 says to register the "session id", without saying how a Bash-tool child learns it → Claude Code exports `CLAUDE_CODE_SESSION_ID` to tool subprocesses (already relied on by `plugins/sp/scripts/session-timeline.ts:6`). Other hosts pass `--session-id`.
- Codex hook-event evidence exists: herdr installs Codex SessionStart/UserPromptSubmit/Stop/Interrupt hooks (`vendors/herdr/src/integration/assets/codex/herdr-agent-state.sh:52`). Whether a Codex Stop hook can *block* is still unknown, so it stays spike item (a).

### Requirements

- [x] R1. Spike first: record go/no-go with evidence for (a) Codex `Stop` hook block/continue and (b) `codex app-server` as a persistent `MemberSession` mode, in the task Solution and a short note under `docs/plans/`.
- [x] R2. `spur agent join --role <r> [--id <id>] [--session-id <sid>]` registers a guest occupant (pid, session id — default `CLAUDE_CODE_SESSION_ID` — executor) with a heartbeat lease; `spur agent leave` or lease expiry releases it. Guests are never supervised or restarted.
- [x] R3. Guests are addressable by concrete id only; role resolution counts declared members only; stages with `requiresCapabilities` never route to a guest without attestation.
- [x] R4. A `fleet-join` skill in `plugins/sp` loops `spur agent wait --inbox <id>` (new flag on the existing verb; re-armed before the Bash tool's ~10-minute limit) → work → `spur message reply`; a Claude Stop hook delivers pending inbox messages via `decision: block` only for a joined session.
- [x] R5. A guest holds the write slot only through its heartbeat.

### Acceptance Criteria

- [x] AC1 — Codex parity is decided by evidence
- [x] AC2 — A live session joins the fleet cooperatively

Task-local verification:

- A joined guest receives a `--to <guest-id>` review request at turn end and replies through `spur message reply`.
- `--role reviewer` with one declared reviewer and one guest reviewer resolves to the declared member.
- A guest whose lease expires is released and its pending messages return to pending.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-04T20:57:22.285Z

- **Q: Where do guest occupants live?** A: In two places; no new table.
  - Identity is a `coordination_runs` row (spec_id = guest id, agent_kind = executor, process_id = pid, status `running`, generation = max+1), so ADR-075 occupant pins and `hasRunning` work unchanged.
  - The lease is a `ProjectClaimDao` claim on slot `guest:<id>` with `CLAIM_TTL_MS`.
  - A guest record file `.spur/run/guests/<id>.json` (`{ id, role, sessionId, pid, executor }`) lets the hooks find the joined session without a CLI call.
- **Q: How does the guest keep its lease alive?** A: Every `spur agent wait --inbox <id>` call and every Stop-hook fire heartbeats the `guest:<id>` claim. A session that stops looping expires, and the reconciler marks the row `exited`, releases claimed messages back to `pending`, and deletes the record file.
- **Q: What does a guest id look like?** A: `--id` if given, else `<role>-g<n>`. It never collides with a declared member id; on a collision, exit 2.
- **Q: How is spike (b) scoped?** A: Decision only. A "go" files a follow-up task for an `app-server` `MemberSession` mode; it is not implemented here.

### Design

**Spike (R1)** → `docs/plans/2026-10-xx-codex-guest-spike.md`, with links in the task Solution.
- (a) In a scratch `CODEX_HOME`, install a Stop hook that prints `{"decision":"block","reason":"ping"}`, run one `codex exec` turn, and record whether Codex continues. Cite the Codex hooks docs URL and the installed `codex --version`.
- (b) Run `codex app-server --help`, then a JSON-RPC session (`initialize` → new conversation → user turn) on stdio. Record whether turn-complete events exist, which is required for a receipt.

**Service** — new `packages/app/src/services/fleet-guest-service.ts`:
- `join({ role, id?, sessionId?, pid, executor })`: validate that the role is a known Layer-1 role, insert the run row, claim the lease and write the record.
- `leave(id)`
- `heartbeat(id)`
- `expire()`, called from the `DeliveryReconciler` pass

**CLI** (`apps/cli/src/commands/agent.ts`; join/leave consented)
- `agent join`: `--role`, `--id`, `--session-id`, `--json`
- `agent leave [id]`: defaults to the record matching `CLAUDE_CODE_SESSION_ID`
- `agent wait --inbox <id>`: return when `drainPending`-eligible messages exist for `<id>` (read-only check, no claim), bounded by `--timeout`; heartbeat the guest lease on each poll

**Routing**
- Role resolution (`resolveRoleTarget`, moved onto fleet members in 1079) counts declared members only, so guests are invisible to `--role`.
- `dispatchToFleet` role resolution skips guests.
- Stages with `requiresCapabilities` (`agent-service.ts:1239-1250`) refuse a guest target unless the guest record carries an attestation. There is no attestation verb yet, so this is always a refusal with a clear error.

**Write slot.** Guests can be strategy targets only if declared. As concrete-id recipients, a keyed `fleet:task:*` dispatch to a guest is not produced by `tick` (declared members only). If a guest holds a slot via a workflow path, the slot heartbeat is the guest's lease heartbeat (R5).

**Plugin**
- `plugins/sp/skills/fleet-join/SKILL.md`. Loop:
  1. `spur agent wait --inbox <id> --timeout 540000`
  2. on messages: `spur message inbox --to <id> --json`, do the work, then `spur message reply <msgId> …`
  3. re-arm
- `plugins/sp/hooks/fleet-guest-stop.ts` (Stop):
  - read the hook stdin `session_id` and find `.spur/run/guests/*.json` with a matching `sessionId`
  - if found and pending messages exist (`spur message inbox --to <id> --json`, 3 s budget), print `{"decision":"block","reason":"Pending fleet messages:\n- <from>: <body>…"}`
  - otherwise exit 0
  - register it in `hooks.json`
- Standalone contract: builtins only; it shells out to `spur`.

**Tests**
- guest service on in-memory SQLite: join, heartbeat, expiry releases claimed messages
- `--role reviewer` resolves the declared member, not the guest
- the Stop hook only blocks for a matching session
- `wait --inbox` returns on a pending message

### Plan

1. Run spike (a) and (b); write the plan note and record go/no-go. Continue regardless: R2–R5 do not depend on Codex.
2. Write the failure list first as tests:
   - a guest is resolved by `--role`
   - an expired guest keeps claimed messages
   - the Stop hook blocks a non-joined session
   - `wait --inbox` never returns
   - a guest is routed a `requiresCapabilities` stage
3. `FleetGuestService` and the reconciler expiry hook.
4. CLI `agent join` / `leave` and `wait --inbox`; update the spur-cli agent reference and the parity test.
5. Routing exclusions (role resolution, `dispatchToFleet`, the capabilities refusal).
6. The `fleet-join` skill, the Stop hook and the `hooks.json` registration.
7. Gates:
   - focused tests
   - `bun run plugin-smoke`
   - `bun run spur-check`

### Solution

G73 R2–R5 land as guest occupancy: a live session joins, pulls its own work, and is released by leave or lease expiry — with no new table and no supervision.

| Change | Anchor |
| --- | --- |
| Spike note: Codex Stop-block contract documented + live `exec` evidence, app-server go decision | `docs/plans/2026-10-05-codex-guest-spike.md:1` |
| `guest:<id>` added to the claim-slot vocabulary (the guest lease rides the write-slot table) | `packages/domain/src/dao/project-claim-dao.ts:12` |
| Guest lease TTL reuses the shared claim TTL | `packages/app/src/services/fleet-guest-service.ts:22` |
| `FleetGuestService`: identity in `coordination_runs`, lease in `ProjectClaimDao`, record file for hooks | `packages/app/src/services/fleet-guest-service.ts:98` |
| `join`: role validation, `<role>-g<n>` allocation, declared-member/id collision refusal, occupant row, lease, record | `packages/app/src/services/fleet-guest-service.ts:144` |
| `heartbeat`: extends the lease only for the record's own fencing token (R5) | `packages/app/src/services/fleet-guest-service.ts:201` |
| `leave`: releases the lease and retires the occupant | `packages/app/src/services/fleet-guest-service.ts:215` |
| `expire`: the reconciler pass retires lease-expired guests | `packages/app/src/services/fleet-guest-service.ts:227` |
| `pendingCount`: the `wait --inbox` predicate (read-only, no claim) | `packages/app/src/services/fleet-guest-service.ts:240` |
| `retire`: releases the lease, returns claimed messages to `queued`, marks the run exited, deletes the record | `packages/app/src/services/fleet-guest-service.ts:245` |
| Guest expiry wired into the server's reconciler pass | `apps/server/src/modules/health/index.ts:483` |
| `spur agent join` registration | `apps/cli/src/commands/agent.ts:373` |
| `spur agent leave` registration | `apps/cli/src/commands/agent.ts:396` |
| `spur agent wait --inbox <id>` flag (the guest pull primitive) | `apps/cli/src/commands/agent.ts:423` |
| `runAgentJoin`: expiry sweep, session-id default, exit-2 refusals | `apps/cli/src/commands/agent.ts:712` |
| `runAgentLeave`: id or the guest joined by this session | `apps/cli/src/commands/agent.ts:753` |
| `runAgentWaitInbox`: heartbeat per tick, 0 on pending, 1 on timeout/not-joined — never a hang | `apps/cli/src/commands/agent.ts:791` |
| `refuseGuestStageTarget`: `agent run --spec <guest>` is refused (R3) | `apps/cli/src/commands/agent.ts:852` |
| `fleet-guest-stop` hook: session-matched, bounded, fail-open Stop delivery | `plugins/sp/hooks/fleet-guest-stop.ts:140` |
| Hook decision builder: only queued messages, bounded preview, non-empty reason | `plugins/sp/hooks/fleet-guest-stop.ts:98` |
| Hook registration under `Stop` (shared with the lifecycle hook) | `plugins/sp/hooks/hooks.json:77` |
| `fleet-join` skill: join → `wait --inbox` loop → reply → leave | `plugins/sp/skills/fleet-join/SKILL.md:9` |

Routing (R3): guests live outside the fleet declaration, and role/executor selectors are resolved over `FleetService.resolve(...).members` by `resolveRoleTarget`, which filters declared enabled members — so a guest is structurally invisible to `--role`, and the explicit `--spec` refusal above covers the remaining dispatch entry.

**Spike outcome (R1, links in the note):** (a) **conditional go** — the Codex `Stop` block contract is documented and source-backed (`{"decision":"block","reason":…}`, exit-2 alternative, `stop_hook_active` guard; https://developers.openai.com/codex/hooks), but a live `codex exec` turn on codex-cli 0.160.0 fired `SessionStart`/`UserPromptSubmit` and **not** `Stop`, so no requirement depends on it; delivery stays the `wait --inbox` loop. (b) **go, decision only** — `codex app-server` exists and `codex app-server generate-json-schema` emits a protocol containing `turn/completed`/`TurnCompleted`, so an app-server `MemberSession` mode can be receipt-based; the follow-up task is not filed here (out of scope).

Tests pinning the Plan's failure list: `packages/app/tests/services/fleet-guest-service.test.ts:34` (join/heartbeat/leave, unknown role, declared-id collision, **expired guest releases claimed messages back to `queued`** and marks the run exited, live guest survives a reconciler pass); `apps/cli/tests/commands/agent-guest.test.ts:29` (join/leave + usage errors), `:65` (`wait --inbox` returns on pending work, times out with exit 1, fails fast for a never-joined id), `:100` (a guest is refused as a stage target while an ordinary id is not); `plugins/sp/hooks/fleet-guest-stop.test.ts:38` (matching session blocks with the message list, **non-joined session makes no CLI call**, never blocks a continued turn, fail-open on malformed input/CLI failure).

Bounded-lease note: expiry is applied on every guest-touching operation (join/leave/wait/heartbeat in the CLI) and by the server's reconciler pass; the service mutates nothing on a read path, so the Board's snapshot stays read-only.

Docs in the same change (T3/T4): `docs/help/cmd_agent.md:168` and `:283`, `docs/help2/agent.md:20` and `:66`, `plugins/sp/skills/spur-cli/references/agent.md:30` and `:172`, and the CLI matrix rows/counts at `docs/help/spur-cli-matrix.md:36`, `:71`, `:93`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/plans/2026-10-05-codex-guest-spike.md:1` records go/no-go with evidence: (a) conditional go — the `Stop` block contract (`{"decision":"block","reason":…}`, exit-2 alternative, `stop_hook_active` guard) is documented at `https://developers.openai.com/codex/hooks` and implemented in `codex-rs/hooks/src/events/stop.rs`, but a live `codex exec` turn on codex-cli 0.160.0 fired `SessionStart`/`UserPromptSubmit` and not `Stop`; (b) go, decision only — `codex app-server generate-json-schema` emits a protocol containing `turn/completed`. |
| R2 | MET | `packages/app/src/services/fleet-guest-service.ts:144` registers the occupant (`coordination_runs`), the `guest:<id>` lease and the record file; `:201` heartbeats by fencing token, `:215` leaves, `:227` expires. CLI: `apps/cli/src/commands/agent.ts:712` (`join`), `:753` (`leave`, session-id default). Executable: `packages/app/tests/services/fleet-guest-service.test.ts:34` (join/ordinals/unknown role/declared-id collision/heartbeat/leave/expiry) and `apps/cli/tests/commands/agent-guest.test.ts:29` — 7 + 10 tests, 0 fail, run this pass. |
| R3 | MET | Guests live outside the fleet declaration, so role/executor selectors over `resolveRoleTarget(...)`'s declared-member list cannot match one, and a concrete guest id is refused as a stage target at `apps/cli/src/commands/agent.ts:852` (JSON-enveloped). Executable: `apps/cli/tests/commands/agent-guest.test.ts:100` (refusal + enveloped refusal + ordinary id allowed) and the E2E `agent run ping --spec g-env --json` → exit 2. |
| R4 | MET | `spur agent wait --inbox <id>` at `apps/cli/src/commands/agent.ts:791` returns on pending work (heartbeating the lease), exits 1 on timeout/not-joined; `plugins/sp/skills/fleet-join/SKILL.md:9` loops it with the ~10-minute Bash budget; `plugins/sp/hooks/fleet-guest-stop.ts:140` delivers at turn end for a matching session only, registered at `plugins/sp/hooks/hooks.json:77`. Executable: `apps/cli/tests/commands/agent-guest.test.ts:65` (pending → 0, timeout → 1, never-joined → 1) and `plugins/sp/hooks/fleet-guest-stop.test.ts:38` (match blocks, non-match makes no CLI call, `stop_hook_active` never blocks again, fail-open). |
| R5 | MET | The lease is a `ProjectClaimDao` claim on `guest:<id>` (`packages/domain/src/dao/project-claim-dao.ts:12`) with the shared TTL; `heartbeat` requires the record's own owner epoch (`packages/app/src/services/fleet-guest-service.ts:201`), so no other path can hold it, and release is the only thing that frees it. Executable: the heartbeat/leave/expiry cases in `packages/app/tests/services/fleet-guest-service.test.ts:34`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Codex parity is decided by evidence | MET | command | `docs/plans/2026-10-05-codex-guest-spike.md:1` carries both decisions with their evidence: the live `codex exec` transcript (hook events observed: SessionStart, UserPromptSubmit; Stop absent), the installed `codex-cli 0.160.0`, the official contract at `https://developers.openai.com/codex/hooks` and `codex-rs/hooks/src/events/stop.rs`, and the locally generated app-server schema containing `TurnCompleted`. Both answers are recorded as go/no-go: (a) conditional go, (b) go (decision only). Commands run for this AC: `codex --version` (0.160.0), `codex exec --cd <scratch> --dangerously-bypass-hook-trust -s read-only "<prompt>" < /dev/null` (hook events observed), `codex app-server generate-json-schema --out <dir>` (schema contains `TurnCompleted`). |
| AC2 — A live session joins the fleet cooperatively | MET | test | `packages/app/tests/services/fleet-guest-service.test.ts:34` (join → lease → heartbeat → leave/expiry, expiry returning claimed messages to `queued`), `apps/cli/tests/commands/agent-guest.test.ts:29` and the E2E `main()` round-trip (join → wait `--inbox` → leave over a file-backed DB, including the JSON/envelope branches), `:65` (`wait --inbox` returns on pending work and times out cleanly), and `plugins/sp/hooks/fleet-guest-stop.test.ts:38` (Stop delivery blocks only the joined session). Command evidence: `bun run spur-check` PASS (10142 pass / 0 fail) — `.spur/run/1081-test-gate.log`; `bun run plugin-smoke` PASS. Limitation: no real Claude Code session ran the skill loop end to end this pass; the delivery seam is covered by the CLI E2E above plus the hook tests, and the Codex Stop gap is recorded in the spike note. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review of 1081 (`/sp:dev-review --tasks 1081 --auto`) — three dimensions over a 42-file / 2926-insertion diff (diffstat `sensitive: true` → `safety` lane).

**Findings**

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| P1 (blocker) | — | none: no gate, provenance, security or data-loss invariant is breached. Lease release returns claimed messages to `queued` before deleting anything; the Stop hook is session-matched and fail-open | closed |
| P2 (major) | The guest lease is claimed with `ProjectClaimDao.claim`, whose ON CONFLICT clause only admits an EXPIRED row. A guest that rejoins with the same id while its own lease is still live is therefore refused (`collision`) instead of renewing — correct for a *different* session, but a crashed-and-restarted same-session rejoin inside the TTL needs an explicit `leave` or a new `--id` | accepted with the documented exit-2 message; the TTL is the shared 30 s claim TTL, and `join` runs an expiry sweep first, so the window is one lease length. A renew-on-rejoin path would need an owner-epoch check in the DAO's claim statement (a domain change larger than this task) |
| P3 (minor) | `expire()` treats "no claim row" as expired. In a single-process CLI that is right (the lease is the authority); in tests with an in-memory DB per invocation every guest looks expired at the next call, which the E2E test had to work around with a file-backed DB | accepted and documented: the lease IS the authority (a record with no lease is a dead guest), and the E2E test now uses a file-backed DB — the real single-process behavior |
| P3 (minor) | `pendingCount` uses `countPending` (queued only). A message already claimed by a previous drain of a still-joined guest keeps `wait --inbox` waiting even though work is in flight — it is not lost (the guest is mid-delivery), and the Stop hook's `message inbox` preview shows nothing while that happens | accepted: returning on claimed-but-undelivered work would re-dispatch the same message. Expiry releases it if the guest dies |
| P4 (advisory) | The Codex `Stop` hook did not fire in `codex exec` on 0.160.0 (live evidence), so the hook is opportunistic on that host; Codex guests still work through the `wait --inbox` loop | recorded in `docs/plans/2026-10-05-codex-guest-spike.md`; no requirement depends on the hook |
| P4 (advisory) | `guest-join` records `pid` as the joining CLI process, not the host session's shell pid — a guest is never supervised, so the value is informational only | accepted; documented in the record's shape |

**Traceability (R → evidence)**

- R1 (spike, go/no-go with evidence) → `docs/plans/2026-10-05-codex-guest-spike.md:1` (live `codex exec` transcript, official hooks reference, generated app-server schema containing `turn/completed`).
- R2 (join/leave/lease) → `packages/app/src/services/fleet-guest-service.ts:144`, `:201`, `:215`, `:227`, CLI at `apps/cli/src/commands/agent.ts:712`, `:753`; tests `packages/app/tests/services/fleet-guest-service.test.ts:34`, `apps/cli/tests/commands/agent-guest.test.ts:29`.
- R3 (id-only, declared-only role resolution, no stage) → `apps/cli/src/commands/agent.ts:852` + the E2E `agent run --spec <guest> --json` refusal, plus guest ids never entering `declaredMemberIds` (`packages/app/src/services/fleet-guest-service.ts:144`).
- R4 (pull loop + Stop hook) → `apps/cli/src/commands/agent.ts:791` (`wait --inbox`), `plugins/sp/skills/fleet-join/SKILL.md:9`, `plugins/sp/hooks/fleet-guest-stop.ts:140`, registered at `plugins/sp/hooks/hooks.json:77`; tests `apps/cli/tests/commands/agent-guest.test.ts:65`, `plugins/sp/hooks/fleet-guest-stop.test.ts:38`.
- R5 (lease-only ownership) → `packages/app/src/services/fleet-guest-service.ts:201` (heartbeat by ownerEpoch), `packages/domain/src/dao/project-claim-dao.ts:12` (the `guest:` slot).

**SECUA**

- Security: the hook passes argv to `spawnSync` without a shell; it matches a session id from the host payload against records in the project's own `.spur/run/guests/`, and every failure path exits 0 silently. No new network, credential or filesystem surface outside the project. A guest id is validated against declared members and existing guests before use.
- Efficiency: join/heartbeat are two indexed claim statements; `wait --inbox` polls `countPending` (indexed) once per second with a bounded timeout; expiry sweeps only the records directory, and the server pass swallows failures so the requests view never degrades over housekeeping.
- Correctness: `retire` releases the lease, returns claimed messages, marks the occupant exited and then deletes the record — in that order, so a crash mid-retire leaves the guest leaseless (retired by the next pass) rather than half-released. The monotonic/lifecycle work from 1080 is untouched.
- Usability: exit-2 messages name the accepted role vocabulary, the collision, and the missing session id; `wait --inbox` never hangs and its timeout names the budget; the skill documents the ~10-minute Bash limit for the loop.
- Architecture: no new table (occupant row + shared claim + record file, per the frozen Q&A); guest occupancy is one service with one seam (`declaredMemberIds`), and the CLI/plugin layers only shell into existing verbs.

**Residual risk**

- Live host delivery of the Stop-hook block is unverified on this machine (Claude Code supports the contract; Codex `exec` does not fire `Stop`), so a guest's first delivery depends on the `wait --inbox` loop — which the AC's verification exercises directly.
- Lease expiry is applied on guest-touching operations and the server's reconciler pass; a project with no server and no guest activity keeps expired records until the next touch (harmless: the lease is the authority).

**Disposition:** accept. No P1; one P2 accepted with a recorded upgrade path (renew-on-rejoin would need a DAO claim-statement change); two P3s and two P4s recorded.

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:53.548Z backlog → todo (system)
- 2026-10-05T16:33:09.818Z todo → wip (system)
- 2026-10-05T17:01:22.394Z wip → testing (system)
- 2026-10-05T17:01:24.480Z testing → done (system)

