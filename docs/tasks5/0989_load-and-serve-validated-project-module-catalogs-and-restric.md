---
schema_version: 1
name: Load and serve validated project module catalogs and restricted assets
status: todo
template: feature-impl
created_at: 2026-09-28T01:46:26.508Z
updated_at: "2026-09-28T01:51:42.069Z"
feature_id: A8
priority: P2
tags:
  - A8
  - board
  - downstream
estimate_hours: 8

ac_numbering: task-local
dependencies: ["0988"]
---

## 0989. Load and serve validated project module catalogs and restricted assets

### Background

The existing merged config schema strips bootstrap.modules; serve currently swallows loadSpurConfig errors and composes the Hono app before Bun.serve. This slice makes declared module selection observable through one read-only catalog and safe asset URLs without evaluating downstream JS. It depends on the preceding runtime manifest/reserved inventory, not an already-existing Board SDK.
Verified seams: packages/config/src/index.ts:894; apps/server/src/serve.ts:599,806,956; apps/server/src/bootstrap.ts:29; packages/contracts/src/index.ts:21. The Board catalog procedure is host-owned and in scope; adding downstream backend procedures is excluded.
Rubric: E8 D1 L4 C1 R1 = 15; config, resolution, DTOs and HTTP handling form one independently testable project catalog deliverable.

### Requirements

