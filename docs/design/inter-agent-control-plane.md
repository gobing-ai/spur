# Inter-agent control plane

**Area:** Occupant identity, coordination-facing run artifacts, pinned wait, caller env.
**Status:** accepted design — ADR-057; not yet built.
**Decision:** ADR-057 (amends ADR-052).
**Feature:** G4.

Shapes only. Rationale: `00` ADR-057 and `03` §17. Do not invoke the planned verbs below as if they exist.

## 1. Existing surfaces this design extends

| Surface | Role after this design | Must not become |
| --- | --- | --- |
| `spur message send\|inbox\|reply\|watch` | Durable command plane (`queued → injected`) | Live TUI prompt |
| `spur agent run` / `spur agent loop` | Occupant invoke; loop drains inbox | Peer socket |
| `POST /api/team/processes/:id/stdin` + process SSE | Operator attach / process pipe | Agent-to-agent command bus |
| `system_events` + EventBus | Wait follow-set after a snapshot sequence | A second EventHub ring |
| Board Inbox `mergeTimeline` | Display only until G3 | Wait or send authority |

No new CLI noun. No Unix-socket JSON API beside oRPC. No terminal snapshot read. No `send-keys`.

## 2. Occupant identity

A live occupant is this record (app/domain type; not a transport DTO until Wave 1 ships):

```ts
interface OccupantRef {
    specId: string; // `.spur/agents/<id>.yaml` id
    agentKind: string; // coding-agent type, e.g. `codex`
    processId: string | null; // supervisor registry id when supervised
    runId: string; // this invoke / loop iteration
    generation: number; // monotonic per specId; +1 on process replace or occupant change
}
```

`specId` keeps the existing agent-spec alphabet (`[a-z][a-z0-9_-]{1,63}`). `runId` is a UUID minted at invoke start (`agent.invoke.start` already carries correlation `runId` in some paths; Wave 1 makes it the pin).

**Rewrite rule:** `agent run --drain` may still map `--agent <specId>` → `spec.type` for `AiRunner` dispatch. The occupant record **retains** `specId`. A wait or send that names only `agentKind` is invalid.

**Pin match:** two refs match when `specId`, `runId`, and `generation` are equal. `agentKind` mismatch or a higher `generation` is `run_replaced` / `occupant_gone`.

## 3. Caller environment (supervised spawn)

Every `spur agent loop` / supervised `agent run` process receives, in addition to existing host hints:

| Variable | Value |
| --- | --- |
| `SPUR_SPEC_ID` | Occupant `specId` |
| `SPUR_TEAM_ID` | `team:<id>` tag when present; unset otherwise |
| `SPUR_RUN_ID` | Current `runId` (updated each loop iteration before invoke) |
| `SPUR_SERVE_URL` | Supervisor API base when `spur serve` launched the process |

`SPUR_AGENT` remains the **host** coding-agent hint (`04` §1.1). It is not a spec id.

`--current` on a future wait/send means `SPUR_SPEC_ID` of the caller. Omitting a target must not fall back to another client's focused Board pane.

## 4. Coordination-facing run record

This is not the Phase-2 rich inspector (`01` §5.3). It is the minimum another agent can address.

```ts
interface CoordinationRun {
    occupant: OccupantRef;
    status: 'running' | 'exited' | 'errored';
    startedAt: string; // ISO-8601
    completedAt: string | null;
    artifactRefs: CoordinationArtifactRef[];
}

interface CoordinationArtifactRef {
    kind: 'result' | 'log' | 'verdict';
    path: string; // project-relative, existing file
    mediaType?: string;
}
```

Persistence: domain DAO + CLI schema increment under `packages/domain` (same composition as `inbox_messages`). Do not store stdout/stderr bodies in the row; store paths. Redact before persist (Phase 2 redaction bullet still applies).

Read path (planned; ADR-051 consent before landing a new verb):

- Preferred: extend an existing run-show / `--json` envelope with `occupant` + `artifactRefs`.
- Allowed: `spur agent run-show <runId>` on the `agent` noun only.
- Forbidden: a `run` or `artifact` noun.

Another agent “reads output” by reading `artifactRefs[].path` (or a bounded `--json` projection of those files). It does not read a PTY.

## 5. Harness lifecycle (derived, not inferred)

