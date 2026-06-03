# AGENTS.md

Guidance for AI coding agents working in this repository. `CLAUDE.md` and `GEMINI.md` symlink here.

## Project

**Spur** — a local-first harness engineering toolkit for mainstream coding agents (Claude Code,
Codex, Gemini CLI, Antigravity, pi, OpenCode, OpenClaw). It is **not** a coding agent and **not** a
BYOK LLM platform. It wraps agents you already have installed and authenticated, adding execution
discipline, constraint checking, workflow orchestration, history analytics, and operational
visibility.

## Documentation map

Each doc owns exactly **one question** about the system and is the single source of truth for it.
A fact lives in **one** doc; other docs link to it, never restate it. Read the doc that governs
your change before editing code; edit the **authoritative** doc for the topic, never patch a
symptom in a derived one.

**Conflict rule:** lower number wins. `00_ADR` is binding and overrides all others on *decisions*;
`01_PRD` is authoritative on *scope*. On conflict, fix the authoritative doc and flag the drift.

| Doc | Owns the question | Authority | Read / edit when |
|-----|-------------------|-----------|------------------|
| `docs/00_ADR.md` | **WHY** — which cross-cutting decision was made, and the one-line reason | **Authoritative** (wins all) | Read before any structural change; add a dated entry before diverging from a decision |
| `docs/01_PRD.md` | **WHAT** — product vision, users, scope (in / out / deferred) | **Authoritative on scope** | Read before adding a command/feature; edit when scope changes |
| `docs/02_ROADMAP.md` | **WHEN** — phases, current vs deferred, sequencing | Derived | Read to place work in a phase; edit when phase status changes |
| `docs/03_ARCHITECTURE.md` | **HOW** — module boundaries, data flow, runtime model, invariants, the *rationale* behind a decision | Derived (ADR wins) | Read before cross-module/seam/schema work; edit when boundaries or mechanisms change |
| `docs/04_DESIGN.md` | **SURFACE** — concrete shapes: every CLI command, flag, config key, env var, table, DTO | Derived | Read/edit when changing a command, flag, env var, or schema |
| `docs/05_FEATURES.md` | **STATUS** — feature decomposition + state (✅ done / 🔶 partial / ⏳ planned / 💤 deferred) | Derived | Read to find a feature's state; edit when a feature's status changes |

**Routing — put each fact in its owning doc, link from the rest:**

- Decision + one-line reason → `00`. Rationale/consequences in depth → `03`.
- Scope (in/out/deferred) → `01`. Mechanism / data flow / invariants → `03`.
- Command/flag/config/schema/DTO shapes → `04`. Phase timing → `02`. Feature status → `05`.
- If you're writing *how it's built* or *why* inside `00`/`01`/`02`, it belongs in `03`/`04`.

A code change that contradicts `00_ADR.md` requires adding a new dated ADR entry that supersedes the
old one **first** — never silently diverge. Any new cross-cutting choice (new app/package, transport
swap, auth boundary, DB swap) gets a new ADR entry pointing to its `03`/`04` detail. A change that
touches a command/config/schema keeps `04_DESIGN.md` in sync in the **same commit**.

## Stack & layout

Bun + TypeScript + Biome monorepo on **Bun workspaces (no Turborepo)**. Layout:

```
apps/
  cli/          # Spur CLI — primary surface; arg dispatch + domain commands (@gobing-ai/spur-cli)
  server/       # Hono on Bun.serve / Cloudflare Worker; oRPC OpenAPI handler (@gobing-ai/spur-server)
  web/          # Astro + Cloudflare adapter; typed oRPC OpenAPI client (@gobing-ai/spur-web)
packages/
  contracts/    # oRPC transport contracts ONLY — health/DTOs, no domain types (@gobing-ai/spur-contracts)
  config/       # zod config schema + env parsing (@gobing-ai/spur-config)
tooling/
  typescript/   # shared tsconfig presets (base/server/react) — from ts-base
drizzle/        # 0000_spur_cli_foundation.sql (active) + _legacy_reference/ (old schema, inert)
docs/           # 00_ADR.md (authoritative) + 01-05 product docs
```

Domain engines do **not** live in this repo. They are external `@gobing-ai/ts-*` packages consumed
from the separate `~/xprojects/ts-libs/` repository:

