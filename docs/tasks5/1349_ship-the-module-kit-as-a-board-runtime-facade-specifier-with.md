---
schema_version: 1
name: Ship the module kit as a Board runtime facade specifier with installed-package types
status: done
template: feature-impl
created_at: 2026-11-16T19:08:27.314Z
updated_at: "2026-11-16T20:04:28.180Z"
feature_id: A81
priority: P1
tags:
  - board
  - web
  - cli
  - distribution

dependencies: ["1348"]
estimate_hours: 8
done_forced: "false"
done_reason: unforced close
---

## 1349. Ship the module kit as a Board runtime facade specifier with installed-package types

### Background

Implements: R3 — The installed Board advertises the UI kit as one additive runtime specifier; R5 — The UI kit authoring types resolve from the installed package without runtime imports; R9 — A Board without the UI kit fails a kit-dependent module with a contained diagnostic.

The host import map today exposes only React/React DOM/React Router facades (BOARD_FACADE_SPECIFIERS in apps/web/src/modules/runtime/manifest.ts). Design: [board-module-ui-kit](docs/design/board-module-ui-kit.md) §3.2–3.3, §4; ADR-150. Runs after the kit extraction task.

Rubric: E5 D1 L3 C1 R1 = 11 → own task (cross web build / manifest / CLI package boundary).


**Refine corrections (2026-11-16)**
- "Same facade mechanism as react/react-router" → `exportNamesOf` (apps/web/scripts/board-runtime.ts:99) measures exports with `createRequire(file)(file)`, which cannot load a TSX module, and `this.resolve(specifier)` (board-runtime.ts:137) needs the specifier to resolve inside the web build → Design now requires a build alias for the kit specifier and a static export list (resolution below).
- "Error containment through ModuleErrorBoundary" → an unresolvable entry import fails in `composeBoardModule` with category `import` (apps/web/src/modules/compose.ts:196-203) before render; ModuleErrorBoundary (apps/web/src/components/ModuleErrorBoundary.tsx:31) only presents it → R5 targets the compose `import` diagnostic.
- "Existing board type-generation path" confirmed: `emit-board-types` (scripts/spur-dev.ts:16, scripts/commands/emit-board-types.ts:19) emits apps/cli/board/index.d.ts from the single source apps/web/src/modules/contribution.ts; the kit needs a second declaration entry.

### Requirements

- [x] R1. Add '@gobing-ai/spur/board/ui' to BOARD_FACADE_SPECIFIERS with a facade chunk re-exporting the module kit from the renderer's client build graph.
- [x] R2. board-runtime.json lists the specifier and records uiKitVersion; manifestVersion, catalogVersion and contributionApiVersion stay 1.
- [x] R3. Generate declaration-only kit types and publish them via the CLI package exports next to @gobing-ai/spur/board; no React value import enters CLI or plugin standalone surfaces (sp-plugin-standalone, plugin-smoke stay green).
- [x] R4. A separately installed downstream fixture typechecks an entry importing the kit.
- [x] R5. A contribution importing the specifier on a Board whose manifest lacks it yields the compose `import` diagnostic (apps/web/src/modules/compose.ts) naming the specifier on its route, while built-ins stay navigable.
- [x] R6. Public-surface consent: the new package export and runtime specifier are recorded in the satellite and changelog (operator consent captured via ADR-150 / A81).

### Acceptance Criteria

- [x] AC1 — The installed Board advertises the UI kit as one additive runtime specifier
- [x] AC2 — The UI kit authoring types resolve from the installed package without runtime imports
- [x] AC3 — A Board without the UI kit fails a kit-dependent module with a contained diagnostic

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T19:09:16.003Z

- **Closed:** specifier is `@gobing-ai/spur/board/ui`, additive; contributionApiVersion stays 1; `uiKitVersion` added to board-runtime.json (ADR-150, board-module-ui-kit §4).
- **Closed:** public-surface consent for the new export/specifier is granted through the operator-run /sp:dev-idea --auto that accepted ADR-150 / A81.
- **Deferred:** preflight gating on `uiKitVersion` — until a second kit major exists.

