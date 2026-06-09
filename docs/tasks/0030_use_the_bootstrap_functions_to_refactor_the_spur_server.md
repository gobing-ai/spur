---
name: use the bootstrap functions to refactor the spur server
description: use the bootstrap functions to refactor the spur server
status: Done
updated_at: 2026-06-09T22:22:00.000Z
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

## 0030. use the bootstrap functions to refactor the spur server

### Background

As we did in the past few tasks, we used these bootstrap functions from ts-infra to refactored the spur cli. Now it's time for us to use all most same functions and mechanisms to refactor the spur server.

If any `@gobing-ai/ts-*` need to be enhanced to support the bootstrap functions as a server, or we found any issues with the current implementation, you can enhance the source code in project `~/xprojects/ts-libs/` directory first. Then we can publish them in next version, so that we can apply the most latest version to the spur server or current projects.


### Requirements
- Refer to the implementation of spur-cli's bootstrap procedure with existing for spur server, figure out the enhancements items first.
- Figure out the system design then implement the bootstrap functions for the spur server.


### Q&A

- **Q (worker module-init):** How to wire portable `runApplication` in `worker.ts` given Workers' init constraints?
  **A:** Lazy singleton — a module-level cached promise initialized on first request. No top-level await.
- **Q (edge subpath):** Upstream a `@gobing-ai/ts-infra/application-edge` subpath now, or inline portable wiring?
  **A:** Inline portable wiring in `worker.ts` now; defer the upstream subpath. Do not block 0030 on a ts-libs release.
- **Q (ADR):** New ADR entry for the split bootstrap?
  **A:** Yes — add **ADR-019** (server bootstrap splits portable/Worker vs node/Bun by runtime).


### Design

**Chosen approach: split bootstrap by runtime (Approach 1).** The server runs on two runtimes —
`Bun.serve` (`src/index.ts`) and Cloudflare Workers (`src/worker.ts`, `wrangler main`). The portable
`runApplication` (`@gobing-ai/ts-infra/application`) is Workers-safe (verified: zero `node:*` imports
across its full reachable graph — event-bus, logger, scheduler factory, plugin host/builtins). The
Node convenience subpath `runNodeApplication` pulls in `node:fs` (file log sink, `readFileSync` YAML
loader, owned bun-sqlite adapter) and is **not** Workers-safe. Therefore each entry uses the layer it
is allowed to use:

- **Bun entry (`index.ts`)** → `runNodeApplication`, mirroring the CLI (ADR-017): YAML `bootstrap:`
  config, file log sink, owned DB adapter, full stop/shutdown. `Bun.serve` is started inside `start(appRt)`.
- **Worker entry (`worker.ts`)** → portable `runApplication`, inlined, behind a **lazy singleton**
  (cached bootstrap promise). Inline config (no file sink, no node DB); D1 binding injected per-request
  from `env` when a real DB consumer appears.

**Shared seam.** Extract `src/bootstrap.ts` exporting:
- `serverBootstrapConfig(env)` — the common `logging`/`telemetry`/`events` block (incl. the
  `NODE_ENV==='test' → logging.enabled=false` mute parity the CLI uses to stop JSON log leakage in tests).
