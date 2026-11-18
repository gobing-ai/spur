---
kind: plan
title: A2A for cross-agent task orchestration — brainstorm
status: draft
created_at: 2026-11-14
updated_at: 2026-11-14
related:
  - docs/get_all_of_these_terminal_coding_agents_speaking_A2A_v1.md
  - docs/design/inter-agent-control-plane.md
  - docs/design/fleet-task-turn-execution.md
  - docs/plans/2026-10-04-agent-fleet-inbox-redesign.md
  - docs/plans/2026-10-21-fleet-performance-measurement.md
  - docs/reports/fleet-perf-receipt.md
tags: [brainstorm, a2a, agent, fleet, orchestration]
needs_design: true
run_id: a9219a41-eeb5-4980-8c55-20543e3c108e
---

# A2A for cross-agent task orchestration — brainstorm

## Refinement (2026-11-14, after operator review)

The "Design Summary" below is superseded where it conflicts with this section; the code-review
findings and the rejection of approach A stand.

- **A2A is a transport under the inbox, not a fourth `agent.run` surface.** The user never selects
  it. A fleet member declared with an Agent Card gets an A2A turn; the keyed inbox request stays the
  durable record.
- **The main fix is daily-use weight, not wire speed.** The user addresses a member by name; Spur
  picks warm inbox turn → A2A turn → cold subprocess. A dispatch works with no `spur self serve` running.
- **Same-machine members stay off A2A.** `a2a server --exec` is a cold, in-memory, per-request
  spawn; putting it in front of local agents would undo ADR-145.
- **The latency baseline is decoupled** (task 1331, P3). Performance work shipped in 0.4.34–0.4.35.
- **Phase 2, undecided:** `spur self serve` serving A2A, for cross-machine Spur fleets.

Owners: ADR-148, `docs/design/a2a-member-transport.md`, feature G8, tasks 1333 and 1334.

## Question

Can Agent2Agent (A2A) v1.0 carry Spur's task orchestration across coding agents, after ACP,
`agent team` and `agent fleet` each disappointed?

## Short answer

Yes as an **edge adapter**, no as a **replacement**. A2A is a wire protocol; Spur's orchestration
value is the control plane around the wire. Keep the control plane, add A2A where Spur has no
native driver, and measure real-agent latency before changing anything else.

## What the code review found

| Area | Finding | Evidence |
| --- | --- | --- |
| Dispatch | One primitive: enqueue a keyed inbox request, read the receipt from `coordination_runs`, poll at 250 ms | `packages/app/src/services/fleet-dispatcher.ts` |
| Delivery | Durable, idempotent (`request_key`), claim-leased; `InboxService` is the sole writer | ADR-143; `packages/app/src/services/inbox-service.ts` |
| Loop | Orchestrator claim + heartbeat, orphan reaping, wake-then-drain, 2 s fallback poll | `packages/app/src/services/agent-loop-service.ts` |
| Warm turns | Codex App Server, Claude stream-json, Pi RPC are correlated warm turns; Grok and Antigravity have no turn-session driver | ADR-145; `docs/reports/fleet-perf-receipt.md` |
| Executor seam | `agent.run` selects `host \| fleet \| subprocess` and returns one receipt shape | `packages/app/src/workflow/actions/agent-run.ts:75`, `:1824` |
| Identity | Waits are pinned to an occupant `{specId, agentKind, processId, runId, generation}` | ADR-075; `docs/design/inter-agent-control-plane.md` |
| Measured overhead | ≈1.5–1.7 s enqueue→validated on stubs; keyed turn 1–13 ms p50 | `docs/reports/fleet-perf-receipt.md` |
| Unmeasured | Real-agent latency distribution and startup-vs-model share | `docs/plans/2026-10-21-fleet-performance-measurement.md` |
| Prior ACP | It was Zed's Agent Client Protocol via `acpx` — editor↔agent, not agent↔agent | `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §2.4 |
| a2a-cli exec mode | Spawns `sh -c` per request; in-memory task map; no session reuse, cwd, auth or durability | `vendors/a2a-cli/internal/localsrv/serve_exec.go` |
| a2a-cli smoke | `a2a server --exec` + `a2a send -o json` → `TASK_STATE_COMPLETED` in 0.023 s; card protocolVersion 1.0 | local run, a2a-cli 0.4.0 |

Two premises in the idea do not hold. The ACP Spur tried did not evolve into A2A (IBM's Agent
Communication Protocol did). And nothing measured shows transport as the bottleneck: fleet's own
overhead is about 1.5 s against model turns that run for minutes.

## What A2A gives and what it does not

| Need | A2A v1.0 | Spur today |
| --- | --- | --- |
| Discover an agent and its skills | Agent Card | `agent.fleet` config + `spur agent list` |
| Send work, get a task id | SendMessage → Task | keyed inbox request |
| Progress stream | SSE / subscribe | `spur agent trace`, ledger events |
| Cancel | CancelTask | `spur agent stop` |
| Ask the caller a question | `INPUT_REQUIRED` | escalation file + HITL pause |
| Idempotent delivery | not specified | `request_key` |
| Durable receipt after a crash | server-defined (none in `--exec`) | `coordination_runs` |
| One writer per worktree | none | fleet + worktree isolation |
| Dependency order, retries, gates | none | workflow engine, `spur task gate` |
| Session reuse across turns | `contextId` (server must implement) | warm-turn drivers |

## Approaches

### A. Replace inbox/fleet with an A2A mesh

