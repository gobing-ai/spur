---
kind: design
title: Verified attached fleet occupants
status: proposed
created_at: 2026-10-21
updated_at: 2026-10-21
related: [G75, G74]
tags: [contract, G75, agent, workflow]
---

# Verified attached fleet occupants

## 1. Issue and scope

G75 selects B2: reliable cooperative guests first, then verified live-session capacity bound to
declared members. This proposed extension is unimplemented. Existing guests and hook behavior remain
owned by [inter-agent control](inter-agent-control-plane.md).
Automatic task participation consumes [G74 task-turn execution](fleet-task-turn-execution.md);
the [shared measurement contract](../plans/2026-10-21-fleet-performance-measurement.md) owns KPIs.

Current join records role/PID/session, guests remain outside declared role selection, and inbox
handoff settles delivered before task completion. The 30-second guest lease renews during wait and
Stop, leaving long work dependent on another renewal mechanism.
Evidence: `apps/cli/src/commands/agent/join.ts:32,49`;
`apps/cli/src/commands/agent/wait.ts:47,63,82`;
`packages/app/src/services/fleet-guest-service.ts:16`;
`packages/domain/src/dao/project-claim-dao.ts:19`.

## 2. Identity, ownership and state

Keep one stable declared member ID and inbox. An attached occupant has a distinct binding identity:
normalized project, member, host session, actual process fingerprint, executor/policy,
capability attestation, occupancy generation and lease owner epoch. A PID alone is metadata; verify
session cooperation and process birth/executable identity when the host exposes it. If identity
cannot be proved, retain explicit guest messaging and refuse automatic stages.

Do not change `resolveMember` (`packages/app/src/workflow/fleet-dispatch.ts`) to mix guests into role candidates. A verified attachment
occupies an existing enabled declaration; the declaration still determines role selection.
No unverified guest can satisfy `requiresCapabilities`.

Readiness states are ready, busy, blocked and draining. Process alive is not ready. A human turn
starts busy; only an explicit safe yield and completed capability handshake advertise ready.
One binding and one active task per member prevent duplicate writers.

## 3. Incremental guest reliability

The participation skill starts a bounded renewal owner in the existing host integration or a
parent-watched helper. Use the current lease DAO with its epoch fence; avoid a new daemon.
Renew at a bounded interval below the TTL, including during 90-second work with no inbox wait.
Stop renewal when session/process identity is lost, lease fencing fails or the operator leaves.

Mechanism (implemented, task 1279): `spur agent join` walks at most eight ancestors from its own
parent for the executor executable (`ps -o ppid=,lstart=,comm=`), records that fingerprint
(`pid`, `processStartedAt`, `executable`, `identity`) and — when the identity is verified — spawns a
detached copy of itself (`SPUR_GUEST_RENEWER=<guest-id>`) that runs `GuestLeaseRenewer` at
`TTL / 3`. The renewer stops on a missing record, a dead or reused agent pid, a lost fence, or a
12-hour lifetime cap. No new verb, flag, daemon or table: one extra optional record field set and
one detached process bounded by the agent's own lifetime. A transient ledger error skips a tick
rather than ending renewal.

Preserve existing guest join, wait and leave defaults. Record the actual agent process when supplied;
the short-lived CLI PID must not imply persistent agent liveness. Validate supplied identity; never
kill or take over an unrelated PID. Rejoin the same proven session idempotently; refuse collisions
from another identity. Leases and message claims remain separate.

Skills/slash commands express opt-in intent. Native host callbacks may accelerate delivery at safe
boundaries. The durable pull loop is the portable fallback and must work with hooks absent. Do not
poll by starting repeated model turns or terminal commands while the session is busy.

## 4. Binding contract on existing surfaces

The additive surface is `spur agent join --member <declared-member-id>`, alongside the existing
required role and optional session/PID/executor fields (implemented, task 1281; operator consent for
this one flag, no new noun or verb). Without `--member`, behavior stays guest-only. The binding is
fenced by occupancy generation + claim epoch, and `memberBinding.stageEligible` carries the binder's
host wake evidence from `bun run fleet-e2e --host-probe`.

