---
template: feature-impl
schema_version: 1
name: "Team process supervision: autostart at serve, attach/detach stdio streams, process registry"
description: ""
status: todo
type: task
profile: standard
feature_id: G2
parent_wbs: null
priority: P2
tags: ["approach-c", "collaboration", "server", "cli"]
dependencies: []
created_at: "2026-07-03T23:35:28.258Z"
updated_at: "2026-07-03T23:44:05.736Z"
---

## 0195. Team process supervision: autostart at serve, attach/detach stdio streams, process registry

### Background

Cycle position P6 (decision D7, docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md) — the largest infra item, deliberately scheduled after the queue (P2) and inbox IPC (P4) so supervised agents ride proven messaging and the Observability module watches the build. Current state: `spur team start|stop` are Phase-4 STUBS (apps/cli/src/commands/team.ts); no process supervisor exists anywhere. Agent specs live in `.spur/agents/<id>.yaml` (TeamService CRUD, `loadAgentSpecs` from ts-ai-runner); `spur agent run --drain` gives a headless work loop per agent.

Decision D7 fixes the transport: server-mediated stdio streams — the supervisor owns child process pipes; attach = SSE subscription replaying a bounded ring buffer then tailing stdout/stderr frames, plus a POST endpoint forwarding lines to child stdin. Explicitly NO PTY and no interactive TUI agents in v1 (supervised agents run headless: single-shot or drain loops). No auto-restart in v1 — exits are recorded in the registry and events, not retried.

Deliverables: supervisor service in `packages/app` (spawn from specs via the ProcessExecutor seam, registry of pid/status/uptime), `team.autostart` config list, process lifecycle events on the bus, attach/stdin endpoints on a server `team` module, `spur team start|stop|attach <agent-id>` CLI verbs replacing the stubs, and the Process List tab in the Observability module (via its tab-extension contract).

