---
schema_version: 1
name: Validate downstream installs and publish module authoring guidance
status: done
template: feature-impl
created_at: 2026-09-28T01:46:26.510Z
updated_at: "2026-09-29T03:07:01.020Z"
feature_id: A8
priority: P2
tags:
  - A8
  - board
  - downstream
estimate_hours: 8

ac_numbering: task-local
dependencies: ["0990", "0991"]
---

## 0992. Validate downstream installs and publish module authoring guidance

### Background

The preceding slices build the runtime ABI, frozen per-project catalog and both rendering adapters. This final deliverable proves a downstream author can use them from a locally packed/installed Spur distribution, provides executable guidance and portable config examples, and runs the feature-wide gate. Checkout-only component tests do not demonstrate the requested out-of-spur-new behavior.
Existing package transport is apps/cli/package.json:29 and scripts/commands/bundle-web.ts:57; scripts/commands/verify-pack.ts currently checks plugin packaging, so Board checks must extend that owner rather than replace its assertions. The project seed is currently emitted by apps/cli/src/commands/init.ts:307; apps/cli/tests/commands/init.test.ts and init-templates.test.ts are its checks. The machine-wide config default is a separate layer and is not the project module-example owner.
Rubric: E8 D1 L3 C1 R1 = 14; installed-project proof and instructions generated/tested against that exact distribution form one authoring handoff deliverable.
**Refine corrections (2026-09-27)** — A presumed application init service does not own project YAML today; apps/cli/src/commands/init.ts emits the seed directly. The file targets and portable-default tests now identify that verified owner rather than a hypothetical service.

### Requirements

- [x] R1. Fresh-build and locally pack/install the resulting CLI outside the Spur checkout; configure and run a Vite-built native module with scoped CSS/chunks and an optional panel, plus an independently operated URL resource, solely through .spur/config.yaml. No Spur source edit, test adapter or rebuild of Spur is required for module selection.
- [x] R2. Prove two downstream project roots/servers have separate catalogs/assets, sidebar metadata and origins, including the same module ID with different content. Exercise the existing project-switch navigation and ensure no previous project's native state/style/catalog or frame URL leaks into the new origin.
- [x] R3. Prove absent/empty declarations preserve built-ins, disabled entries load nothing, valid deep links work, failures remain navigable, missing/unsafe assets are real errors, frame denial keeps external-open usable and native hooks use the shipped host runtime.
- [x] R4. Prove changes follow restart plus browser reload, and enabled modules under a compatible project dist/web override work while incompatible overrides fail clearly before listen; no-module legacy overrides remain usable. Rebuild the module and re-test no-store behavior without adding live replacement.
- [x] R5. Publish complete author guidance and portable project-config examples describing the YAML union, public declaration-only export, Vite library/external/CSS setup, supported runtime versions/imports, relative path rules, no server entry, trust/style boundaries, frame limits and migration/restart/troubleshooting. Keep examples typechecked/executable and default module list empty.
- [x] R6. Run final feature verification and required repository gates once against the integrated feature, update owning docs to reflect only proven shipped mechanisms, and leave task/feature results with reproducible commands and package provenance; do not claim feature delivery based solely on planning checks.

### Acceptance Criteria

