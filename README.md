# Spur

<div align="center">
  <img src="./docs/spur_logo.png" width="45%" alt="Spur logo" />
</div>

**Local-first harness engineering toolkit for mainstream coding agents.**

Spur is not a coding agent. It wraps your existing agents (Pi, Claude Code, Codex, Gemini CLI, OpenCode) with execution discipline, analytics, orchestration, constraints, verification, and operational visibility.

---

## What Spur Does

```text
idea → task decomposition → agent skill/workflow selection → agent execution
  → run/event capture → constraints + verification → inspection + analytics
  → skill/workflow tuning ← repeat
```

**Rule Engine** — YAML-driven linting with 40+ built-in evaluators (regex, AST, path, TSDoc), auto-fixers, and extension system. Policy presets (`recommended`, `spur-dev`) enforce code quality gates.

**Workflow Engine** — FSM-driven state machine workflows with transition gates, handler actions, and Mermaid visualization. Define multi-step processes as YAML.

**Agent Runner** — Detect, invoke, and health-check installed coding agents via a unified interface. No key storage — agents authenticate with their own credentials.

**CLI** — Single binary entry point for all operations. `spur rule run`, `spur workflow run`, `spur agent run`, and more.

**Server** — Hono HTTP API with OpenAPI spec, Zod-validated routes, and Cloudflare Workers support.

**Web** — Astro + React dashboard with RPC client consuming the server API.

---

## Quick Start

```bash
# Prerequisites: Bun >= 1.3.0
bun install

# Build CLI binary
bun run build:cli

# Run quality gate
bun run check

# Initialize a project
./dist/cli/spur init

# Run rule checks
./dist/cli/spur rule run --preset recommended
```

---

## Monorepo Structure

```
packages/
  contracts/      Cross-tier Zod schemas, DTOs, HTTP types (no business logic)
  api-types/      Type-only re-exports of server AppType for web RPC client
  core/           Domain/data layer: DB (Drizzle/SQLite), config, event bus,
                  job queue, telemetry, runtime adapters (Node/Bun + CF Workers)
  kernel/         Rule engine, FSM workflow engine, gate engine, AI runner,
                  agent service, config/profile loading
  workspaces/     Workspace registry (static binding records)
  assets/         Asset reference and inspection utilities
  tooling/        Pure utility libraries

apps/
  cli/            Commander.js CLI — rule, workflow, agent, init, inspect, status, workspace
  server/         Hono HTTP server — OpenAPI routes, middleware, modular composition
  web/            Astro + React frontend — RPC client, Tailwind CSS, Cloudflare Pages

contracts/       Policy contracts (JSON) consumed by rule engine
drizzle/         SQLite migration files
docs/            PRD, roadmap, architecture, design, features, decisions
scripts/         Build, check, policy, coverage helpers
```

**Ownership boundaries:** `contracts` owns DTOs. `core` owns business logic + DB. `kernel` owns engines + runners. `cli`/`server`/`web` own transport. No domain logic in transport layers. Core never imports from `apps/*`.

---

## Packages

| Package                                    | Description                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [`@spur/contracts`](packages/contracts/)   | Cross-tier Zod schemas, HTTP type helpers, compile-time type assertions                       |
| [`@spur/api-types`](packages/api-types/)   | Type-only seam — re-exports server `AppType` for web's Hono RPC client                        |
| [`@spur/core`](packages/core/)             | DB adapters (bun-sqlite, D1), DAOs, config, event bus, job queue, telemetry, runtime factory  |
| [`@spur/kernel`](packages/kernel/)         | Rule engine + host, FSM workflow engine, gate engine, AI runner, agent/workflow/rule services |
| [`@spur/workspaces`](packages/workspaces/) | Workspace registry with static binding records                                                |
| [`@spur/assets`](packages/assets/)         | Asset reference and inspection utilities                                                      |
| [`@spur/tooling`](packages/tooling/)       | Pure utility libraries                                                                        |

---

## CLI Commands

```
spur init                  Initialize project configuration
spur doctor                Health-check installed coding agents
spur status                Show project and workspace status

spur rule run              Run rule checks with evaluators + fixers
spur rule list             List available rules and presets
spur rule file-stats       Show rule file statistics

spur agent run             Execute a coding agent task
spur agent list            List available agents with health info

spur workflow run          Execute an FSM workflow
spur workflow list         List available workflows

spur inspect               Inspect project configuration and state

spur workspace add         Register a workspace binding
spur workspace list        List registered workspaces
```