Dependencies: P2 job-queue task (serve lifecycle patterns, EventBus job events precedent), P4 inbox IPC (supervised agents consume messages; watch verb pairs with drain loops), P1 Observabilities (tab contract). Design doc first: the attach-stream framing (data format, backpressure, buffer size) gets a short design section reviewed before implementation (record in this task's Design).

### Requirements
- [ ] R1 — Supervisor service in `packages/app`: spawn headless agent processes from `.spur/agents` specs through the runtime ProcessExecutor/spawn seam (no raw child_process in app code unless the seam genuinely lacks it — then extend upstream per the shared-library rule); registry tracks agent id, pid, status (running/exited/stopped), start time; exits recorded with code, never silently dropped.
- [ ] R2 — `team.autostart` config (list of agent spec ids) in the server/env config schema (`packages/config` — extend the existing `configSchema`, NOT `spurConfigSchema`; see the 2026-06-15 two-schema note); serve boot spawns each listed agent.
- [ ] R3 — Process lifecycle events on the EventBus (process.spawned/exited/stopped) with agent id + pid; visible in the Events tab.
- [ ] R4 — Attach transport: per-process SSE endpoint replaying a bounded ring buffer (last N frames, constant) then live stdout/stderr frames (framed with stream + timestamp); `POST .../stdin` forwards a line to child stdin; detach (client disconnect) never affects the process; CF entrypoint no-ops.
- [ ] R5 — `GET /api/team/processes` returning id/pid/status/uptime for all supervised processes.
- [ ] R6 — CLI: `spur team start [--agent <id>]` (start supervisor/autostart set or one agent), `spur team stop` (graceful terminate, status reflected), `spur team attach <agent-id>` (consume the SSE stream to the terminal, forward stdin lines, Ctrl-C detaches without killing the child) — replacing the Phase-4 stubs; all with `--json` where output is structured.
- [ ] R7 — Process List tab in the `observability` module via the tab-extension contract: live process list with status, uptime, and an attach affordance linking to the stream view.
- [ ] R8 — Tests: supervisor spawn/exit/stop against a fake ProcessExecutor, ring-buffer replay semantics, stdin forwarding, registry API, CLI attach framing (unit-level), CF no-op; no PTY dependency anywhere.
- [ ] R9 — Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`; manual end-to-end: autostart an echo-style agent spec, attach from a terminal, send stdin, observe output, detach, stop.
### Acceptance Criteria
```gherkin
Feature: Team process supervision

  Scenario: Autostart agents launch with the server
    Given team.autostart lists an existing agent spec
    When spur serve boots
    Then the agent process spawns and the process registry reports it running

  Scenario: Supervised processes are listable over the API
    Given supervised processes exist
    When GET /api/team/processes is requested
    Then each process returns with agent id, pid, status, and uptime

  Scenario: Attaching replays the buffer then tails live output
    Given a running supervised agent with prior output
    When a client attaches to the process output stream
    Then recent buffered frames replay and new stdout and stderr frames arrive live

  Scenario: Stdin lines reach the child process
    Given a client is attached to a running supervised agent
    When a line is posted to the process stdin endpoint
    Then the child process receives that line on stdin

  Scenario: Detaching leaves the process running
    Given a client is attached to a supervised agent
    When the client disconnects from the stream
    Then the process keeps running and remains attachable

  Scenario: Team stop terminates processes gracefully
    Given supervised processes are running
    When spur team stop runs
    Then the processes terminate gracefully and the registry reports them stopped

  Scenario: Process List tab shows live supervision state
    Given the board Observability module is open
    When the operator opens the Process List tab
    Then supervised processes render with live status
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** The largest infra item of the cycle (decision D7): a `SupervisorService` in `packages/app` owning child processes spawned from `.spur/agents/<id>.yaml` specs, a server `team` module exposing registry + attach/stdin endpoints, CLI verbs replacing the Phase-4 stubs, and the Process List tab. Transport is server-mediated stdio streams — SSE out (ring-buffer replay + live tail), POST in. Explicitly NO PTY, no interactive TUI agents, no auto-restart in v1 (exits recorded, not retried).

**OPEN DESIGN POINT — settle in Q&A before implementing (do not guess):** what command does a supervised agent process actually run? Options: (a) a spur-provided headless work loop (e.g. a drain-poll wrapper around `spur agent run --agent <id> --drain` + `spur message watch`), (b) a spec-declared `command` argv field added to the agent spec YAML, (c) both with (a) as default. This determines spec-schema changes and restart semantics. Draft a short proposal in Q&A, get operator confirmation (HITL), THEN implement. Everything else below is settled.

**Supervisor (R1, R3).** `packages/app` service: spawn via the runtime process seam (ProcessExecutor / `Bun.spawn` behind it — VERIFY the seam supports long-running children with piped stdio + kill; if it only runs-to-completion, make the smallest ts-runtime enhancement (spawn-handle API) rather than raw `child_process` in app code — shared-library rule; record the finding here). Registry: `Map<agentId, { pid, status: running|exited|stopped, startedAt, exit? }>`. Per-process ring buffer of framed output `{ stream: stdout|stderr, ts, line }`, bounded (e.g. 500 frames, constant). Lifecycle events on the bus: `process.spawned|exited|stopped` (agent id + pid) — they land in Events tab via the 0189 tap + shared name list. Serve shutdown: SIGTERM children, bounded wait, SIGKILL stragglers — no zombies.

**Config (R2).** `team.autostart: string[]` (agent spec ids) in the ENV config schema (`packages/config` `configSchema` — NOT `spurConfigSchema`; the two-schema split is a known trap, see the 2026-06-15 cerebrum note; exact placement `server.team.autostart` vs top-level `team` block: decide at refinement, record here). Serve boot spawns each listed spec; a missing spec id fails loud at startup (misconfiguration = startup failure, per error-handling policy).

**Server module (R4, R5).** `team` module, Bun-gated (no-op without ctx): `GET /api/team/processes` (registry projection); `GET /api/team/processes/:id/stream` — SSE: replay ring buffer, then live frames; reuse the events module's teardown pattern (abort listener, heartbeat, idempotent close — that code solved ERR_INCOMPLETE_CHUNKED_ENCODING, copy its shape); enqueue failures drop frames (drop-oldest backpressure), never kill the child. `POST /api/team/processes/:id/stdin` `{ line }` → child stdin write.

**CLI (R6).** Replace stubs in `apps/cli/src/commands/team.ts`: `start [--agent <id>]` (autostart set or one), `stop` (graceful), `attach <agent-id>` (consume the SSE stream to the terminal via Bun fetch streaming, forward terminal stdin lines to the POST endpoint; Ctrl-C detaches WITHOUT killing the child). `--json` where output is structured. Note: attach requires `spur serve` running — error clearly when it isn't.

**Board (R7).** Process List tab appended to observability `tabs.ts`: live list (id/status/uptime via registry API + `process.*` events), attach affordance linking to a stream view.

**Testing (R8).** Fake process seam for supervisor tests (spawn/exit/stop, registry truth, ring-buffer bounds + replay order, stdin forwarding); server module tests with a stubbed supervisor; CLI framing tests at unit level; CF no-op. Manual e2e is REQUIRED before done (an echo-loop agent spec: attach, send stdin, observe, detach, stop) — record in Testing.

**Decomposition guidance — this parent SHOULD be decomposed at refinement** (`spur task create ... --parent 0195` or `/sp:dev-plan`): A = supervisor + registry + events (R1–R3); B = server endpoints + attach transport (R4, R5); C = CLI verbs (R6); D = Process tab (R7). A blocks B blocks C; D needs only B.

**Dependencies.** 0190 (serve lifecycle patterns + queue precedent), 0193 (watch/drain pairing for supervised loops), 0189 (tab contract + event names). Downstream: 0197 (workspace composes supervision).
### Plan
- [ ] Q&A gate: settle the supervised-agent command model (spur-provided loop vs spec-declared command vs both) with the operator; record in Q&A + update Design (HITL — do not implement past this unanswered).
- [ ] Verify the runtime process seam supports long-running piped children + kill; if not, land the smallest ts-runtime enhancement and bump the catalog; record in Design (R1).
- [ ] SupervisorService: spawn/registry/ring-buffer/lifecycle-events/graceful-shutdown; unit tests on a fake process seam (R1, R3).
- [ ] `team.autostart` in `packages/config` `configSchema` (+ regenerate the embedded JSON schema — it is the ACTIVE runtime validator, known drift trap); startup fail-loud on unknown spec id; tests (R2).
- [ ] Server `team` module: processes list, SSE attach stream (buffer replay + tail, events-module teardown pattern), stdin POST; Bun-gated; endpoint tests + CF no-op (R4, R5).
- [ ] CLI `team start|stop|attach` replacing stubs; attach = SSE consume + stdin forward + Ctrl-C detach; tests (R6).
- [ ] Process List tab via observability tab contract with live status (R7).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R9).
- [ ] Manual e2e with an echo-loop agent spec: autostart → attach → stdin → output → detach → stop; evidence in Testing (R9).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

G2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
