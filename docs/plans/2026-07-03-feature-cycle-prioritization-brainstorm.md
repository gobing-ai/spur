---
date: 2026-07-03
topic: Next feature cycle — prioritization and sequencing
command: /sp:dev-brainstorm (detailed depth, 7 questions asked, 3 options)
needs_design: true
status: awaiting-operator-review
---

# Brainstorm — Spur Next Feature Cycle: Prioritization & Sequencing

## Overview

Operator proposed 7 work items (Observabilities module, Features module, Inbox/IPC, embedded job
queue, team-mode launch/attach, Workspace module, init fix) and asked for gap-finding plus a
prioritized execution order. Codebase exploration corrected the baseline significantly: the server
module system, SSE planning-event stream, task-kanban board, and job-queue *producer* wiring
already exist — the roadmap doc (02, updated 2026-06-15) is stale on all of these. Discovery
resolved 7 decisions; three sequencing approaches follow.

**Items added to the operator's list during discovery:**

| Added item | Why |
|---|---|
| F7 kanban parity closure (md editor, `estimated_hours`/`impl_progress`, action modal) | Open gaps from `docs/analysis/task-kanban-gap-analysis-v2.md`; board is otherwise near parity |
| Workflow-action server support (only `run` implemented; others 404) | Part of F7 gap 3; blocks board-driven pipeline use |
| A17 `spur task migrate` cutover verb | Service complete, verb unwired; it is the declared Phase 1.5 exit gate |
| `spur history report` implementation | Long-standing TODO marker; parked low |
| Roadmap/docs drift fix (02 says S/W waves "awaiting impl"; code shipped) | Constitution T5/T6 sync debt; cheap hygiene |

## Design Summary

The cycle is sequenced **Observabilities-first** (operator decision D2): ship a thin observability
window over surfaces that already exist (SSE event stream, `inbox_messages`), then use that window
while building the async infrastructure (job-queue worker, inbox IPC, team supervision), then close
the board surface (F7/A17, Features module), with Workspace designed early and implemented last as
the capstone (D3). One new schema object (`system_events`, capped — D5), one new execution
component (in-process job worker + scheduler start in `spur serve`, Bun-only — D6), one new
transport surface (server-mediated stdio attach streams, no PTY — D7), and one contract fix
(`spur init` owns the full canonical scaffold from its npm package; `/sp:spur-init` becomes a thin
adapter that calls it then adapts content — D1). `needs_design: true` — multiple subsystems, a
schema change, new modules, and a new transport are all touched; the Workspace ADR and the team
attach-stream design are the two pieces that must be designed before their build waves.

## Resolved Decision Tree

### Root: What does this cycle optimize for?
- **Resolved:** Observabilities-first, then infrastructure, then remaining board surface (operator override of the board-first recommendation).
- **Rationale:** The observability window pays for itself during the infra build — events/inbox visibility while debugging the worker, IPC, and supervisor.

### D1 — init fix shape
- **Resolved:** Ownership contract: `spur init` copies the full canonical scaffold from its npm package folder; `/sp:spur-init` calls `spur init` then adapts contents to the project. Today there is no clear cut and fresh projects get insufficient config files.
- **Depends on:** none (independent bug fix).

### D3 — Workspace position
- **Resolved:** Capstone, design-first. ADR + design doc written early so inbox/team/board modules grow workspace-shaped seams; implementation lands last.

### D4 — Observabilities v1 scope
- **Resolved:** Module shell + System Events tab + Inbox Messages tab only. Process List and Jobs tabs land *with* their infra (team supervision, job worker) inside the same module.
- **Depends on:** Root (obs-first).

### D5 — Event history source
- **Resolved:** Persisted capped `system_events` table via an EventBus tap in the server; retention pruning becomes the scheduler's first real consumer (insert-time cap until the scheduler lands). Live tail stays on the existing SSE stream.
- **Depends on:** D4.

### D6 — Job queue execution model
- **Resolved:** In-process worker inside `spur serve` (Bun path only; CF stays `NotConfiguredError`): flip `jobQueueEnabled`, add polling consumer loop + typed handler registry + scheduler start.
- **Depends on:** Root.

### D7 — Team attach/detach transport
- **Resolved:** Server-mediated stdio streams — supervisor owns child pipes; attach = SSE/WS subscribe on stdout/stderr + POST stdin. Headless agents only; no PTY/TUI in v1.
- **Depends on:** D6 (supervisor rides server lifecycle), inbox IPC (agent messaging).

## Approaches

### Approach A — Strict serial dependency chain

init fix → Obs v1 → job queue → inbox IPC → team supervision → Features module → F7/A17 → Workspace.

- **Trade-offs:** ➕ Lowest WIP and integration risk; every step consumes the previous one's output. ➖ Board cutover (F7/A17 — a declared roadmap exit) waits behind three infra waves; Phase 1.5 stays formally open for most of the cycle; board momentum from the S/W waves goes cold.
- **Implementation notes:** Obs tabs are extended twice (Jobs tab at queue time, Process tab at team time) — same module, additive.
- **Confidence:** HIGH on order correctness (pure dependency topology, codebase-verified 2026-07-03); MEDIUM on cycle-level value delivery.
- **Decision trace:** Root, D1, D4, D5, D6, D7, D3.