---

## Tech Stack

| Layer         | Technology                                                                           |
| ------------- | ------------------------------------------------------------------------------------ |
| Runtime       | [Bun](https://bun.sh/) ≥ 1.3.0                                                       |
| Language      | TypeScript strict mode                                                               |
| Formatting    | [Biome](https://biomejs.dev/)                                                        |
| DB            | SQLite via [Drizzle ORM](https://orm.drizzle.team/)                                  |
| Server        | [Hono](https://hono.dev/) + `@hono/zod-openapi`                                      |
| Web           | [Astro](https://astro.build/) 6 + React + [Tailwind CSS](https://tailwindcss.com/) 4 |
| Validation    | [Zod](https://zod.dev/) 4                                                            |
| CLI           | [Commander.js](https://github.com/tj/commander.js)                                   |
| Logging       | [LogTape](https://github.com/aspect-build/logtape)                                   |
| Observability | OpenTelemetry (traces + metrics)                                                     |
| Deploy        | Cloudflare Workers (server), Cloudflare Pages (web)                                  |

---

## Commands

### Development

```bash
bun run dev:all              # Start all tiers
bun run dev:cli              # CLI dev mode
bun run dev:server           # Hono server with hot reload
bun run dev:web              # Astro dev server
```

### Quality

```bash
bun run check                # Full gate: format → lint → policy → typecheck → tests → coverage
bun run check:full           # Full gate with verbose output
bun run quicktest            # Run only changed/new test files
bun run typecheck            # tsc --noEmit
bun run test                 # Tests + coverage
bun run test-cf              # Cloudflare Workers runtime tests (Vitest/Miniflare)
bun run autofix              # Format + lint fix
bun run fix:all              # Autofix + policy fix
```

### Build

```bash
bun run build:all            # Build all tiers
bun run build:cli            # Compile CLI binary → dist/cli/spur
bun run build:server         # Build server → dist/server/
bun run build:web            # Build web → dist/web/
```

### Database

```bash
bun run db:generate          # Generate migration from schema changes
bun run db:push              # Push schema to DB (dev)
bun run db:migrate           # Run migrations
```

### Deploy (Cloudflare)

```bash
bun run deploy:server        # Deploy server to Cloudflare Workers
bun run deploy:web           # Deploy web to Cloudflare Pages
```

---

## Documentation

| Document                                             | Purpose                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| [`docs/00_idea.md`](docs/00_idea.md)                 | Project origin, source inputs, strategy                          |
| [`docs/01_PRD.md`](docs/01_PRD.md)                   | Product requirements — problem, user stories, success criteria   |
| [`docs/02_ROADMAP.md`](docs/02_ROADMAP.md)           | Delivery plan — phases, milestones, feature sequencing           |
| [`docs/03_ARCHITECTURE.md`](docs/03_ARCHITECTURE.md) | System architecture — runtime design, tier boundaries, data flow |
| [`docs/04_DESIGN.md`](docs/04_DESIGN.md)             | Detailed design — module contracts, API shapes, DB schema        |
| [`docs/05_FEATURES.md`](docs/05_FEATURES.md)         | Feature specs — per-feature requirements and acceptance criteria |
| [`docs/06_DECISIONS.md`](docs/06_DECISIONS.md)       | Decision log — 28 canonical ADRs (D-001 through D-028)           |

---

## Conventions

- **Runtime detection** confined to `packages/core/src/runtime/`. Application code calls factory methods, never probes runtime identity.
- **Cross-tier schemas** in `@spur/contracts`. Server routes declare local Zod schemas with compile-time `Equals<A, B>` assertions.
- **Web RPC** imports `AppType` from `@spur/api-types` only — never depends on `@spur/server`.
- **Tests** in `tests/` mirroring `src/`. No `__tests__`, no `.test.ts` under `src/`.
- **Naming**: kebab-case source files, PascalCase web components/layouts.
- **TSDoc**: Every export must have `/** ... */` stating what it is and why.
- **Workspaces**: `@spur/<name>`, cross-deps use `workspace:*`.
- **CLI commands** are thin transport wrappers per [D-028](docs/06_DECISIONS.md). Reusable behavior lives in service classes.

---

## License

MIT © [Robin Min](mailto:minlongbing@gmail.com)
