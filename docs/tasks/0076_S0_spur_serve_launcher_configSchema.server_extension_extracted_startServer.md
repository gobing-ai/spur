---
schema_version: 1
name: "S0: spur serve launcher + configSchema.server extension + startServer"
status: Done
type: task
feature_id: S0
priority: P1
tags: ["server-side-adjustment","wave-S0","group-S"]
created_at: 2026-06-15T16:01:46.325Z
updated_at: 2026-06-16T15:59:50.616Z
---

## 0076. "S0: spur serve launcher + configSchema.server extension + extracted startServer"

### Background

The operator's one command to go from terminal to board. spur serve resolves server config, builds the ApplicationRuntime, calls createApp(appRt), starts Bun.serve, optionally opens the browser, handles SIGINT/SIGTERM for graceful shutdown via runNodeApplication. This is the LOCAL-FALLBACK deployment path; the primary deployment is Cloudflare (wrangler deploy of worker.ts). REVIEW AMENDMENT (2026-06-15): serve keys live in the EXISTING configSchema.server (env-config schema, what index.ts already reads as config.server.port), NOT a new spurConfigSchema.server block — that would collide. Anchors: ADR-021.b (board launcher question settled here), design §4 (all subsections).


### Requirements

## Requirements

- [x] **R1**: extend EXISTING configSchema.server (host/openBrowser/webDistPath; port kept) → **MET** | Evidence: `packages/config/src/index.ts:84`
- [x] **R2**: buildConfigFromEnv reads HOST alongside PORT → **MET** | Evidence: `packages/config/src/index.ts:15,127` + `tests/config.test.ts:18` (HOST env)
- [x] **R3**: config.example.yaml documents the server: block → **MET** | Evidence: `config/config.example.yaml:32`
- [x] **R4**: startServer extracted to serve.ts; index.ts + CLI both call it → **MET** | Evidence: `apps/server/src/serve.ts:55` + `apps/server/src/index.ts:11`
- [x] **R5**: `spur serve [--port/--host/--no-open/--cwd/--json]` registered in index.ts → **MET** | Evidence: `apps/cli/src/commands/serve.ts:9` + `apps/cli/src/index.ts:124`
- [x] **R6**: precedence flag → env → default → **MET** | Evidence: `apps/cli/src/commands/serve.ts:22` (`?? config.server`) + flag>env / env>default tests
- [x] **R7**: browser auto-open; skipped by --no-open and --json → **MET** | Evidence: `apps/cli/src/commands/serve.ts:24,34` + `serve.ts:105` + --no-open skip test
- [x] **R8**: --json emits { port, url, pid } → **MET** | Evidence: `apps/cli/src/commands/serve.ts:25` + `tests/commands/serve.test.ts:59`
- [x] **R9**: CLI depends on @gobing-ai/spur-server → **MET** | Evidence: `apps/cli/package.json:54`
- [x] **R10**: 04_DESIGN.md gains spur serve surface + server config keys → **MET** | Evidence: `docs/04_DESIGN.md:201,269-270`
- [x] **R11**: tests (precedence port+host, --no-open, --json, registration, ≥90%) → **MET** (post fix-pass) | Evidence: config.test.ts (HOST), serve.test.ts (flag>env, env>default, --no-open), commands/serve.test.ts (--json, registration); scope coverage 100%/100%


### Q&A



### Design

Authority: design §4 (Board launcher — all subsections), ADR-021.b (the board launcher question is
"settled here"). **REVIEW AMENDMENT 2026-06-15 (operator-confirmed):** serve config lives in the
EXISTING `configSchema.server`, NOT a new `spurConfigSchema.server` block (collision — design §4.2).

**Config ground-truth (verified — the collision this amendment fixes):** `packages/config/src/index.ts`
has TWO schemas. (1) `configSchema` = env/runtime schema parsed by `buildConfigFromEnv(env)`, already has
`server: z.object({ port }).default({ port: 3000 })`, **and is what `apps/server/src/index.ts` reads as
`config.server.port`.** (2) `spurConfigSchema` = the `.spur/config.yaml` project schema (`{ tasks?,
features? }`). The original design said "add `server:` to `spurConfigSchema`" — that COLLIDES with the
existing `configSchema.server`. Resolution: extend `configSchema.server`.

**Schema change (R1) — extend the EXISTING `configSchema.server`:**
```typescript
server: z.object({
  port: z.coerce.number().int().positive().default(3000),  // EXISTING
  host: z.string().default('localhost'),                   // NEW (HOST env)
  openBrowser: z.boolean().default(true),                  // NEW (spur serve only)
  webDistPath: z.string().nullable().default(null),        // NEW (S5 local static path)
}).default({ port: 3000, host: 'localhost', openBrowser: true, webDistPath: null }),
```
`spurConfigSchema` is NOT touched. `buildConfigFromEnv` (R2) reads `HOST` alongside the existing
`PORT` (`SPUR_ENV_VARS` already has `port: 'PORT'` — add `host: 'HOST'`).
`apps/cli/schemas/spur-config.schema.json` is the `.spur/config.yaml` validator — NOT relevant here
since serve keys live in `configSchema` (env), not `spurConfigSchema`; do not touch it.

