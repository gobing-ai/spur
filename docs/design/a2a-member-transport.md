---
kind: design
title: Named-agent dispatch with A2A as a hidden member transport
status: accepted
created_at: 2026-11-14
updated_at: 2026-11-15
related:
  - docs/features/G8_a2a-outbound-executor-edge-for-workflow-agent-run.md
  - docs/features/G9_cross-machine-fleet-spur-serve-speaks-a2a.md
  - docs/plans/2026-11-14-a2a-agent-orchestration-brainstorm.md
  - docs/design/inter-agent-control-plane.md
  - docs/design/fleet-task-turn-execution.md
  - docs/design/fleet-config-declaration.md
tags: [a2a, agent, fleet, dispatch]
---

# Named-agent dispatch with A2A as a hidden member transport

## 1. Issue and scope

Two problems, in the operator's order of importance:

1. **Fleet is too heavy for daily use.** A dispatch needs `spur serve` running, a started member
   (`spur agent start <spec-id>`), and a model of spec ids, occupants, roles, executors, strategy and
   guests. This repository's own `.spur/config.yaml` ships `agent.fleet.enabled: false`.
2. **Spur cannot reach an agent it does not run itself** — another machine, another project, or an
   agent without a native driver.

This design is **accepted** for features G8 and G9 under ADR-148. The G9 listener (§3.5) is built;
task 1333 landed the named-member rung and the default cold fallback (§3.1, §3.2, §4.3), 1334 built
the A2A turn itself (§3.3), and 1335 hid the fleet plumbing verbs, so the sender half of G8 is in.
Task 1337 added the two-install proof and conditional write fencing (§3.5, §4.3).
The user learns one thing: *give a task to an agent by name*, manually or automatically.
How the work travels — warm inbox turn, Agent2Agent
(A2A) v1.0, or a cold subprocess — is Spur's choice and is never selected by the user.

Out of scope: replacing the inbox or the fleet dispatcher; routing same-machine members over A2A;
push notifications, gRPC/JSON-RPC bindings; multi-turn input round trips; new `spur` nouns or verbs
(four plumbing verbs are hidden from default help, none removed);
pipeline performance work (done in 0.4.34–0.4.35; the real-agent baseline is task 1331, P3, and
blocks nothing here).

## 2. Context and constraints

- **One dispatch primitive, one receipt.** `FleetDispatcher` enqueues one keyed inbox request and
  resolves on the `coordination_runs` receipt (`packages/app/src/services/fleet-dispatcher.ts`).
  Outcomes are `completed | failed | not-started | outcome-unknown`; a timeout is `outcome-unknown`
  and only a definite `failed`/`not-started` allows a retry or fallback (ADR-126 A4).
- **The inbox is the ledger, not just a pipe.** It gives idempotent delivery (`request_key`), claim
  leases and a durable receipt (ADR-143). A2A defines none of these, so A2A sits *under* the inbox as
  a delivery hop, not beside it.
- **A member turn is already pluggable.** The member loop drains the inbox and runs one turn through
  `ts-ai-runner` (`packages/app/src/services/agent-loop-service.ts`, ADR-145).
- **A fallback already exists but is opt-in.** An unavailable fleet drops to the subprocess surface
  only when the run declares `executorFallback: traditional`
  (`packages/app/src/workflow/actions/agent-run.ts`).
- **`a2a server --exec` cannot front a local agent well.** It spawns `sh -c` per request with the
  message on stdin, keeps tasks in memory, has no session reuse and listens on TCP only
  (`vendors/a2a-cli/internal/localsrv/serve_exec.go`). For same-machine members it is strictly worse
  than the warm inbox turn, so local members stay on the inbox.
- **Prerequisite, not dependency.** The operator-installed `a2a` binary (a2a-cli ≥ 0.4.0) is
  resolved on PATH and needed only when a member declares `a2a`.

## 3. Solution

### 3.1 What the user sees

