---
schema_version: 1
name: Prove and package the Board shared runtime and downstream authoring contract
status: done
template: feature-impl
created_at: 2026-09-28T01:46:26.503Z
updated_at: "2026-09-28T23:01:47.639Z"
feature_id: A8
priority: P2
tags:
  - A8
  - board
  - downstream
estimate_hours: 8

ac_numbering: task-local
---

## 0988. Prove and package the Board shared runtime and downstream authoring contract

### Background

The shipped CLI currently has no public Board type export, and its web assets come from the Astro client build. A separately compiled native library can use hooks only when its React instance is the renderer's actual instance. This slice delivers that distribution substrate and an installed-package browser proof before a production loader is built. It also preserves the Bun/Hono lifecycle investigation as repeatable evidence.
Current premises: apps/web/src/modules/types.ts:4 defines the existing component/right-panel boundary; apps/web/astro.config.mjs:11 owns the static Astro/Vite build; apps/cli/package.json:26 exposes only schema exports; scripts/commands/bundle-web.ts:30 builds only when index.html is absent. Installed Astro 6.4.2 resolves Vite 7.3.3 through its own package, matching bun.lock; React/DOM 19.2.1 and router 7.11.0 match apps/web/package.json.
Rubric: E8 D1 L2 C1 R1 = 13; keep this cohesive proof/distribution deliverable whole. It reduces the parent's high-risk uncertainty before the next slice.
**Refine corrections (2026-09-27)** — Resolving Vite relative to apps/web can fall through to an ancestor installation; the verified Astro-owned package graph and lockfile both resolve Vite 7.3.3. The runtime task uses that graph and rechecks it before implementation.

### Requirements

- [x] R1. Publish the type-only @gobing-ai/spur/board export containing BoardModuleContribution with readonly apiVersion: 1, component: ComponentType and optional rightPanelComponent: ComponentType; the entry export name is webModule. Generate/package declarations from one authoring source without a CLI React value dependency.
- [x] R2. Ship board-runtime.json and React/JSX facade assets emitted from the same client build graph as the real Board renderer. Install an import map before any external entry evaluates; prove identity rather than version equality.
- [x] R3. Build a downstream Vite ESM fixture outside the Spur checkout with its own React installation, a useState interaction, scoped CSS, a referenced asset/lazy chunk, a deep route and an optional right-panel component. Type-check it using the installed tarball's public export.
- [x] R4. Demonstrate the fixture under the installed CLI's actual Board renderer in a real browser, plus malformed exports and a throwing contribution that do not disable built-ins. Use a build-known test adapter rather than implementing the generic catalog/config loader in this slice.
- [x] R5. Exercise an owned frame-permitting URL app and a frame-denying URL app in the same real-browser proof harness; record focus/scroll/mobile/external-open observations without interpreting iframe load as readiness.
- [x] R6. Preserve a repeatable assertion-based Bun/Hono probe proving listener handler replacement, rejection of late route insertion into a finalized Hono matcher, and dispatch through a freshly constructed replacement app; document the fixed-handler v1 conclusion.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Native contributions use the Board React runtime (req: R1; R2; R3; R4)
  Given a separately installed consumer has its own React dependency and the new declaration-only package export
  When its Vite-built hook-bearing entry renders through the installed Board's temporary adapter
  Then state changes and host context identity are observed, CSS/chunks/panels work, and invalid entries leave built-ins usable; record real-browser and package type-check evidence

Scenario: AC2 — Framed resources retain browser embedding restrictions (req: R5)
  Given owned URL fixtures permit or deny framing
  When the proof harness embeds each and offers an external-open link
  Then browser refusal is respected, the external action remains available, and no frame load is reported as application readiness

Scenario: AC3 — The runtime investigation distinguishes listener and router lifecycle (req: R6)
  Given a Bun listener dispatches a Hono application whose matcher has already served a request
  When the assertion-based probe replaces a listener handler, attempts late route insertion and swaps a newly built app
  Then the three results are distinguished and the test supports fixed catalog/asset handlers before listen for v1
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-28T01:47:50.637Z

