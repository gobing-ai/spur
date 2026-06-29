---
schema_version: 1
name: Module auto-discovery for the Spur Board web registry
description: Module auto-discovery for the Spur Board web registry
status: done
created_at: 2026-06-27T00:41:16.312Z
updated_at: 2026-06-29T16:38:40.309Z
folder: docs/tasks2
type: task
feature-id: ""
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0134. Module auto-discovery for the Spur Board web registry

### Background

The board registry (apps/web/src/modules/registry.ts) is a hand-maintained builtins array: every new UI plugin requires editing the array plus adding a directory. The how_to_extend guide promises 'one directory + one registry line'; auto-discovery makes it literally 'one directory, zero wiring'. Today only apps/web/src/modules/ is scanned. Going forward we want multiple configurable roots (extension folders) and an explicit blacklist — a discovered module can be disabled by id without deleting it. The discovery + enable/disable API must be a small reusable surface so the source of the roots/blacklist is swappable later (e.g. .spur/config.yaml via RPC).


### Requirements
- [ ] R1. Auto-discover board modules by scanning configured roots via Vite `import.meta.glob` (eager, `as: 'sync'`); a module is any direct child directory of a root whose `index.{ts,tsx}` exports a `WebModule` via a **default export** or a **named `module` export**.
- [ ] R2. Ship a single default root on first cut: `apps/web/src/modules/`.
- [ ] R3. Migrate `task-kanban` to the discovery contract (named `module` export) and delete the hand-maintained `builtins` array; the registry no longer imports any module by name.
- [ ] R4. Expose a runtime registry API: `registerModuleRoot(dir)`, `enableModule(id)`, `disableModule(id)`, `getEnabledModules()`, `getModule(id)`, plus the existing consumer exports `modules`, `getModule`, `defaultModule` — so `router.tsx`, `LeftSidebar.tsx`, and `BoardLayout.tsx` keep importing `{ modules }` / `{ defaultModule }` / `{ getModule }` unchanged.
- [ ] R5. Blacklist: `disableModule(id)` removes a discovered module from the enabled set without deleting it; `enableModule(id)` restores it. Default roots and default-disabled ids live in a static config module `apps/web/src/modules/config.ts` (`roots: string[]`, `disabled: string[]`).
- [ ] R6. Deterministic order: enabled modules are ordered by root order, then by stable discovery (sorted) order within a root; `defaultModule` is the first enabled module (Tasks today).
- [ ] R7. Fail-fast validation at module load: duplicate ids or duplicate route segments across roots throw a loud error naming the colliding id/route and both sources — matching the server module registry pattern (`docs/design/server-side-adjustment-design.md` §2.4).
- [ ] R8. Separate build-time discovery from the runtime registry so the registry is unit-testable under `bun test` (which does not transform `import.meta.glob`): `discover.ts` owns the glob and returns the raw list; `registry.ts` is a pure runtime object that takes an injected module list and owns enable/disable/order/validation; `index.ts` wires the glob output into the registry once at app load.
- [ ] R9. Tests (bun:test, happy-dom): (a) registry with an injected list returns correct `modules`/`defaultModule`/`getModule`; (b) `disableModule` removes a module from all three consumer views and `enableModule` restores it; (c) duplicate-id and duplicate-route detection throws; (d) ordering is root-then-discovery stable; (e) an integration test proves the real `discover.ts` glob resolves the `task-kanban` module (guarded to run only under the Vite/Astro build, or stubbed at the registry seam for bun:test).
- [ ] R10. Update `docs/help/how_to_extend_a_new_module_for_spur_board.md` to reflect zero-wiring: drop the "register it (one registry line)" step, document the named `module` export contract, the `config.ts` roots/disabled lists, and the `registerModuleRoot`/`enableModule`/`disableModule` API.
- [ ] R11. Gate green: `bun run lint`, `bun run test` (web workspace + full repo), `bun run build` (proves the Astro build resolves the glob).
### Acceptance Criteria

