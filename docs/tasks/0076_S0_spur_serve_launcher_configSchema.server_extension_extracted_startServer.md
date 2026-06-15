---
name: "S0: spur serve launcher + configSchema.server extension + extracted startServer"
description: "S0: spur serve launcher + configSchema.server extension + extracted startServer"
status: Backlog
created_at: 2026-06-15T16:01:46.325Z
updated_at: 2026-06-15T16:01:46.325Z
folder: docs/tasks
type: task
feature-id: S0
priority: P1
estimated_hours: 6
tags: ["server-side-adjustment","wave-S0","group-S"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0076. "S0: spur serve launcher + configSchema.server extension + extracted startServer"

### Background

The operator's one command to go from terminal to board. spur serve resolves server config, builds the ApplicationRuntime, calls createApp(appRt), starts Bun.serve, optionally opens the browser, handles SIGINT/SIGTERM for graceful shutdown via runNodeApplication. This is the LOCAL-FALLBACK deployment path; the primary deployment is Cloudflare (wrangler deploy of worker.ts). REVIEW AMENDMENT (2026-06-15): serve keys live in the EXISTING configSchema.server (env-config schema, what index.ts already reads as config.server.port), NOT a new spurConfigSchema.server block — that would collide. Anchors: ADR-021.b (board launcher question settled here), design §4 (all subsections).


### Requirements

R1: Extend the EXISTING configSchema.server in packages/config (add host:string=localhost, openBrowser:boolean=true, webDistPath:string|null=null; port already present). Do NOT add a server block to spurConfigSchema (collision — design §4.2). R2: buildConfigFromEnv reads HOST alongside the existing PORT. R3: config.example.yaml documents the server: block (env-backed). R4: Extract startServer(options) to apps/server/src/serve.ts; both apps/server/src/index.ts (standalone entry) and the CLI command call it — one function, two entry points (same pattern as createApp). R5: spur serve [--port <n>] [--host <addr>] [--no-open] [--cwd <path>] [--json] in apps/cli/src/commands/serve.ts; registerServeCommand registered in apps/cli/src/index.ts. R6: Precedence: CLI flag -> env (folded by buildConfigFromEnv) -> schema default (3000/localhost). R7: Browser auto-open (skipped by --no-open and when --json). R8: --json emits { port, url, pid }. R9: CLI depends on @gobing-ai/spur-server to import startServer (add the workspace dep). R10: 04_DESIGN.md gains the spur serve surface + server config keys in the SAME commit. R11: Tests: config precedence (flag>env>default); --no-open skips open; --json shape; serve command registration. Coverage >=90%. GATED on S1 (createApp must work) + S2.


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



### Plan

- [ ] `packages/config`: extend the EXISTING `configSchema.server` with `host`/`openBrowser`/`webDistPath` (keep `port`); add `host: 'HOST'` to `SPUR_ENV_VARS`; `buildConfigFromEnv` reads `HOST`. Do NOT add a `server:` block to `spurConfigSchema`.
- [ ] `config/config.example.yaml`: document the `server:` block (env-backed keys + comment that PORT/HOST env + CLI flags override).
- [ ] Extract `startServer(options)` to `apps/server/src/serve.ts`: resolve config -> `runNodeApplication` -> `createApp(appRt)` -> `Bun.serve` (reuse 0072 handle + SIGINT/SIGTERM) -> optional browser open -> `--json` prints `{ port, url, pid }`. Export it from `apps/server` package exports.
- [ ] `apps/server/src/index.ts`: `if (import.meta.main)` calls `startServer({ ...buildConfigFromEnv, openBrowser:false })`.
- [ ] `apps/cli`: add `@gobing-ai/spur-server` workspace dep; `apps/cli/src/commands/serve.ts` `registerServeCommand(program, context)` with `--port/--host/--no-open/--cwd/--json`; register in `apps/cli/src/index.ts`.
- [ ] Precedence resolver: CLI flag -> config.server (env-folded) -> default; browser open via the ProcessExecutor seam (reuse agent.ts $EDITOR pattern), skipped on --no-open/--json.
- [ ] `docs/04_DESIGN.md`: add the `spur serve` surface + `configSchema.server` keys (SAME commit).
- [ ] Tests: config precedence (flag > env > default) for port + host; `--no-open` skips open; `--json` shape `{port,url,pid}`; serve command registers; startServer boots createApp on a test port and serves /api/health. Coverage >=90%.
- [ ] Gate: `bun run lint` + `test` + `test-cf` + `build`; `git status` only intentional changes (incl. 04_DESIGN).
- [ ] GATE CHECK: confirm S1 (0072/0073) + S2 (0075) landed before starting (createApp + ServerContext + module mount must work).


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