### Design

Approach (WHERE):
- `apps/web/src/modules/runtime/manifest.ts:53` — append `'@gobing-ai/spur/board/ui'` to `BOARD_FACADE_SPECIFIERS` (frozen name). `BoardFacadeSpecifier` and `facadeChunkName` derive from it (chunk `board-facade-@gobing-ai-spur-board-ui`).
- `apps/web/astro.config.mjs` — Vite `resolve.alias` maps `@gobing-ai/spur/board/ui` → `/src/components/module-kit/index.ts`, so `this.resolve` in `facadePlugin` (apps/web/scripts/board-runtime.ts:137) returns a non-external client-graph id.
- `apps/web/scripts/board-runtime.ts:99` — `exportNamesOf` cannot `require` TSX. Add a frozen `MODULE_KIT_EXPORTS` const in `apps/web/src/components/module-kit/exports.ts` (names only) used for the kit specifier; a unit test asserts it equals the index's runtime export keys (import the index under bun test). React specifiers keep `createRequire` measurement.
- `buildRuntimeManifest` (manifest.ts:97) gains `uiKitVersion: string` (semver, starts `1.0.0`, frozen field name); `manifestVersion`, `catalogVersion`, `contributionApiVersion` unchanged.
- `scripts/commands/bundle-web.ts:68-76` already asserts every specifier maps to a packaged facade asset — no change beyond the list.
- Types: extend `scripts/commands/emit-board-types.ts` with a second declaration-only entry (`apps/web/src/components/module-kit/index.ts`) writing `apps/cli/board/ui/index.d.ts`; add `"./board/ui": { "types": "./board/ui/index.d.ts" }` to apps/cli/package.json exports (next to `./board`, package.json:28) and keep `board` in `files`. Declarations reference `react` types only via `import type`.
- R9: no new code path — `composeBoardModule` returns category `import` (compose.ts:196-203) and the route renders `ModuleDiagnostic` (ModuleErrorBoundary.tsx:31). Prove with a test that an entry importing the unmapped specifier yields that diagnostic with the specifier in its message and that built-in routes still render.

WHY: one React instance and one stylesheet; explicit public specifier list (ADR-128, ADR-150).
Rejected: separate standalone kit bundle (second React instance); shipping kit CSS; wildcard `@gobing-ai/spur/board/*` specifiers; preflight parsing contribution imports.
Anti-patterns: do not hand-maintain the facade list separately from `MODULE_KIT_EXPORTS`; do not add a React value import to apps/cli or plugins/sp.
Assumes from 1348: `apps/web/src/components/module-kit/index.ts` exists with the §4 export set. Leaves for 1350: the specifier, `uiKitVersion` and `@gobing-ai/spur/board/ui` types for the template and browser proof.

### Plan

1. Failure list first: unresolved alias, export-list drift, missing facade asset, manifest version bump, React value import in CLI (R1–R3)
2. Alias + specifier + `MODULE_KIT_EXPORTS` + facade emission; manifest `uiKitVersion` + manifest/runtime-distribution tests (R1, R2)
3. emit-board-types second entry + CLI `./board/ui` export (R3)
4. Installed-fixture typecheck proof against the packed package (R4)
5. Compose `import` diagnostic test for the unmapped specifier (R5)
6. Satellite + CHANGELOG entry (R6); `bun run plugin-smoke`, `build:bundle`, `bun run spur-check`

### Solution

