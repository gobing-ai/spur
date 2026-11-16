---
kind: design
title: Board module UI kit — shared shell primitives for native contributions
status: accepted
created_at: 2026-11-16
updated_at: 2026-11-16
related: [A81, A8, docs/design/downstream-board-modules.md]
tags: [contract, A81, web, board]
---

# Board module UI kit — shared shell primitives for native contributions

## 1. Issue and scope

Native project Board modules ([downstream Board modules](downstream-board-modules.md), ADR-128)
receive React and React Router from the host, but nothing else. Every built-in module shell
(History, Observability, Tasks, Features, Plans, Designs) composes its ADR-081 header, tab strip and
filter row from Tailwind/daisyUI classes and private `apps/web/src/components` primitives that a
contribution cannot import. Downstream modules therefore re-implement the shell: knowledge-kit's
`kk-collect`, `kk-daily-ai-voice2` and `kk-itc` carry ~1.3k lines of look-alike CSS
(`apps/board/src/shared/board.css` in that repository) and still drift in layout and density.

This design (feature [A81](../features/A81_board-module-ui-contract-and-shared-ui-kit-for-downstream-modules.md),
ADR-150) adds one Spur-owned runtime module of shell primitives that the host shares with native
contributions through the existing facade/import-map mechanism, plus a starter template. The UI
rules those primitives implement belong to root [DESIGN.md](../../DESIGN.md) (module-shell
section); this file owns the non-UI contract: specifier, exports, versioning, types, distribution
and failure behavior. Migrating knowledge-kit is out of scope (that repository's follow-up).

## 2. Context and constraints

- `BOARD_FACADE_SPECIFIERS` in `apps/web/src/modules/runtime/manifest.ts` is the explicit list of
  bare specifiers the Board resolves to facade chunks emitted from **its own client build graph**;
  `board-runtime.json` records them under `imports`. Each entry is a public resolution promise.
- Host CSS is one Tailwind v4 + daisyUI build scanning `apps/web/src`. Classes used by code inside
  that tree are present in the shipped stylesheet; a contribution must not ship Tailwind or global
  resets (downstream design §6.3).
- ADR-128 / downstream design §4.2 publish `@gobing-ai/spur/board` as a **type-only** export and
  forbid React value imports in CLI and plugin standalone surfaces.
- Built-in shells currently inline their header/tab markup per module (e.g.
  `modules/observability/ObservabilityShell.tsx`); `TimeRangePresets` lives in a module-private
  file. Shell tests (Tasks F72, History, Observability) pin the present layout and URL state.
- Contributions share the React instance but not host context objects (downstream design §6.6), so
  kit components cannot depend on host providers (registry, rpc client, theme context).

## 3. Solution

1. **Extract.** Move the shell primitives the built-in shells already render into
   `apps/web/src/components/module-kit/` as presentational, controlled components with no host
   context, router or rpc dependency. Built-in shells adopt them (at least one in this feature,
   others opportunistically), so host and downstream render the *same* code.
2. **Share.** Add one bare specifier, `@gobing-ai/spur/board/ui`, to `BOARD_FACADE_SPECIFIERS`. Its
   facade chunk re-exports the kit from the same client build graph as the renderer, so it uses the
   host React instance and the host stylesheet already contains its classes. No CSS ships with the
   contribution for kit components.
3. **Type.** Generate a declaration-only artifact for the kit's public props and publish it under
   the existing type-only `@gobing-ai/spur/board` export family (e.g. `@gobing-ai/spur/board/ui`
   types). The CLI package gains `.d.ts` files only — no React value import.
4. **Template.** Ship a starter module (Vite library config externalizing exactly the
   `board-runtime.json` import keys, an entry exporting `webModule` built from kit components, a
   scoped stylesheet for module-private content) at a plugin-owned template path that
   `sp:spur-composer`'s board-module UI reference links. The in-repo fixture module used by the
   browser proof is built from the same template.

| Owner | Responsibility |
| --- | --- |
| root `DESIGN.md` | Normative module-shell rules (anatomy, density, states, themes) for built-in and downstream modules |
| `apps/web` | Kit components, built-in shell adoption, facade emission, manifest specifier |
| `apps/cli` distribution | Kit declaration files in the type-only export; facade asset in shipped Board |
| `plugins/sp/skills/spur-composer` | Board-module UI reference + starter template (links owners, never restates) |
| this satellite + downstream design §6 | Specifier/exports/compatibility contract and authoring steps |

## 4. Contract and compatibility

**Specifier.** `@gobing-ai/spur/board/ui` — value exports resolved only through the host import
map. A contribution lists it as a Vite external alongside the React/router keys.

**Shipped facts (tasks 1348/1349).** `BOARD_UI_KIT_SPECIFIER` in
`apps/web/src/modules/runtime/manifest.ts` is the one name; the client build emits the facade chunk
`board-facade-@gobing-ai-spur-board-ui` from the same graph as the renderer, and
`buildRuntimeManifest` records `uiKitVersion` (currently `1.0.0`, from
`apps/web/src/components/module-kit/exports.ts`). The facade's re-export list is the frozen
`MODULE_KIT_EXPORTS` (the build cannot `require` a TSX barrel), and a unit test keeps it equal to
the barrel's runtime exports.

**Types.** The kit's declarations are generated by `scripts/commands/emit-board-types.ts` into
`apps/cli/board/kit/` — a mirror of `apps/web/src/components` (`module-kit/*.d.ts` plus the
re-exported `ui/*.d.ts`), so the declarations' relative imports keep resolving. The published
subpath `@gobing-ai/spur/board/ui` maps to `apps/cli/board/kit/module-kit/index.d.ts`; the mirror
is declaration-only and carries no runtime React import (`import type`), and the `board`
directory already ships in the package `files`.

**Initial export set** (each extracted from an existing built-in usage; add a component only with
a demonstrated second consumer):

| Export | Purpose (UI rules in DESIGN.md) |
| --- | --- |
| `ModuleShell` | Page container with ADR-081 density and width rules; slots header + body |
| `ModuleHeader` | One-row header: icon, title, subtitle, optional status chip, filter slot, tab slot |
| `ModuleTabs` | Accessible `tablist` strip (controlled `value`/`onChange`, append-only order) |
| `TimeRangePresets` | Range preset group (controlled; the consumer supplies its preset vocabulary) |
| `Card`, `Badge`, `Button` | Existing `components/ui` primitives, re-exported unchanged |
| `EmptyState`, `Diagnostic`, `Loading` | Standard empty, error and loading states |

`Card`, `Badge` and `Button` gained an explicit optional `children` prop when the kit shipped: they
render children at runtime, and React 19 no longer implies that prop, so a contribution writing
`<Badge>ready</Badge>` needed it declared.

Components are controlled and side-effect free; URL synchronization stays in the consumer
(built-ins keep their `useSearchParams` wiring). Props are the public contract; class names and DOM
structure are not.

**Manifest.** `board-runtime.json` `imports` gains the specifier; `manifestVersion`,
`catalogVersion` and `contributionApiVersion` stay `1` (additive). The manifest records a
`uiKitVersion` (semver of the kit's prop contract). Breaking a prop is a major `uiKitVersion` bump;
removing the specifier is a contribution API change and out of scope.

**Failure.** A module importing the specifier on a Board whose manifest lacks it fails module
import; the existing module error boundary shows a diagnostic on that route naming the unresolved
specifier, and built-ins stay navigable. No serve-preflight check parses contribution imports (the
host does not inspect downstream bundles). Pinned by
`apps/web/tests/modules/compose.test.ts` (the browser's own `Failed to resolve module specifier …`
lands as the route's `import` diagnostic).

**Compatibility.** Existing contributions that do not import the kit are unaffected. Iframe
contributions are unchanged. Worker deployments remain without filesystem module loading.

## 5. Tradeoffs and open questions

Recorded in [ADR-150](../00_ADR.md#adr-150-the-board-shares-shell-primitives-with-native-contributions-through-its-runtime-facade):
a shared runtime kit (chosen) versus a documentation-only contract with a shipped token
stylesheet (cheaper but imitation drifts on every host restyle) versus a project-specific Board
build (ADR-128 fallback; heavy for downstream projects).

Resolved: the starter template ships as a plugin skill asset at
`plugins/sp/skills/spur-composer/templates/board-module/` (ADR-130 placement; `sp-plugin-standalone`
scopes hooks/scripts/lib, so the template's React imports are out of its scope). Still open: whether
`uiKitVersion` also gates at preflight, deferred until a second kit major exists.