Every agent runs an A2A server (`claude-a2a`, `@bacnh85/pi-a2a`, `a2a-adapter`,
`a2a server --exec`); Spur becomes an A2A client that sends tasks and polls.

- For: one standard, agents can also call each other directly.
- Against: drops durable idempotent delivery, occupant pinning and write fencing; depends on four
  unverified third-party servers with different session and permission models; `--exec` is a cold
  spawn per request, which is the cost ADR-145 was written to remove; contradicts ADR-057 outright;
  a fourth rewrite in a year aimed at the part that is not slow.
- Verdict: **rejected.**

### B. A2A as an outbound executor surface (recommended)

Add `a2a` beside `host | fleet | subprocess` in `agent.run`. A step names an A2A endpoint; Spur
shells to the installed `a2a` binary (`a2a send -o json`, then `a2a task get` until terminal),
maps the terminal state and artifacts onto the existing receipt, and records the remote `taskId`
and `contextId` in the run row so a crashed dispatcher can re-attach instead of re-sending.

- For: no new dependency; reuses the receipt contract, gates and trace; opt-in per step; reaches
  Grok, Antigravity and remote agents without a native driver; small and reversible.
- Against: a remote agent's writes are outside Spur's fencing; needs an ADR-057 amendment; value
  depends on someone actually running an A2A agent worth calling.
- Verdict: **recommended**, after the baseline below.

### C. No A2A: measure, then extend warm turns

Run the real-agent lane of the fleet KPI plan; add `ts-ai-runner` turn drivers for Grok and
Antigravity.

- For: attacks the only cost that is plausibly large (cold start and model time) with no new
  surface; consistent with the approved simplification plan.
- Against: no interop with agents outside the fleet; each new agent needs a driver.
- Verdict: **do the measurement regardless; driver work only if numbers ask for it.**

### Inbound (Spur as an A2A server) — deferred

A thin HTTP facade that turns SendMessage into a keyed inbox request and serves task state from
`coordination_runs` is feasible and fits the existing Hono server. No outside caller exists, so it
is not built now.

## Design Summary

**Decision.** Reshape: approach B gated by approach C's measurement. A2A is added as an outbound
executor edge. The inbox remains the sole coordination transport inside Spur.

**Components.**

1. **Baseline receipt.** Run the real-agent lane; publish per-phase wall time (queue, start, model,
   tools, gate) per agent. This decides whether transport work is worth anything.
2. **`a2a` executor surface.** A fourth branch at the surface selection in `agent-run.ts`, backed by
   one app-layer service that owns the `a2a` subprocess calls. `ReceiptExecutor` gains `'a2a'`.
3. **State mapping.**

   | A2A task state | Spur receipt |
   | --- | --- |
   | `COMPLETED` | `completed` (artifact text becomes the step output) |
   | `FAILED`, `REJECTED` | `failed` (status message kept as the error) |
   | `CANCELED` | `failed`, reason `canceled` |
   | `INPUT_REQUIRED`, `AUTH_REQUIRED` | `failed`, reason `needs-input` in v1 |
   | client timeout or transport error after send | `outcome-unknown` (remote task id recorded) |
   | send refused before a task id exists | `not-started` |

4. **Idempotency.** The Spur run id is sent as the A2A `messageId`; the returned `taskId` is stored
   before polling starts. Resume reads the task instead of sending again.
5. **Endpoint config.** A2A endpoints are declared in project config next to `agent.fleet`
   (name → card URL, optional auth env var name). Secrets are never stored; only the variable name.
6. **Write fencing.** v1 accepts only steps whose contract is read-only or artifact-returning
   (review, research, plan). Steps that mutate the worktree stay on `fleet`/`subprocess` until an
   isolation story for remote writers exists.
7. **Governance.** ADR amendment narrowing ADR-057: A2A is permitted as an executor edge to
   external agents; it is not an agent-to-agent plane inside the fleet. No new `spur` noun or verb;
   the surface is a workflow step option plus config.

**Out of scope.** Inbound A2A server, push notifications, gRPC/JSON-RPC bindings, multi-turn
`INPUT_REQUIRED` round trips, any third-party inbound wrapper, replacing `spur message`.

**Open items for the operator.**

- What specifically is unsatisfying about fleet (latency, reliability, setup, ergonomics)? The
  baseline covers latency only.
- Consent for the ADR-057 amendment and the new `agent.run` executor value (public workflow
  surface, ADR-051).
- Whether shelling to the Homebrew `a2a` binary is acceptable as a runtime prerequisite, checked by
  `spur agent doctor`.

**Risks.**

| Risk | Mitigation |
| --- | --- |
| A2A changes nothing the operator feels | Baseline first; stop after it if transport share is negligible |
| Remote writer corrupts the tree | Read-only/artifact steps only in v1 |
| Lost task on remote crash | `outcome-unknown` + recorded task id; never auto-resend |
| Exposed listener | Outbound only; Spur opens no port |
| `a2a` binary missing or wrong version | Doctor check; actionable `not-started` error |

## Sources

- A2A v1.0 specification — https://a2a-protocol.org/v1.0.0/specification/
- `vendors/a2a-cli` (a2a-cli 0.4.0 source, read-only)
- `docs/00_ADR.md` — ADR-057, 075, 116, 121, 126, 132, 143, 145, 146
- `docs/design/inter-agent-control-plane.md`, `docs/design/fleet-task-turn-execution.md`
- `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`, `docs/plans/2026-10-21-fleet-performance-measurement.md`, `docs/plans/2026-11-05-simplification-and-product-enhancement.md`
- `docs/reports/fleet-perf-receipt.md`