| File | Change |
| --- | --- |
| `apps/web/src/modules/runtime/manifest.ts:10,40,75,116,133` | `BOARD_UI_KIT_SPECIFIER` is the one name for the kit; it joins `BOARD_FACADE_SPECIFIERS` (so `facadeChunkName`, `BoardFacadeSpecifier`, the import map and `bundle-web`'s asset assertion all derive from it), and the manifest gains `uiKitVersion` while `manifestVersion`/`catalogVersion`/`contributionApiVersion` stay `1`. |
| `apps/web/src/components/module-kit/exports.ts:1-30` | Frozen `MODULE_KIT_EXPORTS` (the facade's re-export list — the build cannot `require` a TSX barrel the way it measures React) and `BOARD_UI_KIT_VERSION = '1.0.0'`; a unit test keeps the list equal to the barrel's runtime exports. |
| `apps/web/scripts/board-runtime.ts:33,115-116,153,229` | `exportNamesFor` branches to the frozen list for the kit specifier and keeps `createRequire` measurement for npm packages; `buildRuntimeManifest` is called with `uiKitVersion`. |
| `apps/web/astro.config.mjs:21` | Vite alias maps the bare specifier to `/src/components/module-kit/index.ts`, so `this.resolve` returns a client-graph id and the facade chunk is emitted from the renderer's own build. |
| `scripts/commands/emit-board-types.ts:59-200` | Second declaration entry: `renderKitDeclarations` compiles the kit barrel with `emitDeclarationOnly` and mirrors every emitted file under `KIT_SOURCE_ROOT` (`apps/web/src/components`), so `module-kit/*.d.ts` + the re-exported `ui/*.d.ts` keep their relative imports; `emitKitDeclarations` writes the mirror, refuses a path outside the mirror root, asserts the frozen entry re-exports and each component's `declare function`, and rewrites `import React` to `import type React` so the artifact carries no runtime React import. |
| `scripts/spur-dev.ts:70,144-151` | The `emit-board-types` step now emits both artifacts (and `build:bundle` chains it, so packing refreshes the mirror). |
| `apps/cli/package.json:31-33` | `"./board/ui": { "types": "./board/kit/module-kit/index.d.ts" }` next to `./board`; `board` is already in `files`, so the mirror ships. |
| `apps/cli/board/kit/**` (11 generated files) | The committed declaration mirror: ⌄`module-kit/` entry + components, `ui/` primitives. Generated, so biome ignores the directory (`biome.json:21`); the emit-vs-disk test guards drift. |
| `packages/contracts/src/board.ts:28-32` | `uiKitVersion` as an optional host-runtime field: a Board built before the kit keeps parsing, and the new field is visible to catalog consumers. |
| `apps/web/src/components/ui/{Badge,Button,Card}.tsx:27/23/17` | Added an explicit optional `children` prop to the three re-exported primitives. They already render children; React 19 no longer implies the prop, so `<Badge>ready</Badge>` from a contribution did not typecheck. Additive, no behavior change — and the installed-consumer typecheck (below) is what surfaced it. |
| `apps/web/tests/components/module-kit/exports.test.ts` | Frozen-list equality + semver check. |
| `apps/web/tests/components/module-kit-consumer-types.test.tsx` | Installed-package proof (R4): a temp consumer outside the checkout whose `node_modules` holds `@gobing-ai/spur` → `apps/cli` runs a real TypeScript program over an entry importing `@gobing-ai/spur/board/ui`; resolution goes through the package `exports` map and reports zero diagnostics. |
| `apps/web/tests/modules/compose.test.ts` (new case) | R5: a contribution whose entry import fails with the browser's own `Failed to resolve module specifier "@gobing-ai/spur/board/ui"` lands as that route's `import` diagnostic naming the specifier, with built-ins still composed and no host diagnostic. |
| `apps/web/tests/modules/runtime/manifest.test.ts`, `apps/web/tests/modules/runtime-distribution.test.ts` | Manifest: the specifier is additive, `uiKitVersion` is recorded, the chunk name is path-safe. Distribution: a real board build advertises the kit asset and its facade re-exports the kit's components. |
| `scripts/commands/emit-board-types.test.ts` | Kit declarations: committed mirror equals generated output, entry re-exports, per-component declarations, declaration-only, deterministic. |
| `apps/web/tests/fixtures/downstream-board/contribution/kit-usage.tsx` | The installed-tarball fixture entry (R4 at the heavy layer, with the packed package) typechecks the kit imports. |
| `docs/design/board-module-ui-kit.md:1-75`, `CHANGELOG.md:3-9` | R6: the satellite records the shipped specifier, `uiKitVersion`, declaration layout, props compensation and the failure path, and moves to `accepted`; the changelog carries the two public-surface bullets under `[Unreleased]` (the release section itself is generated from commits). |

Verification: `spur task gate 1349 light` PASS on the final tree (10 checks: format-lint, rules:pre, rules:post, five workspace typechecks, `test:apps/web`, `test:plugins/sp`); `bun run --filter @gobing-ai/spur-web build` emits `board-runtime.json` with the kit specifier + `uiKitVersion 1.0.0` and the `board-facade-@gobing-ai-spur-board-ui` chunk; `bun test tests/modules/runtime-distribution.test.ts` 10 pass; `bun run plugin-smoke` PASS.

Deviation from the task Design: the declaration mirror lands at `apps/cli/board/kit/` (mirroring `apps/web/src/components`) rather than `apps/cli/board/ui/index.d.ts`. A single-file `board/ui/index.d.ts` cannot be emitted from a barrel that re-exports its siblings plus `../ui/*` without breaking those relative imports; the published subpath is still `@gobing-ai/spur/board/ui`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — add `@gobing-ai/spur/board/ui` to BOARD_FACADE_SPECIFIERS with a facade chunk re-exporting the module kit from the renderer's client build graph | MET | `apps/web/src/modules/runtime/manifest.ts:10` (the one specifier constant) and `:75` (in `BOARD_FACADE_SPECIFIERS`, so `facadeChunkName`/`BoardFacadeSpecifier`/import map derive from it); `apps/web/astro.config.mjs:21` (alias → `/src/components/module-kit/index.ts`) and `apps/web/scripts/board-runtime.ts:115-116,153` (frozen `MODULE_KIT_EXPORTS` for a TSX barrel, measured `createRequire` names for npm packages); a real build emits `board-facade-@gobing-ai-spur-board-ui` and the test asserts the facade re-exports the kit's components — `apps/web/tests/modules/runtime-distribution.test.ts:73-87` |
| R2 — `board-runtime.json` lists the specifier and records `uiKitVersion`; `manifestVersion`, `catalogVersion`, `contributionApiVersion` stay 1 | MET | test — `apps/web/tests/modules/runtime/manifest.test.ts:57-67` asserts the specifier, `uiKitVersion === '1.0.0'` and all three protocol versions still `1`; `manifest.ts:40,116,133` carries the field through `buildRuntimeManifest`; the emitted `dist/web/board-runtime.json` reports `uiKitVersion 1.0.0` with the other versions unchanged (`bun run --filter @gobing-ai/spur-web build`) |
| R3 — generate declaration-only kit types and publish them through the CLI package exports next to `@gobing-ai/spur/board`; no React value import in CLI/plugin surfaces (sp-plugin-standalone, plugin-smoke green) | MET | `scripts/commands/emit-board-types.ts:139-208` (mirror emit, outside-root refusal, frozen entry/per-component lines, `import React` → `import type React`); `apps/cli/package.json:31-33` (`./board/ui` → the mirror entry; `board` already in `files`); `scripts/commands/emit-board-types.test.ts:52-88` asserts the committed mirror equals generated output, is declaration-only and deterministic; `command` — `spur task gate 1349 light` PASS (rules:pre includes `sp-plugin-standalone`; the emitted `.d.ts` set has no value import) and `bun run plugin-smoke` → "plugin surface is standalone and installs clean" |
| R4 — a separately installed downstream fixture typechecks an entry importing the kit | MET | test — `apps/web/tests/components/module-kit-consumer-types.test.tsx:87-97` compiles a consumer that lives OUTSIDE the checkout, resolving `@gobing-ai/spur/board/ui` through `apps/cli`'s real `exports` map, and expects zero diagnostics; `apps/web/tests/fixtures/downstream-board/contribution/kit-usage.tsx` keeps the same proof at the packed-tarball layer (heavy suite) |
| R5 — a contribution importing the specifier on a Board whose manifest lacks it yields the compose `import` diagnostic naming the specifier, built-ins still navigable | MET | test — `apps/web/tests/modules/compose.test.ts:174-195`: the browser's own `Failed to resolve module specifier "@gobing-ai/spur/board/ui"` renders the module's route as `module-diagnostic` / `data-failure-category="import"` containing the specifier, with built-ins composed and `hostDiagnostics` empty; the containment path itself is unchanged (`apps/web/src/modules/compose.ts:196-203`, `ModuleErrorBoundary.tsx`) |
| R6 — public-surface consent recorded for the new package export and runtime specifier in the satellite and changelog | MET | `docs/design/board-module-ui-kit.md:78-91` records the shipped specifier, `uiKitVersion`, declaration layout, the `children` compensation and the failure path (status now `accepted`, consent via ADR-150/A81); `CHANGELOG.md:3-9` carries the two public-surface bullets under `## [Unreleased]` with `src:` anchors — the release sections themselves are machine-generated from commits |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The installed Board advertises the UI kit as one additive runtime specifier | MET | test | `apps/web/tests/modules/runtime-distribution.test.ts:73-87` (built board: specifier present, asset exists, facade re-exports the kit) + `apps/web/tests/modules/runtime/manifest.test.ts:57-67` (versions unchanged) |
| AC2 — The UI kit authoring types resolve from the installed package without runtime imports | MET | test | `apps/web/tests/components/module-kit-consumer-types.test.tsx:87-97` (outside-checkout consumer, `exports`-map resolution, zero diagnostics) + `scripts/commands/emit-board-types.test.ts:75-82` (declaration-only, no value import) |
| AC3 — A Board without the UI kit fails a kit-dependent module with a contained diagnostic | MET | test | `apps/web/tests/modules/compose.test.ts:174-195` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Functional + SECUA focus: PASS. All six requirements and three acceptance criteria carry direct evidence — the specifier and manifest field (`apps/web/src/modules/runtime/manifest.ts:10,40,75`), the facade emission path (`apps/web/scripts/board-runtime.ts:115-116,153,229`), the generated declaration mirror and its frozen assertions (`scripts/commands/emit-board-types.ts:139-208`, `scripts/commands/emit-board-types.test.ts:52-88`), the package export (`apps/cli/package.json:31-33`), the installed-consumer typecheck (`apps/web/tests/components/module-kit-consumer-types.test.tsx:87-97`), and the contained import diagnostic (`apps/web/tests/modules/compose.test.ts:174-195`). Gate evidence: light gate PASS on 10 checks; `bun run --filter @gobing-ai/spur-web build` produced `board-runtime.json` with `uiKitVersion 1.0.0` plus the kit facade chunk; `bun run plugin-smoke` PASS.

Findings (advisory, none blocking):

- **P4** — the declaration mirror is `apps/cli/board/kit/` rather than the Design's literal `apps/cli/board/ui/index.d.ts`; a single-file entry cannot re-export siblings plus `../ui/*` without breaking relative paths. Published subpath unchanged; deviation recorded in the Solution and the satellite.
- **P4** — the kit chunk emits Vite's `"default" is not exported` warning, the same class the React Router facades already emit.
- **P4** — `uiKitVersion` is advertised but not gated on, per the task's recorded deferral.
- **P4** — `CHANGELOG.md` gained `## [Unreleased]` because release sections are generated from commits.

Residual risk: the packed-tarball layer (fixture build + browser proof) runs at the feature's integrated full gate, not per task; per-task evidence is the installed-consumer typecheck, the real board build and the distribution test. Disposition: PASS, no follow-up filed.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T20:03:55.506Z todo → wip (system)
- 2026-11-16T20:04:26.872Z wip → testing (system)
- 2026-11-16T20:04:28.176Z testing → done (system)