Closed decisions (2026-09-27): A8 follows ADR-128 and the accepted downstream-board-modules contract. Embedded YAML is the only selection/metadata authority; compiled native React is primary and iframe URLs use one Board-owned adapter. No required server entry or downstream backend procedure is introduced. v1 uses startup snapshots, restart and reload. The real installed shared-runtime proof precedes production composition; failure routes back to design rather than a renderer substitution.

Deferred with owner: the A8 feature owner handles any future messaging/data/theme bridge, live replacement, directory-hosted frames, split views or Worker filesystem support only after a concrete requirement. Exact Astro build wiring is the bounded runtime task's investigation, with frozen output and proof criteria; later tasks consume its delivered manifest rather than choosing another ABI. There are no unresolved product decisions in this task.

Prerequisites: none. Handoff to tasks 0989, 0990 and 0992: shipped board-runtime.json, exact facade mappings/type export and real-browser proof receipts; 0991 reuses the owned frame fixtures. A proof failure prevents the dependent task pipelines from starting.

### Design

Accepted contract: docs/design/downstream-board-modules.md and ADR-128. A8 uses embedded bootstrap.modules declarations, Vite-built native ESM and a Board-owned URL frame adapter. Native modules have no required server entry. Configuration/build changes use restart plus browser reload. This task implements only its named slice; downstream server imports, external manifests, raw TSX compilation, Module Federation, process launching/proxying, live replacement and private Board SDK exports remain outside scope.

WHAT/WHY: Establish one real runtime ABI and public type boundary, plus evidence that the accepted direction works in an installed distribution. Reuse Astro/Vite's client bundling; do not build an independent React vendor bundle. The exact Astro integration hook is the bounded implementation investigation in this task, using installed Astro 6.4.2/Vite 7.3.3 source. Its output contract is frozen, not an unverified Rollup option.

WHERE/OWNERSHIP: apps/web/src/modules/types.ts and proposed apps/web/src/modules/contribution.ts own the authoring shape; apps/web/astro.config.mjs and proposed apps/web/src/modules/runtime/ own facade entries/build integration. apps/cli/package.json, scripts/commands/bundle-web.ts and its tests own package inclusion. Proposed tests: apps/web/tests/modules/runtime-distribution.test.ts, apps/web/tests/fixtures/downstream-board/, apps/server/tests/board-listener-lifecycle.test.ts and scripts/commands/verify-pack.test.ts. Use existing internal build entrypoints; any helper belongs under scripts/commands or its owning workspace, never a new public CLI verb.

FROZEN OUTPUT: board-runtime.json at the web distribution root has manifestVersion:1, catalogVersion:1, contributionApiVersion:1, reactVersion, reactDomVersion, reactRouterVersion, imports (explicit bare specifier -> same-origin facade asset URL), and reservedModules (built-in id/route metadata plus retired workspace/inbox/teams identities). Generate reserved inventory from the same host declarations rather than importing TSX into the server or maintaining a second hand-written list. At minimum imports includes react, react/jsx-runtime and react/jsx-dev-runtime; any supported React DOM/router subpath is explicit, with no wildcard promise. Record the supported list and actual resolved versions for consumers. Public package export ./board resolves a declaration-only artifact; author dependencies supply compatible React types.

ALGORITHM: Ensure Board hydration imports and facades resolve to identical client graph modules. Emit/inject the import map before any native import; verify built HTML ordering and actual identity with a hook/context test inside the Board tree. The test-only fixture may export its imported React/JSX function references so the adapter can compare strict object/function identity against its own host imports; the normal authoring export remains webModule. A shared test context can live in the independently served fixture graph and be provided by the adapter, without exporting any private Board context. The isolated test adapter dynamically imports an independently built fixture served at a fixed test asset path. It is injected only into a temporary test build and excluded from shipped production discovery; it requires no bootstrap.modules support. A published production tarball has no test routes/fixtures.

HANDOFF: The catalog slice consumes the manifest/reserved inventory and package layout; the native slice consumes exact facade URLs/type ABI and import-map placement; iframe/final slices reuse the owned browser fixtures. Deliver durable test sources and task evidence, not just ignored run files. If same-graph identity or packaged authoring resolution fails, stop dependent production work and return a concrete failure/design alternative; do not change a declared React module into a frame.