- `createApp(appRt)` — `createApp` gains an optional `ApplicationRuntime` param and threads
  `logger`/`events`/`db` into the Hono context (`c.set('rt', appRt)`) and the oRPC handler `context`
  (replacing today's `context: {}`).

**Scope discipline (R2).** The current oRPC `health` handler ignores context; there is no consumer of
a threaded `logger`/`db` yet. So context-threading is a **thin enabling seam only** — set the runtime
on Hono context and pass `logger`/`events`/(optional)`db` into the oRPC `context`, demonstrated by one
assertion. No capability registries, no per-request DB plumbing beyond the injection point. Registries
remain deferred per ADR-012 amendment.

**Doc sync.** Same-commit updates to `03 §2 Runtime model` and `04 §5 Server/Web`; new **ADR-019**
recording the portable/node split before the structural divergence.


### Solution

Server bootstrap standardized on `ts-infra` using a runtime-aware split (ADR-019):

- **`src/bootstrap.ts` (new)** — `serverBootstrapConfig(env)` returns shared logging/telemetry/events
  block with test-mute guard. `createApp(appRt?)` threads optional `ApplicationRuntime` into Hono
  context (`c.set('rt', appRt)`) and oRPC handler `context`. Declares `ContextVariableMap.rt` for
  type-safe access.
- **Bun entry (`index.ts`)** — `runNodeApplication` with inline `serverBootstrapConfig(env)`;
  `Bun.serve` inside `start(appRt)`. Re-exports unchanged.
- **Worker entry (`worker.ts`)** — portable `runApplication` behind a lazy singleton (`let rtPromise`);
  no top-level await. `fetch` awaits runtime → `createApp(appRt).fetch()`.
- **Dependencies** — `@gobing-ai/ts-infra` moved from devDeps to deps; `ts-db` + `ts-runtime` added
  (required by `runNodeApplication`'s static imports).
- **Tests** — 9 Bun tests + 1 CF test, all passing. Runtime-threading seam verified with mock `ApplicationRuntime`.
- **Docs** — ADR-019 added; `03 §2` and `04 §5` synced.
- **CHANGELOG** — entry under Unreleased → Changed.


### Plan

1. **`src/bootstrap.ts` (new).** Extract `serverBootstrapConfig(env)` (shared logging/telemetry/events
   + test-mute guard) and refactor `createApp` to accept an optional `ApplicationRuntime`, threading
   `logger`/`events`/`db` into Hono context + oRPC handler `context`. Keep `createApp()` (no-arg) working
   for the no-runtime/legacy test path.
2. **Bun entry (`index.ts`).** Replace the bare `Bun.serve` with `runNodeApplication`: load the
   `bootstrap:` section, inject the owned DB, and start `Bun.serve({ fetch: createApp(appRt).fetch, port })`
   inside `start(appRt)`. Preserve `import.meta.main` guard + existing exports.
3. **Worker entry (`worker.ts`).** Add a lazy singleton: `let rtPromise; async function getRuntime() { rtPromise ??= runApplication({ config: serverBootstrapConfig(env), services: { logger, events } }); return rtPromise; }`. `fetch` awaits the runtime, builds (or memoizes) `createApp(appRt)`, delegates. No top-level await; no `node:*`.
4. **Tests.** Update `app.test.ts` (createApp with/without runtime), `worker.test.ts`, and the
   `*.cf.ts` Workers-runtime test to assert: (a) health still 200 on both entries, (b) no `node:fs`
   import reaches the Worker bundle (vitest-pool-workers will fail-fast if it does), (c) test-mute parity
   — no JSON log lines leak. Maintain per-file ≥90% line/function coverage.
5. **Docs + ADR.** Add **ADR-019** (portable/node split by runtime). Sync `03 §2` and `04 §5` in the
   same commit. Flag any drift in the authoritative docs.
6. **Verification gate.** `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build` all green;
   `git status` shows only intentional changes.

**Out of scope / deferred:** upstream edge convenience subpath (inline now); D1 owned-DB plugin;
capability registries; per-request DB plumbing beyond the injection seam.

### Review

**Verdict: PASS.** SECU review:

- **Security:** No new attack surface. `serverBootstrapConfig` uses env vars only; Worker entry uses
  lazy singleton (no top-level await, no `node:*`). `@gobing-ai/ts-infra/application` portable
  subpath verified Workers-safe (zero `node:*` imports across full reachable graph at 0.3.7).
- **Correctness:** All 389 tests pass (0 fail); CF worker-runtime test passes. `createApp()`
  no-arg path preserved for backwards compatibility. `createApp(appRt)` seam type-checks via
  Hono `ContextVariableMap.rt`.
- **Efficiency:** Lazy singleton avoids cold-start cost on Worker; `runNodeApplication` on Bun
  mirrors CLI path. No allocations added to hot path.
- **Usability:** Exports unchanged — `createApp`, `generateOpenApiSpec`, `router`, `AppRouter`,
  `worker` re-exported from `index.ts`.

---

## Verification — 2026-06-09 (dev-verify --auto --fix all --force)

**Verdict: PASS.** Re-audited the on-disk implementation (Phase 7 SECU + Phase 8 traceability).
Gates re-run live, not trusted from the prior Review section.

**Gates (all green):**
- `biome check` (server scope) — clean, no suppressions added.
- Server `tsc --noEmit` — clean.
- `bun test apps/server/tests` — **15 pass / 0 fail**; `bootstrap.ts`/`worker.ts`/`router.ts` at 100% func, 94–100% line.
- `test-cf` (vitest-pool-workers) — **1 pass** → confirms no `node:*` reached the Worker bundle (the core Workers-safety gate).
- `bun build --compile` (Bun entry) — succeeds, 766 modules.

**Requirements traceability (Phase 8):**
- [x] **R1** (figure out enhancements vs CLI bootstrap) → **MET** | Evidence: ADR-019 + `03 §2` document
  the portable/node split; the dual-runtime asymmetry (Worker can't use `runNodeApplication`) is the
  identified enhancement item. No upstream ts-libs change required (inline portable wiring, per Q&A).
- [x] **R2** (design + implement server bootstrap) → **MET** | Evidence: `src/bootstrap.ts`
  (`serverBootstrapConfig` + `createApp(appRt?)`), `index.ts` (`runNodeApplication`), `worker.ts`
  (portable `runApplication` + lazy singleton). Matches the approved Approach-1 design.

**Findings:**
| # | Title | Dimension | Location | Disposition |
|---|-------|-----------|----------|-------------|
| 1 | Rejected bootstrap promise cached forever on Worker | Correctness (P4) | `worker.ts:8` | **FIXED** — `.catch` resets `rtPromise` so the next request retries instead of replaying a stale rejection. |
| 2 | `getRuntime` ignores `env` after first init | Correctness (P3) | `worker.ts:8` | **WONTFIX** — intentional and correct for the Workers isolate model (bootstrap config is process-stable); flagging would be noise. |

No P1/P2 findings. No new attack surface; `db` threaded into oRPC context is `undefined` on both
entries today (no DB configured), so no data exposure.

### Testing

- **Command:** `bun run test` (389 tests, 0 fail), `bun run test-cf` (1 pass)
- **Scope:** Server bootstrap paths (Bun + Workers), createApp with/without runtime, Worker fetch handler
- **Result:** All passing. Coverage: 99.71% funcs, 99.14% lines
- **Evidence:** `apps/server/tests/app.test.ts` (3 tests → 4 tests), `apps/server/tests/worker.test.ts` (1 test → 2 tests), `apps/server/tests/cf/worker-runtime.cf.ts` (1 test, unchanged)
- **Next action:** None — all gates pass

---

## Unit pass — 2026-06-09 (dev-unit apps/server/src/worker.ts --auto)

The verify-pass `.catch` reset (worker.ts:16-18) was uncovered → `worker.ts` dropped to 80% func / 84%
line. Closed the gap **and** removed the singleton's untestability:

- **Testability seam.** `getRuntime` now takes an injectable `BootstrapFn` (default = real
  `runApplication`) + a test-only `resetRuntime()`. This makes the failure-and-retry branch unit-testable
  without fragile `mock.module` + dynamic-reimport (which hung on the stateful module singleton).
- **New tests** (`tests/worker-retry.test.ts`, 2 tests): (1) successful bootstrap is cached — runs once
  across calls; (2) rejected bootstrap is **not** cached — next call retries and succeeds. `beforeEach`/
  `afterEach` `resetRuntime()` isolates the module singleton from `app.test.ts`/`worker.test.ts`, which
  prime it via real `fetch`.
- **Coverage (full server suite):** `worker.ts` **100% func / 100% line**; `bootstrap.ts`/`router.ts`
  100/100; `openapi.ts` 100/94.4. All four `apps/server/src/*` above the 90% target.
- **Result:** server suite **17 pass / 0 fail**; lint + `tsc --noEmit` + `test-cf` green.
  (`bun test` repo-wide threshold flags transitively-imported `packages/config/*` at 0% — tested in
  its own workspace suite, out of this task's scope.)

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References