**Core scenarios (must-pass gate):**

- [ ] **AC1 — A new module is discovered with zero wiring.** Given a directory `apps/web/src/modules/notes/index.tsx` exists exporting `module: WebModule`, when the board builds and loads, then `notes` appears in the sidebar nav and `/board/notes` resolves to its component — with no edit to `registry.ts` or any import list.
- [ ] **AC2 — The Tasks module survives the migration.** Given `task-kanban/index.tsx` is migrated to `export const module = …`, when the board loads, then `/board/tasks` renders the kanban, `/` redirects to `/board/tasks`, and the active-module highlight works exactly as before.
- [ ] **AC3 — Consumer call sites are unchanged.** Given `router.tsx`, `LeftSidebar.tsx`, and `BoardLayout.tsx` import `{ modules }` / `{ defaultModule }` / `{ getModule }` from `./modules/registry`, when the registry is rebuilt, then these three files have no source diff (only `registry.ts`/`discover.ts`/`config.ts` change).
- [ ] **AC4 — A module can be disabled without deletion.** Given `notes` is discovered, when `disableModule('notes')` runs (or `notes` is listed in `config.ts` `disabled`), then `notes` is absent from `modules`, `getModule('notes')` returns `undefined`, and `defaultModule` is never `notes`.
- [ ] **AC5 — A disabled module can be re-enabled.** Given `notes` is disabled, when `enableModule('notes')` runs, then `notes` reappears in `modules` in its original position and `getModule('notes')` resolves again.
- [ ] **AC6 — Duplicate ids fail loud.** Given two discovered modules share `id: 'notes'`, when the registry loads, then it throws an error whose message names `'notes'` and both source directories.
- [ ] **AC7 — Duplicate routes fail loud.** Given two discovered modules share `route: 'notes'`, when the registry loads, then it throws an error whose message names the colliding route and both sources.
- [ ] **AC8 — Order is deterministic.** Given roots `[A, B]` with modules `A/z, A/a, B/m`, when the registry builds the enabled list, then the order is `A/a, A/z, B/m` (root order, then sorted discovery order within root), and `defaultModule` is `A/a`.

**Edge-case scenarios (advisory):**

- [ ] **AC9 — Test environment isolates the glob.** Given `bun test` does not transform `import.meta.glob`, when registry unit tests run, then they inject a hand-built module list into the registry and never invoke `discover.ts`'s glob directly.
- [ ] **AC10 — Empty root is harmless.** Given a configured root with no child directories exporting a `WebModule`, when the registry loads, then it contributes zero modules and emits no error.
- [ ] **AC11 — Build proves discovery.** Given the Astro build runs, when `bun run build` completes, then the built bundle contains the `task-kanban` module resolved via the glob (no runtime "module not found").

### Q&A



### Design
**Approach — separate build-time discovery from the runtime registry.** The single hard constraint: `import.meta.glob` is a Vite/Astro build-time transform, invisible to `bun test`. So the glob call must live in a module the unit tests never import directly; the registry itself must be a pure runtime object that takes a module list as input.

**File layout (all under `apps/web/src/modules/`):**

- **`types.ts`** — unchanged. `WebModule` stays the single contract.
- **`config.ts`** (new) — the static source of truth for discovery inputs:
  ```ts
  export const moduleRoots = ['./'] as const;            // relative to modules/ — first cut: one root
  export const disabledModules: readonly string[] = [];  // ids to drop after discovery
  ```
  Kept as a static TS module (not `.spur/config.yaml`) so discovery stays a pure web build-time concern with no server round-trip. The registry API takes these as inputs, so a future RPC-backed config can layer on without rework.
- **`discover.ts`** (new) — the only place `import.meta.glob` is called. Eager (`{ eager: true, as: 'sync' }`) so the registry can validate/order synchronously at load:
  ```ts
  const entries = import.meta.glob('./*/index.{ts,tsx}', { eager: true, as: 'sync' });
  export function discoverModules(): WebModule[] { /* read `module` named export or default from each; collect */ }
  ```
  Discovery contract: each `index` must export a `WebModule` via a **named `module`** export, or a **default export**. Missing both → the child is skipped (not an error), so non-module directories don't break discovery.