LIMITS: Native code is trusted browser code. apiVersion validation follows ESM evaluation. No generic plugin framework, live router mutation, bridge SDK, dependency upgrade, or simulation-only proof. Happy DOM/component mocks can supplement but cannot establish browser ESM identity or framing policy.

DELEGATION CONTRACT: Prerequisites: none. Handoff to tasks 0989, 0990 and 0992: shipped board-runtime.json, exact facade mappings/type export and real-browser proof receipts; 0991 reuses the owned frame fixtures. A proof failure prevents the dependent task pipelines from starting.

### Plan

- [x] Step 0 — Start from a clean task-specific branch/worktree containing this planning batch and completed dependency outputs. Re-read AGENTS.md, the contribution contract and root DESIGN.md for UI changes. Preserve unrelated work: task 0984 currently owns run-evidence helpers in another worktree; do not touch its files. Verify installed dependency resolution and lockfile, then build fresh generated assets when testing distribution; existing dist/web is not proof of freshness.
- [x] Step 1 (R1,R2) — Inspect the installed Astro/Vite client graph and island script ordering. Add the smallest same-graph facade integration, manifest and declaration emission; verify the installed package's ./board type path and absence of a runtime React import in CLI/plugin artifacts.
- [x] Step 2 (R2,R3) — Fresh-build apps/web, run the existing CLI bundle pipeline, pack locally and install into a temporary consumer outside the checkout. Create the Vite library fixture with the explicit external list and consumer React/types; check scoped CSS, separate chunk and asset URLs.
- [x] Step 3 (R3,R4) — Run the temporary adapter under the installed Board root in a real browser. Assert click/state updates and shared context/hook identity, deep links, panel render, malformed export and render-failure isolation. Capture package/build/tool provenance and browser observations.
- [x] Step 4 (R5) — Serve owned allowed/denied frame fixtures on separate origins; observe host navigation, mobile/focus/scroll and an always-usable external link. Keep browser refusal intact and make no readiness claim for a denied frame.
- [x] Step 5 (R6) — Add an isolated listener lifecycle test with ephemeral ports and finally cleanup. Assert late Hono mutation failure and fresh-app handler replacement separately from Bun listener behavior.
- [x] Step 6 (R1–R6) — Run package inclusion, focused runtime/lifecycle tests and the task gate. Publish exact output files, supported specifiers and proof receipts for dependent tasks. Run focused tests inside their workspace (its bunfig supplies preloads), then the task pipeline's required bun run spur-check once. Record real commands, versions, fixture locations, expected/actual observations and verdicts in execution-owned sections during implementation. Leave feature-wide checks to the final slice. No CLI noun/verb is added.

### Solution

One authoring source for the contribution ABI, a generated declaration-only export, an emitted runtime
manifest + import map, and a bundle-time guard that refuses to ship a board without it.

**Contract and runtime — added**

| File | Role |
| --- | --- |
| `apps/web/src/modules/contribution.ts:18` | The ONE authoring source for `BoardModuleContribution`; `apiVersion: 1` at `:20`. Type-only, no React value import. |
| `apps/cli/board/index.d.ts:19` | Generated declaration-only ABI; `apiVersion: 1` at `:21`, `export declare const webModule` at `:38`. Header marks it generated. |
| `scripts/commands/emit-board-types.ts:20` | Pins `BOARD_AUTHORING_SOURCE`; renders the `.d.ts` at `:44`; writes it at `:97`. |
| `apps/web/src/modules/runtime/manifest.ts:12` | `BoardRuntimeManifest`; frozen versions at `:40`; `BOARD_FACADE_SPECIFIERS` at `:53`, with `react-dom/client` at `:58` and `react-router/dom` at `:60`; `BoardFacadeSpecifier` at `:69`; facade source at `:86`; manifest build at `:97`; `importMapFor` at `:121`; `renderImportMapScript` at `:126`; `injectImportMap` at `:136`. |
| `apps/web/scripts/board-runtime.ts:192` | The `boardRuntime()` Astro integration; facade chunk naming at `:143`; import-map injection at `:226`. |
| `apps/web/scripts/host-inventory.ts:20` | `hostReservedModules()` derives the reserved inventory from the host's own declarations — never hand-written. |

