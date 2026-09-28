---
schema_version: 1
name: Render native downstream modules through one Board registry
status: todo
template: feature-impl
created_at: 2026-09-28T01:46:26.509Z
updated_at: "2026-09-28T01:51:42.577Z"
feature_id: A8
priority: P2
tags:
  - A8
  - board
  - downstream
estimate_hours: 8

ac_numbering: task-local
dependencies: ["0989"]
---

## 0990. Render native downstream modules through one Board registry

### Background

Built-in discovery is an eager Vite glob, registry modules/defaultModule exports are snapshots, and BoardApp creates a browser router once. Adding a filesystem root to registerModuleRoot cannot load a browser entry because that method is currently a no-op. This slice replaces consumer snapshots with one resolved registry and renders native contributions through the existing Board root.
Current seams: apps/web/src/modules/discover.ts:104; apps/web/src/modules/registry.ts:33,65,105; apps/web/src/router.tsx:21,66; apps/web/src/components/BoardApp.tsx:11; apps/web/src/components/BoardLayout.tsx:91,154. Upstream runtime proof and typed catalog are prerequisites, not current capabilities.
Rubric: E8 D1 L1 C1 R1 = 12; loader, router, sidebar and active-module layout share one UI review/rollback boundary.

### Requirements

- [ ] R1. Fetch the typed project catalog through the existing OpenAPILink client, resolve enabled native contributions and construct exactly one combined registry before creating the browser router. All sidebar/router/active-module consumers use that registry, retaining built-in landing behavior and retired redirects.
- [ ] R2. Import prebuilt ESM using the upstream host import map, apply explicit styles before displaying a contribution, and validate named webModule.apiVersion/components before registration. Use YAML metadata exclusively and support bare/deep native routes without rebuilding Spur.
- [ ] R3. Bound catalog fetch and each native entry/style load, contain load/export/version/render/right-panel failures per module, retain a visible error route and useful diagnostics, and keep built-ins navigable. Catalog failure falls back to built-ins with a visible catalog diagnostic.
- [ ] R4. Display an external native right panel only when supplied and preserve built-in layout, saved preferences, mobile menu/focus and project identity. Keep trusted native errors inside a boundary so they do not remove host navigation.
- [ ] R5. Preserve project-local isolation and restart/reload semantics: no live registry mutation, module HMR, custom React root, private Board SDK or process launch. Disabled modules produce no browser requests and no contribution evaluation.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Existing Board behavior remains with no external modules (req: R1; R4; R5)
  Given catalog is empty or the project has no external declarations
  When the Board opens its landing and built-in routes
  Then built-in landing, retired redirects, mobile navigation and saved panel preferences retain their established behavior

Scenario: AC2 — An installed Board renders a downstream React contribution (req: R1; R2; R4)
  Given an independently Vite-built valid native contribution is delivered by the real project catalog
  When the Board opens its bare/deep module route and interacts with it
  Then its component, styles, chunks and optional panel render inside the existing Board root using YAML metadata

Scenario: AC3 — Native contributions use the Board React runtime (req: R2; R5)
  Given the fixture has its own React installation and the shipped host mapping
  When the real composition path evaluates and renders its contribution
  Then hooks/context use the same host runtime and no private Board path is imported

Scenario: AC4 — Unsupported or failing contributions leave built-ins usable (req: R1; R2; R3; R5)
  Given one catalog/import/style/version/component/panel operation fails or times out
  When the Board completes composition and navigation
  Then the affected module has a bounded actionable error route, late results are discarded, and built-ins remain usable

Scenario: AC5 — External module layouts preserve accessible Board navigation (req: R3; R4)
  Given native contributions have or lack a right panel
  When the user navigates with keyboard or a narrow viewport and returns to a built-in
  Then panel visibility is correct, host navigation/focus works and saved built-in preferences are preserved
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-28T01:47:53.577Z

Closed decisions (2026-09-27): A8 follows ADR-128 and the accepted downstream-board-modules contract. Embedded YAML is the only selection/metadata authority; compiled native React is primary and iframe URLs use one Board-owned adapter. No required server entry or downstream backend procedure is introduced. v1 uses startup snapshots, restart and reload. The real installed shared-runtime proof precedes production composition; failure routes back to design rather than a renderer substitution.