```yaml
agent:
  fleet:
    members:
      - { id: coder,    executor: codex }                  # a local agent
      - { id: reviewer, a2a: http://mac-mini.local:3008 }  # any A2A v1.0 agent
```

```bash
spur agent run --agent coder "/sp:dev-run 1332 --auto"   # manual
spur agent status                                         # who is busy, who is idle
```

Automatic dispatch keeps its existing entry points: a workflow step or `/sp:dev-runall` naming a
member, and the `gtd` strategy for tasks tagged `fleet:auto`. Nothing in these commands names a
transport, a surface or a daemon.

### 3.2 Delivery ladder (Spur's choice, per dispatch)

```text
dispatch to <member>
  ├─ member is live under spur serve      → keyed inbox request → warm turn          (today's fleet)
  ├─ member declares `a2a`                → keyed inbox request → A2A turn           (new)
  │                                         or, with no serve, the A2A turn in-process
  └─ member is local and not live         → cold subprocess with the member's executor (default-on)
every rung ends in the same receipt, gates and trace
```

The third rung is the daily-use fix: a dispatch with no daemon running works, slower, instead of
failing. `spur serve` becomes an accelerator, not a prerequisite. The ladder falls through only on a
definite `not-started`; it never re-dispatches after `outcome-unknown`.

### 3.3 The A2A turn

A member with `a2a` is an ordinary fleet member whose turn driver is A2A instead of a local CLI:

```text
claimed inbox message (request_key K)
  │  a2a send -o json --request-payload
  │    {message:{messageId: K, role:'user', parts:[{text}]},
  │     configuration:{returnImmediately:true}}
  │  → taskId, contextId   ── stored on the coordination run BEFORE any wait
  │  a2a task get <taskId> -o json   every pollMs until terminal or deadline
  ▼
task state → run receipt (§4.2)
```

`returnImmediately` is the v1 async send: a2a-cli 0.4.0 rejects the literal combination
`send --async --request-payload`, so the service carries the async policy in the payload instead of
letting the CLI synthesize a different message id. The keyed inbox id and the A2A message id therefore
stay identical.

`A2aMemberTransport` (`packages/app/src/services/a2a-member-transport.ts`) is the only module that
owns `card get`, `send`, `task get` and `task cancel`. With no `spur serve`, the dispatch command
claims the just-enqueued message by id and runs that function in-process; a live member runs the same
function for its claimed messages. A stored `remote_task_id`/`remote_context_id` on the existing
`coordination_runs` row (migrations 0055/0056) suppresses `send` on every restart, and the loop's local
orphan reaper deliberately skips rows carrying a remote task id.

**Refresh on read (1396).** A turn's poll ends at `timeoutMs` (default 600 s) with
`outcome-unknown`; the row keeps its `remote_task_id`, and only a restarted live loop used to
re-attach. `A2aMemberTransport.refresh(runId)` closes that gap without a poller: for a `running` row
carrying a remote task id it performs exactly ONE `task get`, applies the §4.2 mapping, and writes the
receipt (completed → `exited`, failed → `errored`, still working → unchanged). It never sends, a
terminal row costs no network call, and a failure leaves the last known receipt intact with the cause
reported. `spur agent trace` calls it once per delegated row (and on every `--follow` poll) and renders
`member`, `remoteTaskId`, `remoteContextId`, `remoteState`, `remoteBranch` and `refreshError`; raising
the timeout would only move the cliff, so it stays at 600 s.

The credential variable's VALUE reaches only the spawned environment. A generated helper file contains
only `SPUR_A2A_AUTH_VALUE`'s name and answers the a2a credential-helper protocol over its private pipe;
errors are redacted before they reach receipts or logs. Artifact text lands at
`.spur/run/<runId>/a2a-result.md`, and both warm and in-process commands read it back as the turn output.

**Proof.** `bun run a2a-member-e2e` drives a real `a2a server --exec`: cold, live loop, real workflow
`agent.run`, timeout → orphan sweep → fresh-transport re-attach, missing auth, unreachable card, doctor,
and read-only refusal. Receipt: `docs/reports/a2a-member-e2e-receipt.json` (9/9).

