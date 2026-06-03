# 00 ADR — Spur

**Status:** Authoritative · **Last Updated:** 2026-06-03 · **Owner:** Robin Min

The single source of truth for Spur's cross-cutting **decisions**. Each `ADR-NNN` records *what was
decided* and *the one-line reason* — the mechanism, rationale-in-depth, and consequences live in
`03_ARCHITECTURE.md` (or concrete shapes in `04_DESIGN.md`), reached via the `Detail:` pointer.

Rules: entries are append-only and never renumbered (cross-references depend on the number). When
another doc conflicts with an entry here, this file wins — flag the drift. Supersede a decision with
a new dated entry that names the one it replaces. There is no `06_DECISIONS.md`.

---

## ADR-001: Greenfield Re-Foundation

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Re-found Spur as a clean Bun-workspace monorepo scaffolded from `ts-base` conventions,
rather than extracting the debt-laden `@spur/*` tree from the original starter. No `@spur/*` scope
exists here; apps depend only on `@gobing-ai/ts-*` packages plus two thin local packages
(`contracts`, `config`).

**Why.** Extracting the old code as-is would carry its accumulated debt forward.

**Detail:** `03 §1 Topology`.

---

## ADR-002: Bun Workspaces, No Turborepo

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Orchestrate tasks with Bun workspace filtering (`bun run --filter '*'`). Do not adopt
Turborepo or any remote-cache layer (`turbo.json` forbidden). Revisit only if package count grows
substantially.

**Why.** ~3 apps + ~2 local packages is well below the ~20-package threshold where Turborepo earns
its ceremony.

**Detail:** `03 §1 Topology`.

---

## ADR-003: Shared TypeScript Tooling from ts-base

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Import `ts-base` conventions for Biome, Lefthook, and the shared tsconfig presets
(`tooling/typescript/` — base/server/react). The lint gate is `biome check` + per-workspace
`tsc --noEmit`; style drift is a gate failure, not a review nit.

**Why.** Consistent tooling with sibling `ts-base`/`ts-libs` projects.

**Detail:** style rules in `AGENTS.md` (Code style); preset wiring in `03 §1 Topology`.

---

## ADR-004: ts-libs as External Dependencies, Not Workspace Members

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Consume `@gobing-ai/ts-*` packages by npm semver; they are not members of this repo's
`workspaces` array. `workspace:*` is invalid for these deps and must never appear in a committed
manifest. `bun link` is temporary inner-loop tooling only — unlink, publish, and pin to semver
before a task's gate.

**Why.** The Spur ↔ ts-libs boundary becomes an `import` line, enforceable in review.

**Detail:** `03 §1.1 External dependency boundary`.

---

## ADR-005: oRPC as the Type Seam

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Use oRPC (`@orpc/*@1.14.x`) as the server↔web type seam: contracts in
`packages/contracts` (transport DTOs only), server binds handlers via `implement(contract)`, OpenAPI
generated from the contract, web client typed via `OpenAPILink`. The old `@hono/zod-openapi` +
`Equals<A,B>` pattern is retired and must not return.

**Why.** Makes contract↔handler drift a compile error instead of a runtime surprise.

**Detail:** `03 §4 Type Seam`; concrete surface in `04 §5 Server/Web`.

---

## ADR-006: Domain Engines Are External ts-libs Packages, Not a Local Kernel

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** The reusable engines are standalone, independently-versioned ts-libs packages
(`ts-ai-runner`→`spur agent`, `ts-rule-engine`→`spur rule`, `ts-dual-workflow-engine`→`spur
workflow`, `ts-llm-jsonl-importer`→`spur history`), each owning its types and schema. The old
`@spur/kernel` monolith is gone; CLI commands are thin transport wrappers.

**Why.** Engines stay reusable by other projects; Spur is a thin consumer with only its domain glue
local.

**Detail:** `03 §1.1 External dependency boundary` and the per-domain sections `03 §5–7`.

---

## ADR-007: Package-Owned Database Schema

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** Each domain package exports its own schema SQL; the CLI composes them with its own
domain tables into `CLI_SCHEMA_SQL` and applies them through an isolated journal
(`__spur_cli_migrations`). The migrator only loads top-level `drizzle/*.sql` files containing the
`_spur_cli_` marker; `drizzle-kit` is not the CLI's migration runtime.

**Why.** Schema ownership follows code ownership instead of coupling every table to one migration set.

**Detail:** `03 §8 Data & Storage`; table shapes in `04 §3.1 Tables`.

---

