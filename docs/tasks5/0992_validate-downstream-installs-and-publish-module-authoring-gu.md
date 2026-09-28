---
schema_version: 1
name: Validate downstream installs and publish module authoring guidance
status: todo
template: feature-impl
created_at: 2026-09-28T01:46:26.510Z
updated_at: "2026-09-28T01:51:42.948Z"
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

- [ ] R1. Fresh-build and locally pack/install the resulting CLI outside the Spur checkout; configure and run a Vite-built native module with scoped CSS/chunks and an optional panel, plus an independently operated URL resource, solely through .spur/config.yaml. No Spur source edit, test adapter or rebuild of Spur is required for module selection.
- [ ] R2. Prove two downstream project roots/servers have separate catalogs/assets, sidebar metadata and origins, including the same module ID with different content. Exercise the existing project-switch navigation and ensure no previous project's native state/style/catalog or frame URL leaks into the new origin.
- [ ] R3. Prove absent/empty declarations preserve built-ins, disabled entries load nothing, valid deep links work, failures remain navigable, missing/unsafe assets are real errors, frame denial keeps external-open usable and native hooks use the shipped host runtime.
- [ ] R4. Prove changes follow restart plus browser reload, and enabled modules under a compatible project dist/web override work while incompatible overrides fail clearly before listen; no-module legacy overrides remain usable. Rebuild the module and re-test no-store behavior without adding live replacement.
- [ ] R5. Publish complete author guidance and portable project-config examples describing the YAML union, public declaration-only export, Vite library/external/CSS setup, supported runtime versions/imports, relative path rules, no server entry, trust/style boundaries, frame limits and migration/restart/troubleshooting. Keep examples typechecked/executable and default module list empty.
- [ ] R6. Run final feature verification and required repository gates once against the integrated feature, update owning docs to reflect only proven shipped mechanisms, and leave task/feature results with reproducible commands and package provenance; do not claim feature delivery based solely on planning checks.

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

- [ ] Step 0 — Start from a clean task-specific branch/worktree containing this planning batch and completed dependency outputs. Re-read AGENTS.md, the contribution contract and root DESIGN.md for UI changes. Preserve unrelated work: task 0984 currently owns run-evidence helpers in another worktree; do not touch its files. Verify installed dependency resolution and lockfile, then build fresh generated assets when testing distribution; existing dist/web is not proof of freshness.
- [ ] Step 1 (R1,R5) — Consume both completed renderer outputs. Fresh-build web and CLI, pack locally, install in two independent roots and compile the documented contribution/typecheck examples using the shipped ./board export.
- [ ] Step 2 (R1,R2,R3) — Exercise real native/frame routes and shared sidebar via real-browser interaction, host hook identity, panel/deep links/assets, catalog/failure containment and mobile navigation. Switch projects through the established Board mechanism and verify root/origin/catalog/style/state separation.
- [ ] Step 3 (R3,R4) — Execute no-module, disabled, malformed/config, asset-escape/missing, unsupported export, frame-denied and compatible/incompatible dist-override cases. Confirm before-listen errors, external-open fallback and actual restart/reload/no-store results.
- [ ] Step 4 (R5) — Publish tested author guide and opt-in config examples through their owning renderer/template; keep empty defaults. Add focused template/example/pack contract assertions and update mechanism docs only where runtime proof establishes the behavior.
- [ ] Step 5 (R6) — Run focused installed/pack/template tests, task-local gate, then bun run spur-check-feature, bun run test-cf and bun run build once for A8; record git status --short and resolve only A8 findings. For CLI source changes, bun link inside apps/cli and the required filtered build:bundle after source changes.
- [ ] Step 6 (R1–R6) — Complete the normal verify/review/doc-sync feature handoff with durable execution evidence, limitations and reproduction commands. Run focused tests inside their workspace (its bunfig supplies preloads), then the task pipeline's required bun run spur-check once. Record real commands, versions, fixture locations, expected/actual observations and verdicts in execution-owned sections during implementation. Leave feature-wide checks to the final slice. No CLI noun/verb is added.

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
- Dependency outputs: Prerequisites 0990 and 0991: completed native and iframe composition, plus their runtime/catalog prerequisites. Handoff: executable downstream guide/examples, installed-project proof, feature-wide gate receipts and documented limitations. No unimplemented dependency is treated as an existing capability.
- Concurrency audit 2026-09-27: main at 67096d060f951d416f0ad9acdf3a119543bcfe33; task 0984 is wip in /Users/robin/xprojects/spur-wt-0984 and owns unrelated run-evidence helpers. One writer per tree; integrate this planning batch into a clean task branch before implementation. Recheck active worktrees/status at execution start.
- Source facts and proposed new targets are distinguished in Background/Design. Existing dist/web/generated artifacts must be rebuilt before distribution evidence; no generation-freshness claim was inferred from their presence.

### History
### Notes

Planning freeze (2026-09-27): Requirements, Design, Plan, AC mapping, closed decisions, dependency contracts and current-tree premises have been audited. These specifications are ready for ordered delegation. Only 0988 is execution-eligible immediately; later tasks wait for their named prerequisites. Normal task checks pass with only L4.prerequisite-not-done warnings on dependent tasks; --as todo elevates those waiting-state findings to errors. Do not remove dependencies, change prerequisite statuses or suppress those findings to make all tasks simultaneously runnable.

Final concurrency recheck: main is now f32848ba6898765d0ecf31b1e7d87bf61a16aa16, git worktree list shows only the root tree, and task list --status wip returns empty. The earlier 0984 ownership note is historical; its other session finished during planning. Material A8 source seams were reread and remain unimplemented. Keep the step-0 clean-tree/tool-version/generated-build precondition for execution.