A restarted loop that finds a stored `taskId` reads that task; it never sends again. The same
function runs in-process when no `spur serve` is up.

### 3.4 Ownership

| Piece | Owner | Note |
| --- | --- | --- |
| Member declaration | `FleetMemberSchema` in `packages/config` | gains `a2a` and `authEnv`; `a2a` and `executor` are mutually exclusive |
| Name resolution | existing `--agent` resolution | a member id resolves before role/executor/binary |
| Ladder | `FleetDispatcher` callers' unavailable-fleet branch | fallback to subprocess becomes the default for local members |
| A2A turn (`a2a` calls + JSON parsing) | `A2aMemberTransport` in `packages/app/src/services/a2a-member-transport.ts` | the only module that knows the CLI grammar |
| Write admission | the same transport (card extension) + `packages/app/src/workflow/fleet-dispatch.ts` (pre-enqueue gate) | mutating work is admitted only for a card declaring `urn:spur:write-fencing:v1`; an unreachable card is `unavailable`, never an exception |
| Remote task identity | existing `coordination_runs` row | `remote_task_id`, `remote_context_id` (0055/0056) |
| Readiness | `spur agent doctor` | per member: which rung it will take and why; for A2A also binary version, card reachability and protocol version |

No new table, verb, executor surface or contract DTO. `ExecutorDispatchSurface` keeps its three
values.

### 3.5 Phase 2 (feature G9): `spur serve` speaks A2A — contract (task 1336, built)

Each declared, enabled member gets an Agent Card served by `spur serve`; `SendMessage` becomes a
keyed inbox request (`messageId` → `request_key`) and `GetTask` reads `coordination_runs`. Two Spur
installs then form a cross-machine fleet with A2A as the only wire and the inbox as the ledger at
both ends, and any A2A client can hand work to a Spur member. A card extension lets a Spur member
declare that it fences its own tree, which lifts invariant 3 for that member (G8 side, built by 1337).

The listener is one `apps/server` module (`apps/server/src/modules/a2a/`) — a facade over
`InboxService` and `coordination_runs`, no new table and no second inbox writer (ADR-143).

| Surface | Contract |
| --- | --- |
| Switch | `server.a2a.enabled` (`SPUR_A2A_ENABLED`, default `false`); **off mounts no route at all**, so every path below answers 404 like any unknown path |
| Credential | `server.a2a.authEnv` (`SPUR_A2A_AUTH_ENV`) names the environment variable holding the bearer token. `enabled` without `authEnv` fails the config load (an enabled endpoint with no token can only reject everyone). Only the NAME is configuration; the value is read at mount and never persisted, echoed, or logged |
| Card | `GET /a2a/members/<member>/.well-known/agent-card.json` — protocol version `1.0`, `HTTP+JSON` as the only interface, `streaming: false`, `pushNotifications: false`, and `capabilities.extensions` carrying `urn:spur:write-fencing:v1` (the member fences its own tree). The advertised origin is `http://<x-forwarded-host><x-forwarded-prefix>` when BOTH headers are present, else `new URL(c.req.url).origin` — the gateway rewrites `host` to the upstream loopback authority, so without this the card advertises an ephemeral serve port that dies on the next restart (1395 R4). The upstream binds loopback only, so these headers can come from a local process, and they affect the advertised URL alone, never auth |
| Send | `POST /a2a/members/<member>/message:send` — `{message:{messageId, role, parts:[{text}]}}` → `{task}`. One inbox request, `kind: 'request'`, request key `a2a:<member>:<messageId>`; a repeated `messageId` with the same work replays the same task id, a different body is `409 ALREADY_EXISTS` |
| Get | `GET /a2a/members/<member>/tasks/<id>` — the task id IS the inbox message id; state comes from the run receipt |
| Cancel | `POST /a2a/members/<member>/tasks/<id>:cancel` — stops the member's run through the supervisor's existing stop path and records the intent first, so the state survives a restart. A task with no run in progress, or a terminal one, is `400 FAILED_PRECONDITION` (`TASK_NOT_CANCELABLE`) — a queued request is never reported canceled |
| Errors | A2A envelope `{error:{code,status,message,details:[{@type:"type.googleapis.com/google.rpc.ErrorInfo",domain:"a2a-protocol.org",reason,metadata}]}}`; missing/wrong token is `401` with `WWW-Authenticate: Bearer` and **writes nothing** |
| member id | the member's inbox address `<projectSlug>-<memberLocalId>`; `FleetService.memberAddresses` resolves it from the declaration alone, so a member whose executor is globally disabled still has an address (its launch is a separate failure) |
| Forwarded identity | the gateway's `proxy` sets `x-forwarded-host` (the authority the client dialed) and `x-forwarded-prefix` (the matched project prefix) on every upstream request, and strips any inbound copy first (1395 R3) |

