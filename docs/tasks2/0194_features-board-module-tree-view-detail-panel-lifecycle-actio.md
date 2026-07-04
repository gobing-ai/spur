---
template: feature-impl
schema_version: 1
name: "Features board module: tree view, detail panel, lifecycle actions, check runner"
description: ""
status: todo
type: task
profile: standard
feature_id: F8
parent_wbs: null
priority: P2
tags: ["approach-c", "board", "web"]
dependencies: []
created_at: "2026-07-03T23:35:28.257Z"
updated_at: "2026-07-03T23:43:58.329Z"
---

## 0194. Features board module: tree view, detail panel, lifecycle actions, check runner

### Background

Cycle position P5 (docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). The server already has a `feature` module (`apps/server/src/modules/feature/`) and SSE already carries feature.created/updated/transitioned events; the web board has the auto-discovery module contract (`docs/help/how_to_add_a_new_ui_module.md`) with task-kanban as the reference. This task adds the `features` web module: a tree view mirroring the `docs/features/INDEX.md` ID hierarchy with status badges, a detail panel (frontmatter, Goal, Scope, rendered Gherkin AC, linked-tasks table), lifecycle status transitions routed through the server feature module so guards apply (denial reasons surfaced, not swallowed), and a `feature check` runner displaying per-layer L1–L4 findings.

Server work is limited to whatever read/action endpoints the existing feature module lacks (audit first — the module already serves the kanban's feature filter). This is deliberately a small, self-contained board win scheduled after the board becomes the daily driver (P3) and independent of the infra chain (P2/P4/P6).

Dependencies: P1 Observabilities task only for consistency of module conventions (tab/data patterns), not functionally. UI imports go through the `apps/web/src/ui.ts` seam (ADR-025).

### Requirements
- [ ] R1 — Audit the existing server feature module's endpoints; add only what the board needs (list with hierarchy+status, detail body, transition action, check runner) — record the delta in Design before coding.
- [ ] R2 — Web module `features` under `apps/web/src/modules/` (auto-discovered `WebModule`, zero manual wiring): tree view mirroring the ID hierarchy with status badges live-updated from feature SSE events.
- [ ] R3 — Detail panel: frontmatter fields, Goal, Scope, Acceptance Criteria rendered from the Gherkin block, and the linked-tasks table with links into the Task Kanban detail.
- [ ] R4 — Status transition UI driven through the lifecycle-guarded server update; a guard denial shows the reason and leaves the tree unchanged.
- [ ] R5 — Check runner: trigger `feature check` for the selected feature from the panel; findings grouped by layer (L1–L4) with severity styling.
- [ ] R6 — Tests: module discovery, tree building from a fixture corpus, transition denial surface, check-findings rendering; server endpoint tests for any new routes.
- [ ] R7 — Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`; manual board pass over the live corpus.
### Acceptance Criteria
```gherkin
Feature: Features board module

  Scenario: Feature tree renders with live status
    Given features exist in docs/features
    When the operator opens the Features module
    Then the full ID tree renders with status badges matching each feature's frontmatter

  Scenario: Detail panel shows the feature body
    Given the feature tree is rendered
    When a feature node is clicked
    Then Goal, Scope, Acceptance Criteria, and linked tasks render in the detail panel

  Scenario: Status transitions go through lifecycle guards
    Given a feature detail panel is open
    When the operator selects a new status
    Then the server persists it via the lifecycle-guarded update and the tree reflects the new status

  Scenario: Guard-denied transitions surface the reason
    Given a feature whose target transition is denied by a lifecycle guard
    When the operator attempts that transition
    Then the board shows the denial reason and the feature status is unchanged

  Scenario: Feature check runs from the board
    Given a feature detail panel is open
    When the operator triggers a check
    Then findings display grouped by layer with their severity
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** A small, self-contained board win: web module `features` over the EXISTING server feature module (`apps/server/src/modules/feature/`) + `FeatureService` in `packages/app` (all corpus logic already lives there — the server stays thin, ADR-021). SSE already streams `feature.created|updated|transitioned`, so live updates are free.

**Server audit first (R1).** Enumerate what the feature module already serves (it at least backs the kanban's feature filter) and record the delta HERE before coding. Expected additions (verify, don't assume): detail body (frontmatter + sections), transition action (must route through the lifecycle-guarded `FeatureService.update` — `TransitionDenied` maps to a structured error carrying the guard report, not a 500), and `POST /api/features/:id/check` returning findings grouped by layer (L1–L4) with severity (the service's check API exists — `spur feature check` uses it).

**Tree (R2).** Hierarchy is ID-derived, same rule the corpus uses everywhere: children of `X` = ids with `length === X.length + 1 && startsWith(X)`. Build client-side from the list endpoint; status badges from frontmatter; subscribe `feature.*` on the existing EventSource for live updates. Do NOT parse `INDEX.md` — derive from data, the index is a generated artifact.

**Detail panel (R3).** Frontmatter fields, Goal, Scope, rendered AC (strip the ```gherkin fence, render scenario blocks with Given/When/Then styling — presentational parse only, NO validation logic client-side), linked-tasks table with WBS links into the Task Kanban detail route.

**Transition + check UX (R4, R5).** Status select → PATCH; on `TransitionDenied` show the reason (toast/inline) and leave the tree unchanged. Check button → findings list grouped by layer with severity styling. Both are read-after-write consistent via the SSE event or explicit refetch.

**Constraints.** UI imports via `apps/web/src/ui.ts` only (ADR-025). Auto-discovery module contract (`docs/help/how_to_add_a_new_ui_module.md`) — zero manual wiring. If a markdown renderer enters for the body, share whatever 0191 adopted (one seam entry, not two renderers).

**Testing (R6).** Tree building from a fixture corpus (nesting, badge mapping); transition-denial surface; check-findings rendering; server tests for each new route (in-memory SQLite + temp features dir, per feature-module test conventions).

**Decomposition guidance.** Single task. Optional split only if the server delta from R1 is unexpectedly large: A = server routes, B = web module.

**Dependencies.** 0189 for module conventions only (not functional). Independent of 0190/0192/0193/0195. Schedule after 0191/0192 per Approach C (P5), but nothing blocks doing it earlier if the board track has slack.
### Plan
- [ ] Audit existing feature-module routes; record the delta table in Design (R1).
- [ ] Add missing server routes: detail body, lifecycle-guarded transition (guard report in the error), check runner; endpoint tests (R1, R4, R5).
- [ ] Web module `features`: WebModule export + ID-derived tree with status badges + `feature.*` SSE live updates; discovery + tree tests (R2).
- [ ] Detail panel: frontmatter, Goal/Scope, fenced-Gherkin presentational rendering, linked-tasks table with kanban links (R3).
- [ ] Transition UI with denial-reason surface; check UI with per-layer findings; component tests (R4, R5).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R7).
- [ ] Manual board pass over the LIVE corpus: browse tree, open this task's feature (F8), run check, attempt a guard-denied transition; record evidence in Testing.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

F8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