**startServer extraction (R4 — design §4.3):** extract `startServer(options)` to
`apps/server/src/serve.ts`. Both `apps/server/src/index.ts` (standalone entry) and the CLI `serve`
command call it — one function, two entry points (same pattern as `createApp`). `index.ts` becomes:
```typescript
if (import.meta.main) {
  const config = buildConfigFromEnv(process.env);
  await startServer({ port: config.server.port, host: config.server.host, openBrowser: false, cwd: process.cwd(), json: false });
}
```
`startServer` resolves config -> builds the `ApplicationRuntime` (via `runNodeApplication`) -> calls
`createApp(appRt)` -> `Bun.serve` (with the 0072 graceful-shutdown handle + signal handlers) -> optional
browser open -> on `--json` prints `{ port, url, pid }`.

**CLI command (R5 — design §4.3):**
```
spur serve [--port <n>] [--host <addr>] [--no-open] [--cwd <path>] [--json]
```
`apps/cli/src/commands/serve.ts` `registerServeCommand(program, context)` mirrors the other CLI command
modules (commander noun, `--json` via the project output seam). Registered in `apps/cli/src/index.ts`.
CLI depends on `@gobing-ai/spur-server` (R9) to import `startServer` (add the workspace dep —
`apps/server` exports it via `package.json exports`).

**Precedence (R6 — design §4.2):** CLI flag -> env (folded by `buildConfigFromEnv`: PORT/HOST) ->
schema default (3000/localhost). NO `.spur/config.yaml` file layer for serve keys this round (the
amendment removed the file-config layer; env + flags own server runtime config).
```typescript
function resolvePort(flag: number|undefined, config: Config): number { return flag ?? config.server.port; }
```

**Browser open (R7):** open `http://<host>:<port>/board` (or `/`) unless `--no-open` or `--json`. Use a
cross-platform open (Bun: `Bun.spawn(['open'|'xdg-open'|'start', url])` per platform) — confirm the
existing pattern (the CLI already shells out for `$EDITOR` in agent.ts; reuse the ProcessExecutor seam).

**04_DESIGN.md sync (R10):** add the `spur serve` surface line + the `configSchema.server` keys to
`docs/04_DESIGN.md` in the SAME commit (constitution: command/config change keeps 04 in sync same-commit).

**GATED on S1 (0072/0073 — createApp + ServerContext must work) and S2 (0075 — modules mount).**