**Existing seams — modified**

| File | Change |
| --- | --- |
| `apps/cli/package.json:28` | `exports["./board"] = { "types": "./board/index.d.ts" }` — a types-only condition, so no runtime entry point exists; `board` added to `files` at `:36`; `emit-board-types` prepended to `build:bundle` at `:52`. |
| `apps/web/astro.config.mjs:14` | `integrations: [react(), boardRuntime()]`. |
| `scripts/commands/bundle-web.ts:38` | `verifyBoardRuntime()`; file/version constants at `:26`–`:27`; invoked before packaging at `:108`. Packaging now fails loudly on a missing/malformed manifest, a wrong protocol version, or an unsupported facade URL shape. |
| `apps/web/tsconfig.json`, `.gitignore` | Fixture/test path config; ignore board build and browser-proof scratch. |
| `scripts/spur-dev.ts` | `emit-board-types` subcommand. |

**Proofs — added**

- Unit: `apps/web/tests/modules/contribution.test.ts`, `apps/web/tests/modules/runtime-distribution.test.ts`, `apps/web/tests/modules/runtime/manifest.test.ts`; `scripts/commands/emit-board-types.test.ts`; `scripts/commands/bundle-web.test.ts` (extended).
- Real browser: `apps/web/tests/modules/board-runtime-browser.test.ts` (R3/R4, AC1), `apps/web/tests/modules/board-frames-browser.test.ts` (R5, AC2).
- Lifecycle: `apps/server/tests/board-listener-lifecycle.test.ts` (R6, AC2).
- Helpers: `apps/web/tests/test-helpers/cdp.ts`, `board-build.ts`, `board-server.ts`, `downstream-fixture.ts`, `frame-fixtures.ts`.
- Fixtures: `apps/web/tests/fixtures/downstream-board/**` (out-of-checkout Vite ESM app with its own React — `useState`, scoped CSS, lazy chunk, SVG asset, deep route, optional right panel, plus `malformed.ts` / `throwing.ts` / `own-react.ts`), `apps/web/tests/fixtures/frames/**` (permitted/denied/harness), `apps/web/tests/fixtures/board-test-adapter/**`.

**Decisions**

- `board-runtime.json` is emitted at the **distribution root** (`apps/web/scripts/board-runtime.ts:46`), not under `_astro/`, so the import map's facade URLs are stable across content-hashed rebuilds.
- Facade source is generated from the **measured** export names (`apps/web/src/modules/runtime/manifest.ts:86`) rather than `export * from 'react'`: Vite's production CJS interop (`strictRequires`) hides React's named exports from Rollup's static analysis, so `export *` emits nothing usable while the interop namespace yields the renderer's real bindings — the same function objects the Board hydrates with.
- Explicit subpaths only — `react-dom/client` is named at `apps/web/src/modules/runtime/manifest.ts:58` and `react-router/dom` at `apps/web/src/modules/runtime/manifest.ts:60`, so no wildcard matches them; no wildcard, so every entry is a deliberate resolution promise.
- The `./board` export carries a `types` condition and nothing else — there is no runtime SDK to accidentally import.

### Testing

#### Commands and outcomes

Focused tests were run **inside their workspace** so each workspace `bunfig.toml` preload applies;
the full gate was run once from the worktree root.

