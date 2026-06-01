# 00 ADR — Spur

**Status:** Authoritative
**Last Updated:** 2026-05-30
**Owner:** Robin Min

This file is the **single source of truth** for Spur's architecture decisions. Each entry carries
Context, Decision, and Consequences. When another document conflicts with an entry here, this file
wins — flag the drift and resolve it. New cross-cutting decisions are appended as `ADR-NNN`.

> There is no separate `06_DECISIONS.md`. All architecture decisions live here.

---

## ADR-001: Greenfield Re-Foundation

**Status:** Accepted · **Date:** 2026-05-30

**Context.** The original Spur codebase was scaffolded from an immature starter
(`typescript-bun-starter`) and accumulated technical debt across `@spur/core`, `@spur/kernel`,
`@spur/contracts`, and the history packages. Extracting that code as-is would move the debt.

**Decision.** Re-found Spur in a clean Bun-workspace monorepo. Scaffold a fresh foundation from
`ts-base` mono conventions, port apps with direct `@gobing-ai/ts-*` imports, and re-implement the
extractable engines from scratch as standalone ts-libs packages.

**Consequences.** No `@spur/*` scope exists in this repo. Apps depend only on ts-libs packages plus
two thin local packages (`contracts`, `config`). Cutover replaces the old tree in one commit (or
re-points the remote) once all gates pass.

---

## ADR-002: Bun Workspaces, No Turborepo

**Status:** Accepted · **Date:** 2026-05-30

**Context.** The project is ~3 apps + ~2 local packages + a handful of external ts-libs deps.

**Decision.** Use Bun workspace filtering (`bun run --filter '*'`) for task orchestration. Do not
adopt Turborepo.

**Consequences.** No `turbo.json`, no remote cache layer. Turborepo earns its keep around 20+
packages; below that it is ceremony. Root scripts compose Biome + `tsc --noEmit` + `bun test`
directly. Revisit only if the package count grows substantially.

---

## ADR-003: Shared TypeScript Tooling from ts-base

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Import `ts-base` conventions for Biome, Lefthook, and shared tsconfig presets under
`tooling/typescript/` (base/server/react). The lint gate is `biome check` + per-workspace
`tsc --noEmit`. Style: 4-space indent, single quotes, semicolons, trailing commas,
`noExplicitAny: error`.

**Consequences.** Consistent tooling with sibling `ts-base`/`ts-libs` projects. Style drift is a
gate failure, not a review nit.

---

## ADR-004: ts-libs as External Dependencies, Not Workspace Members

**Status:** Accepted · **Date:** 2026-05-30

**Context.** `@gobing-ai/ts-*` packages live in the separate `~/xprojects/ts-libs/` repository and
are published to npm. They are not members of this repo's `workspaces` array.

**Decision.** Consume the four stable infra packages (`ts-db`, `ts-infra`, `ts-runtime`,
`ts-utils`) by npm semver (`^0.2.3`). `workspace:*` is **invalid** for these deps and must never
appear in a committed manifest. `bun link` is permitted only as temporary inner-loop tooling while
a ts-libs package is being changed; it must be unlinked, published, and pinned to semver before its
task's gate.

**Consequences.** The boundary between Spur (domain consumer) and ts-libs (generic infra) is an
`import` line, enforceable in review. **Open item:** the four extracted engines
(`ts-ai-runner`, `ts-rule-engine`, `ts-dual-workflow-engine`, `ts-llm-jsonl-importer`) are still on
`link:` and must be published + pinned before this repo builds from a clean clone (tracked
follow-up).

---

## ADR-005: oRPC as the Type Seam

**Status:** Accepted · **Date:** 2026-05-30

**Context.** The old repo used Hono RPC (`hc<AppType>()`) + `@hono/zod-openapi` route definitions
with `Equals<A,B>` compile-time assertions — a brittle, hand-maintained contract↔handler link.

