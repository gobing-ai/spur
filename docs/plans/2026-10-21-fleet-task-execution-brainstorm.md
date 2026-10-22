---
kind: plan
title: Brainstorm — faster fleet task execution
status: proposed
created_at: 2026-10-21
updated_at: 2026-10-21
related:
  - docs/plans/2026-10-21-fleet-performance-measurement.md
  - docs/plans/2026-10-21-fleet-live-session-brainstorm.md
tags: [brainstorm, agent, workflow]
needs_design: true
run_id: 239ca033-d3f1-43b5-b6fa-02237dc489f3
---

# Brainstorm — faster fleet task execution

## 1. Overview

The fleet already keeps member loops alive and supports persistent, resume and one-shot session modes.
However, keyed task requests bypass persistent stdin so the shared run service can produce a durable
execution receipt. Thus a warm member does not imply warm task execution. The orchestrator also awaits
its conversational drain before scheduling. These are observed mechanisms; their latency contribution
is not yet measured. See `packages/app/src/services/agent-loop-service.ts:464,486,587`.

This track improves the existing task path first. The first batch is Codex, Claude Code and Pi, each
with an independently proved adapter and fallback. Live sessions consume the same contract in track B.
Grok Build and Antigravity CLI are second-batch candidates, not unsupported claims of parity.

The [shared KPI contract](2026-10-21-fleet-performance-measurement.md) owns metrics, proposed targets,
sample budgets, repeatable receipts, comparison controls and rollout order.

## 2. Approaches

### A1 — scheduling and startup improvements within current execution

Measure phases, separate conversational execution from deterministic scheduling, preserve precheck
executor pins and reduce demonstrably repeated initialization. Continue task execution through the
existing process/resume path. Do not spend effort replacing 100 ms ledger polling before measurement.

Pros: smallest blast radius; scheduling improves even if persistent integration is unavailable;
keeps existing receipt and fallback behavior. Cons: each task/stage still incurs process startup and
session reconstruction, so gains may be limited when those costs dominate.

Implementation: retain one scheduling owner and serialized tick/observe operations; conversation
execution must not hold its loop. Do not solve this merely by scheduling once before a blocking chat
call: later task arrivals must also dispatch while the conversation runs. Preserve existing
precheck doctor pinning rather than add a second cache. Use bounded invalidation when configuration
or executor health changes.

Evidence: `agent-loop-service.ts:587`, `system-event-follow.ts:31` under
`packages/app/src/services/`; `config/workflows/task-pipeline.yaml:231`.

### A2 — correlated persistent task turns, layered on A1 — recommended

Keep a live agent transport for each active declared worker, and execute keyed requests as correlated
turns through it. Reuse the task action's existing validation, artifacts, escalation, permissions and
terminal receipt machinery. Persist acceptance separately from validated completion.

Pros: directly addresses the persistent-task gap; supplies the same execution primitive needed by
attached workers; avoids separate headless and live-session accounting. Cons: protocol-specific
completion parsing, cancellation and recovery require real E2E proofs; warm memory and conversation
growth need bounds; SDK/API availability varies by installed version.

Implementation:
- Put reusable process/protocol mechanics in ts-ai-runner; consume a released compatible facade in
  Spur after external work is separately authorized. Do not vendor a duplicate runner in Spur.
- Bind Spur execution ID to native session/thread/turn identity and occupant generation. A request ID
  or successful stdin write is not task completion.
- One active task turn per worker initially; readiness and bounded pending work prevent hidden
  overlapping writers. No general-purpose worker-pool framework is needed.
- Keep existing task-stage contract checks in `runFleetWorkItem` /
  `AgentRunActionRunner`; a transport swap must not bypass them.
- Construct each process using the resolved executor's model/provider/reasoning, tool and permission
  policy. Reuse only when those settings, workspace and role remain compatible.
- Preserve coder affinity for related remediation; use fresh reviewer conversations. Process reuse
  never authorizes reuse of implementation context for independent review.
- Capability failure falls back before acceptance to verified resume-by-ID, then one-shot. An
  ambiguous post-acceptance disconnect is reconciled; never blindly replay a writing turn.
- Drain output continuously with bounded redacted persistence; do not block agent output on UI speed.
  Deliberately close idle processes and reset poisoned/oversized sessions with an evidence record.

Local evidence: `packages/app/src/services/member-session.ts:215`;
`packages/app/src/workflow/fleet-work-item.ts:88`;
`packages/app/src/workflow/actions/agent-run.ts:798,1102`;
`config/workflows/task-pipeline.yaml:678`;
`node_modules/@gobing-ai/ts-ai-runner/src/team-agent-process.ts:122`.

### A3 — reduce orchestration and context work after profiling

Measure and remove redundant model-driven lifecycle work, repeated broad repository discovery and
oversized stage inputs. Pass compact evidence/artifact pointers between stages while preserving
necessary context. Explore deterministic entry into the existing workflow engine for recognized
fleet task requests, so an outer model need not interpret a lifecycle command merely to launch it.

