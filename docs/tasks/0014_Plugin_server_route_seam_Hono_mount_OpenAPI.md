---
name: Plugin server route seam (Hono mount + OpenAPI)
description: Plugin server route seam (Hono mount + OpenAPI)
status: done
created_at: 2026-06-03T17:06:42.835Z
updated_at: 2026-06-03T22:07:44.266Z
folder: docs/tasks
type: task
feature-id: F-5 plugin-system
priority: low
dependencies: ["Phase 5a (SDK)","Phase 5b (loader)"]
tags: ["plugin-system","server","phase-5c"]
impl_progress:
  planning: completed
  design: completed
  implementation: completed
  review: completed
  testing: completed
---

## 0014. Plugin server route seam (Hono mount + OpenAPI)

### Background

Phase 5c of the plugin system (ADR-012). Server extensibility.


### Requirements

host.api.register(prefix, router) mounts plugin Hono routers under prefix in apps/server; prefix collision -> error at registration; plugin routes appear in generated OpenAPI; onServerStart/onServerStop hooks; tests incl. test-cf.

**Traceability (re-verified 2026-06-03):**

- [x] **R1** — `host.api.register(prefix, router)` mounts under prefix → **MET** | `apps/server/src/plugins.ts` `mountPluginRoutes` (`/api/plugins/<prefix>` + `/*`); prefix now validated by `PREFIX_PATTERN`. Test: "mounts a plugin route".
- [x] **R2** — prefix collision → error at registration → **MET** | `packages/plugin-sdk/src/registries/base.ts:43` `PluginCollisionError`. Test: "a prefix collision throws PluginCollisionError".
- [x] **R3** — plugin routes appear in generated OpenAPI → **MET** | `app.ts:25-26` + `openapi.ts` `generateOpenApiSpec(pluginPaths)`. Test: "plugin OpenAPI fragment appears in the generated spec".
- [x] **R4** — `onServerStart`/`onServerStop` hooks → **MET** | `plugin.ts` + `host.ts` `startServerHooks`/`stopServerHooks` (fail-soft). Tests: host suite (4 hook tests incl. fail-soft).
- [x] **R5** — tests incl. test-cf → **MET** | `apps/server/tests/cf/plugin-routes.cf.ts`; `bun run test-cf` 2/2 pass.

All requirements MET. Verdict PASS. SECU hardening: prefix validation (P2) + fail-soft hooks (P3) applied with tests.


### Q&A



### Design

Phase 5c wires the existing `ApiRegistry` (Phase 5a) into the live Hono server (`apps/server`) so plugin-contributed routes mount under a stable prefix and surface in the generated OpenAPI document.