Join with a member:
1. Resolve that enabled declared member in the current normalized project.
2. Validate role/executor/effective policy and a current host-mode capability proof.
3. Refuse a live owner, wrong session/project, unsupported delivery/result channel or attestation.
4. Acquire the existing member occupancy fence before exposing ready capacity. Persist discovery
   only after the lease/occupant identity is consistent; failed join leaves no orphan binding.
5. Publish a monotonic lifecycle observation under the same fence.

Bound pull resolves the caller's binding to the declared member inbox and validates the epoch on
claim, acceptance, completion and renewal. Guest-only pull still addresses its concrete guest ID.
`agent report` may update the member only when the host binding pin matches. Existing message
commands and InboxService remain the coordination path; add no private alternate broker.

Reuse FleetGuestService/coordination ownership where cohesive. If a separate binding service is
necessary, it must own the atomic transition and exact responsibility; do not leave dual writers.
Private discovery records can be versioned additively. Only introduce a migration when the existing
DAO cannot fence the member transition; justify it in the task before changing schema.

## 5. Work and human arbitration

A ready attached occupant claims one keyed request and starts G74's correlated turn with the member
pin. Preserve native acceptance, progress, validated terminal result and durable receipt separately.
A returned inbox batch is not completed stage work.

Human work and operator-answer waits take priority: advertise busy/blocked, keep new tasks queued,
and never inject fleet work mid-turn. Native steering can only implement an explicitly requested
interruption under the current task policy. Ordinary message arrival never authorizes interrupting
human work or discarding its context.

Graceful leave enters draining, stops new assignment and waits for or explicitly interrupts the
active fleet turn. A disconnect leaves possibly executed work outcome-unknown. Fence the old owner
and reconcile evidence before replacement. Detach never terminates a human-owned process.
A late completion from an old generation cannot release a new write lease or certify its task.

Guests stay concrete-address message participants. Stage-enabled attachments retain executor
attestation, worktree write controls and independent review policy; their role declaration alone
grants none of those capabilities.

## 6. First-batch capabilities and fallback

| Host | Required portable behavior | Optional acceleration, subject to exact-version proof |
| --- | --- | --- |
| Codex | in-session join/pull/work/reply | a reachable supported App Server connection; no inference from PID or stored thread |
| Claude Code | in-session join/pull/work/reply | existing Stop callback or supported bridge at safe boundaries |
| Pi | in-session join/pull/work/reply | installed-version extension or a reachable RPC bridge |

An existing RPC/stdio subprocess is not attachable from an unrelated process merely because its
PID is known. Starting a new process and resuming history is not attachment to a running human turn.
Probe interactive and headless modes separately. Keep unsupported cases message-only with an
actionable reason rather than silently promising automatic execution.

Official feasibility references checked 2026-10-21:
[Codex App Server](https://learn.chatgpt.com/docs/app-server),
[Claude hooks](https://code.claude.com/docs/en/hooks#stop),
[Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md).
No current hook/endpoint parity is asserted without installed-host evidence.
Generated capability adapters are installed through Superskill; do not hand-maintain generated files.

Grok Build and Antigravity CLI remain batch 2: qualify the exact executable, identity, renewal,
native result and supported wake behavior. Portable cooperative messages may be used without
asserting automatic task eligibility.

## 7. Verification, tradeoffs and compatibility

Before implementation, enumerate failure cases and add repeatable E2E scenarios for work beyond TTL,
PID reuse, foreign identity, competing binders, stale completion, crash after acceptance,
missing hooks, busy human work, blocked input and detach. Include both supervised and attached
occupants in the same receipt driver and compare against supervised-warm, not only cold startup.

B1-only guests cost less but do not supply automatic member capacity. Universal PID takeover is
rejected: identity does not expose a prompt/completion channel. B2 shares current declaration,
inbox and G74 validation boundaries, making its added complexity explicit. Native endpoint
attachment is an optional adapter rather than mandatory fleet infrastructure; see ADR-146.

