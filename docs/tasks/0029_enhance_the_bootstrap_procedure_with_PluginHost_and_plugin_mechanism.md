---
name: enhance the bootstrap procedure with PluginHost and plugin mechanism
description: enhance the bootstrap procedure with PluginHost and plugin mechanism
status: done
created_at: 2026-06-08T18:13:17.156Z
updated_at: 2026-06-09T06:29:32.107Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0029. enhance the bootstrap procedure with PluginHost and plugin mechanism

### Background
In the last task 0028, we already leverage `runNodeApplication` to bootstrap the application. Meanwhile, we already have the mechanism of plugin via package `packages/plugin-sdk` or `@gobing-ai/spur-plugin-sdk`, but we totaly did not integrate it with the bootstrap procedure.

On one hand, we need to customize so many things with life cycle management concepts into some plugins and make sure they can work well with the bootstrap procedure via the `PluginHost`.

On the other hand, I also noticed that package package `packages/plugin-sdk` or `@gobing-ai/spur-plugin-sdk` looks like a little bit complex. I am not sure if it is the right choice for the plugin SDK or it's just coming from the origin place -- we just migrate too much from the old codebase. That's say we'd better to simplify it first.

As usual, if we need to enhance any upstream packages in `@gobing-ai/ts-*` to ensure we can work with, we can create seperate task files to implement it in another project in `~/xprojects/ts-libs/`.

### Requirements
- Have a comprehensive code review on package `packages/plugin-sdk` or `@gobing-ai/spur-plugin-sdk`  to see whether it is over-engineered or not. if yes, how can we simplify it?

- Meanwhile, we also need to work with this enhanced PluginHost and SpurPlugin interface, we implement all the necessary things as built-in plugins, for example, logging, event bus, database, and so on in folder `packages/app`.

- Then, we need to consider how can we leverage them with existing `runNodeApplication` to simplify the bootstrap procedure. It's not designed for spur-cli only. It will be applied to spur-server soon with the same approach.