- [ ] R1. Extend the existing merged project config loader with a strict bootstrap.modules array defaulting empty, discriminated by required type react|iframe; preserve bootstrap.options and unrelated configuration. Shared id/name/icon are required, optional sidebarLabel/description/order/enabled follow the contract, and enabled defaults true. React web has directory/entry and styles defaults []; iframe source has url; each type forbids the other's fields.
- [ ] R2. Reject unsupported or mixed fields, duplicate IDs/routes and collisions with all host/retired identities, including disabled declarations. IDs match ^[a-z][a-z0-9-]*$, name/icon are nonempty, order finite. Invalid iframe URLs (non-absolute, non-http(s), embedded credentials) are configuration errors.
- [ ] R3. At Board serve startup resolve enabled native directories from the selected project root and canonical entry/style paths inside each root; check existence and containment before Bun.serve. Disabled declarations perform structural validation but require no asset files or native code evaluation. Ordinary CLI config loading performs no asset IO or extension import.
- [ ] R4. Expose contract.board.modules as a typed read-only GET /api/board/modules procedure with catalogVersion:1, the host runtime descriptor and enabled safe module descriptors; omit filesystem roots and server-only state. Use implement(contract), existing OpenAPI generation and typed client shape.
- [ ] R5. Serve declared native trees through fixed /modules/:id/* handlers before static/SPA fallback with correct MIME and Cache-Control:no-store. Reject traversal, malformed encoding and symlink escape at request time, return real missing-asset errors and expose no undeclared or disabled roots.
- [ ] R6. Fail clearly before listening on malformed explicit module config or an incompatible selected Board distribution with enabled contributions; preserve the established no-module/standalone paths. Build one project-owned catalog per server and use restart/reload semantics, without route mutation or downstream server imports.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Malformed declarations fail before the project server listens (req: R1; R2; R3; R6)
  Given explicit declarations include a malformed field, host collision or missing enabled native file
  When the real serve startup path resolves that project
  Then it reports the declaration/index/reason and never calls listen; valid no-module configuration remains usable

Scenario: AC2 — Disabled modules do not load assets or execute contributions (req: R1; R2; R3; R4; R5)
  Given a structurally valid disabled module points to missing assets or an executable sentinel
  When the config is loaded, catalog requested and its asset URL requested
  Then structural errors still fail, while the disabled item is absent from the catalog, requires no files and never evaluates code

Scenario: AC3 — Module assets remain inside their declared web directory (req: R3; R4; R5)
  Given an enabled native tree contains JS/CSS/chunks plus traversal and symlink-escape targets
  When actual Hono requests access safe, missing and unsafe paths
  Then safe assets have correct MIME/no-store, escapes are refused, missing JS is not HTML, and public catalog data contains no filesystem root

Scenario: AC4 — Invalid frame URLs are rejected as configuration errors (req: R1; R2)
  Given frame declarations use relative URLs, unsupported schemes or embedded credentials
  When the merged config is parsed
  Then they fail with actionable configuration diagnostics and valid absolute credential-free HTTP/HTTPS URLs retain their intended value

Scenario: AC5 — Module selection changes use the documented restart lifecycle (req: R6)
  Given a project server owns its prepared module snapshot
  When the underlying declaration changes while it runs
  Then the existing catalog remains the startup snapshot until a server restart, with no live route insertion
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-28T01:47:51.957Z

Closed decisions (2026-09-27): A8 follows ADR-128 and the accepted downstream-board-modules contract. Embedded YAML is the only selection/metadata authority; compiled native React is primary and iframe URLs use one Board-owned adapter. No required server entry or downstream backend procedure is introduced. v1 uses startup snapshots, restart and reload. The real installed shared-runtime proof precedes production composition; failure routes back to design rather than a renderer substitution.

Deferred with owner: the A8 feature owner handles any future messaging/data/theme bridge, live replacement, directory-hosted frames, split views or Worker filesystem support only after a concrete requirement. Exact Astro build wiring is the bounded runtime task's investigation, with frozen output and proof criteria; later tasks consume its delivered manifest rather than choosing another ABI. There are no unresolved product decisions in this task.

Prerequisite 0988: packaged manifest, generated reserved host identities, type/runtime versions and verified import-map ordering. Handoff to 0990 and 0991: typed catalog snapshots and restricted asset URLs; 0992 consumes startup/project/distribution invariants.

### Design

Accepted contract: docs/design/downstream-board-modules.md and ADR-128. A8 uses embedded bootstrap.modules declarations, Vite-built native ESM and a Board-owned URL frame adapter. Native modules have no required server entry. Configuration/build changes use restart plus browser reload. This task implements only its named slice; downstream server imports, external manifests, raw TSX compilation, Module Federation, process launching/proxying, live replacement and private Board SDK exports remain outside scope.

WHAT/WHY: Supply the browser with a frozen safe project snapshot. The config schema checks shape; application services check host collisions, paths and distribution capability; server handlers deliver the result. Existing bootstrap.options remains the ts-infra forwarding surface.

WHERE/OWNERSHIP: packages/config/src/index.ts and proposed board-modules.ts; existing config loader/tests; proposed packages/app/src/services/board-modules.ts with tests; proposed packages/contracts/src/board.ts and its index; apps/server/src/context.ts, serve.ts, bootstrap.ts and router.ts, plus a thin proposed modules/board/handlers.ts and restricted asset handler. Keep app logic in packages/app and cross-workspace imports through @gobing-ai/* facades. Web rendering is owned by the next slice. Reuse the runtime manifest emitted upstream; do not re-own facade building.

FROZEN INPUT/OUTPUT: Export BoardModuleDeclaration from config as the validated union. Proposed prepareBoardModules({projectRoot,declarations,webDistPath,runtimeManifest}) returns {catalog,assetRoots}; catalog is the transport DTO, assetRoots is private canonical id->directory metadata. Consume upstream board-runtime.json, validate its versions and facade files for enabled contributions, and use its reservedModules for collisions. Resolve host reserved inventory from the packaged host output even when a selected legacy project dist/web lacks capability; no-module legacy overrides remain usable. Define BoardModuleCatalog DTO as {catalogVersion:1,runtime:{contributionApiVersion:1,reactVersion,reactDomVersion,reactRouterVersion,imports},modules:[...]}. runtime may be null only for an empty enabled catalog served without a compatible Board distribution (standalone/legacy); an enabled catalog requires the upstream manifest. This preserves Worker/no-Board paths without filesystem loading. Public shared descriptors retain metadata and derived route; react adds entryUrl/styles, iframe adds source:{url}. Route is the existing relative WebModule route id, yielding /board/<id>; it is not configurable. No filesystem paths enter DTOs.

VALIDATION ORDER: Existing merge/loader -> strict structural parse -> collision check across all declared entries/host inventory -> filter enabled -> selected distribution capability -> realpath and enabled-file containment -> construct URLs/catalog -> createApp -> Bun.serve. Shape validation never evaluates native code. Narrowly correct serve's current catch-to-null behavior so explicit malformed declarations cannot silently disappear; test existing optional-config and standalone cases.

ASSET RULES: Decode and normalize the requested suffix; reject unsafe/absolute paths. Canonicalize the candidate, prove it equals root or starts with root plus platform separator, and require a regular file. Recheck canonical containment on each request to cover symlink changes. Encode URL path segments, retain relative chunk imports and never route /modules failures into Board HTML. Missing/unsafe/disabled IDs return 404/explicit invalid-path status without secret filesystem diagnostics. No-store intentionally avoids immutable generation machinery.

HANDOFF: The native slice gets real typed catalog responses and safe asset URLs; the iframe slice gets already-validated descriptors; the final slice gets per-project startup/dist-override invariants. No frontend registry is needed to verify this slice: an actual createApp request and real serve startup test can demonstrate the entire output.

DELEGATION CONTRACT: Prerequisite 0988: packaged manifest, generated reserved host identities, type/runtime versions and verified import-map ordering. Handoff to 0990 and 0991: typed catalog snapshots and restricted asset URLs; 0992 consumes startup/project/distribution invariants.

### Plan

- [ ] Step 0 — Start from a clean task-specific branch/worktree containing this planning batch and completed dependency outputs. Re-read AGENTS.md, the contribution contract and root DESIGN.md for UI changes. Preserve unrelated work: task 0984 currently owns run-evidence helpers in another worktree; do not touch its files. Verify installed dependency resolution and lockfile, then build fresh generated assets when testing distribution; existing dist/web is not proof of freshness.
- [ ] Step 1 (R1,R2) — Add discriminated schemas/defaults and inferred types through existing loader; test absent/empty lists, layered config preservation, unknown/mixed fields, finite order, defaults and credentials/scheme rejection.
- [ ] Step 2 (R2,R3,R6) — Implement prepareBoardModules and manifest/reserved-inventory consumption. Test duplicate/retired/built-in collisions even disabled, project-root independence from cwd, disabled missing directory, valid external asset tree, absolute paths, traversal and symlink escapes.
- [ ] Step 3 (R4) — Add board DTO/contract and implement(contract) handler using ServerContext. Generate OpenAPI through its existing generator; assert the typed payload has no private path and standalone returns an empty catalog without filesystem capability.
- [ ] Step 4 (R5) — Mount one fixed native asset namespace ahead of SPA fallback. Use real temporary JS/CSS/chunk/image files and real Hono requests for MIME, no-store, unknown/disabled IDs, missing JS, encoded traversal and a symlink changed after startup.
- [ ] Step 5 (R3,R6) — Thread prepared state through serve/createApp before listening; remove silent loss of explicit module parse failures. Test listen is not invoked for malformed/missing assets/incompatible enabled override, and no-module existing overrides/health path still start.
- [ ] Step 6 (R1–R6) — Run config loader/bootstrap-options tests, proposed packages/app/tests/services/board-modules.test.ts, packages/contracts/tests/board.test.ts and apps/server/tests/board-modules.test.ts, plus focused serve regressions and the task gate. Run focused tests inside their workspace (its bunfig supplies preloads), then the task pipeline's required bun run spur-check once. Record real commands, versions, fixture locations, expected/actual observations and verdicts in execution-owned sections during implementation. Leave feature-wide checks to the final slice. No CLI noun/verb is added.

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
- Dependency outputs: Prerequisite 0988: packaged manifest, generated reserved host identities, type/runtime versions and verified import-map ordering. Handoff to 0990 and 0991: typed catalog snapshots and restricted asset URLs; 0992 consumes startup/project/distribution invariants.
- Concurrency audit 2026-09-27: main at 67096d060f951d416f0ad9acdf3a119543bcfe33; task 0984 is wip in /Users/robin/xprojects/spur-wt-0984 and owns unrelated run-evidence helpers. One writer per tree; integrate this planning batch into a clean task branch before implementation. Recheck active worktrees/status at execution start.
- Source facts and proposed new targets are distinguished in Background/Design. Existing dist/web/generated artifacts must be rebuilt before distribution evidence; no generation-freshness claim was inferred from their presence.

### History
### Notes

Planning freeze (2026-09-27): Requirements, Design, Plan, AC mapping, closed decisions, dependency contracts and current-tree premises have been audited. These specifications are ready for ordered delegation. Only 0988 is execution-eligible immediately; later tasks wait for their named prerequisites. Normal task checks pass with only L4.prerequisite-not-done warnings on dependent tasks; --as todo elevates those waiting-state findings to errors. Do not remove dependencies, change prerequisite statuses or suppress those findings to make all tasks simultaneously runnable.

Final concurrency recheck: main is now f32848ba6898765d0ecf31b1e7d87bf61a16aa16, git worktree list shows only the root tree, and task list --status wip returns empty. The earlier 0984 ownership note is historical; its other session finished during planning. Material A8 source seams were reread and remain unimplemented. Keep the step-0 clean-tree/tool-version/generated-build precondition for execution.