**Decision.** Adopt oRPC (`@orpc/*@1.14.x`) as the server↔web type seam. Transport contracts live
in `packages/contracts` (`oc.route(...).output(...)`). The server router binds handlers via
`implement(contract)`. OpenAPI is generated from the contract (`OpenAPIGenerator`). The web client
uses `OpenAPILink` typed against the same contract. The `@hono/zod-openapi` + `Equals<A,B>` pattern
is retired and must not be reintroduced.

**Consequences.** Contract↔handler drift is a compile error, not a runtime surprise. `packages/contracts`
holds transport DTOs only — domain types stay in their owning ts-libs package.

---

## ADR-006: Domain Engines Are External ts-libs Packages, Not a Local Kernel

**Status:** Accepted · **Date:** 2026-05-30

**Context.** The old repo concentrated rules, workflow, AI runner, and gates inside one
`@spur/kernel` package.

**Decision.** The reusable engines become standalone, independently-versioned ts-libs packages,
each owning its types and (where relevant) its schema:

| Capability | Package | CLI command |
|------------|---------|-------------|
| Agent detection / doctor / run | `@gobing-ai/ts-ai-runner` | `spur agent` |
| Constraint rule evaluation | `@gobing-ai/ts-rule-engine` | `spur rule` |
| FSM + transition-flow orchestration | `@gobing-ai/ts-dual-workflow-engine` | `spur workflow` |
| Append-only JSONL history import | `@gobing-ai/ts-llm-jsonl-importer` | `spur history import` |

**Consequences.** Spur is a thin consumer; CLI commands are transport wrappers over package APIs.
The engines are reusable by other projects. Spur-domain glue (analytics pricing, DAO wiring) stays
in `apps/cli`.

---

## ADR-007: Package-Owned Database Schema

**Status:** Accepted · **Date:** 2026-05-30

**Context.** A monolithic Drizzle migration set coupled every table to one place and broke when
engines changed their schema.

**Decision.** Each domain package exports its own schema SQL
(`HISTORY_IMPORT_SCHEMA_SQL`, `WORKFLOW_ENGINE_SCHEMA_SQL`). The CLI composes them with its own
domain tables into `CLI_SCHEMA_SQL` and applies them through an isolated journal
(`__spur_cli_migrations`). The migrator only loads top-level `drizzle/*.sql` files containing the
`_spur_cli_` marker.

**Consequences.** Schema ownership follows code ownership. Legacy migrations copied from old spur
live inert under `drizzle/_legacy_reference/` and are never applied. `drizzle-kit` is not the
migration runtime for the CLI.

---

## ADR-008: History — Raw Stays in Files, DB Holds Only Validated ETL

**Status:** Accepted · **Date:** 2026-05-30

**Context.** The old importer stored raw JSON in DB columns (hitting SQLite text limits → parse
errors), re-imported everything on each run, and re-implemented record splitting per platform.

**Decision.** The importer (`@gobing-ai/ts-llm-jsonl-importer`) enforces:

- **Validate before persist** — only Zod-validated canonical records reach the DB.
- **Raw stays as files** — source JSONL is the canonical raw store; no `history_raw_*` tables.
- **Incremental by checkpoint** — composite PK `(source, source_file)` tracks `last_line`; JSONL is
  append-only, so old lines are never reprocessed.
- **Idempotent** — SHA-256 dedup at record level (hash computed after redaction).
- **One source = one `SourceDefinition`** — a discriminated union with `fieldMap` (raw→canonical),
  optional `fieldTransforms`, `splitConfig`, and schema. Adding a source adds one variant; the
  generic pipeline never changes.

**Consequences.** Three table classes only: import ledger, checkpoint, per-source ETL. Full /
incremental / force-file modes are first-class. Spur analytics reads the ETL tables as a consumer.

---

