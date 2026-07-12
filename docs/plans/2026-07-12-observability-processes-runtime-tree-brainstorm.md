---
date: 2026-07-12
topic: observability-processes-runtime-tree
needs_design: true
status: approved
recommended_approach: process-inventory-service-flat-rows
task_wbs: "0243"
---

# Brainstorm: Observability Processes → serve-rooted runtime tree

## Overview

The Spur Board **Observability → Processes** tab is empty for most operators because it only lists
`SupervisorService`-managed team agents (`GET /api/team/processes`), which exist only after
`SPUR_TEAM_AUTOSTART` or `spur team start`. That matches feature **G2** (team supervision) but fails
as a **daily runtime surface**.

**Destination:** Refactor Processes into a read-only inventory of the **spur serve process and all
descendants**, with OS-sourced metrics and a light registry overlay for Spur semantics (supervisor
agent ids, source labels). Team control APIs stay separate.

## Decision Tree (Phase 1 — locked)

### Root: What should Processes primarily show?

- **Resolved:** Spur runtime process tree (serve + descendants)
- **Rationale:** Board is open while serve runs; daily value without requiring team autostart. CLI
  `spur task` / `spur agent` outside the serve tree deferred (documented host-scan follow-up).

### Branch: Discovery + enrichment

- **Resolved:** OS tree walk from serve PID + registry overlay
- **Rationale:** Catches children even if they skipped ProcessExecutor; supervisor/executor maps add
  labels. OS supplies pid/ppid/rss/etime/command.

### Branch: API placement

- **Resolved:** New `GET /api/observability/processes`
- **Rationale:** Observe vs control. Keep `GET /api/team/processes` + start/stop/stdin/stream for G2.

### Branch: v1 columns

- **Resolved:** Core ops set — pid, ppid, source, name/label, command (truncated), status, RSS,
  duration/uptime, startedAt. Threads/CPU deferred.
- **Rationale:** Daily usefulness without macOS/Linux thread-count branching.

### Branch: ProcessExecutor depth

- **Resolved:** Overlay only what we already have (SupervisorService + optional pid match)
- **Rationale:** Do not block on ts-runtime live registry; follow-up when spawn enforcement lands.

### Branch: Refresh + controls

- **Resolved:** Poll inventory (2–5s / focus); read-only UI; no start/stop/attach on this tab in v1
- **Rationale:** Matches current tab (no attach UI shipped); keeps task scope shippable.

### Branch: Platforms

- **Resolved:** macOS + Linux; fail loud elsewhere
- **Rationale:** Bun serve targets; parse `ps` with fixtures; no Windows v1.

## Approaches

### Approach 1: ProcessInventoryService + flat rows ⭐ Recommended

**Description:** Add `ProcessInventoryService` in `packages/app` that (1) walks the OS process tree
rooted at `process.pid` via a small platform helper (`ps` on macOS/Linux), (2) overlays
`SupervisorService.list()` by pid → `source=supervisor`, `label=agentId`, (3) marks the root as
`source=serve`. Mount `GET /api/observability/processes` on the server (new thin module or under an
existing observability routes home). Rewrite `ProcessListTab` to a sortable table over that DTO with
polling. Leave `/api/team/*` unchanged.

**Trade-offs:**

- **Pros:** Aligns with ADR-021 (logic in app package); testable parser + service with fixtures; tab
  always shows ≥1 row when Board talks to a live serve; clear observe/control split.
- **Cons:** Flat list needs `depth` or client-side indent from `ppid`; `ps` parsing is
  platform-sensitive; command-line heuristics for non-supervisor children are imperfect.

**Implementation notes:**

- DTO (illustrative): `{ processes: ProcessInventoryRow[]; rootPid: number; capturedAt: string }`
  where row has `pid`, `ppid`, `depth`, `source: 'serve' | 'supervisor' | 'descendant'`, `label?`,
  `command`, `status`, `rssBytes`, `elapsed`, `startedAt?`, `agentId?`.
