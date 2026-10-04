---
schema_version: 1
name: Let a live session join the fleet as a guest occupant after a Codex parity spike
status: todo
template: feature-impl
created_at: 2026-10-04T20:30:39.562Z
updated_at: "2026-10-04T20:57:53.548Z"
feature_id: G73

dependencies: ["1074", "1080"]
priority: P3
estimate_hours: 8
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

- [ ] R1. Spike first: record go/no-go with evidence for (a) Codex `Stop` hook block/continue and (b) `codex app-server` as a persistent `MemberSession` mode, in the task Solution and a short note under `docs/plans/`.
- [ ] R2. `spur agent join --role <r> [--id <id>] [--session-id <sid>]` registers a guest occupant (pid, session id — default `CLAUDE_CODE_SESSION_ID` — executor) with a heartbeat lease; `spur agent leave` or lease expiry releases it. Guests are never supervised or restarted.
- [ ] R3. Guests are addressable by concrete id only; role resolution counts declared members only; stages with `requiresCapabilities` never route to a guest without attestation.
- [ ] R4. A `fleet-join` skill in `plugins/sp` loops `spur agent wait --inbox <id>` (new flag on the existing verb; re-armed before the Bash tool's ~10-minute limit) → work → `spur message reply`; a Claude Stop hook delivers pending inbox messages via `decision: block` only for a joined session.
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

- 2026-10-04T20:57:53.548Z backlog → todo (system)