- **`registry.ts`** (rewritten) — the runtime registry. Pure, injectable, owns enable/disable/order/validation:
  ```ts
  export function createRegistry(discovered: WebModule[], opts?: { disabled?: readonly string[] }): Registry;
  ```
  where `Registry` exposes `modules`, `getModule(id)`, `defaultModule`, `enableModule(id)`, `disableModule(id)`, `getEnabledModules()`, `registerModuleRoot(dir)`. The module-level singletons `modules` / `getModule` / `defaultModule` are exported from a thin `index.ts` that wires `discoverModules()` + `config.ts` into `createRegistry` once at app load — preserving the exact consumer import shape.
- **`index.ts`** (new) — the wiring seam: `const reg = createRegistry(discoverModules(), { disabled: disabledModules }); export const modules = reg.modules; export const getModule = reg.getModule; export const defaultModule = reg.defaultModule;`

**Consumer migration:** `router.tsx`, `LeftSidebar.tsx`, `BoardLayout.tsx` keep importing from `./modules/registry` (re-exported through `index.ts`) — **zero source diff**. `task-kanban/index.tsx` changes one line: `export const TaskKanbanModule = …` → `export const module: WebModule = …`.

**Validation & ordering (fail-fast):** `createRegistry` throws if two discovered modules share `id` or `route` — message names the collision and both source paths. Ordering: outer order = `moduleRoots` order; inner order = sorted directory name within a root (stable, independent of glob return order, which is not guaranteed deterministic). `defaultModule` = `modules[0]`.

**Testability seam (the payoff of the split):** registry tests call `createRegistry([a, b], { disabled: ['b'] })` with hand-built `WebModule` fixtures — no Vite, no glob, no happy-dom needed for the core logic tests. `discover.ts` gets one guarded integration test (runs under the Astro build or is stubbed at the seam).

**Boundary-rule interaction:** `ui-import-seam-only` / `no-daisyui-class-leak` (config/rules/ui/) are unaffected — discovery changes how modules are *registered*, not how they *import UI*.

**Rejected alternatives:**
- *Runtime `fs.readdirSync`* — only works server-side; the board is an Astro `client:only` island hydrating in the browser. Rejected.
- *Hand-maintained array + a separate blacklist* — keeps the manual edit point the task exists to remove. Rejected.
- *Eager vs lazy glob* — lazy (`() => import()`) defers validation to route-hit time and makes duplicate-id detection non-eager; eager keeps the fail-fast contract at load. Chosen: eager.

**Risk R1 — glob determinism.** `import.meta.glob` return order is not spec'd; mitigated by sorting within root in `discover.ts`. Risk R2 — a stray non-module directory under a root must not break the build; mitigated by skip-on-no-export (AC10).
### Solution
**Implemented — `import.meta.glob` auto-discovery with a pure runtime registry.**

File layout under `apps/web/src/modules/`:
- `config.ts:1` (new) — `moduleRoots: ['./']`, `disabledModules: []`. Pure data, the swappable source for roots/blacklist.
- `discover.ts:94` (new) — the sole `import.meta.glob('./*/index.{ts,tsx}', { eager: true, as: 'sync' })` call (`discover.ts:77`). Reads the named `module` export (fallback: `default`) via `readModule` (`discover.ts:44`)/`isWebModule` (`discover.ts:52`); sorts within root by directory name; skips entries with no WebModule export. Ships a bun-test fallback (`discoverViaFs`, `discover.ts:129`) wired from `discoverModules()` (`discover.ts:95`) so unit tests resolve `task-kanban` without the Vite transform.
- `registry.ts:105` (rewritten) — `createRegistry(discovered, opts?)`: pure runtime registry owning duplicate id/route fail-fast validation, enable/disable, ordering (root-then-sorted), and the `modules`/`getModule`/`defaultModule` consumer exports (`registry.ts:108,111,116`). The module-level singletons wire `discoverModules()` + `config.ts` once at load.
- `apps/web/src/modules/task-kanban/index.tsx:114` — one-line rename: `export const TaskKanbanModule` → `export const module: WebModule`.