## ADR-009: Dual-Mode Workflow Engine

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** `@gobing-ai/ts-dual-workflow-engine` provides two execution models behind one host:
a **state-machine** driver (FSM: states, transitions, guards — for linear/looping workflows) and a
**transition-flow** driver (DAG with conditional branching — for multi-phase pipelines). Both follow
a single readable control loop. Persistence is via an adapter (SQLite through ts-db BaseDao;
in-memory for tests). Workflow definitions are YAML, Zod-validated, with variable interpolation.

**Consequences.** One dependency covers both simple dev-task loops and complex orchestration without
introducing a second engine. The CLI's `WorkflowService` wires the DB persistence adapter.

---

## ADR-010: CLI Is the Primary Surface; Local-First by Default

**Status:** Accepted · **Date:** 2026-05-30

**Context.** Spur is a single-machine developer tool. Phase 1 has no network requirement in the core
loop.

**Decision.** The CLI (`apps/cli`) is the primary entry point and the writer of record. The server
(`apps/server`) and web (`apps/web`) are a thin, read-oriented inspection surface that can also run
on Cloudflare Workers via runtime abstraction. Every CLI command supports `--json`. The committed
product command set is `init`, `agent`, `history`, `rule`, `workflow`; supporting utilities are
`status`, `migrate`, `inspect`, `workspace`.

**Consequences.** SQLite + local files are the default store. Commands beyond the committed set from
old spur (asset inspection, richer run inspection) are deferred until their need and design are
reconfirmed — they are not ported speculatively.

---

## ADR-011: ts-db Consumed as a Facade; Tables Are a Single Source of Truth

**Status:** Accepted · **Date:** 2026-06-01

**Context.** Spur consumes `@gobing-ai/ts-db@0.2.3`, which is a drizzle-free facade with a
single-source-of-truth schema model (ts-libs ADR-005/007). Earlier, `packages/domain` defined tables
as raw `sqliteTable` objects **and** hand-wrote `DOMAIN_SCHEMA_SQL` — two descriptions that could
drift. The 0.2.3 `defineTable` derives the table, its zod schemas, and its `CREATE TABLE` DDL from
one definition.

**Decision.** As a *consumer* of ts-db, Spur follows the facade contract:

1. **ts-db is imported only inside `packages/domain`.** Apps (`cli`, `server`, `web`) and the other
   local packages (`config`, `contracts`) consume persistence through `@gobing-ai/spur-domain` DAOs —
   never `@gobing-ai/ts-db` directly, never the raw adapter.
2. **drizzle-orm is confined to `packages/domain/src/schema/`.** Table authoring legitimately uses
   drizzle column builders (`text`, `integer`) as input to `defineTable`; nowhere else in Spur may
   import `drizzle-orm` (not DAOs, analytics, apps). Business/query code uses the ts-db vocabulary
   (`EntityDao`, `BaseDao`, the predicate spec).
3. **Tables are defined with `defineTable`** (from `@gobing-ai/ts-db/schema`) — not bare `sqliteTable`.
   Each schema file exports the `DefinedTable` (for DDL/zod) plus its `.table` (for DAOs/FKs).
4. **DDL is derived, never hand-written.** `DOMAIN_SCHEMA_SQL` is composed from each table's
   `createTableSql`. No raw `CREATE TABLE` for a Drizzle-backed table (only the migration journal and
   package-owned SQL from ts-libs are exempt). `.sql` text-imports are forbidden (non-portable).
5. **Raw string SQL stays inside `packages/domain`** (the DAO/migration layer), never in apps.

**Consequences.** Drift between table/DDL/zod is structurally impossible; the storage engine stays
swappable; apps remain drizzle- and SQL-free. Enforced by `.spur/rules/boundary/dao-boundary.yaml`
(`ts-db-only-in-domain`, `drizzle-only-in-domain-schema`, `tables-via-defineTable`,
`no-hand-written-ddl-for-drizzle-tables`, `raw-sql-only-in-domain`). `drizzle-zod` + `zod` are
dependencies of `packages/domain` because it imports the `@gobing-ai/ts-db/schema` subpath.
