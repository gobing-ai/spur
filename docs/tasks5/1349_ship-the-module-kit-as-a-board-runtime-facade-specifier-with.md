---
schema_version: 1
name: Ship the module kit as a Board runtime facade specifier with installed-package types
status: todo
template: feature-impl
created_at: 2026-11-16T19:08:27.314Z
updated_at: "2026-11-16T19:36:32.755Z"
feature_id: A81
priority: P1
tags:
  - board
  - web
  - cli
  - distribution

dependencies: ["1348"]
estimate_hours: 8
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

- [ ] R1. Add '@gobing-ai/spur/board/ui' to BOARD_FACADE_SPECIFIERS with a facade chunk re-exporting the module kit from the renderer's client build graph.
- [ ] R2. board-runtime.json lists the specifier and records uiKitVersion; manifestVersion, catalogVersion and contributionApiVersion stay 1.
- [ ] R3. Generate declaration-only kit types and publish them via the CLI package exports next to @gobing-ai/spur/board; no React value import enters CLI or plugin standalone surfaces (sp-plugin-standalone, plugin-smoke stay green).
- [ ] R4. A separately installed downstream fixture typechecks an entry importing the kit.
- [ ] R5. A contribution importing the specifier on a Board whose manifest lacks it yields the compose `import` diagnostic (apps/web/src/modules/compose.ts) naming the specifier on its route, while built-ins stay navigable.
- [ ] R6. Public-surface consent: the new package export and runtime specifier are recorded in the satellite and changelog (operator consent captured via ADR-150 / A81).

### Acceptance Criteria

- [ ] AC1 — The installed Board advertises the UI kit as one additive runtime specifier
- [ ] AC2 — The UI kit authoring types resolve from the installed package without runtime imports
- [ ] AC3 — A Board without the UI kit fails a kit-dependent module with a contained diagnostic

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