Receiver-side state mapping (the inverse of §4.2, `projectState`): a cancel intent outranks the
receipt (a stopped run exits `errored`, and the caller must still read `canceled`); then run row
`exited` → `COMPLETED`, `errored` → `FAILED` (with the reason as the status message), `running` →
`WORKING`; with no run row, inbox `claimed` → `WORKING`, `failed` → `FAILED`, else `SUBMITTED`.
`COMPLETED` carries the member's newest inbox reply on the thread as one text artifact and, when the
member works in a Git tree, `metadata.remoteBranch` naming that branch.

**CSRF exemption.** `/a2a/*` is exempt from the server's CSRF guard
(`apps/server/src/middleware/pipeline.ts`). Every A2A route is bearer-authenticated — a header a
cross-site simple request cannot set — so the rule protects nothing there, and it actively breaks
the client: the unmodified `a2a` CLI sends no `Content-Type` on `task cancel`, which is exactly the
shape `csrf()` rejects.

**Proof.** `bun run a2a-serve-e2e` drives a real `spur serve` with the real `a2a` CLI
(`card get`, `send --async`, `task get`, `task cancel`) and writes
`docs/reports/a2a-serve-e2e-receipt.json`. The member loop itself is not run there — the
`completed`/`failed` arms seed the run rows a member writes; the two-install dispatch is G9 task
1337.

**Proof.** `bun run a2a-two-install-e2e` drives two real Spur homes plus a deterministic exec worker:
read-only dispatch with durable A/B records, the fencing card, an extension-free refusal, a wrong-token
refusal, fenced mutation with `metadata.remoteBranch`, a real workflow `requireDiff` stage, B down,
and B restart → re-attach with one send, plus a no-fetch/no-merge assertion. Receipt:
`docs/reports/a2a-two-install-e2e-receipt.json` (9/9).

## 4. Contract and compatibility

### 4.1 Config

| Key | Meaning |
| --- | --- |
| `members[].a2a` | Agent Card host, URL or local card path; presence makes the member an A2A member |
| `members[].project` | alternative to `a2a` (task 1395): a registered LOCAL project — registry name or gateway prefix — whose member this declaration addresses |
| `members[].member` | required with `project`; the target member's local id, so the remote instance id is `<projectRegistryName>-<member>` |
| `members[].authEnv` | the NAME of an environment variable holding the credential. Required with `project`; optional with `a2a`. Must match `[A-Za-z_][A-Za-z0-9_]*`; inline values and assignments are invalid |

`a2a`, `project` and `executor` are pairwise mutually exclusive on one member — one target, never two;
`authEnv` is only a variable name, never a credential.

**Project-addressed resolution (1395).** `project` + `member` resolves at DISPATCH time, never cached,
to `http://localhost:<server.gateway.port><prefix>/a2a/members/<registryName>-<member>/.well-known/agent-card.json`
and is handed to `A2aMemberTransport` exactly as a literal `a2a` value would be, so the delivery
ladder, write fencing, receipts and never-resend are unchanged. A remote entry, an unknown or
ambiguous project, a gateway that is not answering, or a foreign listener on the gateway port each
fail as a `not-started` turn whose message says what to do; `spur agent doctor` prints the resolved
URL next to the rung. The address grammar on `--agent` and `spur message` is untouched — a member
declaration names the target, so there is no new public verb.

