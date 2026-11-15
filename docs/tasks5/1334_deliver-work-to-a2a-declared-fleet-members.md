---
schema_version: 1
name: Deliver work to A2A-declared fleet members
status: todo
template: feature-impl
created_at: 2026-11-15T04:02:03.794Z
updated_at: "2026-11-15T09:17:40.412Z"
feature_id: G8
priority: P2
tags:
  - a2a
  - agent
  - fleet
  - transport
estimate_hours: 14

dependencies: ["1333"]
---

## 1334. Deliver work to A2A-declared fleet members

### Background

Implements: R3 — A member declared with an A2A card receives work over A2A; R4 — A2A task states map onto the existing receipt outcomes; R5 — An A2A wait that times out is outcome unknown and is never re-sent; R6 — A restarted dispatch re-attaches to the recorded remote task; R7 — Worktree-mutating work is refused for an A2A member; R10 — A2A credentials come from the environment only.

Spur cannot hand work to an agent it does not run itself. ADR-148 (Proposed) puts A2A v1.0 under the inbox as a member's turn driver, invisible to the user. Contract: `docs/design/a2a-member-transport.md` sections 3.3, 4.1, 4.2 and 4.3. Starting this task requires operator acceptance of ADR-148 decision 2 (member keys `a2a`/`authEnv`, the `a2a` binary as an optional prerequisite).

### Requirements

- [ ] R1 — `FleetMemberSchema` gains `a2a` (card host, URL or path) and `authEnv` (variable name only); `a2a` with `executor` is a validation error.
- [ ] R2 — One `packages/app` service owns every `a2a` CLI call: send (async, `messageId` = the request key), task get, task cancel, card get.
- [ ] R3 — An A2A member's claimed inbox message is completed by that service as the turn; with no `spur serve`, the same function runs in-process from the dispatch command.
- [ ] R4 — The remote task id and context id are stored on the coordination run before any wait; a restart reads the task and never sends again.
- [ ] R5 — Task states map to receipts exactly as design section 4.2; a deadline or transport error after a task id exists is `outcome-unknown`.
- [ ] R6 — Unreachable card, missing binary or unset auth variable yields `not-started` and a nonzero exit naming the member.
- [ ] R7 — Work declaring `expectFile(s)`, `requireDiff` or owned sections is refused for an A2A member before any send.
- [ ] R8 — The credential value reaches only the child process environment and is redacted from receipts, traces and logs.
- [ ] R9 — No flag, step option or run variable selects A2A; `ExecutorDispatchSurface` keeps its three values.
- [ ] R10 — The doctor line for an A2A member reports the binary version, card reachability and protocol version.

### Acceptance Criteria

- [ ] AC1 — A member declared with an A2A card receives work over A2A
- [ ] AC2 — A2A task states map onto the existing receipt outcomes
- [ ] AC3 — An A2A wait that times out is outcome unknown and is never re-sent
- [ ] AC4 — A restarted dispatch re-attaches to the recorded remote task
- [ ] AC5 — Worktree-mutating work is refused for an A2A member
- [ ] AC6 — A2A credentials come from the environment only

Task-local check: the E2E run against a local `a2a server --exec` leaves a repeatable receipt artifact.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**2026-11-15 — not started (batch 1331,1334,1337).** Cancelled at the batch level before implementation:
the remaining work is a member-loop turn-driver integration (an A2A member's claimed inbox message is
completed by the transport service inside `runDrain`) plus a coordination-run `contextId` persistence
path, the read-only admission check, a doctor line and a two-install E2E lane — a multi-hour feature
that a batch slot could not finish honestly. Prerequisites verified present for the next run:
ADR-148 decision 2 is Accepted, `a2a 0.4.0` is on PATH (`a2a send --async`, `task get`, `task cancel`,
`card get`), and both dependency tasks (1333, 1336) are `done`. Run it as its own `/sp-dev-run 1334`.

### Design

Approach: an A2A member is an ordinary fleet member whose turn driver shells to the operator-installed `a2a` binary (`a2a send --async -o json --request-payload`, then `a2a task get -o json` on an interval). The keyed inbox request stays the durable record; the existing claim, lease and receipt code is reused.

Why: A2A defines no idempotent delivery, durable receipt or write fencing, so it sits under the inbox rather than beside fleet; no new dependency; the user never sees it.

Rejected: a fourth `agent.run` surface (makes the transport user-visible); an A2A SDK dependency; wrapping local agents in `a2a server --exec` (cold per request, in-memory tasks, no session reuse); streaming (polling survives a restart).