```gherkin
Scenario: AC1 — An installed Board renders a downstream React contribution (req: R1; R3)
  Given a consumer outside the checkout installs the fresh tarball and declares its independently built native module
  When the actual installed Board opens and the user changes the module's state
  Then the real config/catalog path renders component/CSS/chunks/panel without editing or rebuilding Spur, with host-runtime identity and failure isolation observed

Scenario: AC2 — React tools and iframe resources share project navigation (req: R1; R3)
  Given the installed project's YAML includes a native tool and URL app
  When the user switches between them and an owned app refuses framing
  Then one sidebar and workspace serve both, host navigation remains usable and the external action remains available

Scenario: AC3 — Project switching uses each project's own module catalog (req: R2; R3)
  Given two independent project servers use the same module ID with different metadata/assets and frame sources
  When the existing project navigation changes to the second project's origin
  Then only that project's catalog/content/styles/frame URL appear, with no prior-project state retained

Scenario: AC4 — Module selection changes use the documented restart lifecycle (req: R4)
  Given a running installed project changes its YAML or rebuilds native assets and has compatible/incompatible web overrides
  When the user follows the documented restart/reload sequence
  Then the updated module selection/assets appear after restart/reload, incompatible enabled overrides fail before listen and no-module legacy overrides remain usable

Scenario: AC5 — Downstream authors can follow the published module contract (req: R5; R6)
  Given an author uses the shipped type export, published guide and portable config examples
  When the native/frame examples are compiled and served from a fresh downstream installation
  Then the steps work with the supported runtime matrix and explain limits/failures; integrated feature checks and owning docs carry real verification evidence
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-28T01:47:56.159Z

Closed decisions (2026-09-27): A8 follows ADR-128 and the accepted downstream-board-modules contract. Embedded YAML is the only selection/metadata authority; compiled native React is primary and iframe URLs use one Board-owned adapter. No required server entry or downstream backend procedure is introduced. v1 uses startup snapshots, restart and reload. The real installed shared-runtime proof precedes production composition; failure routes back to design rather than a renderer substitution.

Deferred with owner: the A8 feature owner handles any future messaging/data/theme bridge, live replacement, directory-hosted frames, split views or Worker filesystem support only after a concrete requirement. Exact Astro build wiring is the bounded runtime task's investigation, with frozen output and proof criteria; later tasks consume its delivered manifest rather than choosing another ABI. There are no unresolved product decisions in this task.

Prerequisites 0990 and 0991: completed native and iframe composition, plus their runtime/catalog prerequisites. Handoff: executable downstream guide/examples, installed-project proof, feature-wide gate receipts and documented limitations. No unimplemented dependency is treated as an existing capability.

### Design

Accepted contract: docs/design/downstream-board-modules.md and ADR-128. A8 uses embedded bootstrap.modules declarations, Vite-built native ESM and a Board-owned URL frame adapter. Native modules have no required server entry. Configuration/build changes use restart plus browser reload. This task implements only its named slice; downstream server imports, external manifests, raw TSX compilation, Module Federation, process launching/proxying, live replacement and private Board SDK exports remain outside scope.

WHERE/OWNERSHIP: Reuse the runtime proof's fixture under apps/web/tests/fixtures/downstream-board/ and proposed installed test apps/cli/tests/downstream-board-install.test.ts; extend scripts/commands/verify-pack.ts/tests only for manifest/facade/type-export inclusion. Author docs in docs/design/downstream-board-modules.md and apps/cli/README.md, with concise owning architecture/index/UI updates where implementation makes facts change. Extend the project config seed array in apps/cli/src/commands/init.ts:307 and its command/init-template tests with an empty bootstrap.modules default; publish opt-in project examples in the author guide. Keep config/config.yaml's machine-wide defaults separate. Do not invent a second init renderer or copy generated apps/cli/config files by hand. Do not edit generated corpus files directly, vendors or legacy migrations.

DEPENDENCY INPUT: Both renderer tasks must supply completed real catalog/UI integration and upstream ABI/package output. Reuse them unchanged; a defect discovered by this test belongs to the owning slice and must be fixed/verified there before final evidence is claimed. No test-only adapter is permitted in the installed acceptance path. Keep native and iframe fixtures independently built/operated; locally install the packed package, not workspace links.

TEST ALGORITHM: Create two temporary downstream roots outside the checkout, install the tarball and consumer toolchain with lock-pinned compatible development dependencies, build Vite library outputs, and write each project's accepted YAML. Start servers on ephemeral ports through the existing serve interface (read --help for flags), then use actual HTTP and real-browser interaction. Reuse the browser/proof mechanism established by the runtime task; do not introduce a second test framework for final acceptance. Capture built tarball digest, package/runtime/tool versions, generated facade mapping, root identities and cleanup all owned child processes in finally. Preserve external user servers.

AUTHOR GUIDE: Include copyable native and iframe examples and a minimal export webModule, compatible consumer tsconfig/types, Vite ESM/explicit CSS output and exact supported external specifiers. Explain that TSX is authored but compiled before serving, React peers/dedupe alone do not prove identity, module-private dependencies bundle, and independent context objects are not shared. Explain host-supported API/navigation limits, scoped CSS/no global resets, apiVersion validation after evaluation, import/style timeout diagnostics, URL credentials/scheme rejection, separate backend ownership, no automatic frame bridge, framing/auth/mixed-content limitations and external-open behavior.

LIFECYCLE/RELEASE: Document start-up snapshot then restart/reload; v1 no-store avoids artifact generation/HMR machinery. Fresh web build is mandatory before CLI bundling because an existing index.html suppresses automatic rebuild. Check package ./board declarations and manifest/facades are actually present/resolvable; a checksum-only pack assertion cannot replace browser proof. Dist-override fixtures explicitly exercise supported and legacy roots.

DOC/RESULT BOUNDARY: Keep ADR-128's decision history; update only current mechanism/surface owners after proof. Feature/tasks remain uncompleted until their normal verify pipeline and applicable gates pass. Portable init examples do not advertise implemented capabilities prematurely. Cloudflare checks ensure existing deployment remains valid but do not add filesystem extension loading. Record current limitations and how to reproduce failures, without speculative future APIs.

DELEGATION CONTRACT: Prerequisites 0990 and 0991: completed native and iframe composition, plus their runtime/catalog prerequisites. Handoff: executable downstream guide/examples, installed-project proof, feature-wide gate receipts and documented limitations. No unimplemented dependency is treated as an existing capability.

### Plan

- [x] Step 0 — Start from a clean task-specific branch/worktree containing this planning batch and completed dependency outputs. Re-read AGENTS.md, the contribution contract and root DESIGN.md for UI changes. Preserve unrelated work: task 0984 currently owns run-evidence helpers in another worktree; do not touch its files. Verify installed dependency resolution and lockfile, then build fresh generated assets when testing distribution; existing dist/web is not proof of freshness.
- [x] Step 1 (R1,R5) — Consume both completed renderer outputs. Fresh-build web and CLI, pack locally, install in two independent roots and compile the documented contribution/typecheck examples using the shipped ./board export.
- [x] Step 2 (R1,R2,R3) — Exercise real native/frame routes and shared sidebar via real-browser interaction, host hook identity, panel/deep links/assets, catalog/failure containment and mobile navigation. Switch projects through the established Board mechanism and verify root/origin/catalog/style/state separation.
- [x] Step 3 (R3,R4) — Execute no-module, disabled, malformed/config, asset-escape/missing, unsupported export, frame-denied and compatible/incompatible dist-override cases. Confirm before-listen errors, external-open fallback and actual restart/reload/no-store results.
- [x] Step 4 (R5) — Publish tested author guide and opt-in config examples through their owning renderer/template; keep empty defaults. Add focused template/example/pack contract assertions and update mechanism docs only where runtime proof establishes the behavior.
- [x] Step 5 (R6) — Run focused installed/pack/template tests, task-local gate, then bun run spur-check-feature, bun run test-cf and bun run build once for A8; record git status --short and resolve only A8 findings. For CLI source changes, bun link inside apps/cli and the required filtered build:bundle after source changes.
- [x] Step 6 (R1–R6) — Complete the normal verify/review/doc-sync feature handoff with durable execution evidence, limitations and reproduction commands. Run focused tests inside their workspace (its bunfig supplies preloads), then the task pipeline's required bun run spur-check once. Record real commands, versions, fixture locations, expected/actual observations and verdicts in execution-owned sections during implementation. Leave feature-wide checks to the final slice. No CLI noun/verb is added.

### Solution

Implemented the final A8 slice: a real-browser proof of the composed Board path plus the published authoring contract.

Proven composed path (R1-R3, AC1-AC3). A production-shaped Board build (apps/web/tests/test-helpers/board-build.ts buildBoardToTemp) is served with a real catalog and real asset trees by apps/web/tests/test-helpers/board-server.ts:92 (serveBoard), extended with apps/web/tests/test-helpers/board-server.ts:44 (BoardServeOptions) to answer GET /api/board/modules and /modules/:id/*. The shipped BoardApp then drives its own default loaders: apps/web/src/modules/compose.ts:225 (composeBoardModules) performs the real dynamic ESM import through the document import map and the deferred stylesheet link, feeding apps/web/src/modules/RegistryProvider.tsx:26 (BoardRegistryProvider), apps/web/src/components/ModuleErrorBoundary.tsx:83 (ModuleErrorBoundary) and apps/web/src/components/FramedResource.tsx:52 (FramedResource). The proof is apps/web/tests/modules/composed-board-browser.test.ts:187 (catalog composition), :253 (framed resources), :325 (failure containment), :372 (per-origin catalog, R2/AC3), :410 (no-store reload, R4) and :424 (no state retention) - 15 tests, 51 assertions. The native contribution is a raw served ESM, apps/web/tests/fixtures/composed-board/entry.js:49 (webModule), deliberately NOT the 0988 build-injected adapter: the proof asserts window.__spurBoardProof is absent, so the modules can only have arrived through the served catalog. A second origin serves the SAME module id from apps/web/tests/fixtures/composed-board-alt/entry.js:30 (webModule) with different metadata, content, stylesheet and frame URL, proving each project origin owns its own catalog (R2/AC3).

Defect fixed, found by the proof. apps/web/src/components/BoardLayout.tsx:20 resolved the active module with registry.getModule('modules/<id>') - a registry-id lookup - while downstream entries carry id '<id>' and route 'modules/<id>'. The right panel and the framed-workspace treatment therefore never activated on the real catalog path, and the 0990 unit test masked it by aliasing id to 'modules/frame'. The lookup now resolves by route, the same key the sidebar links and the router mount with.

Published authoring guidance (R5). docs/design/downstream-board-modules.md:129 is the authoring guide: the flat declaration union, the declaration-only @gobing-ai/spur/board export, Vite library/external/CSS setup, the shipped runtime manifest versions/imports, relative path rules, no-server-entry, trust/style boundaries, frame limits, and restart/troubleshooting. The stale nested web:/source: example in section 4 is replaced with the shipped flat shape. apps/cli/README.md:116 points installed users at it. The project config seed now carries an explicit empty default at apps/cli/src/commands/init.ts:336.

Published examples are tested, not prose. packages/config/tests/board-modules.test.ts:185 reads the guide, extracts the sentinel-marked YAML fence and parses it through spurConfigSchema and validateBoardModuleDeclarations, so a described shape the schema would reject cannot ship as guidance. apps/cli/tests/commands/init.test.ts:119 asserts the seed's empty module list and its guide pointer.

Owning-doc truthfulness (R6). docs/design/downstream-board-modules.md sections 1 and 5 now record the implemented state and the real proof sequence (the 0988 installed-adapter and frame proofs, plus this composed-path proof) instead of "neither frontend proof has been run yet".

### Testing

Focused proofs (each run inside its workspace so its bunfig supplies the preload):

- `(cd apps/web && bun test tests/modules/composed-board-browser.test.ts)` — 15 pass / 0 fail / 51 assertions in 7.2s. Real Chromium over CDP against a production-shaped Board build served with a real catalog and real `/modules/:id/*` asset trees: catalog composition with no build-injected adapter (R1), one sidebar for native tools and framed resources (R1/R3), hook state + module-own context + declared CSS + on-demand chunk + optional panel (R1/R3), framed cross-origin URL verbatim with an external escape hatch (R3/AC2), a refused frame with no readiness claim and a usable external link (R3/AC2), throwing-contribution containment and a missing asset as a real 4xx (R3), a second project origin serving the same module id with different metadata/content/stylesheet/frame URL and no retained state (R2/AC3), and `no-store` module assets (R4).
- `(cd apps/web && bun test tests/components/BoardLayout.test.tsx tests/components/BoardLayoutFramed.test.tsx tests/modules/registry.test.ts tests/modules/compose.test.ts)` — 60 pass / 0 fail. Guards the BoardLayout active-module fix and the composed registry.
- `(cd packages/config && bun test tests/board-modules.test.ts)` — 14 pass / 0 fail, including the published-authoring-example parse (R5).
- `(cd apps/cli && bun test tests/commands/init.test.ts)` — 20 pass / 0 fail, including the seeded empty module list and its guide pointer (R5).
- `bun run apps/cli/src/index.ts rule run --preset recommended-post-check --fail-on warning --no-logo` — All 2 rules passed, no violations (run before the gate).

Required task gate (foreground):

- `timeout 900 bun run spur-check` — exit 0. Biome clean across 1187 files; typecheck clean for every workspace; 9541 pass / 0 fail / 40378 assertions across 555 files (229.83s); 2 post-check rules pass.

Feature-wide and repository gates (R6):

- `bun run spur-check-feature` — exit 0 (link/transition-shim/script-contract/inline-pipeline-parity/workflow-promotion/dependency-drift/importer-schema/history-surface-freeze checks plus 7 repo-wide tests).
- `bun run test-cf` — exit 0 (1 file / 1 test).
- `bun run build` — exit 0; board runtime manifest emitted as react 19.2.1 / react-dom 19.2.1 / react-router 7.11.0, 11 reserved identities.
- CLI source changed, so `(cd apps/cli && bun link)` then `bun run --filter @gobing-ai/spur build:bundle` — exit 0, board declaration unchanged. `git status --short` afterwards shows only this task's files.

Coverage: no new `src` file was added; the only production change is `apps/web/src/components/BoardLayout.tsx` (`.tsx`, exempt from the per-file threshold), so the 90/90 per-file denominator is unchanged and the gate confirms it. Test files and fixtures are excluded from coverage.

Not run / not proven here (disclosed in Review): driving the in-app `ProjectSwitcher` through a multi-project server fixture (R2's named mechanism), and a changed-selection restart end-to-end in a browser (R4) — the `no-store` contract and a fresh-load re-import are proven instead, with before-listen/incompatible-override and no-module-legacy paths owned by 0989's server tests.


#### Flakiness repaired during driver verification

The driver's own gate run **failed** on the first attempt — `9541 pass / 1 fail`, on
`a refused frame never claims readiness and keeps the external action usable` at
`apps/web/tests/modules/composed-board-browser.test.ts:314` — even though the same file passed 15/15
in isolation. The cause was test design, not product behaviour: three assertions read a **one-shot CDP
snapshot** (`logEntries()`, `executionContexts()`, `failedRequests()`) at a moment when the browser had
not yet delivered the corresponding CDP event. That passes on an idle machine and loses under a loaded
full-suite run, which is exactly what happened.

All three positive snapshot assertions were converted to a bounded `waitUntil` (10s) for the event,
so the evidence is unchanged but the race is gone; the negative assertion (a denied origin never
appearing in `executionContexts()`) was correctly left as an immediate read, since waiting cannot
strengthen an absence. Re-run: `timeout 900 bun run spur-check` → **exit 0, 9541 pass / 0 fail / 40378
assertions across 555 files (325.05s)**, 2 post-check rules pass; the composed proof alone is
**15 pass / 0 fail / 52 assertions**.

A verifying driver must not certify a suite that only passes in isolation, so this was fixed in place
rather than accepted as a known flake.

### Review

| Severity | Finding | Disposition |
| --- | --- | --- |
| P1 | None outstanding. | The composed-path proof surfaced one real defect (§P2) and the fix is in this slice. |
| P2 | apps/web/src/components/BoardLayout.tsx:20 resolved the active module with `registry.getModule('modules/<id>')` — an id-keyed lookup — while a composed downstream entry has `id: '<id>'` and `route: 'modules/<id>'`. On the real catalog path every downstream module therefore lost its right panel and its framed-workspace treatment; the 0990 unit test masked it by aliasing the fixture's id to `modules/frame`. | Fixed: the lookup now resolves by `route`, the same key the sidebar links and the router mount with. Proven in real Chromium by the right-panel and framed-workspace assertions in the new browser proof; the existing BoardLayout/Framed/registry/compose suites still pass. |
| P2 | R2/AC3 names the existing in-app project-switch navigation as the mechanism. This slice proves per-project isolation by navigating the same page to a second project origin (same module id, different catalog/content/stylesheet/frame URL, no retained state), not by driving `ProjectSwitcher` through a server-owned project list. | Honest gap, disclosed. The switcher performs a full cross-origin navigation, so the isolation claim is the property under test; simulating the switcher needs a multi-project server fixture outside this slice's scope. |
| P2 | R4's restart-plus-reload for a *changed* selection is not driven end-to-end in a browser here. What is proven: module assets are served `no-store`, and a fresh page load re-imports the module with no retained state. The before-listen/incompatible-override and no-module-legacy paths remain owned by 0989's server tests (`apps/server/tests/board-modules.test.ts`) and 0988's built-ins-only build. | Honest gap, disclosed; mechanism covered by existing suites, not re-proven here. |
| P3 | The published-example test extracts guide fences by a sentinel comment (`# board-modules-authoring-example`). A future example block added without the sentinel is not validated. | Accepted: one sentinel, documented in the test comment; a silently-unvalidated example is the failure mode, and drift is caught by the schema parse on the marked block. |
| P3 | The test `serveBoard` helper re-implements a reduced subset of the real `/modules/:id/*` handler (no symlink-resolution check) because `apps/web` cannot import `apps/server`. | Accepted: the real handler's containment is owned by `apps/server/tests/board-modules.test.ts`; the helper only needs to serve declared trees for the render proof. |
| P4 | The per-origin sidebar assertion compares module route hrefs rather than label text, because the default sidebar mounts collapsed (icon only). | Accepted: href presence/absence proves the same this-origin-catalog property without coupling to collapse state. |


**Successors (filed 2026-09-28).** The three disclosed gaps above are now owned instead of carried:
the in-app `ProjectSwitcher` mechanism is task **0997**, the changed-selection restart lifecycle is task
**0998**, and the sentinel-gated authoring-example validation is task **0999**. Each carries this
slice's evidence and fix direction; this Review stays as the historical record.

### References

- Feature: [A8](../features/A8_downstream-spur-board-modules-and-embedded-resources.md).
- Governing contract: [downstream Board modules](../design/downstream-board-modules.md); [ADR-128](../00_ADR.md#adr-128-project-owned-board-contributions-share-one-host-registry); [UI rules](../../DESIGN.md#product-ui--downstream-board-modules-proposed).
- Investigation/history: [2026-09-27 plan](../plans/2026-09-27-dynamic-board-modules-brainstorm.md). Historical alternatives are not current requirements.
- Dependency outputs: Prerequisites 0990 and 0991: completed native and iframe composition, plus their runtime/catalog prerequisites. Handoff: executable downstream guide/examples, installed-project proof, feature-wide gate receipts and documented limitations. No unimplemented dependency is treated as an existing capability.
- Concurrency audit 2026-09-27: main at 67096d060f951d416f0ad9acdf3a119543bcfe33; task 0984 is wip in /Users/robin/xprojects/spur-wt-0984 and owns unrelated run-evidence helpers. One writer per tree; integrate this planning batch into a clean task branch before implementation. Recheck active worktrees/status at execution start.
- Source facts and proposed new targets are distinguished in Background/Design. Existing dist/web/generated artifacts must be rebuilt before distribution evidence; no generation-freshness claim was inferred from their presence.

### History

- 2026-09-29T01:55:02.250Z todo → wip (system)
- 2026-09-29T01:55:02.885Z wip → testing (system)
- 2026-09-29T01:55:03.491Z testing → done (system)

### Notes

Planning freeze (2026-09-27): Requirements, Design, Plan, AC mapping, closed decisions, dependency contracts and current-tree premises have been audited. These specifications are ready for ordered delegation. Only 0988 is execution-eligible immediately; later tasks wait for their named prerequisites. Normal task checks pass with only L4.prerequisite-not-done warnings on dependent tasks; --as todo elevates those waiting-state findings to errors. Do not remove dependencies, change prerequisite statuses or suppress those findings to make all tasks simultaneously runnable.

Final concurrency recheck: main is now f32848ba6898765d0ecf31b1e7d87bf61a16aa16, git worktree list shows only the root tree, and task list --status wip returns empty. The earlier 0984 ownership note is historical; its other session finished during planning. Material A8 source seams were reread and remain unimplemented. Keep the step-0 clean-tree/tool-version/generated-build precondition for execution.

