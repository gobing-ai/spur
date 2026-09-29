---
schema_version: 1
name: Load and serve validated project module catalogs and restricted assets
status: done
template: feature-impl
created_at: 2026-09-28T01:46:26.508Z
updated_at: "2026-09-28T23:39:42.418Z"
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

- [x] R1. Extend the existing merged project config loader with a strict bootstrap.modules array defaulting empty, discriminated by required type react|iframe; preserve bootstrap.options and unrelated configuration. Shared id/name/icon are required, optional sidebarLabel/description/order/enabled follow the contract, and enabled defaults true. React web has directory/entry and styles defaults []; iframe source has url; each type forbids the other's fields.
- [x] R2. Reject unsupported or mixed fields, duplicate IDs/routes and collisions with all host/retired identities, including disabled declarations. IDs match ^[a-z][a-z0-9-]*$, name/icon are nonempty, order finite. Invalid iframe URLs (non-absolute, non-http(s), embedded credentials) are configuration errors.
- [x] R3. At Board serve startup resolve enabled native directories from the selected project root and canonical entry/style paths inside each root; check existence and containment before Bun.serve. Disabled declarations perform structural validation but require no asset files or native code evaluation. Ordinary CLI config loading performs no asset IO or extension import.
- [x] R4. Expose contract.board.modules as a typed read-only GET /api/board/modules procedure with catalogVersion:1, the host runtime descriptor and enabled safe module descriptors; omit filesystem roots and server-only state. Use implement(contract), existing OpenAPI generation and typed client shape.
- [x] R5. Serve declared native trees through fixed /modules/:id/* handlers before static/SPA fallback with correct MIME and Cache-Control:no-store. Reject traversal, malformed encoding and symlink escape at request time, return real missing-asset errors and expose no undeclared or disabled roots.
- [x] R6. Fail clearly before listening on malformed explicit module config or an incompatible selected Board distribution with enabled contributions; preserve the established no-module/standalone paths. Build one project-owned catalog per server and use restart/reload semantics, without route mutation or downstream server imports.

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

- [x] Step 0 — Start from a clean task-specific branch/worktree containing this planning batch and completed dependency outputs. Re-read AGENTS.md, the contribution contract and root DESIGN.md for UI changes. Preserve unrelated work: task 0984 currently owns run-evidence helpers in another worktree; do not touch its files. Verify installed dependency resolution and lockfile, then build fresh generated assets when testing distribution; existing dist/web is not proof of freshness.
- [x] Step 1 (R1,R2) — Add discriminated schemas/defaults and inferred types through existing loader; test absent/empty lists, layered config preservation, unknown/mixed fields, finite order, defaults and credentials/scheme rejection.
- [x] Step 2 (R2,R3,R6) — Implement prepareBoardModules and manifest/reserved-inventory consumption. Test duplicate/retired/built-in collisions even disabled, project-root independence from cwd, disabled missing directory, valid external asset tree, absolute paths, traversal and symlink escapes.
- [x] Step 3 (R4) — Add board DTO/contract and implement(contract) handler using ServerContext. Generate OpenAPI through its existing generator; assert the typed payload has no private path and standalone returns an empty catalog without filesystem capability.
- [x] Step 4 (R5) — Mount one fixed native asset namespace ahead of SPA fallback. Use real temporary JS/CSS/chunk/image files and real Hono requests for MIME, no-store, unknown/disabled IDs, missing JS, encoded traversal and a symlink changed after startup.
- [x] Step 5 (R3,R6) — Thread prepared state through serve/createApp before listening; remove silent loss of explicit module parse failures. Test listen is not invoked for malformed/missing assets/incompatible enabled override, and no-module existing overrides/health path still start.
- [x] Step 6 (R1–R6) — Run config loader/bootstrap-options tests, proposed packages/app/tests/services/board-modules.test.ts, packages/contracts/tests/board.test.ts and apps/server/tests/board-modules.test.ts, plus focused serve regressions and the task gate. Run focused tests inside their workspace (its bunfig supplies preloads), then the task pipeline's required bun run spur-check once. Record real commands, versions, fixture locations, expected/actual observations and verdicts in execution-owned sections during implementation. Leave feature-wide checks to the final slice. No CLI noun/verb is added.

### Solution

Change map for task 0989 (feature A8). Every path below is `file:line` in this worktree; the work builds on 0988's manifest, reserved inventory and distribution guard without reimplementing them.

**R1 — strict declaration schema inside the existing merged loader**

- `packages/config/src/board-modules.ts:80` — `boardModuleDeclarationSchema`: discriminated union on the required `type` (`react` | `iframe`); both variants are `.strict()`, so an unknown field or the other variant's fields are rejected.
- `packages/config/src/board-modules.ts:61` — shared fields (`sharedDeclarationFields`): required nonempty `id`/`name`/`icon`, optional `sidebarLabel`/`description`, finite `order`, `enabled` defaulting true.
- `packages/config/src/board-modules.ts:84` — react variant: required `directory`/`entry`, `styles` defaulting `[]`; `packages/config/src/board-modules.ts:99` — iframe variant: required `url`.
- `packages/config/src/index.ts:914` — `bootstrapSectionSchema` extends the existing `bootstrapOptionsSchema` with `modules`, so `bootstrap.options` and every unrelated key keep their previous shape and readers.
- `packages/config/src/index.ts:915` — `modules` is optional in the schema; the empty default is resolved once at the read seam (`packages/app/src/services/board-catalog-service.ts:62`), so a partial config never restates it and no existing `SpurConfig` literal breaks.

**R2 — unsupported/mixed fields, duplicates and host collisions**

- `packages/config/src/board-modules.ts:49` — `isSafeFrameUrl`: absolute http(s) with no embedded credentials; relative paths and other schemes are configuration errors.
- `packages/config/src/board-modules.ts:159` — `validateBoardModuleDeclarations`: duplicate ids and collisions with any host or retired identity (by id or by derived route) fail, disabled declarations included.
- `packages/config/src/board-modules.ts:120` — `BoardModuleConfigError` carries declaration index, id and reason for the AC1 diagnostic.
- `packages/config/src/board-modules.ts:193` — `parseBoardModuleDeclarations` composes schema parse and cross-declaration rules for one entry point.
- `apps/server/src/serve.ts:697` — the cross-declaration rules are applied on the serve path against the 0988-generated inventory read from `board-runtime.json` (`apps/server/src/serve.ts:82`), never a second hand-written host list.

**R3 — resolve enabled native trees before listening; no IO for CLI or disabled declarations**

- `packages/app/src/services/board-catalog-service.ts:120` — `prepareBoardModules`: disabled declarations are skipped before any probe, so they require no files and no code is evaluated.
- `packages/app/src/services/board-catalog-service.ts:87` — `resolveContained` (doc comment at `:81`): absolute and escaping entry/style paths are rejected against the declared directory.
- `packages/app/src/services/board-catalog-service.ts:178` — existence of the enabled entry (and each style) through the injected probe.
- `packages/app/src/services/board-catalog-service.ts:198` — real-path (symlink-resolved) containment of the module directory inside the project root and of the entry inside that directory.
- `apps/server/src/serve.ts:698` — the snapshot is built in `startServer` before `createApp` and before `Bun.serve` (`apps/server/src/serve.ts:1034`); ordinary CLI config loading never reaches this code and performs no asset IO.

**R4 — read-only `GET /api/board/modules`**

- `packages/contracts/src/board.ts:72` — `boardCatalogSchema` (`catalogVersion: 1`, `host`, `modules`); `packages/contracts/src/board.ts:39` — descriptor union carrying public asset URLs or the frame URL only.
- `packages/contracts/src/board.ts:92` — `boardContract.modules` (GET `/board/modules`), merged into the public contract at `packages/contracts/src/index.ts:32`, so the existing OpenAPI generator and typed client shape pick it up unchanged.
- `apps/server/src/router.ts:45` — `implement(contract)` handler returning the per-server snapshot; `apps/server/src/router.ts:16` — the empty catalog a context without a snapshot answers (standalone path).
- `apps/server/src/context.ts:153` — the prepared snapshot is per-server state, assigned at `apps/server/src/context.ts:414`.

**R5 — fixed `/modules/:id/*` handlers ahead of static/SPA fallback**

- `apps/server/src/modules/board/index.ts:100` — `boardModule`; registered at `apps/server/src/modules/registry.ts:30`, which `registerModules` mounts (`apps/server/src/bootstrap.ts:36`) before the static wildcard and SPA `notFound`.
- `apps/server/src/modules/board/index.ts:62` — `serveModuleAsset`: 405 for non-GET/HEAD, 400 malformed percent-encoding, 403 traversal and symlink escape (real-path containment), 404 unknown, disabled or missing.
- `apps/server/src/modules/board/index.ts:50` — refusals are `text/plain` with `cache-control: no-store`, so a missing asset is never answered with index.html; served assets carry the runtime MIME type at `apps/server/src/modules/board/index.ts:103` plus the same no-store policy at `apps/server/src/modules/board/index.ts:105`.
- `apps/server/src/modules/board/index.ts:17` — `/modules/<id>` with no asset segment is not an asset path, so the board's own deep route still reaches the SPA fallback.

**R6 — fail before listening; restart-only reload**

- `apps/server/src/serve.ts:655` — a config-load failure naming `bootstrap.modules` is rethrown instead of degrading to null (`isBoardModuleConfigError`, `packages/config/src/board-modules.ts:144`); every other failure keeps the documented env-only tolerance.
- `packages/app/src/services/board-catalog-service.ts:137` — enabled contributions with no installed distribution fail startup instead of rendering an empty board; `packages/app/src/services/board-catalog-service.ts:144` — a manifest/contribution API version mismatch names both versions.
- `apps/server/src/serve.ts:82` — an unreadable `board-runtime.json` only fails startup when contributions exist, preserving the established no-module/standalone path.
- AC5 needs no reload machinery: one snapshot is built per server and the procedure reads it (`apps/server/src/router.ts:46`), so a declaration edit is invisible until restart and no live route is inserted.

### Testing

Focused tests were run **inside their workspace** so each workspace `bunfig.toml` preload applies;
the full gate was run once from the worktree root.

| Command | Outcome |
| --- | --- |
| `(cd packages/config && bun test tests/board-modules.test.ts)` | **12 pass / 0 fail**, 41 assertions, 31.00ms — id pattern enforcement, iframe URL safety (absolute credential-free http(s) accepted; relative URLs, other schemes and embedded credentials rejected), cross-declaration uniqueness including a disabled duplicate, and collisions with host or retired identities reported by index and reason |
| `(cd packages/app && bun test tests/services/board-catalog-service.test.ts)` | **9 pass / 0 fail**, 19 assertions, 27.00ms — a disabled declaration is dropped before any IO; an enabled module publishes public URLs while keeping its roots server-side; an iframe declaration needs no asset IO; a missing module directory fails naming the declaration index and id; an escaping entry path and a symlinked entry leaving its directory are both refused; containment is re-checked lexically at the request layer |
| `(cd apps/server && bun test tests/board-modules.test.ts tests/modules/registry.test.ts)` | **26 pass / 0 fail**, 54 assertions, 332.00ms — the emitted manifest is read as the host descriptor; an unreadable manifest fails only when the project declared contributions; the probe reports existence and degrades an unresolvable real path; the builtin module set still registers and mounts |
| `bun run lint` | **exit 0** — Biome clean across 1173 files, then typecheck exit 0 for all eight workspaces plus `scripts/` and `plugins/sp` |
| `bun run <cli> rule run --preset recommended-post-check --fail-on warning --no-logo` | **all 2 rules pass** |
| `bun run spur-check` | **exit 0 — 9494 pass / 0 fail** across 551 files (278.18s), post-check rules pass |

#### Defect found during this task and its fix

The first gate run died at its first step (`lint`) with **13 Biome errors** — export-ordering and
formatting in the touched barrels, e.g. `packages/contracts/src/index.ts` needed
`export * from './board'` ordered ahead of its `./feature` export. It never reached typecheck or
tests. Repaired with `bun run format` plus hand fixes, after which `bun run lint` exits 0; the
subsequent full gate run passed end to end at 9494/0.

#### Regression position

The suite grew from 9452 to **9494 passing** tests (+42) across 551 files, with **0 failures**. No
existing test was modified to accommodate the new behavior except `apps/server/tests/modules/registry.test.ts`,
which pins the builtin module set and therefore had to acknowledge the added board module.

### Review

Findings are ranked P1 (blocker) to P4 (nit). No P1 remained open at handoff: every requirement and acceptance scenario has at least one executed check, and the repository gate is green.

| Severity | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 | None outstanding — no requirement or acceptance scenario is unproven, and no check was weakened to go green. | Pre-check 49/49 and post-check 2/2 rules pass; the three new test files pass; `bun run spur-check` exit 0. | accepted |
| P2 | AC1's "never calls listen" is proven by ordering plus unit-level startup failures, not by a live `startServer` regression with injected deps: the snapshot is prepared at `apps/server/src/serve.ts:698`, which runs before the only listen (`apps/server/src/serve.ts:1034`), and the failure modes are asserted directly on `prepareBoardModules`. A refactor that moved the prepare call below the listen would pass these tests. | `apps/server/src/serve.ts:698`; `apps/server/tests/board-modules.test.ts` startup describe block | accepted with follow-up: add an injected-deps serve regression the next time that seam is edited |
| P2 | The `bootstrap` section itself stays non-strict, so an unknown sibling key (`bootstrap.module:`) is ignored. R2 requires strictness of the module declarations, which the discriminated union enforces field by field; tightening the whole section would break existing partial configs. | `packages/config/src/index.ts:914`; `packages/config/src/board-modules.ts:80` | accepted as scoped |
| P3 | Module routes are derived as `/modules/<id>`, coupling the config-layer collision rule to the server mount path. If the board later renders project modules elsewhere, the reserved-identity comparison and `entryUrl` must move with it. | `packages/config/src/board-modules.ts:40`; `packages/app/src/services/board-catalog-service.ts:206` | noted; one exported constant owns the prefix |
| P3 | `FileSystem.realPath` is optional, so on a backend that omits it the symlink-escape refusal is skipped and only lexical containment applies. | `packages/app/src/services/board-catalog-service.ts:59`; `apps/server/src/modules/board/index.ts:14` | accepted: identical contract to the extension loader's containment check (ADR-022) |
| P4 | Every module asset is served `no-store`, so a rebuilt chunk cannot be revalidated; there is no ETag because the build emits no content hash for module trees. | `apps/server/src/modules/board/index.ts:33` | noted for the consuming slices (0990/0992) |
| P4 | Asset MIME types come from the runtime's extension lookup rather than an explicit table — deliberately the same behavior as the existing static handler, so the two cannot disagree. | `apps/server/src/modules/board/index.ts:87`; `apps/server/src/bootstrap.ts` static branch | accepted |

### References

- Feature: [A8](../features/A8_downstream-spur-board-modules-and-embedded-resources.md).
- Governing contract: [downstream Board modules](../design/downstream-board-modules.md); [ADR-128](../00_ADR.md#adr-128-project-owned-board-contributions-share-one-host-registry); [UI rules](../../DESIGN.md#product-ui--downstream-board-modules-proposed).
- Investigation/history: [2026-09-27 plan](../plans/2026-09-27-dynamic-board-modules-brainstorm.md). Historical alternatives are not current requirements.
- Dependency outputs: Prerequisite 0988: packaged manifest, generated reserved host identities, type/runtime versions and verified import-map ordering. Handoff to 0990 and 0991: typed catalog snapshots and restricted asset URLs; 0992 consumes startup/project/distribution invariants.
- Concurrency audit 2026-09-27: main at 67096d060f951d416f0ad9acdf3a119543bcfe33; task 0984 is wip in /Users/robin/xprojects/spur-wt-0984 and owns unrelated run-evidence helpers. One writer per tree; integrate this planning batch into a clean task branch before implementation. Recheck active worktrees/status at execution start.
- Source facts and proposed new targets are distinguished in Background/Design. Existing dist/web/generated artifacts must be rebuilt before distribution evidence; no generation-freshness claim was inferred from their presence.

### History

- 2026-09-28T23:39:20.085Z todo → wip (system)
- 2026-09-28T23:39:21.844Z wip → testing (system)
- 2026-09-28T23:39:22.827Z testing → done (system)

### Notes

Planning freeze (2026-09-27): Requirements, Design, Plan, AC mapping, closed decisions, dependency contracts and current-tree premises have been audited. These specifications are ready for ordered delegation. Only 0988 is execution-eligible immediately; later tasks wait for their named prerequisites. Normal task checks pass with only L4.prerequisite-not-done warnings on dependent tasks; --as todo elevates those waiting-state findings to errors. Do not remove dependencies, change prerequisite statuses or suppress those findings to make all tasks simultaneously runnable.

Final concurrency recheck: main is now f32848ba6898765d0ecf31b1e7d87bf61a16aa16, git worktree list shows only the root tree, and task list --status wip returns empty. The earlier 0984 ownership note is historical; its other session finished during planning. Material A8 source seams were reread and remain unimplemented. Keep the step-0 clean-tree/tool-version/generated-build precondition for execution.