Deferred with owner: the A8 feature owner handles any future messaging/data/theme bridge, live replacement, directory-hosted frames, split views or Worker filesystem support only after a concrete requirement. Exact Astro build wiring is the bounded runtime task's investigation, with frozen output and proof criteria; later tasks consume its delivered manifest rather than choosing another ABI. There are no unresolved product decisions in this task.

Prerequisite 0989 (including 0988 transitively): typed catalog, safe assets, validated metadata and shipped runtime ABI. Handoff to 0991: resolved registry/provider, contributionType layout seam and failure-safe shell; 0992 receives the real native path.

### Design

Accepted contract: docs/design/downstream-board-modules.md and ADR-128. A8 uses embedded bootstrap.modules declarations, Vite-built native ESM and a Board-owned URL frame adapter. Native modules have no required server entry. Configuration/build changes use restart plus browser reload. This task implements only its named slice; downstream server imports, external manifests, raw TSX compilation, Module Federation, process launching/proxying, live replacement and private Board SDK exports remain outside scope.

WHERE/OWNERSHIP: apps/web/src/modules/{registry,types,discover}.ts, proposed compose.ts and RegistryProvider.tsx, apps/web/src/router.tsx, components/BoardApp.tsx, LeftSidebar.tsx, BoardLayout.tsx and proposed ModuleErrorBoundary.tsx; use lib/rpc-client.ts. Inspect every registry consumer with rg before changing exports so all callers use the same instance. Keep existing createRegistry validation and built-in discovery. Remove obsolete private singleton use when all callers migrate; do not treat registerModuleRoot as an ESM loader.

FROZEN SEAMS: composeBoardModules(catalog,builtins) returns resolved WebModule entries plus diagnostics; createBoardRoutes(registry) returns route objects and createAppRouter(registry) constructs once; BoardRegistryProvider supplies useBoardRegistry to shell consumers. These are internal UI names, not public authoring exports. Extend host-internal module metadata minimally with contributionType:'builtin'|'react'|'iframe' where layout requires it; built-ins remain unchanged externally. Preserve a separately captured built-in default rather than allowing a low external order to replace /board's landing target. Sort external entries deterministically using configured order and id tie-breaker while retaining existing built-in ordering.

LOAD ALGORITHM: Fetch with the existing bounded client; match catalogVersion/contributionApiVersion to shipped capability. For each enabled react descriptor, begin a bounded style/import operation and collect settled outcomes so one failure cannot reject the whole batch. Set an internal NATIVE_MODULE_LOAD_TIMEOUT_MS=10000, passed as a seam for tests; bound stylesheet onload/onerror as well as import. Do not add a user-config flag for this initial bound. A timed-out ESM import cannot be canceled and may still evaluate trusted top-level code; discard its late result and never claim execution was sandboxed. Decode/validate export after evaluation, retaining a failure component with its metadata. Render through the existing Board router/root only. Import map is already emitted/injected by the runtime slice; no second runtime bundle.

FAILURE/UI: An accessible diagnostic names module id and failure category, with reload guidance and navigation intact; redact internal paths from user-facing payloads. Wrap external component and optional panel rendering. Explicit CSS must complete before successful module display; isolate CSS by authoring convention, not an invented runtime CSS sandbox. Native contributions with no panel get no empty right-panel surface; distinguish built-ins so their current preferences remain intact. Catalog-empty and catalog-failed paths both build a valid built-in router.

DEPENDENCIES/HANDOFF: Consume the preceding catalog schema and safe URLs, and the proof's exact supported runtime mappings. Leave a registry entry/adaptation seam that the iframe slice fills with a Board-owned component; do not implement an iframe bridge or duplicate frame renderer here. The final slice uses this real path instead of the proof's temporary adapter. Browser identities/import-map behavior must still be covered by the upstream real-browser fixture.

DELEGATION CONTRACT: Prerequisite 0989 (including 0988 transitively): typed catalog, safe assets, validated metadata and shipped runtime ABI. Handoff to 0991: resolved registry/provider, contributionType layout seam and failure-safe shell; 0992 receives the real native path.