| Package | Role |
|---------|------|
| `@gobing-ai/ts-utils` | output, errors, api-response, cursor, date, access helpers |
| `@gobing-ai/ts-infra` | logger, EventBus, telemetry, scheduler, job-queue interfaces |
| `@gobing-ai/ts-runtime` | runtime context, FileSystem, ProcessExecutor, config loader |
| `@gobing-ai/ts-db` | DbAdapter, BaseDao, migrations, QueueJobDao |
| `@gobing-ai/ts-ai-runner` | `AgentDetector`, `DoctorRunner`, `AiRunner` (backs `spur agent`) |
| `@gobing-ai/ts-rule-engine` | `RuleEngine`, evaluators, presets, formatters (backs `spur rule`) |
| `@gobing-ai/ts-dual-workflow-engine` | FSM + transition-flow engine (backs `spur workflow`) |
| `@gobing-ai/ts-llm-jsonl-importer` | `runJsonlImport`, SourceDefinition pipeline (backs `spur history`) |

- **Runtime / package manager / test runner:** Bun `1.3.14`. Prefer `bun:*` APIs over `node:*`.
- **Lint + format:** Biome `2.4.16`. No ESLint, no Prettier.
- **Type seam:** oRPC `1.14.x`. **HTTP:** Hono. **Web:** Astro. **DB:** SQLite via ts-db.
- **Tool versions:** pinned in `.prototools` ([proto](https://moonrepo.dev/proto)). **Hooks:** Lefthook.

Never introduce a new runtime, package manager, linter, formatter, or Turborepo.

> **Dependency source.** Spur consumes released `@gobing-ai/ts-*` packages by semver. Temporary
> `bun link @gobing-ai/ts-*` is acceptable only while validating an unreleased shared-library fix;
> remove the link and return to semver once the package is released.

> **Version SSOT — Bun Catalog.** Every dependency **shared across two or more workspaces** (the
> `@gobing-ai/ts-*` family, the `@orpc/*` seam, `typescript`, `@types/bun`, `zod`) is declared **once**
> in the root `package.json` under `workspaces.catalog`, and each workspace references it with
> `"catalog:"` — never a literal version. **Package-private deps stay as literals** in their own
> manifest (e.g. `figlet` in cli, `hono`/`wrangler`/`vitest` in server, `astro` in web, `drizzle-zod`
> in domain, root-only `@biomejs/biome`/`lefthook`). Rule of thumb: a dep in ≥2 manifests → catalog;
> a dep in exactly one → literal. To bump a shared dep, edit the root catalog block and run
> `bun install`; do **not** edit version strings in `apps/*` or `packages/*`. The lockfile mirrors the
> catalog map. (`bun publish` inlines `catalog:` to the resolved version, but Spur's apps are
> unpublished and the packages are internal, so this never surfaces externally.)

> **Shared-library evolution.** If a `@gobing-ai/ts-*` package cannot support a Spur requirement
> cleanly, prefer enhancing the owning package in `~/xprojects/ts-libs/` over adding workaround
> code or leaking implementation details into Spur. Keep the boundary explicit: make the smallest
> upstream change that turns the shared package into the right facade, verify `ts-libs` with its own
> gates, then consume it from Spur through a published semver version or an explicit temporary
> `bun link`. Document any temporary link requirement in the task until the package is released.

## Code style (enforced by `biome.json`)

- 4-space indent, `lineWidth` 120.
- **Single quotes**, semicolons always, trailing commas everywhere.
- `interface` for object shapes, `type` for unions/intersections.
- Imports/exports are auto-sorted by Biome — don't hand-order them.
- `any` is an **error** (`noExplicitAny`). Narrow the type; justify any unavoidable case with `// biome-ignore`.
- Workspace imports use the `@gobing-ai/*` alias, never deep relative paths into a sibling package.

## Commands

```bash
bun run lint       # biome check + per-workspace tsc --noEmit  (the gate)
bun run format     # biome check --write                       (autofix)
bun run test       # bun test --coverage (all workspaces)
bun run test-cf    # Cloudflare Workers Vitest (server)
bun run clean      # reset root dist/
bun run build      # clean, then build cli/server/web into root dist/
bun run check      # lint + test (local gate)
bun run dev        # bun run --filter '*' dev
```

CLI binary: `apps/cli` exposes `bin: { spur: "./src/index.ts" }` — the `.ts` entry runs only under
Bun. Run with `bun run apps/cli/src/index.ts <command>` during development.

## CLI surface

Supported commands (the harness loop). `init`, `agent`, `history`, `rule`, `workflow` are the
committed product surface; `status` and `migrate` are supporting utilities.

```
spur init       [--name <name>] [--json]
spur agent      run <prompt> [--agent <name>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--json]
spur agent      list [--json]
spur agent      doctor [agent] [--json]
spur history    import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--json]
spur history    analyze [--since <iso-date>] [--json]
spur history    report [--json]  # TODO marker; implementation deferred
spur rule       run [--preset <name>] [--rule <id>] [--fail-on <severity>] [--json]
spur rule       validate [--file <path>|--preset <name>|<path>] [--json]
spur rule       list [--preset <name>] [--json]
spur workflow   validate <workflow.yaml> [--json]
spur workflow   run <workflow.yaml> [--run-id <id>] [--json]
spur workflow   list [--json]
spur status     [path] [--json]
spur migrate    [--json]
```

Every command supports `--json` for machine consumption.

## Verification gate (all must pass before "done")

1. `bun run lint` clean — Biome and per-workspace `tsc --noEmit`.
2. `bun run test` passes; no test skipped, `.skip`'d, or commented out to go green.
3. `bun run test-cf` passes (server Workers runtime).
4. `bun run build` succeeds across all workspaces.
5. `git status` shows only intentional changes.

If a check fails, fix the root cause. **Never** bypass with `--no-verify`, `--force`, or new
`biome-ignore` suppressions added solely to silence the gate.

## Testing

- Tests live in `tests/` next to the code (`<workspace>/tests/**/*.test.ts`), using `bun:test`.
- Coverage target is **per file line >= 90% and function >= 90% in aggregate** (`bunfig.toml`).
- DAOs test against in-memory SQLite (`:memory:`); inject a fresh adapter per test.
- Names describe behavior under a condition; assertions tie to the requirement, not the implementation.

## oRPC conventions

- Contracts live in `packages/contracts/src` and are the single source of truth (transport DTOs only).
- The server router binds handlers via `implement(contract)` so contract↔handler drift fails at compile time.
- OpenAPI is generated from the contract (`@orpc/openapi` `OpenAPIGenerator`); never hand-maintain a spec.
- Clients (`apps/web`, future `apps/cli` remote) consume only contract types via `OpenAPILink`; never reach into server internals.
- Domain types belong in their owning `@gobing-ai/ts-*` package, **never** in `packages/contracts`.

## Database / migrations

- Each domain package owns its schema SQL; the CLI composes them into `CLI_SCHEMA_SQL`
  (`apps/cli/src/db/migrations.ts`): CLI domain tables + `HISTORY_IMPORT_SCHEMA_SQL` +
  `WORKFLOW_ENGINE_SCHEMA_SQL`.
- The CLI migrator only applies top-level `drizzle/*.sql` files containing the `_spur_cli_` marker.
- History keeps raw data in files (no `history_raw_*` tables); the DB holds only validated ETL rows,
  an import ledger, and per-file checkpoints.
- Old migrations under `drizzle/_legacy_reference/` are inert reference only — never activate them.

## Conventions & boundaries

- Conventional Commits required (`feat:`, `fix:`, `docs:`, `chore:`, ...). Breaking changes in a `BREAKING CHANGE:` footer.
- Cross-workspace imports use `@gobing-ai/<pkg>`, never `../../../packages/...`.
- `vendors/` and `drizzle/_legacy_reference/` are reference-only — **never modify**.
- Never commit secrets, `.env*`, or credentials. Spur never stores agent API keys — auth is the agent's concern.
- Never edit `.github/workflows/` without approval.
- Surgical changes only: touch what the task needs; no drive-by refactors, no speculative abstractions,
  no comments that restate what the code already says.

---

## OpenWolf context

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read `.wolf/OPENWOLF.md` each session. Check
`.wolf/cerebrum.md` before generating code. Check `.wolf/anatomy.md` before reading files.