Pros: can improve total task time when model/tool round trips dominate; benefits all agents,
including second-batch resume/one-shot transports. Cons: premature context trimming can increase
mistakes/retries; changing the outer entry risks duplicating pipeline lifecycle logic.

Implementation: reuse the workflow engine, never create a second pipeline executor. Compare phase
timings and actual prompt/tool work before selecting changes. Keep required checks and reviewer
independence. Model/reasoning changes are a separate controlled experiment rather than an unmeasured
default downgrade. Worktree/read-only concurrency is an existing throughput tool, not a new scheduler
redesign in this track.

Evidence: `packages/app/src/services/strategy-runtime.ts:500` dispatches a `/sp:dev-run` directive;
`packages/app/src/workflow/actions/agent-run.ts:1102` owns traced stage dispatch.
Whether an avoidable extra model turn occurs in each real execution remains to be measured.

## 3. First-batch compatibility plan

| Agent | Persistent transport candidate | Completion contract and fallback |
| --- | --- | --- |
| Codex | App Server stdio, initialize once, native threads/turns | correlate turn terminal status and artifacts; verified exec-resume/one-shot fallback |
| Claude Code | existing stream-json CLI input/output shim; use documented SDK semantics as reference | distinguish final result success/error from partial output and process exit; resume/one-shot fallback |
| Pi | existing RPC shim, JSON records over stdin/stdout | distinguish command acceptance from terminal agent activity; correlate serialized turns; session/one-shot fallback |

Sources checked 2026-10-21:
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): initialize, thread/start or resume,
  turn/start and turn/completed. The installed executable must pass a version-specific spike.
- [Claude streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode):
  persistent input and result messages. SDK documentation establishes feasibility, not that the
  installed CLI shim already supplies the complete correlated task contract.
- [Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md):
  long-lived RPC, command responses and streamed session events.
- Installed shim records: `node_modules/@gobing-ai/ts-ai-runner/src/agents/shims.ts:533`;
  persistent framing: `packages/app/src/services/member-session.ts:147`.

No new SDK dependency is assumed; use the existing CLI transports when they meet the contract.
Do not globally disable hooks, skills, security or project instruction discovery to claim faster
startup. Such a change would remove functionality the fleet depends on.

## 4. Proposed work packages and acceptance evidence

These are planning packages, not created task records.

| Order | Package / owner | Observable acceptance |
| --- | --- | --- |
| E0 | Shared phase baseline / Spur observability | reproducible cold/resume receipt per first-batch agent; missing timings explicit |
| E1 | Conversation-independent scheduler / Spur loop | queued task dispatches during a held 30-second chat; no duplicate owner/tick |
| E2 | Correlated task-turn facade / ts-ai-runner | acceptance, result, failure, interruption and uncertain disconnect remain distinct |
| E3 | Claude Code integration / runner + Spur | two keyed turns reuse process; one fresh review; artifacts and native result match receipts |
| E4 | Pi integration / runner + Spur | same proofs plus fragmented/interleaved RPC records and exact binary provenance |
| E5 | Codex integration / runner + Spur | same proofs plus native thread/turn identity and reconnect behavior |
| E6 | Unified keyed dispatch / Spur action/loop | workflow-stage contracts, output stream and lineage remain intact under all adapters |
| E7 | Real-agent comparison / shared E2E driver | paired latency, throughput, token/resource and quality receipt; no fabricated gain |

E0–E7 are work-package identifiers; A1–A3 above identify alternative approaches.
Resolve external runner work before integrating the facade; one writer per worktree throughout.
Existing helpers, exports, fixtures, tests and their callers must be inspected when tasks are refined.

## Design Summary

Recommended A2 includes A1 as its first delivery increment. Transport persistence and conversation
affinity are separate decisions. The existing workflow engine remains lifecycle authority; native
turn completion feeds its current artifact validation and durable receipt boundary. Automatic
dispatch retains write leases, owner epochs, exact request identity, cancellation and failure
semantics. Review starts fresh even in a warm process. Track B reuses this contract instead of
inventing a second execution path. Cross-package transport changes make `needs_design: true`.

## 5. Risks and verification

Write behavior/failure cases before implementation and prioritize repeatable E2E receipts:
partial/malformed events, accepted-then-crashed turn, duplicate/late terminal event, stale generation,
timeout/cancel with active tools, quota/auth refusal, permission/operator wait, process exit between
turns, poisoned session, changed executor policy and fresh reviewer isolation. Confirm a lost
terminal event cannot produce success or automatic duplicate side effects.

Proposed performance thresholds are in the shared contract. Real-agent trials remain pending.
Warm-task correctness must pass before making persistence the preferred supported mode.

## 6. Recommendation and handoff

Proceed with A2, beginning with baseline and A1. Defer A3's broader context/orchestration changes
until measurements identify a worthwhile saving; preserve a candidate package in the backlog.
Batch 2 applies generic scheduling/measurement gains to Grok Build and Antigravity CLI and probes
exact resume/structured-result capabilities before enabling persistent or attached stage execution.

The idea run requires idea-eval review before feature/task planning. Operator approach selection is
pending. No feature, task or implementation is claimed by this discovery artifact.