### Plan

- [ ] Step 0 — Start from a clean task-specific branch/worktree containing this planning batch and completed dependency outputs. Re-read AGENTS.md, the contribution contract and root DESIGN.md for UI changes. Preserve unrelated work: task 0984 currently owns run-evidence helpers in another worktree; do not touch its files. Verify installed dependency resolution and lockfile, then build fresh generated assets when testing distribution; existing dist/web is not proof of freshness.
- [ ] Step 1 (R1,R5) — Trace all imports of registry/modules/defaultModule/getModule/routes. Add registry context and a route factory while preserving memory-router tests, retired redirects and built-in landing; avoid constructing a browser router during Astro build.
- [ ] Step 2 (R1,R2,R3) — Add typed catalog fetch and native composition with explicit CSS loading, named export/version checks, 10-second internal timeout and settled per-module outcomes. Test empty catalog, rejected fetch, stalled import, late resolve, bad export/version and CSS errors.
- [ ] Step 3 (R2,R4) — Mount successful components through the existing root; add external component/panel error containment and optional native panel layout. Verify deep paths, native metadata, ordering, mobile menu/focus and saved built-in layout settings.
- [ ] Step 4 (R3,R5) — Verify disabled descriptors never reach browser import/style requests. Run real consumer fixture through the typed catalog path and assert hook interaction uses the host graph, with failure navigation retained.
- [ ] Step 5 (R1–R5) — Extend existing apps/web/tests/modules/registry.test.ts and router tests; proposed apps/web/tests/modules/compose.test.ts and component layout tests must observe actual consumer behavior. Supplement with the real-browser runtime fixture; run fresh Astro build and task gate. Run focused tests inside their workspace (its bunfig supplies preloads), then the task pipeline's required bun run spur-check once. Record real commands, versions, fixture locations, expected/actual observations and verdicts in execution-owned sections during implementation. Leave feature-wide checks to the final slice. No CLI noun/verb is added.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: [A8](../features/A8_downstream-spur-board-modules-and-embedded-resources.md).
- Governing contract: [downstream Board modules](../design/downstream-board-modules.md); [ADR-128](../00_ADR.md#adr-128-project-owned-board-contributions-share-one-host-registry); [UI rules](../../DESIGN.md#product-ui--downstream-board-modules-proposed).
- Investigation/history: [2026-09-27 plan](../plans/2026-09-27-dynamic-board-modules-brainstorm.md). Historical alternatives are not current requirements.
- Dependency outputs: Prerequisite 0989 (including 0988 transitively): typed catalog, safe assets, validated metadata and shipped runtime ABI. Handoff to 0991: resolved registry/provider, contributionType layout seam and failure-safe shell; 0992 receives the real native path.
- Concurrency audit 2026-09-27: main at 67096d060f951d416f0ad9acdf3a119543bcfe33; task 0984 is wip in /Users/robin/xprojects/spur-wt-0984 and owns unrelated run-evidence helpers. One writer per tree; integrate this planning batch into a clean task branch before implementation. Recheck active worktrees/status at execution start.
- Source facts and proposed new targets are distinguished in Background/Design. Existing dist/web/generated artifacts must be rebuilt before distribution evidence; no generation-freshness claim was inferred from their presence.

### History
### Notes

Planning freeze (2026-09-27): Requirements, Design, Plan, AC mapping, closed decisions, dependency contracts and current-tree premises have been audited. These specifications are ready for ordered delegation. Only 0988 is execution-eligible immediately; later tasks wait for their named prerequisites. Normal task checks pass with only L4.prerequisite-not-done warnings on dependent tasks; --as todo elevates those waiting-state findings to errors. Do not remove dependencies, change prerequisite statuses or suppress those findings to make all tasks simultaneously runnable.

Final concurrency recheck: main is now f32848ba6898765d0ecf31b1e7d87bf61a16aa16, git worktree list shows only the root tree, and task list --status wip returns empty. The earlier 0984 ownership note is historical; its other session finished during planning. Material A8 source seams were reread and remain unimplemented. Keep the step-0 clean-tree/tool-version/generated-build precondition for execution.

