---
kind: plan
title: Brainstorm — live sessions participating in the fleet
status: proposed
created_at: 2026-10-21
updated_at: 2026-10-21
related:
  - docs/plans/2026-10-21-fleet-performance-measurement.md
  - docs/plans/2026-10-21-fleet-task-execution-brainstorm.md
tags: [brainstorm, agent, workflow]
needs_design: true
run_id: b0d3dc58-abc9-4525-b8a5-17f52dddbd63
---

# Brainstorm — live sessions participating in the fleet

## 1. Overview

An existing session can already join as a guest with role, PID and host session identity, pull its
inbox and reply. Guests intentionally cannot satisfy role selectors or receive attested workflow
stages. A Stop hook can hand off messages at a turn boundary; it is not a universal wake channel.
See `apps/cli/src/commands/agent/join.ts:49`,
`docs/design/inter-agent-control-plane.md:268` and
`plugins/sp/scripts/hooks/fleet-guest-stop.ts:163`.

The performance aim is to borrow an already-ready session without an extra model/process startup,
and to make such capacity usable without duplicate work, missing results or human-session interference.
Existing interactive context may help or hurt; compare it explicitly rather than counting a live PID
as a speedup. First batch: Codex, Claude Code and Pi. Grok Build and Antigravity CLI are deferred
capability probes. The [shared KPI contract](2026-10-21-fleet-performance-measurement.md) owns evidence.

## 2. Approaches

### B1 — strengthen cooperative guests only

Keep concrete guest addressing and explicit inbox pulling. Improve join identity, background lease
renewal, lifecycle reporting and the existing skill/hook behavior. Work remains explicit message
requests, with no automatic capability-gated stage assignment.

Pros: smallest change, already familiar, portable pull fallback; a useful independently shippable
increment. Cons: does not increase automatic fleet stage capacity; model/tool round trips for
waiting and replies can offset saved startup; busy or idle unsupported hosts may not wake promptly.

Implementation: distinguish the actual agent PID from the short-lived join CLI PID; bind session,
project and join generation, renew while both waiting and working, and provide explicit leave.
Treat delivered as transport handoff, not completed work. Do not imply expiry recovers an already
delivered request's unfinished side effects.

Evidence: `apps/cli/src/commands/agent/join.ts:32` defaults PID to the CLI process;
`apps/cli/src/commands/agent/wait.ts:47,63,82` heartbeats and settles handoff;
`packages/app/src/services/fleet-guest-service.ts:16,245` defines lease/expiry behavior;
`packages/domain/src/dao/project-claim-dao.ts:19` defines the shared 30-second TTL.

### B2 — cooperative registration plus verified member binding — recommended

Deliver B1 first. Then let a cooperating session explicitly offer execution capacity to an existing
declared fleet member after proving identity, required capabilities and the shared task-turn contract.
The declared member keeps its stable inbox; its bound occupant may be supervised or attached.
A guest remains a guest until that handshake succeeds.

Pros: reuses warm human-operated sessions for automatic work; keeps declared role routing stable;
shares receipts and measurements with track A. Cons: busy-state coordination, capability proof,
ownership transfer and crash recovery are more complex than registration; arbitrary TUI instances
without a supported integration remain message-only.

Proposed lifecycle:
1. Opt in from the target session using the existing participation skill/command entry.
2. Register project/member/session/process identity, supported delivery/result channels and role.
3. Prove relevant executor, model/policy, workspace, tooling and required capabilities. Self-declared
   role or PID cannot satisfy a capability gate. Use existing attestation ownership.
4. Bind one idle declared member under a fenced lease/generation. Do not add guests to role-selector
   results; promote only through the declared member's occupancy boundary.
5. Advertise ready/busy/blocked/draining independently of process liveness. Accept one turn at a time.
   Human work owns the session until explicitly yielding; do not inject a fleet task mid-turn.
6. Claim work through the durable inbox, establish execution identity and native/cooperative turn ID,
   stream progress, validate required artifacts and record completion through A's shared receipt.
7. Continue heartbeats during work, stop offering capacity on disconnect/expiry, reconcile ambiguous
   work, and release ownership on leave. Detaching does not kill a human-owned process.
8. Any fallback to supervised execution first fences/detaches the old occupant and reconciles active
   work. If its write side effects cannot be ruled out, hold for recovery rather than spawn a duplicate.

This is a proposed boundary change, not current supported behavior.
Evidence: `packages/app/src/services/fleet-selector.ts:22,39`;
`packages/app/src/services/fleet-guest-service.ts:139`;
`packages/app/src/workflow/fleet-work-item.ts:62`;
`docs/design/inter-agent-control-plane.md:286,299`.

### B3 — direct protocol attachment where a reachable endpoint exists

Attach through a host's explicitly exposed protocol endpoint and bind native session/turn identities.
Use this as an optional B2 adapter, not an alternative untracked IPC bus or mandatory new daemon.
A process launched in RPC/stdio mode is not thereby attachable from an unrelated process; attachment
requires a reachable supported endpoint or an in-session bridge.

Pros: structured turn control and progress can reduce pull-tool/model round trips; better visibility
than hooks alone. Cons: an arbitrary existing TUI may expose no such endpoint; version and ownership
rules differ by host; taking over the terminal or sending synthetic keystrokes violates project rules.