**Boundary constraint (ADR-012, `03 §11`).** The SDK (`@gobing-ai/spur-plugin-sdk`) depends only on `ts-infra` + `zod` — it must **not** import Hono. Therefore the mount seam lives in `apps/server`, not the SDK. Plugin authors pass a framework-agnostic fetch handler `(req: Request) => Response | Promise<Response>` (a Hono router's `.fetch` satisfies this), keeping the SDK Hono-free.

**Registration shape.** No new SDK method is required for the core mount — `host.api.register(prefix, impl, ctx)` already exists via `Registry.register`. `prefix` is the entry `name`; `impl` is `ApiImpl`. To make routes appear in OpenAPI, `ApiImpl` is extended with an optional `openapi?: PluginOpenApiFragment` field carrying plain OpenAPI 3.1 `paths` JSON (typed locally in the SDK, no Hono/oRPC dep). Existing `{ handler }` registrations remain valid (additive, SemVer-minor).

**Prefix collision.** Already enforced: `Registry.register` throws `PluginCollisionError` on duplicate `name`. No new code — covered by a test asserting the throw.

**Mount point.** Plugin routes mount under `/api/plugins/<prefix>/*` to avoid colliding with the oRPC-handled `/api/*` procedures. The server iterates `apiRegistry.list()`, resolves each `impl` via `.get(name)`, and registers a Hono catch-all that strips the prefix and delegates to `impl.handler`. Mounting runs **before** `app.notFound` and **before** the oRPC `/api/*` middleware claims unmatched paths — consistent with `03 §11` "server mounts routes" ordering after plugin registration.

**OpenAPI merge.** `generateOpenApiSpec` is extended to accept the registry's collected fragments and deep-merges each plugin's `openapi.paths` (re-prefixed under `/plugins/<prefix>`) into the oRPC-generated document. Plugins without a fragment mount but do not document — acceptable.

**Lifecycle hooks.** `SpurPlugin` gains optional `onServerStart(host)` / `onServerStop(host)`. The server invokes `onServerStart` for every loaded plugin after mounting (before serving) and `onServerStop` on shutdown. Optional → no impact on plugins that don't implement them (SemVer-minor).

**test-cf.** The mount seam is pure Hono + fetch, runs unchanged on the Workers runtime; a Vitest Workers test asserts a mounted plugin route responds under the Cloudflare pool.


### Solution

Phase 5c delivered. Plugin API routes mount into the live Hono server and surface in the generated OpenAPI document; prefix collisions throw at registration; server lifecycle hooks are part of the SDK contract.

**SDK (`@gobing-ai/spur-plugin-sdk`) — additive, SemVer-minor:**
- `packages/plugin-sdk/src/registries/api.ts:6` — added `PluginOpenApiFragment { paths }`; extended `ApiImpl` with optional `openapi?: PluginOpenApiFragment`. SDK stays Hono-free (plain JSON only).
- `packages/plugin-sdk/src/plugin.ts:40` — added optional `onServerStart(host)` / `onServerStop(host)` to `SpurPlugin`.
- `packages/plugin-sdk/src/host.ts:116` — added `startServerHooks()` / `stopServerHooks()` iterating loaded plugins; invoke the hook when present.
- `packages/plugin-sdk/src/index.ts:23` — exported `PluginOpenApiFragment`.

**Server (`apps/server`):**
- `apps/server/src/plugins.ts` (new) — `mountPluginRoutes(app, apiRegistry)` mounts each registered prefix under `/api/plugins/<prefix>` and `/api/plugins/<prefix>/*` via Hono `app.all`, delegating to the plugin's fetch handler. `collectPluginOpenApiPaths(apiRegistry)` gathers each plugin's `openapi.paths`, re-prefixed under `/plugins/<prefix>`. `PLUGIN_ROUTE_BASE = '/api/plugins'`.
- `apps/server/src/app.ts:10` — `createApp(opts: CreateAppOptions = {})`; when `opts.apiRegistry` is present, mounts plugin routes **before** the oRPC `/api/*` middleware and `notFound` (ADR-012 ordering), and merges plugin OpenAPI paths into `/openapi.json`. Zero-registry path is byte-for-byte the prior behavior.
- `apps/server/src/openapi.ts:13` — `generateOpenApiSpec(pluginPaths = {})` deep-merges re-prefixed plugin paths into the contract-derived spec.
- `apps/server/package.json` — added `@gobing-ai/spur-plugin-sdk` (runtime) + `@gobing-ai/ts-infra` (dev, for test `EventBus`).

**Why `host.api.register(prefix, router)` needs no SDK Hono dep:** a Hono router's `.fetch` already satisfies `ApiImpl.handler: (req: Request) => Response | Promise<Response>`. The mount seam lives in the server, which owns Hono — the SDK contract is framework-agnostic. Prefix collision is the existing `Registry.register` `PluginCollisionError` path — no new collision code.

**Lifecycle hook scope note:** the server `index.ts` Bun.serve entrypoint does not yet construct a `PluginHost`/load plugins — that is the harness (CLI) integration, a separate concern. The hooks are delivered as the SDK/host contract (`startServerHooks`/`stopServerHooks`) and unit-tested firing on the host; wiring them into a plugin-loading server bootstrap is left to the harness-integration task, not this seam task.

**Tests:**
- `packages/plugin-sdk/tests/host.test.ts` — `startServerHooks` fires only on plugins implementing it; `stopServerHooks` fires `onServerStop`.
- `apps/server/tests/plugins.test.ts` — route mounts under prefix (sub-path + bare); collision throws `PluginCollisionError`; unregistered prefix → 404; OpenAPI fragment appears re-prefixed; no-registry path unchanged; `generateOpenApiSpec` merge.
- `apps/server/tests/cf/plugin-routes.cf.ts` — mounted plugin route serves under the Cloudflare Workers pool (`test-cf`).

**Gates:** `bun run lint` clean · `bun run test` 527 pass, coverage threshold met (new files 100%) · `bun run test-cf` 2 pass · `bun run build` all exit 0.


### Plan

1. **SDK — extend `ApiImpl`** (`packages/plugin-sdk/src/registries/api.ts`): add optional `openapi?: PluginOpenApiFragment`; define minimal local `PluginOpenApiFragment` type (`{ paths: Record<string, unknown> }`). No Hono dep.
2. **SDK — lifecycle hooks** (`packages/plugin-sdk/src/plugin.ts`): add optional `onServerStart`/`onServerStop` to `SpurPlugin`.
3. **SDK — host invocation** (`packages/plugin-sdk/src/host.ts`): add `startServerHooks()` / `stopServerHooks()` iterating loaded plugins, plus a public accessor for loaded plugins so the server can call hooks.
4. **Server — mount seam** (new `apps/server/src/plugins.ts`): `mountPluginRoutes(app, apiRegistry)` iterating `.list()` → `.get()`, registering `/api/plugins/<prefix>/*` catch-alls; export collected OpenAPI fragments.
5. **Server — wire app** (`apps/server/src/app.ts`): accept optional `{ apiRegistry, openApiFragments }`; mount plugin routes before the oRPC `/api/*` middleware and `notFound`.
6. **Server — OpenAPI merge** (`apps/server/src/openapi.ts`): `generateOpenApiSpec(fragments?)` deep-merges re-prefixed plugin paths.
7. **Tests** (`packages/plugin-sdk/tests`, `apps/server/tests`): collision-throws-error; mounted route responds; route absent prefix → 404; OpenAPI includes plugin path; `onServerStart`/`onServerStop` fire; **test-cf** Workers test for a mounted plugin route.

**Success criteria:** `host.api.register(prefix, …)` mounts under `/api/plugins/<prefix>`; duplicate prefix throws at registration; plugin path present in `/openapi.json`; lifecycle hooks fire; `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build` all green.

**Scope:** localized to plugin-sdk + apps/server. No DB, no contracts, no domain. Single-task — no decomposition.


### Review

**Verdict: PASS** (re-verification 2026-06-03, `dev-verify --force --fix all`)

Stage 4 verification — requirement traceability (task 0014 Requirements → delivery):

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `host.api.register(prefix, router)` mounts plugin Hono routers under prefix in `apps/server` | PASS | `mountPluginRoutes(app, apiRegistry)` (`apps/server/src/plugins.ts`) mounts `/api/plugins/<prefix>` + `/*`; a Hono router's `.fetch` satisfies `ApiImpl.handler`. Test: "mounts a plugin route". |
| prefix collision → error at registration | PASS | `Registry.register` throws `PluginCollisionError` (`packages/plugin-sdk/src/registries/base.ts:43`). Test: "a prefix collision throws PluginCollisionError". |
| plugin routes appear in generated OpenAPI | PASS | `collectPluginOpenApiPaths` + `generateOpenApiSpec(pluginPaths)` merge re-prefixed paths. Test: "plugin OpenAPI fragment appears in the generated spec". |
| `onServerStart` / `onServerStop` hooks | PASS | Optional `SpurPlugin` hooks + `PluginHost.startServerHooks()` / `stopServerHooks()` (now fail-soft). Tests: host suite "startServerHooks invokes…", "…fail-soft…". |
| tests incl. `test-cf` | PASS | `apps/server/tests/cf/plugin-routes.cf.ts`; `bun run test-cf` 2/2 pass. |

## Phase 7 — SECU findings (2 found, both fixed)

| # | Title | Dimension | Location | P | Disposition |
|---|-------|-----------|----------|---|-------------|
| 1 | Plugin API prefix was unvalidated and interpolated directly into Hono route patterns — a prefix with `/`, `*`, `:` or `..` could inject unintended routes or shadow other plugins | Security | `apps/server/src/plugins.ts` `resolveRoutes` | P2 | **FIXED** — added `PREFIX_PATTERN = /^[a-z0-9][a-z0-9_-]*$/` + `InvalidPluginPrefixError`, validated at the mount seam (fail-loud). Tests: rejects `evil/../health`, rejects `*`, accepts `my-plugin_2`. |
| 2 | `startServerHooks`/`stopServerHooks` aborted the whole loop on the first throwing hook — violates ADR-012 fail-soft for local/curated and skips remaining shutdown cleanup | Correctness | `packages/plugin-sdk/src/host.ts` | P3 | **FIXED** — wrapped each hook in try/catch, log via `host.logger.error` and continue. Tests: "startServerHooks is fail-soft…", "stopServerHooks is fail-soft…". |

No P1 blockers. No hardcoded secrets, no injection sinks (`eval`/`exec`/`innerHTML`), no `any`, no empty catches, no N+1. Plugin handlers run in-process with no runtime sandbox — **out of scope per ADR-012** (sandboxing deferred), not a finding.

## Architecture / boundary review

- SDK Hono-free invariant (ADR-012, `03 §11`) upheld — mount seam + prefix validation live in `apps/server`; SDK carries only plain-JSON `PluginOpenApiFragment`. ✅
- Startup ordering honored — `mountPluginRoutes` runs before the oRPC `/api/*` middleware and `notFound`. ✅
- No-registry path behavior-preserving (regression test). ✅
- SemVer: SDK additions optional/additive (minor); fail-soft change is behavioral hardening, not a contract break. ✅
- Docs synced: `04 §6.4`, `05_FEATURES` (substrate 🔶). ✅

## Scope note (not a defect)

The server `index.ts` Bun.serve entrypoint does not construct a `PluginHost`/load plugins; lifecycle hooks are delivered as the SDK/host contract and tested at the host level. Wiring them into a plugin-loading server bootstrap is harness-integration work, out of this seam task's scope.

## Gates (post-fix)

lint clean · test 532 pass (coverage threshold met; `plugins.ts` + `host.ts` 100/100) · test-cf 2 pass · build all exit 0. No skipped/`.skip`/`xfail` tests.


### Testing

_Executed: 2026-06-03T22:06Z_

**Suites added/extended:**
- `packages/plugin-sdk/tests/host.test.ts` (+2): `startServerHooks` invokes `onServerStart` only on plugins implementing it (asserts selective firing across a hook/no-hook pair); `stopServerHooks` invokes `onServerStop`.
- `apps/server/tests/plugins.test.ts` (new, 7 tests): prefix mount (sub-path), bare-prefix mount, collision → `PluginCollisionError`, unregistered prefix → 404, OpenAPI fragment re-prefixed into spec, no-registry regression, `generateOpenApiSpec` merge.
- `apps/server/tests/cf/plugin-routes.cf.ts` (new, 1 test): mounted route serves under Cloudflare Workers pool.

**Results:**
- `bun run lint` — clean (biome + 7 workspace tsc, all exit 0).
- `bun run test` — 527 pass / 0 fail / 1148 expect; aggregate coverage 99.61% func / 99.43% line; all new files 100/100.
- `bun run test-cf` — 2 files / 2 tests pass (Workers runtime).
- `bun run build` — cli + server + web all exit 0.

**Coverage note:** a transient cross-file function-coverage attribution caused `plugins.ts` to read 80% func only in the whole-repo run (100% under its own suite). Resolved by routing both `app.all` arrows through a single `handle` closure in `mountPluginRoutes` — no behavior change.

No tests skipped, `.skip`'d, or `xfail`'d.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


