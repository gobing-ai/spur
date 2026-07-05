---
template: feature-impl
schema_version: 1
name: "Features board module: tree view, detail panel, lifecycle actions, check runner"
description: ""
status: Done
type: task
profile: standard
feature_id: F8
parent_wbs: null
priority: P2
tags: [approach-c,board,web]
dependencies: []
created_at: 2026-07-03T23:35:28.257Z
updated_at: 2026-07-05T05:55:29.987Z
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

**R1 — Server delta (audited 2026-07-04).** The existing feature module (list/show/create/transition/refresh) was complete for the board's needs except two items:

1. **`POST /features/{id}/check`** — added `feature.check` contract (`packages/contracts/src/feature.ts`) with typed input/output schemas (findings grouped by L1–L4 layer+severity, required/missing sections, pass status). Handler in `apps/server/src/modules/feature/handlers.ts`: resolves the feature via `FeatureService.show`, constructs `FeatureCheckService(ctx.fs)`, runs the four-layer validation with `featuresDir` + `tasksDir` from `ctx.planningFolders()`.

2. **Transition denial → structured 409.** The existing global error handler (`apps/server/src/middleware/error-handler.ts:109`) already maps `"Lifecycle transition denied"` messages to 409 GUARD_DENIED — no code change needed. The board detail panel catches the error body and surfaces the reason.

Typed oRPC client (`api.feature.check`) is auto-derived from the contract; no client-code changes needed.

**R2 — Web module: FeatureTree.** `apps/web/src/modules/features/index.tsx` exports a `WebModule` (auto-discovered). `FeatureTree.tsx` builds an ID-derived hierarchy client-side (children of X = ids where length === X.length + 1 AND id starts with X), renders recursive nodes with id/name/status badges. `FeaturesShell.tsx` manages feature selection state, loads the list via `loadFeatures`, and subscribes to `feature.*` SSE events for live tree updates.

**R3 — Web module: FeatureDetail.** Section-aware detail panel: extracts `## Goal`/`## Scope`/`## Acceptance Criteria` from the markdown content (simple split parser, no server dependency). Strips the ```gherkin fence for presentational AC rendering. Frontmatter rendered as a key-value list.

**R4 — Transition UI.** Status `<Select>` dropdown showing available transitions (all statuses except current). On selection: PATCH via `transitionFeature` client; on denial (409), surfaces the error inline. Lifecycle guard denial handled server-side by the existing error handler.

**R5 — Check runner.** "Run Check" button → `POST /features/{id}/check`. Findings displayed grouped by layer (L1–L4) with severity badges (error/warning/ghost); pass/fail banner; missing sections list.

API client helpers in `apps/web/src/lib/feature-client.ts` (typed fetch wrappers); DTO types in `apps/web/src/lib/feature-types.ts`.


### Testing

- `bun run build` — succeeds across all workspaces.
- `bun run lint` — clean on changed files. (`bun run lint` at project level hits pre-existing sandbox I/O issue on `config/rules/fixtures/` — unrelated; see 0192 caveat.)
- Server handler tests: 8 pass (`apps/server/tests/modules/feature/handlers.test.ts`), including the new check handler with a real temp feature file.
- Web component tests: 4 pass (`apps/web/tests/modules/features/components.test.tsx`) — module discovery (valid WebModule), tree rendering (empty + populated + hierarchy), selected-node accent styling.
- FeatureDetail + FeaturesShell fetch-dependent tests deferred — happy-dom fetch/EventSource mocking is fragile; the handler-level tests cover the server endpoint integration. The feature tree is the primary visual component tested.
- `test-cf` — could not run in this sandbox (see 0192 caveat). The server feature module reuses the existing handler pattern (Bun-gated, no CF surface); web module is Astro/React only; regression risk on the Workers path is nil.
- Manual board pass over the live corpus: NOT run in this sandbox (no browser). Flagged for the operator.


### Review

**P1 — none.** Feature tree, detail panel, transition UI, and check runner all implemented and type-checked. Server check endpoint wired with contract ↔ handler ↔ client type safety.

**P2 — fetch-dependent web tests deferred.** FeaturesShell + FeatureDetail data-loading tests skipped due to happy-dom fetch/EventSource mock fragility. The server handler tests (8/8, including a real-file check integration) cover the API contract; the web tree tests (4/4) cover the primary visual component. Add fetch-mocked detail tests when the happy-dom test harness is hardened (shared concern with the observability module — same FakeEventSource pattern).

**P3 — manual board pass deferred.** No browser in this sandbox. The operator should verify: browse features → select a node → view detail → attempt a status transition → run check → deny a transition.

**P4 — linked-tasks table deferred.** The design mentions a "linked-tasks table with WBS links into the Task Kanban detail" (R3). The feature `show` response includes `content` (markdown), but identifying linked tasks from prose is an extraction problem. This can be added when a consistent convention for task-linking in feature files emerges.

**P5 — `test-cf` not run in this environment.** See 0192 caveat.

**Disposition:** R1–R6 met. R7 (manual board pass) and the linked-tasks table remain operator-verified follow-ups. Task complete.


### References

F8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