Codex App Server is a candidate only when the session exposes a supported reachable connection;
starting a new App Server or resuming a stored thread does not prove attachment to the same live
interactive process. Claude's streaming subprocess and Pi's stdio RPC support controlled warm
workers, not universal PID-based attachment. Use B1 pull mode when the actual live session lacks
an integration. Do not develop terminal scraping, PTY takeover or a second message transport.

Sources checked 2026-10-21:
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): connection initialization, native
  thread/turn operations and terminal events; host/version attachment still needs a spike.
- [Claude streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode):
  persistent controlled sessions; it does not establish arbitrary interactive process attachment.
- [Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md):
  commands over subprocess stdin and events on stdout.
- [Claude Stop hooks](https://code.claude.com/docs/en/hooks#stop): continuation at a Stop boundary.

## 3. First-batch participation matrix

| Host | Portable baseline | Optional acceleration | Proof required before automatic stage work |
| --- | --- | --- | --- |
| Codex | explicit join/pull/reply skill in a cooperating session | supported App Server connection; hook only after host/mode probe | session identity, same-process ownership, turn result and capability handshake |
| Claude Code | explicit join/pull/reply skill | existing Stop hook; native integration only where supported | working-time heartbeat, busy arbitration, fresh review and result correlation |
| Pi | explicit join/pull/reply skill | installed-version extension or RPC bridge where reachable | exact binary identity, ready/busy and command-versus-turn completion |

No claim that all hosts can wake an idle arbitrary session from a PID. Probe interactive and headless
modes separately. The repository's Codex Stop spike tested 0.160.0, whereas this session observes
0.163.0; old failure is evidence to re-test, not a current-version verdict.
See `docs/plans/2026-10-05-codex-guest-spike.md:12`.

Skills/slash commands express intent; hooks report or hand off at safe supported boundaries;
durable inboxes carry requests; the shared execution contract owns completion. Generated adapters
must be installed through Superskill, not hand-maintained per platform.

## 4. Proposed work packages and dependencies

These are planning packages, not created task records.

| Order | Package / owner | Observable acceptance |
| --- | --- | --- |
| B0 | Host-mode capability spikes / integration | Codex, Claude Code and Pi each have supported/unsupported evidence and exact binary provenance |
| B1 | Guest lifecycle hardening / Spur | a 90-second active job survives the 30-second lease through independent renewal; crash/leave releases ownership |
| B2 | Existing join/pull skill and generated adapters / plugin | all three agents process a bounded request and reply; hook absence still works |
| B3 | Fenced binding handshake / Spur | one occupant per declared member; wrong session/project/role/capability and stale generation refused |
| B4 | Shared stage execution / Spur + A contract | accepted work completes with validated artifacts and receipt; no guest-by-role bypass |
| B5 | Human/fleet arbitration / host integration | busy session is not assigned; yield/interrupt/leave semantics are explicit |
| B6 | Mixed-fleet E2E receipt / shared driver | attached and supervised agents share tasks without duplicate writes, false success or quality loss |

B1 and B2 can proceed as useful guest improvements without waiting for the whole of A.
B3–B6 require A's correlated lifecycle and verified native/cooperative result boundary.
Do not make live participation require a new always-on service when the existing server/lease
owner can supply the lifecycle. Any host extension remains capability-probed.

## Design Summary

Recommend B2 with B1 as its first increment and B3 only where the host exposes an appropriate channel.
Keep member identity/inbox stable; represent attached execution as a verified, leased occupant.
Role/PID registration is discovery metadata, not execution permission. Reuse track A's acceptance,
completion, artifacts, cancellation and fencing. Preserve human control, independent reviewer context,
one writer per worktree and existing durable messaging. New occupancy and capability boundaries
make `needs_design: true`.

## 5. Verification and performance decision

Write failure scenarios before implementation. Produce repeatable E2E receipts for join/rejoin,
working longer than TTL, detached CLI PID, PID reuse, wrong project/session, two joiners racing,
missing hooks, idle wake, busy work, delayed completion after lease transfer, loss of connection after
acceptance, permission/operator wait, leave during work and process death. Never report a delivered
message or live PID as completed work.

Compare attached-ready versus supervised-cold and supervised-warm on identical tasks. Count attach
handshake, pull-tool calls, retries and context growth. If B adds no material latency/throughput gain
against warm supervised workers, retain it for operator convenience and do not claim a performance
win or expand its scope. Resource and quality guardrails remain mandatory.

## 6. Recommendation and handoff

Proceed with B2 incrementally alongside A. Automatic participation depends on A's reliable task-turn
receipt; guest reliability and capability probes can begin earlier. Defer universal arbitrary-process
attachment, remote fleet networking and new public CLI verbs. Extend existing surfaces only after
the design review establishes the concrete consent scope.

Batch 2 covers Grok Build and Antigravity CLI: use generic join/pull behavior where a cooperating
session can execute it, retain verified resume/one-shot task fallback, and probe exact transport,
hooks and terminal-result support before adding native adapters. The runner record marks Antigravity's
capabilities unverified on its probing host; do not advertise readiness from that record alone
(`node_modules/@gobing-ai/ts-ai-runner/src/agents/shims.ts:569`).

Operator approach selection is pending at the idea-eval gate; no live session was joined in this work.