**Out of scope:** Cloudflare `wrangler deploy` (that's the worker.ts entry, not spur serve); Vite dev
server (W5/0081).


### Solution

## Solution

`spur serve` is the local-fallback launcher; primary deployment stays Cloudflare (`worker.ts`).
Implemented per design §4 with the 2026-06-15 review amendment (serve keys extend the EXISTING
`configSchema.server`, not a new `spurConfigSchema` block — collision avoided).

**Config (R1–R3):** `configSchema.server` in `packages/config/src/index.ts:84` gained
`host` (default `localhost`), `openBrowser` (default `true`), `webDistPath` (default `null`),
keeping the existing `port`. `SPUR_ENV_VARS` (`index.ts:15`) maps `host: 'HOST'`; `buildConfigFromEnv`
folds `HOST` alongside `PORT` (`index.ts:127`). `config/config.example.yaml:32` documents the block.
`spurConfigSchema` and `spur-config.schema.json` are untouched.

**startServer extraction (R4):** `apps/server/src/serve.ts` owns `startServer(options, deps?)` —
resolve bootstrap config → `runNodeApplication` → `createApp(appRt, { fs, ctx })` → `Bun.serve` with
SIGINT/SIGTERM graceful-shutdown handlers → optional browser open. Two entry points call it:
`apps/server/src/index.ts:11` (`import.meta.main`, `openBrowser:false`) and the CLI command.
A `StartServerDeps` injection seam (added 2026-06-15) lets tests pass fakes instead of
process-global `mock.module` — defaults wire the real implementations; production callers pass only
`options`.

**CLI command (R5–R9):** `apps/cli/src/commands/serve.ts` `registerServeCommand` registers
`spur serve [--port/--host/--no-open/--cwd/--json]` (`apps/cli/src/index.ts:124`). Precedence is
`options.port ?? config.server.port` (flag → env-folded → schema default). `--json` emits
`{ port, url, pid }` and skips the server start + browser open; `--no-open` skips only the browser.
CLI declares the `@gobing-ai/spur-server` workspace dep (`apps/cli/package.json:54`).

**Browser open (R7):** `apps/server/src/open-url.ts` `openUrl` shells out via `Bun.spawn([cmd, url])`
(`open`/`xdg-open`/`start` per platform) — argv array, no shell interpolation, no injection vector.

**Docs (R10):** `docs/04_DESIGN.md` carries the `spur serve` surface line (§ commands) and the
`server.openBrowser` / `server.webDistPath` config keys.

**Gates:** `bun run check`, `test-cf`, `build` all green; coverage-gate + tsdoc rules pass; the three
scope source files at 100% line/function coverage.


### Plan

## Plan

- [x] `packages/config`: extend the EXISTING `configSchema.server` with `host`/`openBrowser`/`webDistPath` (keep `port`); add `host: 'HOST'` to `SPUR_ENV_VARS`; `buildConfigFromEnv` reads `HOST`. Do NOT add a `server:` block to `spurConfigSchema`.
- [x] `config/config.example.yaml`: document the `server:` block (env-backed keys + comment that PORT/HOST env + CLI flags override).
- [x] Extract `startServer(options)` to `apps/server/src/serve.ts`: resolve config -> `runNodeApplication` -> `createApp(appRt)` -> `Bun.serve` (reuse 0072 handle + SIGINT/SIGTERM) -> optional browser open -> `--json` prints `{ port, url, pid }`. Export it from `apps/server` package exports.
- [x] `apps/server/src/index.ts`: `if (import.meta.main)` calls `startServer({ ...buildConfigFromEnv, openBrowser:false })`.
- [x] `apps/cli`: add `@gobing-ai/spur-server` workspace dep; `apps/cli/src/commands/serve.ts` `registerServeCommand(program, context)` with `--port/--host/--no-open/--cwd/--json`; register in `apps/cli/src/index.ts`.
- [x] Precedence resolver: CLI flag -> config.server (env-folded) -> default; browser open via the ProcessExecutor seam (reuse agent.ts $EDITOR pattern), skipped on --no-open/--json.
- [x] `docs/04_DESIGN.md`: add the `spur serve` surface + `configSchema.server` keys (SAME commit).
- [x] Tests: config precedence (flag > env > default) for port + host; `--no-open` skips open; `--json` shape `{port,url,pid}`; serve command registers; startServer boots createApp on a test port and serves /api/health. Coverage >=90%.
- [x] Gate: `bun run lint` + `test` + `test-cf` + `build`; `git status` only intentional changes (incl. 04_DESIGN).
- [x] GATE CHECK: confirm S1 (0072/0073) + S2 (0075) landed before starting (createApp + ServerContext + module mount must work).


### Review

## Review — 2026-06-16

**Status:** 1 finding (P4) + 1 partial requirement resolved via fix-pass
**Scope:** apps/server/src/serve.ts, apps/cli/src/commands/serve.ts, packages/config/src/index.ts, apps/server/src/open-url.ts
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline (current)
**Gate:** `bun run check` → pass · coverage-gate + tsdoc rules → pass · scope files 100%/100%
**Verdict:** PASS (post-fix; was PARTIAL on R11 test gaps)

### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Windows `start` needs `cmd /c start` to resolve (cmd builtin, not a binary) | Usability | apps/server/src/open-url.ts:8 | Non-blocking — Windows is not a target platform (macOS/Linux primary). `Bun.spawn(['start', url])` won't launch on Windows; wrap with `cmd /c` if Windows support is added. No injection risk (argv array, no shell). |

**Fix-pass 2026-06-16:** R11 test gaps closed — 4 tests added, 0 failed, 0 skipped. Gate + coverage-gate re-run clean.
- HOST-env precedence asserted (`packages/config/tests/config.test.ts`: HOST=0.0.0.0 flows through).
- flag > env (`apps/cli/tests/commands/serve.test.ts`: --port 9090 beats PORT=8080).
- env > default (PORT=8080 used when no --port flag).
- --no-open skips browser open (`apps/server/tests/serve.test.ts`: openUrl not called when openBrowser:false).


### Testing

## Testing

Coverage: scope source files (`serve.ts`, `commands/serve.ts`, `config/index.ts`) at **100% line /
100% function**. Gate `bun run check` + `test-cf` + coverage-gate + tsdoc-export rules all pass.

**Config precedence (R6, R11) — `packages/config/tests/config.test.ts`:**
- defaults: `{ port:3000, host:'localhost', openBrowser:true, webDistPath:null }`
- env layer: `PORT=4321`, `HOST=0.0.0.0` fold through `buildConfigFromEnv`

**CLI command (R5, R8, R11) — `apps/cli/tests/commands/serve.test.ts`:**
- `serve` command registers on the program
- `--json` emits `{ port, url, pid }` and does NOT start the server
- flag > env: `--port 9090` wins over `PORT=8080`
- env > default: `PORT=8080` used when no `--port` flag
- a startup error surfaces as a clean exit 1 (try/catch path)

**startServer (R4, R7, R11) — `apps/server/tests/serve.test.ts`:**
- `Bun.serve` wired; the captured fetch handler serves `/api/health` (200)
- `--no-open` (openBrowser:false) does NOT call `openUrl`
- openBrowser:true opens `http://<host>:<port>/board`
- scheduler branch + SIGINT/SIGTERM graceful-shutdown handlers exercised via injected deps
- `defaultDeps.createScheduler` lazily builds a real `NodeSchedulerAdapter`

All tests use the `StartServerDeps` injection seam — no `mock.module`, so no cross-file leak.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