Consumer migration: `apps/web/src/router.tsx`, `apps/web/src/components/LeftSidebar.tsx`, `apps/web/src/components/BoardLayout.tsx` have **zero source diff** (verified via `git diff --stat`) — they import `{ modules }` / `{ defaultModule }` / `{ getModule }` from `./modules/registry` unchanged.

Tests (all bun:test, happy-dom): `apps/web/tests/modules/registry.test.ts` (createRegistry fixtures + singleton wrappers), `apps/web/tests/modules/discover.test.ts` (readModule/isWebModule branches, discoverViaGlob with injectable glob, discoverViaFs with injectable fs seam covering catches + sort, real-fallback integration resolving task-kanban). `discover.ts` + `registry.ts` at 100% function/line coverage.

Gates: `bun run lint` clean (7 workspaces); `bun run test` 1994/1994 pass, 99.48% function / 99.12% line aggregate; `bun run test-cf` pass; `bun run build` succeeds — the Astro web build resolves the glob and `task-kanban` lands in the BoardApp bundle (AC11 concretely verified: the `/board/tasks` route and `tasks` module id are present in `dist/web/_astro/BoardApp.DbI3iLzZ.js`).
### Plan
1. **Add `config.ts`** — `moduleRoots` (first cut: `['./']`) and `disabledModules` (`[]`). No behavior yet; pure data.
2. **Add `discover.ts`** — `import.meta.glob('./*/index.{ts,tsx}', { eager: true, as: 'sync' })`; `discoverModules(): WebModule[]` reads the `module` named export (fallback: default) from each entry, sorts within root by directory name, skips entries with no `WebModule` export.
3. **Rewrite `registry.ts`** — `createRegistry(discovered, opts)` returning `{ modules, getModule, defaultModule, enableModule, disableModule, getEnabledModules, registerModuleRoot }`. Implement fail-fast duplicate `id`/`route` detection and the disable/enable filter. Keep the type-only `WebModule` re-export.
4. **Add `index.ts`** — wire `createRegistry(discoverModules(), { disabled: disabledModules })` into the module-level singletons; re-export `modules`, `getModule`, `defaultModule`. Confirm `router.tsx` / `LeftSidebar.tsx` / `BoardLayout.tsx` still resolve via `./modules/registry` (re-export from `index.ts` or update the barrel — **zero logic diff in the three consumers**).
5. **Migrate `task-kanban`** — rename `export const TaskKanbanModule = …` to `export const module: WebModule = …`. Update the one internal reference (if any) and the registry test's `getModule('tasks')` assertion still holds.
6. **Delete the old `builtins` array** from `registry.ts` — it is fully replaced by discovery.
7. **Tests** — (a) `registry.test.ts`: rewrite to use `createRegistry` with hand-built fixtures covering AC1–AC8 (modules/getModule/defaultModule, disable→enable, duplicate id throws, duplicate route throws, ordering root-then-sorted, empty root harmless). (b) `discover.test.ts`: one guarded test that `discoverModules()` resolves `task-kanban` (stub the glob seam or mark build-only). (c) Keep `BoardLayout.test.tsx` / `ResponsiveAndTheme.test.tsx` green (they hit the real registry via the consumer surface).
8. **Update `docs/help/how_to_extend_a_new_module_for_spur_board.md`** — remove the "Register it (one registry line)" step; document the named `module` export contract, `config.ts` roots/disabled lists, and the `registerModuleRoot`/`enableModule`/`disableModule` API. Add a "disable without deleting" subsection.
9. **Gate** — `bun run lint` → `bun run test` (web, then full repo) → `bun run build` (proves the Astro build resolves the glob and `task-kanban` lands in the bundle). Fix any failure at the root cause; no `--no-verify`, no suppressions.
10. **Commit** — atomic conventional commit: `feat(web): auto-discover board modules via import.meta.glob`.
### Review
**Coverage-first hardening — made the build-only paths unit-testable.**