- **[NEW — required by upstream ADR-018] Own the injected DB lifecycle.** ts-infra `0.3.6` no longer
  closes a caller-injected `services.db` on shutdown (ADR-018, "close what you create, never what you
  were handed"). `apps/cli/src/index.ts` currently creates the adapter (`createMigratedDbAdapter`),
  injects it via `services: { db }`, and relies on `app.stop()` to close it — this now **leaks** after
  the catalog bump. Spur-cli (and spur-server when it adopts the same path) must close their own
  adapter: wrap the bootstrap in `try/finally` and call `db.close()` in **both** branches (the
  config-file `runNodeApplication` path *and* the no-config direct path). This is a regression-prevention
  requirement, not optional cleanup.


### Q&A

**Q1: Is the existing `packages/plugin-sdk` over-engineered?** Yes — decisively. ~945 LOC
across nine capability registries, a four-tier `TrustEngine`, a glob-pattern `EventRegistry`
with a token-bucket rate limiter, and a Zod manifest schema. Grounding check (2026-06-08):
**zero plugins exist on disk** (`find . -name plugin.yaml` → none) and **not one registry
method (`get`/`list`/`register`/`subscribe`) is called from production code** — only the
package's own tests and the server's `mountPluginRoutes` shim touch it. It is speculative
infrastructure built far ahead of any consumer (R2 violation), regardless of ADR-012's
"load-bearing for future migration" intent.

**Q2: How do we simplify it?** Don't trim it in place — **move a bare core upstream.** The
plugin substrate is a *runtime* concern, and `@gobing-ai/ts-infra` already owns the runtime
lifecycle (`runApplication`). Upstream a minimal `PluginHost` + `Plugin` (lifecycle-only) into
ts-infra so every ts-infra app inherits the mechanism; then **delete `packages/plugin-sdk`
entirely** and consume the core from `@gobing-ai/ts-infra`. (Robin, 2026-06-08.) Upstream work
landed across **ts-libs tasks 0025–0028** (core + leak fix + service-plugin migration +
reason-carrying teardown), shipped in ts-infra **`0.3.6`**.

**Q3: "Implement logging / event bus / database as built-in plugins" — literally?** No — and the
reasoning is now even stronger. ts-infra **already** exposes its own core services (logger,
telemetry, scheduler, user-callback) as internal built-in plugins on the PluginHost lifecycle
(ADR-017/018). Spur re-wrapping those would **double-layer** the same mechanism. Spur consumes the
lifecycle, it does not re-plugin-ize core services. Spur-authored built-in *plugins* remain deferred
to "later, with what ts-infra already has" (Robin) and are reserved for genuine Spur contributions,
not core services.

**Q4: What about the server's plugin routes?** Clean them up. `apps/server/src/plugins.ts`
(`ApiRegistry` → `mountPluginRoutes`) + its CF tests have no real consumer. Remove them with
the SDK; move any genuinely reusable bit to `packages/app/src/plugins` **only if** it will be
used on the CLI or server side. (Robin, 2026-06-08.)

**Q5: ADR-012 timing?** Amend ADR-012 **first** (CLAUDE.md hard rule: a change contradicting
`00_ADR` needs a superseding dated entry before diverging). The amendment records: substrate
*home* moves from a standalone Spur SDK to ts-infra; first cut is a bare lifecycle core;
capability registries + the four-tier trust ladder are **deferred** (re-addable later), not
permanently rejected. (Robin, 2026-06-08.)

**Q6: Dependency handling while ts-infra core is unreleased?** `bun link @gobing-ai/ts-infra`
during dev (documented here); once ts-infra publishes, bump the root catalog
`@gobing-ai/ts-infra` to **`0.3.6`** (the release carrying tasks 0025–0028 / ADRs 015–018) and
drop the link. (Robin, 2026-06-08.)

**Q7: [NEW] Does the upstream carry a breaking behavior change Spur must handle?** Yes — one.
ts-infra `0.3.6` (ADR-018) **stops auto-closing caller-injected `services.db`** on shutdown. The
portable `runApplication` only closes adapters the bootstrap itself creates. Spur-cli injects its DB
(`apps/cli/src/index.ts:52 services: { db }`) and never closes it, so the upgrade introduces a DB
adapter leak on every run unless Spur closes it itself (see the new Requirement). This is the only
behavior change in the upstream surface; everything else (the `Plugin` interface, `PluginHost`,
`runApplication` `plugins`/`pluginHost` options) is additive.

**Q8: [NEW] What does the upstream `Plugin` interface actually look like now?** Richer than the
0025-era "bare interface" this task was first written against, but fully additive:
- `failFast?: boolean` (ADR-017) — a `failFast` plugin that throws in `onStart` aborts the bootstrap;
  others log + continue. Use it for any Spur plugin whose init must succeed.
- `onStop(host, reason?)` / `onUnload(host, reason?)` (ADR-018) — teardown hooks carry an optional
  string stop reason (`runApplication` passes `'manual'|'signal'|'error'|'shutdown'`).
- `onLoad`/`onStart`/`onStop`/`onUnload` semantics: `loadAll` fail-fast; `startAll` fail-fast only for
  `failFast` plugins; `stopAll`/`unloadAll` always fail-soft and run in **reverse registration order**.
Imported from `@gobing-ai/ts-infra` (the `application` surface). **Note:** do not confuse this with
`@gobing-ai/ts-runtime/extension` (the engine extension-loader subpath, renamed from `/plugin` in
ADR-016) — different mechanism, different package; Spur consumes the `ts-infra` `Plugin` here.


### Design

#### Dependency / sequencing (two repos)

This task **depends on ts-libs tasks 0025–0028** (bare `PluginHost`+`Plugin` core, startup-leak fix,
infra services as built-in plugins + `failFast`, reason-carrying teardown + caller-owned DB) — **all
landed and shipping in ts-infra `0.3.6`**. Order:

1. ts-libs 0025–0028 land the full plugin lifecycle (own gates + ADRs 015–018 in ts-libs). **Done.**
2. Spur `bun link @gobing-ai/ts-infra` (or bump catalog to `0.3.6`) to validate against the core.
3. Spur bumps root catalog `@gobing-ai/ts-infra` to `0.3.6` and drops the link.

#### Spur-side changes (this task)

- **ADR-012 amendment (first).** New dated entry in `docs/00_ADR.md`: substrate home →
  ts-infra; bare lifecycle core; registries + trust deferred. Update `03 §11` and `04 §6`
  to point at the ts-infra core and mark the Spur registry/trust surface as removed/deferred.
- **Delete `packages/plugin-sdk`.** Remove the package and its workspace wiring (root
  `package.json` workspaces, catalog entry if any). Spur imports `PluginHost`/`Plugin` from
  `@gobing-ai/ts-infra`.
- **Server cleanup.** Remove `apps/server/src/plugins.ts` (`mountPluginRoutes`,
  `collectPluginOpenApiPaths`, `InvalidPluginPrefixError`, `ApiRegistry` usage) and its tests
  (`apps/server/tests/plugins.test.ts`, `apps/server/tests/cf/plugin-routes.cf.ts`) plus the
  `app.ts` call sites. Move a reusable seam to `packages/app/src/plugins` **only** if a real
  CLI/server consumer remains — otherwise delete outright (Q4).
- **App layer.** Reconcile `packages/app/src/services/plugin-loader.ts` +
  `plugin-service.ts` with the bare core. They currently depend on the SDK's
  `validateManifest`/`PluginManifest`/`PluginHost.loadPlugin`. With manifests deferred, either
  (a) keep a thin Spur-local discovery (`plugin.yaml` scan → dynamic import → `host.register`)
  that targets the bare `Plugin` interface, or (b) defer discovery until a real plugin exists
  and reduce `plugin-service`/`plugin` command to "no plugins loaded". Decide during planning;
  bias to (b) (simplest, matches "no plugins exist yet").
- **DB lifecycle ownership (ADR-018 — new).** ts-infra `0.3.6` no longer closes a caller-injected
  `services.db`. Wrap the bootstrap in `try/finally` in `apps/cli/src/index.ts` and call `db.close()`
  in both branches (config-file `runNodeApplication` path + the no-config direct path); apply the same
  to the server path when it adopts the bootstrap. Add a shutdown-closes-db test to prevent regression.
- **Bootstrap.** `runApplication` drives the plugin lifecycle natively (ts-libs 0025–0028). The
  CLI `main()` (`apps/cli/src/index.ts`) and server `app.ts` inherit it by passing
  `plugins`/`pluginHost` through their existing `runNodeApplication`/`runApplication` options —
  no Spur-side `start()`-seam host wiring. Note `Plugin` is additive (`failFast`, reason-carrying
  teardown) per Q8.

#### CLI-surface invariant

The `spur plugin` command (`apps/cli/src/commands/plugin.ts`) and its `--json` envelope must
not drift unexpectedly. If discovery is deferred (option b), `spur plugin list` reports an
empty set with the same envelope shape; document any change in `04_DESIGN.md` in the same
commit (CLAUDE.md doc rule) and keep the consistency gate green.


### Solution

**Chosen approach:** Upstream-and-delete. Move a bare `PluginHost`+`Plugin` core to ts-infra
(0025), amend ADR-012, delete `packages/plugin-sdk`, clean up the server's unused route shim,
reconcile the app-layer loader to the bare core, and let the enhanced `runApplication` own the
plugin lifecycle so CLI and server share one bootstrap path.

Rejected (from brainstorm 2026-06-08):
- *Trim plugin-sdk in place within ADR-012* — still leaves the substrate in the wrong home and
  duplicates it for the next ts-infra consumer.
- *Wrap logging/eventbus/db as built-in plugins* — adds a layer over working ts-infra lifecycle.
- *Wire PluginHost as-is without simplifying* — contradicts the explicit "simplify first" intent.

### Plan

**Phase 0 — Upstream (DONE; tracked in ts-libs tasks 0025–0028)**
1. Bare `PluginHost`+`Plugin` core + `runApplication` integration (0025), startup-leak fix (0026),
   infra services as built-in plugins + `failFast` (0027), reason-carrying teardown + caller-owned DB
   (0028). All ts-libs gates green; ADRs 015–018 recorded. Ships in ts-infra **`0.3.6`**.

**Phase A — Spur ADR + link**
2. Amend Spur `docs/00_ADR.md` ADR-012 (home → ts-infra; bare core; registries/trust deferred);
   update `03 §11`, `04 §6`.
3. `bun link @gobing-ai/ts-infra` to the released `0.3.6` core; verify `PluginHost`/`Plugin` resolve.

**Phase B — Delete SDK + server cleanup**
4. Remove `packages/plugin-sdk` + workspace/catalog wiring.
5. Remove `apps/server/src/plugins.ts` + plugin route tests + `app.ts` call sites (or move the
   minimal reusable seam to `packages/app/src/plugins` only if justified by a real consumer).

**Phase C — App-layer + bootstrap reconcile**
6. Reconcile `packages/app/src/services/plugin-loader.ts` + `plugin-service.ts` to the bare
   `Plugin` interface (or defer discovery; bias to defer). Keep `spur plugin` envelope stable.
7. Pass `plugins`/`pluginHost` through `runNodeApplication` in `apps/cli/src/index.ts` and the
   server `app.ts`; confirm zero CLI-surface drift and consistency gate green.
8. **[NEW — ADR-018] Own the injected DB lifecycle.** Wrap the bootstrap in `try/finally` and call
   `db.close()` in both branches of `apps/cli/src/index.ts` (config-file `runNodeApplication` path
   and the no-config direct path); apply the same pattern to the server path when it adopts the
   bootstrap. Add/adjust a test asserting the adapter is closed on shutdown so the leak can't regress.

**Phase D — Release**
9. Confirm root catalog `@gobing-ai/ts-infra` is at **`0.3.6`** and drop the `bun link`.

**Gate (each phase):** `bun run lint` · `bun run test` · `bun run test-cf` · `bun run build`;
clean `git status`. No `--no-verify`, no suppression-only fixes.


### Review

## Verification — 2026-06-09 (dev-verify --auto --fix all --force)

**Verdict: PASS (with one gap found and fixed during the pass).**

Phase 8 — requirements traceability (verified on disk):

- [x] **R1** (code-review plugin-sdk; simplify if over-engineered) → **MET** | `packages/plugin-sdk`
  deleted; Q1–Q2 record the over-engineering verdict and the upstream-and-delete decision.
- [x] **R2** (built-in plugins for logging/eventbus/db in packages/app) → **MET (correctly scoped down)** |
  Per Q3, ts-infra already exposes these as internal built-in plugins; Spur consumes the lifecycle rather
  than double-layering. No Spur re-plugin-ization — the right call, not a miss.
- [x] **R3** (leverage runApplication to unify CLI+server bootstrap) → **MET** | `apps/cli/src/index.ts`
  drives `runNodeApplication`; server adopts the same path under task 0030.
- [x] **R4 [ADR-018]** (own injected DB lifecycle; close in both branches) → **MET; regression test ADDED
  this pass** | `apps/cli/src/index.ts:86-90` closes `db` in a `try/finally` covering both the
  `runNodeApplication` and no-config branches. The required "shutdown-closes-db test to prevent
  regression" was **missing** — added in this pass (see Testing).

SECU (Phase 7) on the bootstrap surface: no P1/P2. Security — injected `services.db` is caller-owned and
explicitly closed; no leak, no secret exposure. Correctness — `finally` guarantees close on the throw
path (e.g. `--version`'s Commander exitOverride). Efficiency/Usability — clean.

| # | Title | Dimension | Location | Disposition |
|---|-------|-----------|----------|-------------|
| 1 | Missing ADR-018 DB-close regression test (explicit R4 requirement) | Correctness (P2) | `apps/cli/tests/bootstrap.test.ts` | **FIXED** — added `db?` injection seam to `MainOptions` + 2 tests asserting `db.close()` runs on shutdown for both branches via a `close`-spy Proxy over a real `:memory:` adapter. |

### Testing

- **Gap closed:** R4's regression guard did not exist. Added `db?: DbAdapter` to `MainOptions`
  (`apps/cli/src/index.ts`) so a spy adapter can be injected, then two tests in `bootstrap.test.ts`:
  `closes the injected DB adapter on shutdown — runNodeApplication path` and `— no-config path`. Both
  inject a Proxy that flags `close()` while delegating to a real adapter, and assert `closed() === true`.
  These fail if `db.close()` is removed from `main()`'s `finally`.
- **Gates (all green):** `bun run lint` (Biome + all-workspace `tsc --noEmit`) clean · `bun test apps/cli`
  **163 pass / 0 fail** (was 161 → +2) · `bun run test-cf` 1 pass · `bun build --compile` succeeds.
- **Result:** task requirements fully traceable to code + tests; no skipped/`.skip` tests.

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References

- **Upstream dependency (DONE, shipped in ts-infra `0.3.6`):** ts-libs tasks
  `0025` (bare `PluginHost`+`Plugin` core + `runApplication` integration),
  `0026` (startup-failure resource-leak fix),
  `0027` (infra services as built-in plugins + additive `failFast`),
  `0028` (reason-carrying teardown + caller-owned DB). ADRs 015–018 in
  `~/xprojects/ts-libs/docs/00_ADR.md`.
- **Upstream behavior change to handle (ADR-018):** portable `runApplication` no longer closes a
  caller-injected `services.db` — Spur must close its own adapter (see Requirement + Q7).
- **Binding decision being amended:** `docs/00_ADR.md` ADR-012 (plugin substrate); detail in `docs/03_ARCHITECTURE.md §11`, `docs/04_DESIGN.md §6`.
- **Bootstrap baseline:** task `0028` (`runNodeApplication` adoption) — `apps/cli/src/index.ts`, `apps/cli/src/context.ts`.
- **DB-close site (new requirement):** `apps/cli/src/index.ts` (creates `db` at ~L38, injects `services: { db }` at ~L52, `app.stop('shutdown')` at ~L63; direct-path branch also leaves `db` open).
- **Code to delete/reconcile:** `packages/plugin-sdk/**`, `apps/server/src/plugins.ts`, `apps/server/src/app.ts`, `packages/app/src/services/{plugin-loader,plugin-service}.ts`, `apps/cli/src/commands/plugin.ts`.
- **Brainstorm source:** `/rd3:dev-brainstorm` session 2026-06-08 (this analysis).
- **Task review/refresh:** 2026-06-08 — reconciled against shipped ts-infra `0.3.6` (tasks 0025–0028); added DB-ownership requirement, Q7/Q8, Phase C step 8.