- Parser unit tests with golden `ps` stdout fixtures (macOS + Linux column layouts).
- Empty/error: unsupported OS → structured 501/503 with message; serve-only with no children → one
  root row (not the current “No supervised processes” empty state).
- Web: replace empty-state copy; columns as locked; poll 3s default; cancel on unmount.
- Contracts: if board already uses hand-rolled fetch for team (it does), matching pattern is OK for
  v1; prefer contracts package only if other oRPC routes are the norm for new endpoints — check
  adjacent observability routes and match.

**Confidence:** HIGH — constrained by existing G2/J code and operator decisions (2026-07-12).

**Decision trace:** All Phase 1 locks.

---

### Approach 2: Nested tree DTO

**Description:** Same inventory service and endpoint, but response is a nested
`{ pid, children: [...] }` tree. UI renders recursive rows / expand-collapse.

**Trade-offs:**

- **Pros:** Natural parent/child UX; depth free.
- **Cons:** Global sort-by-memory awkward; harder to virtualize; more UI complexity for v1 value.

**Implementation notes:** Provide both tree and a flat projection, or flatten client-side — prefer
Approach 1 single flat list with `depth`/`ppid` if tree UI is deferred.

**Confidence:** MEDIUM — good UX later; not needed for first daily usefulness.

**Decision trace:** Same discovery/API/columns; differs presentation shape only.

---

### Approach 3: Server-local walker (no app service)

**Description:** Implement `ps` walk + overlay inline in `apps/server` route handler; minimal
`packages/app` change; tab switches endpoint.

**Trade-offs:**

- **Pros:** Smallest file count; fastest spike.
- **Cons:** Violates ADR-021 thin apps; harder reuse/test; drifts from Jobs/System Events patterns
  that keep domain logic out of transport.

**Confidence:** LOW for this monorepo’s architecture rules — reject unless emergency spike.

**Decision trace:** Same product scope; wrong layering.

## Recommendation

**Ship Approach 1.** It turns Processes into a useful default view whenever Board is connected,
preserves G2 control surfaces, and stays within locked scope (no host-wide CLI scan, no threads/CPU,
no ProcessExecutor registry rewrite, no team controls on the tab).

**Explicit non-goals (v1):**

- Host-wide inventory of shell `spur task` / `spur agent` not under serve
- Threads, %CPU columns
- Live ProcessExecutor global registry in ts-runtime
- Attach/stdin/start/stop UI on Processes tab
- Windows process walker
- Persisted process history / time-series

**Follow-ups (separate tasks):**

1. Host OS scan for external Spur CLIs (optional filter)
2. ProcessExecutor live registry overlay when enforcement is complete
3. Threads/CPU columns
4. Optional team control chips on supervisor rows
5. Nested tree UI polish

## Design Summary

| Item | Choice |
| --- | --- |
| Product | Read-only Processes inventory = serve PID tree + metrics |
| Data | OS walk (`ps`) + Supervisor overlay |
| API | `GET /api/observability/processes` (new); team API unchanged |
| App layer | `ProcessInventoryService` in `packages/app` |
| UI | `ProcessListTab` table; poll 2–5s; core columns |
| Platforms | macOS + Linux; fail loud else |
| G2 | Unchanged control plane; supervisor rows labeled in inventory |
| `needs_design` | **true** — new service + API + OS integration + UI rewrite |

### Spec self-review

- No TODOs/TBDs in requirements intent
- No contradiction with G2 (control stays on team routes)
- Scope not expanded to host-wide CLI scan
- Ambiguity remaining: exact route module home (`apps/server/src/modules/…`) and whether OpenAPI
  contract package is required — implementer matches adjacent observability endpoints

## Next Steps

1. Operator confirms Approach 1 (or overrides).
2. Create implementation task (feature link: **J** observability board; related **G2**).
3. Optional: `/sp:dev-refine` then `/sp:dev-run` for execution.
4. Same-commit `docs/04_DESIGN.md` surface note if API is user-facing (T3).