The initial implementation left `discover.ts` at 78% line coverage and `registry.ts` at 93% — both below the 90% per-file gate. Root cause: `discoverViaGlob` (the always-live browser path) is dead under `bun test` because `import.meta.glob` is `undefined` there, and `discoverViaFs`'s defensive catches + sort comparator were unreachable with a single real module dir.

Resolution: inject the dependencies rather than suppress the gate. `discoverViaGlob` now takes the glob fn as a param; `discoverViaFs` takes an `FsSeam` (`readdirSync` + `tryRequire`); `readModule`/`isWebModule` are exported as pure test seams. Tests inject fakes that exercise every branch (default-export fallback, malformed-field rejection, readdir catch, require catch, ext-loop `.tsx`→`.ts`, sort comparator with out-of-order entries). Both files now at 100% function/line coverage — no `istanbul ignore`, no `biome-ignore`, no skipped tests.

**P1 (resolved):** `FsSeam.readdirSync` opts typed `{ withFileTypes: boolean }` failed tsc (node's overload needs literal `true`). Narrowed to `{ withFileTypes: true }`.

**Type-safety fix:** test fixture `shape()` was typed `Record<string, unknown>`, breaking `toEqual(WebModule)` overloads. Retyped to `WebModule`; rejection tests build raw objects inline.

No new suppressions. The 0134 implementation + its tests are the only source changes; all other workspaces untouched.
### Testing
**Gate evidence (run 2026-06-29):**

- `bun run lint` — clean across 7 workspaces (biome + per-workspace `tsc --noEmit`).
- `bun run test` — 1994/1994 pass, 5080 expect() calls. Aggregate coverage 99.48% function / 99.12% line. Target files `discover.ts` and `registry.ts` both 100%.
- `bun run test-cf` — 1/1 pass (Cloudflare Workers runtime).
- `bun run build` — succeeds. The Astro web build resolves `import.meta.glob` and `task-kanban` lands in the BoardApp bundle (AC11): `dist/web/_astro/BoardApp.DbI3iLzZ.js` contains the `tasks` module id and `/board/` route strings.

**AC traceability:**
- AC1 (zero-wiring discovery) — `discover.ts` + the `module` named-export contract; a new dir under `modules/` is discovered with no registry edit.
- AC2 (Tasks survives) — task-kanban migrated to `export const module`; build + tests prove `/board/tasks` resolves.
- AC3 (consumer files unchanged) — `git diff --stat` on `router.tsx`, `LeftSidebar.tsx`, `BoardLayout.tsx` = empty.
- AC4/AC5 (disable/enable without deletion) — `createRegistry(disabled)` + `disableModule`/`enableModule` round-trip in `registry.test.ts`.
- AC6/AC7 (duplicate id/route fail loud) — `registry.test.ts` asserts the thrown error names the colliding id/route.
- AC8 (deterministic order) — root-then-sorted order; `discoverViaGlob`/`discoverViaFs` sort tests prove stable ordering.
- AC9 (test isolates the glob) — registry tests inject hand-built fixtures; `discoverModules` real-fallback test resolves task-kanban.
- AC10 (empty root harmless) — `discoverViaFs` readdir-catch test returns empty; readModule-null test skips non-modules.
- AC11 (build proves discovery) — build output verified above.
### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


### History

- 2026-06-29T07:03:06.647Z backlog → todo (system)
- 2026-06-29T16:37:56.738Z todo → wip (system)
- 2026-06-29T16:38:40.121Z wip → testing (system)
- 2026-06-29T16:38:40.309Z testing → done (system)