Existing configs are unchanged. `strategy`, `orchestrator`, `role` and `purpose` keep their
defaults and are not needed for manual dispatch.

### 4.2 State mapping (A2A members)

| A2A task state | Receipt | Reason |
| --- | --- | --- |
| `TASK_STATE_COMPLETED` | `completed` | artifact text parts, joined, are the turn output |
| `TASK_STATE_FAILED`, `TASK_STATE_REJECTED` | `failed` | remote state + status message |
| `TASK_STATE_CANCELED` | `failed` | `canceled` |
| `TASK_STATE_INPUT_REQUIRED`, `TASK_STATE_AUTH_REQUIRED` | `failed` | `needs-input` / `needs-auth`; the remote task is then canceled |
| deadline or transport error after a task id exists | `outcome-unknown` | carries the task id |
| no task id obtained (card unreachable, binary missing, auth variable unset) | `not-started` | actionable message |

### 4.3 Invariants

1. **Transport is never user-selected.** No flag, step option or run variable names A2A.
2. **Never auto-resend.** After a task id exists the only way forward is reading that task.
3. **A2A work is read-only unless the card declares write fencing.** Work that declares
   `expectFile(s)`, `requireDiff` or owned sections is refused before anything is sent unless the
   card's `capabilities.extensions` contains `urn:spur:write-fencing:v1`. Without the extension,
   behavior is exactly G8's. The sender consults the card both before enqueue and before send.
4. **No secret at rest.** Only the variable name is stored; the value reaches the child process
   environment and is redacted from receipts, traces and logs.
5. **Completed tasks return artifact text and the remote branch.** The member writes its answer as
   an inbox reply, so `GetTask` returns it as an artifact. On completion, `Task.metadata.remoteBranch`
   names the member's current working branch; the sender records it but never fetches or merges it.
   The same field reaches the named-member result, the workflow receipt and the `spur agent run --json`
   envelope.
6. **Warm turns are untouched.** A live local member behaves exactly as today.
7. **The cold rung is visible.** The receipt records which rung ran and why (`fallbackReason`).

### 4.4 Errors

Failed operations exit nonzero and name the member, the rung attempted, the remote task id when one
exists and the next action.

## 5. Tradeoffs and open questions

- **Local members stay off A2A.** A2A is the wire wherever Spur crosses a process tree it does not
  own; inside one machine the inbox is faster, warm and durable. Uniform A2A for local members would
  mean running one cold `a2a server --exec` per agent and losing ADR-145.
- **Default cold fallback.** Zero-setup dispatch costs a cold start per turn. The alternative
  (auto-starting `spur serve` from a CLI command) hides a daemon behind a one-shot command.
- **Shelling to `a2a` vs. an SDK.** No new dependency; cost is a process per call and a parser pinned
  by golden fixtures that fails loudly on an unknown shape.
- **Read-only default.** A card without the write-fencing extension takes no coding work at all. The
  restriction lifts only for Spur↔Spur members that declare that they fence their own tree, so the
  sender never reasons about a remote tree it cannot fence.

Operator decisions (2026-11-14, ADR-051 consent):

1. **Accepted** — `--agent <member-id>` resolves to a fleet member; cold fallback is on by default
   (task 1333).
2. **Accepted** — `a2a` / `authEnv` on fleet members; the Homebrew `a2a` binary is an optional
   prerequisite (task 1334).
3. **Accepted, in G8** — `join`, `leave`, `wait` and `report` are hidden from default
   `spur agent --help` and keep working (task 1335).
4. **Planned as feature G9** — `spur serve` as an A2A server (tasks 1336, 1337; P3 until a caller
   exists).