## ADR-008: History — Raw Stays in Files, DB Holds Only Validated ETL

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** `@gobing-ai/ts-llm-jsonl-importer` validates before persist (only Zod-validated
records reach the DB), keeps raw JSONL as the canonical store (no `history_raw_*` tables), is
incremental by `(source, source_file)` checkpoint, idempotent via post-redaction SHA-256, and models
each source as one `SourceDefinition` variant over a generic pipeline.

**Why.** The old importer stored raw JSON in DB columns (hit SQLite limits), re-imported everything
each run, and re-implemented splitting per platform.

**Detail:** `03 §7 History Import & Analytics`; `SourceDefinition` shape in `04 §3.2`.

---

## ADR-009: Dual-Mode Workflow Engine

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** `@gobing-ai/ts-dual-workflow-engine` provides two execution models behind one host: a
state-machine driver (FSM — linear/looping) and a transition-flow driver (DAG with conditional
branching). Definitions are Zod-validated YAML with variable interpolation; persistence is via an
adapter (SQLite through ts-db; in-memory for tests).

**Why.** One dependency covers both simple dev-task loops and complex orchestration without a second
engine.

**Detail:** `03 §6 Workflows`.

---

## ADR-010: CLI Is the Primary Surface; Local-First by Default

**Status:** Accepted · **Date:** 2026-05-30

**Decision.** The CLI (`apps/cli`) is the primary entry point and writer of record; server/web are a
thin, read-oriented inspection surface (also runnable on Cloudflare Workers). SQLite + local files
are the default store. Every command supports `--json`. Committed product commands: `init`, `agent`,
`history`, `rule`, `workflow`; supporting utilities: `status`, `migrate`. Commands beyond this set
are deferred until their need and design are re-confirmed — not ported speculatively.

**Why.** Spur is a single-machine developer tool with no network requirement in the Phase-1 core loop.

**Detail:** `03 §2 Runtime Model`; command surface in `04 §1 CLI Surface`.

---

## ADR-011: ts-db Consumed as a Facade; Tables Are a Single Source of Truth

**Status:** Accepted · **Date:** 2026-06-01

**Decision.** As a consumer of `@gobing-ai/ts-db` (drizzle-free facade), Spur confines `ts-db` and
`drizzle-orm` to `packages/domain` (drizzle only inside `src/schema/`), defines tables via
`defineTable` (never bare `sqliteTable`), derives all DDL from `createTableSql` (no hand-written
`CREATE TABLE` for Drizzle-backed tables, no `.sql` text-imports), and keeps raw SQL out of apps.

**Why.** Makes table/DDL/zod drift structurally impossible and keeps the storage engine swappable
and apps SQL-free.

**Detail:** `03 §8 Data & Storage`; enforced by `.spur/rules/boundary/dao-boundary.yaml`.

---

## ADR-012: Plugin System Is the Foundational Substrate (Sandboxing Out of Scope)

**Status:** Accepted (design) · **Date:** 2026-06-03

**Decision.** Adopt a plugin substrate — standalone SDK (`@gobing-ai/spur-plugin-sdk`, depending only
on `ts-infra`), manifest-driven discovery, capability registries, and a four-tier trust ladder
(`bundled` > `curated` > `local` > `untrusted`) — designed from day one to carry first-party
primitives, but built as **gated, independently-shippable slices**. Key constraints: built-ins are
pre-registered through the same `register()` path (not special-cased); core/bundled plugins load
**fail-fast**, `local`/`curated` **fail-soft**; `bundled` capabilities are never gated; the harness
seam needs **no upstream change** (Spur-side overlay over the structural `AgentShim` interface); all
plugin files are YAML validated by a per-file Zod schema. Trust ships as **registration-time
gating** only — runtime sandboxing (fs/net/shell isolation) is **accepted out of scope**; the
`untrusted` tier is not loaded at all (fail-closed). No plugin code ships from this decision.

**Why.** Spur is a single-machine, local-first tool (ADR-010) where every installed plugin is already
operator-trusted, so OS-level isolation solves a threat model that does not yet exist; the substrate
must still be load-bearing because first-party primitives will migrate onto it later.

**Supersedes earlier framing:** the "blocked on upstream `BaseHarness`" and "manifest in TOML"
readings are withdrawn. **Scope authority:** sandboxing-out-of-scope follows `01_PRD §5.4`.

**Detail:** `03 §11 Plugin Substrate` (mechanism, two-class loading, trust engine, harness overlay);
manifest/config schemas and the trust ladder in `04 §6 Plugin System`. *(Sections added in the
03/04 migration step.)*