| Command | Outcome |
| --- | --- |
| `(cd apps/web && bun test tests/modules/contribution.test.ts tests/modules/runtime-distribution.test.ts tests/modules/runtime/)` | **25 pass / 0 fail**, 106 assertions, 9.64s — R1 ABI, R2 manifest, import-map ordering/idempotence |
| `(cd apps/server && bun test tests/board-listener-lifecycle.test.ts)` | **4 pass / 0 fail**, 16 assertions, 24ms — R6 (handler replacement; finalized matcher rejects late route; fresh app serves it) |
| `bun test scripts/commands/emit-board-types.test.ts scripts/commands/bundle-web.test.ts` | **9 pass / 0 fail**, 24 assertions, 2.73s — artifact is exactly what the source generates, declaration-only, regeneration deterministic; bundler refuses a manifest-less/invalid board |
| `(cd apps/web && bun test tests/modules/board-runtime-browser.test.ts tests/modules/board-frames-browser.test.ts)` | **14 pass / 0 fail**, 70 assertions, 20.87s — real Chrome via CDP |
| `bun run spur-check` (run 1) | lint clean (1166 files) · typecheck clean (8 workspaces + scripts + plugins) · pre-check 49 rules pass · **9452 pass / 0 fail** across 548 files (344.20s) · **post-check FAILED** |
| `bun run <cli> rule run --preset recommended-post-check` (after fix) | **all 2 rules pass** |
| `bun run spur-check` (run 2, recheck) | **PASS** — exit 0 · 9452 pass / 0 fail across 548 files (372.60s) · post-check rules pass |

#### The one defect found, and its fix

Run 1's post-check failed on a single rule:

```
ERROR every-export-has-tsdoc apps/web/src/modules/runtime/manifest.ts:63
  Exported type "BoardFacadeSpecifier" is missing a doc comment
```

Fixed by documenting the type in the file's established voice — explaining *why* it is derived from
`BOARD_FACADE_SPECIFIERS` (single source, the two cannot drift) rather than declaring it separately.
Post-check then passed. No other rule, test, lint, or typecheck failure occurred.

#### What the browser actually proved (AC1 / AC2)

Run against the **installed tarball's** renderer, not a mock, using **Chrome** over CDP
(`/Applications/Google Chrome.app`, no puppeteer — the harness talks raw CDP):

- The Board renderer mounted the downstream fixture on a **deep link**.
- **React is shared by instance, not by version** — strict object/function identity of the React
  instance observed inside the contribution against the host's, which is what `AC1` asks for and
  what version-string equality would not establish.
- Hooks, host context, and **scoped CSS** all work inside the Board's React tree.
- A **lazy chunk** and a referenced **SVG asset** load on demand (111.78ms) — i.e. the fixture is a
  real Vite build, not a stub.
- The optional **right panel** renders in the Board's own panel chrome.
- The downstream entry **type-checks against the installed `./board` export**.
- **Malformed export and a throwing contribution both leave the built-ins usable** (221.77ms).
- Frames: the permitted app **actually runs** inside the frame; the denied app **never runs** and its
  refusal is observable; **no readiness claim is derived from a frame load event**; the external-open
  link carries `noopener`/`noreferrer` and opens; focus and scrolling inside the framed document are
  observed separately; a mobile viewport keeps the embed working with no readiness claim from the
  refusal.

Happy-DOM was not used for the identity or framing proofs — both required a real browser.

#### Residual

- The `implement` stage's `agent.run` hit the 30-minute pipeline budget mid-cleanup, before it ran its
  own full gate. Its work-in-progress intent was to stop the browser-proof test helpers from reading
  the adapter location out of `process.env`. Functionally complete and green, but that helper coupling
  remains — worth a follow-up if the helpers are reused.
- Vite is not a direct dependency of `apps/web`; it resolves through Astro 6.4.2's own graph
  (Astro 6.4.2 → Vite 7.3.3). The facade/import-map work depends on that transitive resolution.

### Review

Reviewed the change set against R1–R6, AC1–AC3, and the frozen constraints. Verification was
observation-only; every row below is a finding I observed in this change set, not a restatement of
the task text.