Invariants: never re-send once a task id exists; read-only work only; no secret at rest; unknown CLI output fails loudly with the binary version; usage is reported unavailable.

Key signatures (shape, not code): `send(member, text, messageId) -> {taskId, contextId}`; `read(member, taskId) -> {state, statusMessage, artifactText}`; `toReceipt(task | error) -> FleetReceiptStatus + reason`.

### Plan

- [x] Write the failure list first (each row of design section 4.2 plus the invariants) as E2E cases against a local `a2a server --exec` fixture and a stub returning each non-completed state.
- [x] Member schema keys and validation.
- [x] A2A turn service with golden fixtures of `a2a` JSON output.
- [x] Wire it as the turn driver in the member loop and as the in-process path; task-id persistence and re-attach.
- [x] Read-only admission refusal; doctor line.
- [x] Update `docs/design/a2a-member-transport.md` status and the fleet config satellite; rebuild the CLI bundle.

### Solution

Approach: A2A is a member turn driver under the keyed inbox, not a fourth executor surface. `A2aMemberTransport` owns every `a2a` CLI call and is used by the live member loop, the no-serve CLI dispatch and the workflow fleet path. Remote task identity rides the existing `coordination_runs` row before the first poll, so a restart re-attaches instead of re-sending.

| File:line | Change |
| --- | --- |
| `packages/config/src/index.ts:582` | `FleetMemberSchema.a2a` / `authEnv` (variable-name regex); entry validation rejects `a2a + executor` and accepts role/executor/a2a as the third declaration arm |
| `apps/cli/schemas/spur-config.schema.json:225` | the same contract on the CLI's JSON-Schema config loader |
| `packages/app/src/services/a2a-member-transport.ts:101` | `A2aCliService`: card/send/get/cancel/version only; async send is one payload with caller `messageId` + `configuration.returnImmediately` (a2a 0.4.0 rejects `--async --request-payload`) |
| `packages/app/src/services/a2a-member-transport.ts:266` | `A2aMemberTransport`: claim → send → persist remote identity → poll → receipt; read-only admission, redaction, doctor and warm-output readback |
| `packages/app/src/services/a2a-member-transport.ts:131` | credential helper contains only the env var name; the value reaches the child env and is redacted from errors/receipts/logs |
| `packages/app/src/services/fleet-service.ts:317` | A2A members materialize as `type: 'a2a'` specs without a local executor; resolution carries `a2a`/`authEnv` and no fsWrite capability |
| `packages/app/src/services/member-dispatch.ts:182` | no-serve A2A rung; A2A never falls back to a local executor; warm output uses the result artifact |
| `packages/app/src/services/agent-loop-service.ts:519` | a live A2A member completes claimed inbox messages through the same transport, skipping local session startup |
| `packages/app/src/workflow/fleet-dispatch.ts:208` | mutating work is refused before prompt write/enqueue/send; the in-process A2A path returns the existing fleet receipt variants |
| `packages/app/src/workflow/actions/agent-run.ts:472` | A2A rows skip the local work-item-result reader; A2A `not-started`/unavailable never takes the cold subprocess rung |
| `apps/cli/src/commands/agent/run.ts:138` | `spur agent run --agent <a2a-member>` output, JSON envelope and nonzero failure/outcome-unknown exits |
| `apps/cli/src/commands/agent/shared.ts:634` | doctor reports binary version, card reachability and protocol version; CLI loop/dispatch composition |
| `packages/domain/src/migrations.ts:1646` | migrations 0055/0056 add `remote_task_id` / `remote_context_id`; DAO carries them and local orphan reaping skips remote A2A rows |
| `packages/app/src/services/inbox-service.ts:282` | `claimById` lets an in-process dispatch claim exactly its own message, not an older sibling |
| `scripts/commands/a2a-member-e2e.ts:1` | repeatable real `a2a server --exec` lane and `docs/reports/a2a-member-e2e-receipt.json` |

Docs: `docs/design/a2a-member-transport.md` §3.3 is now the built contract (including the actual a2a 0.4.0 payload grammar); `docs/design/fleet-config-declaration.md` and `docs/design/data-output-contracts.md` own the config/schema deltas; `plugins/sp/skills/spur-cli/references/agent.md` and `docs/help/cmd_agent.md` describe the member rung and doctor line. `ExecutorDispatchSurface` remains `host | fleet | subprocess`.

E2E: `bun run a2a-member-e2e` — 9/9 steps against `a2a 0.4.0`: cold in-process, live member loop, real workflow stage, timeout → orphan sweep → fresh-transport re-attach with one send, missing auth, unreachable card, doctor, read-only refusal.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