| State | Source (first-class only) |
| --- | --- |
| `working` | `agent.invoke.start` for this `runId` |
| `idle` | `agent.invoke.exit` for this `runId` **and** no `queued` inbox for `specId` |
| `blocked` | First-class blocked signal only (HITL / future `agent report-state`). Absent signal ⇒ state is not `blocked` |
| `done` | Out of v1. Herdr `done` is unseen-idle UI; do not invent an unseen bit here |

No screen-manifest detector. No OSC/spinner matching.

## 6. Planned wait / send-wait surface

Accepted design. **Not shipped.** Do not document these as committed command signatures in `04` §1.1 until code exists (T3 + ADR-051 consent).

```text
spur agent wait <specId> [--run <runId>] --until invoke-exit|idle|blocked [--timeout <ms>] [--json]
spur message send <body> --to <specId> [--from <id>] --wait --until injected|invoke-exit [--timeout <ms>] [--json]
```

`until` values are exact. Repeating `--until` is allowed (OR). Default for standalone wait: `idle`. Default for `send --wait`: `invoke-exit`.

**Algorithm (both commands):**

1. Snapshot `OccupantRef` + current `system_events` sequence (or EventBus sequence when the server is the caller).
2. Mutate (no-op for bare wait; enqueue for send).
3. If the snapshot already satisfies `until`, return success (wait) / include occupant (send).
4. Follow cataloged events after that sequence. Re-probe occupant only on a relevant event.
5. Identity mismatch → `occupant_gone` or `run_replaced`.
6. No relevant event and no status change within `timeout_ms` → `wait_stalled` when the wait started from a non-working occupant and `--until` is not already true; otherwise `timeout`.
7. Client disconnect / SIGINT ends the wait; it does not roll back an already-enqueued message.

Long waits stay on the CLI/connection side. `TeamService` / `AgentService` methods remain short.

`timeout_ms` has no default on standalone wait (may wait until signal). `send --wait` from a non-working occupant uses a 5s stall budget unless `--timeout` is ≤ 5s (then the caller timeout wins).

## 7. Typed coordination errors

Extend the team/agent CLI `--json` error body (not the generic HTTP `API_ERROR_CODES` set unless the same code is served over oRPC):

| `code` | When |
| --- | --- |
| `occupant_gone` | spec no longer hosts an occupant |
| `run_replaced` | `runId` or `generation` no longer matches the pin |
| `wait_stalled` | no observed lifecycle change inside the stall budget |
| `timeout` | caller `--timeout` elapsed |
| `protocol_mismatch` | reserved; only if CLI/`spur serve` version skew is detected later |

Exit mapping: `timeout` / `wait_stalled` → 1; usage → 2; execution failure → existing agent-run 3.

## 8. Snapshot + subscribe

Wait and any future Board live tail:

1. Read a snapshot (`CoordinationRun` and/or inbox + occupant).
2. Remember `system_events` / bus sequence.
3. Follow events with `sequence > snapshot`.
4. On reconnect, snapshot again. Do not keep a 512-event in-memory ring.

Board SSE (roadmap S6/W6) is **not** a prerequisite. CLI wait may poll the ledger or subscribe to the in-process bus.

## 9. Wave split (implementation)

| Wave | Lands | Does not land |
| --- | --- | --- |
| 1 | `OccupantRef`, drain rewrite keeps `specId`, env injection, `CoordinationRun` persist + read | wait verb, lifecycle enum as a public wait target, new noun |
| 2 | `agent wait`, `message send --wait`, lifecycle table §5, error codes §7, skill + `04` signatures (T3, ADR-051 consent) | Board SSE, `blocked` without a first-class signal, protocol ping |
| 3 | Snapshot/seq helper reused by wait, contract/schema notes, optional `agent report-state` only if `blocked` cannot be derived | G3 Board un-merge (feature G3 / ADR-052), live handoff, screen detection |

## 10. Files likely to change (implementers)

- `packages/app/src/services/agent-service.ts` — mint/retain occupant; emit invoke events with pin
- `packages/app/src/services/team-service.ts` — send-wait snapshot; do not add a third store
- `packages/app/src/services/supervisor-service.ts` — env injection; generation bump on replace
- `apps/cli/src/commands/agent.ts` — drain rewrite; wait verb (Wave 2)
- `apps/cli/src/commands/message.ts` — `--wait` (Wave 2)
- `packages/domain/src/migrations.ts` — coordination-run table
- `packages/contracts/src/` — oRPC DTOs only when Board/server expose the record
- `plugins/sp/skills/spur-cli/references/agent.md` + `message.md` — Wave 2, same commit as verbs