| Priority | Severity | Finding | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| P3 (minor) | minor | The browser-proof helpers read the adapter path out of `process.env` and mutate that ambient state in a shared test process. Correct under Bun's per-file isolation, but it couples the harness to process state — this is precisely the cleanup the interrupted implement run was mid-way through when it exhausted its budget. | `apps/web/tests/test-helpers/board-build.ts`, `apps/web/tests/test-helpers/board-server.ts`, `apps/web/tests/test-helpers/downstream-fixture.ts` | Deferred — no behavioural impact; the suite is green. Recorded here and in the Testing residual. |
| P4 (advisory) | advisory | `apps/web` declares no direct Vite dependency. The facade generation and import-map injection resolve Vite transitively through Astro 6.4.2, so an Astro bump could move the Vite major with no signal in any manifest this repo controls. | `apps/web/package.json` lists no `vite` entry; `apps/web/node_modules/vite` is absent while `astro` resolves it | Accepted — the emitted manifest records the measured React/DOM/Router versions at build time, and the real-browser proof fails loudly on a broken facade rather than silently degrading. |
| P4 (advisory) | advisory | Nothing asserts that a *value* import of `@gobing-ai/spur/board` fails for a non-TypeScript consumer. The safety of the type-only export currently rests on the declaration alone, so a plain-JS consumer's mistake would surface at their bundle time rather than ours. | `apps/cli/board/index.d.ts:38` is `export declare const webModule`; no fixture performs a value import | Deferred — outside this slice's frozen scope, which requires only the type-check against the installed export (R3). |

No P1 (blocker) and no P2 (major) findings were identified.

Frozen constraints were re-verified clean against the final change set:

- no new public `spur` noun or verb — no CLI source file was modified at all;
- no dependency added, upgraded, or removed in any manifest;
- no plugin/catalog/config loader, no Module Federation, no bridge SDK;
- the reserved-module inventory is generated from host declarations rather than hand-written.

Residual risk: the `implement` stage's agent run exhausted its 30-minute budget before it ran its own
gate. The green gate referenced by the verification verdict was produced by a separate full run over
the same tree, and the task and feature specification files were frozen before that run and were not
modified after it.

### References

- Feature: [A8](../features/A8_downstream-spur-board-modules-and-embedded-resources.md).
- Governing contract: [downstream Board modules](../design/downstream-board-modules.md); [ADR-128](../00_ADR.md#adr-128-project-owned-board-contributions-share-one-host-registry); [UI rules](../../DESIGN.md#product-ui--downstream-board-modules-proposed).
- Investigation/history: [2026-09-27 plan](../plans/2026-09-27-dynamic-board-modules-brainstorm.md). Historical alternatives are not current requirements.
- Dependency outputs: Prerequisites: none. Handoff to tasks 0989, 0990 and 0992: shipped board-runtime.json, exact facade mappings/type export and real-browser proof receipts; 0991 reuses the owned frame fixtures. A proof failure prevents the dependent task pipelines from starting.
- Concurrency audit 2026-09-27: main at 67096d060f951d416f0ad9acdf3a119543bcfe33; task 0984 is wip in /Users/robin/xprojects/spur-wt-0984 and owns unrelated run-evidence helpers. One writer per tree; integrate this planning batch into a clean task branch before implementation. Recheck active worktrees/status at execution start.
- Source facts and proposed new targets are distinguished in Background/Design. Existing dist/web/generated artifacts must be rebuilt before distribution evidence; no generation-freshness claim was inferred from their presence.

### History

- 2026-09-28T22:51:12.159Z todo → wip (system)
- 2026-09-28T23:01:12.318Z wip → testing (system)
- 2026-09-28T23:01:47.639Z testing → done (system)

### Notes

Planning freeze (2026-09-27): Requirements, Design, Plan, AC mapping, closed decisions, dependency contracts and current-tree premises have been audited. These specifications are ready for ordered delegation. Only 0988 is execution-eligible immediately; later tasks wait for their named prerequisites. Normal task checks pass with only L4.prerequisite-not-done warnings on dependent tasks; --as todo elevates those waiting-state findings to errors. Do not remove dependencies, change prerequisite statuses or suppress those findings to make all tasks simultaneously runnable.

Final concurrency recheck: main is now f32848ba6898765d0ecf31b1e7d87bf61a16aa16, git worktree list shows only the root tree, and task list --status wip returns empty. The earlier 0984 ownership note is historical; its other session finished during planning. Material A8 source seams were reread and remain unimplemented. Keep the step-0 clean-tree/tool-version/generated-build precondition for execution.