### Approach B — Dual track (board ∥ infra)

Track 1 (web/board): Obs v1 → Features module → F7 parity + A17. Track 2 (server/infra): job queue → inbox IPC → team supervision. init fix first; tracks run in parallel via agent batches (`/sp:dev-parallel` / `sp:super-coder`); Workspace after both tracks merge.

- **Trade-offs:** ➕ Best wall-clock time; file sets are mostly disjoint (`apps/web` vs `apps/server`/`packages/app`). ➖ Highest WIP; Obs Jobs/Process tabs and inbox board views have cross-track integration points that can land out of order; parallel batches burn more operator attention per week.
- **Implementation notes:** Requires the parallel-execution machinery to be trusted for medium tasks; integration checkpoints needed where Track 1 consumes Track 2 APIs.
- **Confidence:** MEDIUM — parallel task fan-out exists (task 0141 ✅) but within-step Q&A is deferred (0142), which is exactly what cross-track integration questions would need.
- **Decision trace:** Root, D1, D4, D5, D6, D7, D3.

### Approach C — Milestone-weave ⭐ Recommended

init fix → Obs v1 → job queue enablement → **F7 parity + workflow actions + A17 cutover** (closes the Phase 1.5 exit early) → inbox IPC → Features module → team supervision → Workspace (ADR written back at the Obs-v1 stage).

- **Trade-offs:** ➕ Honors obs-first (D2) and still lands the board-cutover milestone mid-cycle, when it's cheapest (board is already near parity — the remaining F7 work is small); infra proceeds in dependency order (queue → inbox → team) with the observability window watching each. ➖ One context switch from infra to board work and back; team supervision lands late (acceptable — it's the largest and riskiest item, and D7's design benefits from the inbox + queue being real first).
- **Implementation notes:** The `system_events` insert-time cap migrates to a scheduled pruning job the moment the queue/scheduler wave lands — a designed hand-off, not rework. Workflow-action server support ships inside the F7 wave (same handler surface).
- **Confidence:** HIGH for positions 1–4 (bug fix + codebase-verified small waves); MEDIUM for the tail (team supervision size is estimated, not designed).
- **Decision trace:** Root, D1, D4, D5, D6, D7, D3 — fully compatible with all resolved decisions.

## Recommendation

**Approach C.** A beats nothing but defers a nearly-free milestone; B's parallelism premium isn't
worth the integration risk while within-step Q&A (0142) is still blocked — ironically on this very
cycle's team/inbox items. C keeps the operator's obs-first intent, sequences infra by real
dependency, and cashes in the Phase 1.5 exit (A17 cutover, "operator daily-drives the board") at
the mid-point instead of the end.

## Prioritized Backlog (the deliverable)

| # | Item | Size | Why here |
|---|---|---|---|
| P0 | **init ownership contract fix** (D1) — `spur init` ships full canonical scaffold from package; `/sp:spur-init` thin adapter | S | It's a bug on the front door of every new project; independent of everything else |
| P1 | **Observabilities v1** — module shell + Events tab (`system_events` capped table + tap + API + SSE live tail) + Inbox tab (D4/D5) | M | Operator strategy root; every later wave is debugged through this window |
| P2 | **Job queue + scheduler enablement** — worker loop, typed handler registry, scheduler start; first consumers: `system_events` pruning, then history import (D6) | M | Foundation for all async work; Obs Jobs tab lands here |
| P3 | **F7 parity + workflow-action server support + A17 `task migrate` cutover** | S–M | Closes the declared Phase 1.5 exit; board becomes the daily driver; cheapest milestone on the board |
| P4 | **Inbox/IPC enhancement** — message events on the bus, watch/push delivery, server message API; Obs Inbox tab upgrades to live (dep: P2) | M | The IPC substrate team mode and Workspace both consume |
| P5 | **Features board module** — web module over the existing server feature module | S | Cheap win; independent, slots after the board is the daily driver |
| P6 | **Team-mode supervision** — launch at `spur serve` startup, attach/detach via server-mediated streams (D7); Obs Process tab | L | Largest item; consumes P2 (lifecycle) + P4 (messaging); design doc first |
| P7 | **Workspace module** — ADR/design written during P1–P2; implemented last as composition of P4+P6+board modules (D3) | L | Capstone by operator decision; early design keeps seams workspace-shaped |
| P8 | Backlog: `spur history report`, roadmap/docs drift fix (02_ROADMAP S/W wave status), 0142 unblock check after P6 | S | Park; drift fix can ride any docs commit |

## Next Steps

1. Operator reviews this doc (user review gate — no downstream command has consumed it).
2. On approval: create the P0 task (`/sp:dev-brainstorm` `--task` equivalent: `spur task create`) or
   run `/sp:dev-plan` per item as each wave starts; P1 and P6 warrant `--feature` treatment (BDD AC
   from this decision trace).
3. Write the Workspace ADR during the P1–P2 window (D3).
4. Fix the 02_ROADMAP drift (S/W waves shipped) in the next docs commit.

## Spec Self-Review

No placeholders; no internal contradictions found; scope creep check: P8 items explicitly parked;
ambiguity check: team-supervision size flagged as estimate pending its design doc (P6 gate).
