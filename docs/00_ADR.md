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

---

## ADR-012: Plugin System — Foundational Substrate, Phased Build, Sandboxing Out of Scope

**Status:** Accepted (design) · **Date:** 2026-06-03 (amended 2026-06-03 — primitive-substrate intent)

**Context.** Task 0006 proposes a relaydeck-style plugin-first architecture: a standalone SDK
(`@gobing-ai/spur-plugin-sdk`), manifest-driven discovery, eight capability registries (command, api,
ui, event, harness, provider, rule, skill/worker), and a four-level trust ladder (`bundled` >
`curated` > `local` > `untrusted`). Four forces shape the design:

0. **The plugin system is a low-level *substrate*, not an optional add-on layer.** (Operator
   clarification, 2026-06-03.) The intent is that fundamental, first-party system primitives — agent
   harnesses, rule evaluators, model providers, history sources, workflow actions — are *eventually
   implemented as bundled plugins on top of this substrate*, not bolted on beside a fixed core. The
   plugin runtime therefore sits **below** most capability code, on the startup hot path, and must be
   designed for that load-bearing role from day one — even though no first-party code is migrated onto
   it in the initial slices (see Decision 7).

1. **Roadmap placement.** `02_ROADMAP.md` puts extension seams in **Phase 5+ ("later")**; Phase 4
   (inspection surface) work is still unstarted. The task itself is tagged `deferred`/`post-team-mode`.
2. **Harness seam reality.** R7 assumes `@gobing-ai/ts-ai-runner` exposes an extensible `BaseHarness`
   class. It does **not** — the runner models agents as a *closed union* `AgentName` plus a
   `Readonly<Record<AgentName, AgentShim>>` (`getAgentShim`, `isAgentName`, `AGENT_SHIMS`). A new
   harness *type* is registered via a Spur-side shim-overlay registry against the **structural
   `AgentShim` interface** — the union is compile-time only, so no upstream change is needed
   (see Decision 6; this corrects an earlier "blocked on upstream" reading).
3. **Sandboxing scope conflict.** R4/R11.4 require enforcing an `untrusted` sandbox (no fs, no net,
   no shell). `01_PRD.md` §5.4 lists **sandboxing as out of scope (Phase 1)**. Per the doc-map
   authority rule (lower number wins), the PRD overrides the task on scope; the operator has
   **accepted** this out-of-scope call (2026-06-03).

**Decision.**

1. **Adopt the plugin architecture as the Phase 5+ extension model**, but build it as **gated,
   independently-shippable slices**, not the monolithic 7-phase task as written. Re-scope 0006 into
   sub-tasks (see 02_ROADMAP / 05_FEATURES): (a) SDK package + registries + trust *policy* (no
   enforcement teeth), (b) discovery/loader + CLI `plugin list|info`, (c) server route mounting,
   (d) harness registry — *shim-overlay over the structural `AgentShim` contract; no upstream gate*.

2. **SDK is standalone** (`packages/plugin-sdk`, `@gobing-ai/spur-plugin-sdk`) depending only on
   `@gobing-ai/ts-infra` (`Logger`, `EventBus`, `EventMap`). The host application (`packages/app`)
   depends on the SDK; the SDK never depends on core. This keeps third-party plugins importing a
   light facade and prevents a circular `app ↔ sdk` edge.

3. **No new CLI framework.** Plugin commands register handler functions against the existing
   `apps/cli/src/args.ts` parser (consistent with ADR-010). No Commander/yargs.

4. **Event seam wraps the typed `EventBus`.** `ts-infra`'s `EventBus<TEvents extends EventMap>` is
   key-typed (`on`/`emit` over `keyof TEvents`), so glob patterns (`agent.*`, `*`) live in a thin
   Spur-side `EventRegistry` adapter that fans a pattern out to the concrete event keys. Rate
   limiting for high-churn events (`usage.record`) lives in that adapter.

5. **Trust ladder ships as policy now; runtime sandboxing is ACCEPTED out of scope.** The trust
   *level* is parsed, recorded, and used for **registration-time capability gating** (a plugin cannot
   register a capability it did not declare, or one its tier forbids). True runtime **sandboxing**
   (fs/net/shell isolation, R11.4's "untrusted cannot perform denied actions") is **confirmed out of
   scope** (operator-accepted 2026-06-03), consistent with PRD §5.4 — it is not merely deferred
   pending re-confirmation. Spur is a single-machine, local-first developer tool (ADR-010) where
   every plugin the operator installs is already operator-trusted; OS-level isolation adds
   significant complexity (worker-thread/process boundaries, capability brokering) for a threat model
   that does not yet exist. Therefore: the `bundled`/`curated`/`local` tiers load and run in-process;
   the `untrusted` tier is **not loaded at all** (fail-closed). Runtime enforcement is revisited only
   if/when Spur onboards genuinely third-party, non-operator-authored plugins (task 0016 captures the
   future design; it is not on the Phase-5 critical path).

6. **Harness registry is NOT upstream-blocked — use a Spur-side shim-overlay registry.** Earlier
   analysis mis-read the constraint. The `AgentName` "closed union" is a **compile-time TypeScript
   type only**: at runtime `AGENT_SHIMS` is a plain object literal, `isAgentName(v)` is
   `Object.hasOwn(AGENT_SHIMS, v)`, and `getAgentShim(a)` is `AGENT_SHIMS[a]`. `AiRunner` resolves a
   shim by that lookup and treats the name purely as a key/label. A plugin harness only needs to
   supply an object satisfying the **`AgentShim` interface** (`name`, `command`, `tier`,
   `getHelpCommand`, `getVersionCommand`, `getPromptCommand`, `getAuthCommand`) — a *structural*
   contract, not a `BaseHarness` base class. The Spur-side `HarnessRegistry` therefore keeps its own
   `Map<string, AgentShim>` overlay: resolution checks the overlay first, then falls back to
   `getAgentShim` for built-ins. No upstream change is required to ship plugin harnesses. (An upstream
   enhancement — exporting an `AgentShim` type guard or accepting an injected shim in `AiRunner` — is
   a *nice-to-have* that removes a small amount of `as`-casting at the seam, not a prerequisite.)

7. **Design for the primitive-substrate role now; migrate first-party code later** (operator decision,
   2026-06-03 — "substrate now, migrate later"). The SDK and loader are built so a **bundled plugin
   can be a system primitive** — but no existing first-party functionality is moved onto the substrate
   in the initial slices (R10 backward-compat holds: hardcoded `agent`/`rule`/`workflow`/`history`/etc.
   keep working unchanged). The load-bearing design constraints this imposes:

   - **Two-class loading, not one.** The loader splits plugins by origin: **core/bundled** plugins
     (shipped in the Spur install dir) load **fail-fast** — a bundled-plugin failure is a fatal
     startup error, because it *is* the system — while `local`/`curated` plugins stay **fail-soft**
     (logged and skipped, never crash Spur). The R2.3 "invalid plugins are skipped" rule applies only
     to the non-core classes.
   - **Built-ins are pre-registered, not special-cased.** Registries expose the same `register()` path
     the future bundled-plugin primitives will use; current hardcoded built-ins (the seven `AgentShim`s,
     the rule evaluators, etc.) are modeled as **implicit pre-registrations** so that migrating them to
     real bundled plugins later is a *move*, not a re-architecture. The `HarnessRegistry` overlay
     (Decision 6) is the first instance of this: built-in shims and plugin shims resolve through one
     map.
   - **`bundled` trust = "this is the system."** The trust engine must never let a `bundled`
     capability be denied; gating applies to `curated`/`local`/`untrusted` only. `bundled` is the floor
     the core stands on.
   - **Registry contracts are stable seams, versioned with care.** Because primitives will live behind
     them, a registry's `register()` signature is a public contract (SemVer-significant on the SDK),
     not an internal convenience. Each registry is designed as the *real* runtime wiring for that
     capability, not a side-channel beside a hardcoded path.
   - **Startup ordering is explicit.** Discovery/registration of core plugins happens **before** command
     dispatch and **before** the server mounts routes, so a primitive is available the moment any code
     that depends on it runs. The bootstrap sequence is part of the loader's contract, not incidental.

8. **YAML everywhere, validated by a Zod schema per file type** (operator decision, 2026-06-03 —
   supersedes the earlier "manifest in TOML via `Bun.TOML`" note). Spur already standardizes on **YAML**
   for its config files (`.spur/agents/*.yaml`, `.spur/workflows/*.yaml`, `.spur/rules/*.yaml`) and
   ships the parser in `@gobing-ai/ts-runtime` (`parseYamlObject`, `stringifyYamlObject`,
   `YamlParseError`). Plugin files follow suit: **`plugin.yaml`** (manifest) and **`.spur/plugins/<name>.yaml`**
   (config overrides) are YAML, not TOML — one format across the whole project, no new parser
   dependency. The substantive part of this decision: **every Spur YAML file type gets a declarative
   `zod` schema** (the convention already set by `packages/config`'s `configSchema`), so an input file
   is validated in one standard, fast step (`schema.safeParse(parseYamlObject(text))`) with structured,
   path-pointed errors — replacing ad-hoc field-by-field checks (e.g. the upstream agent-spec
   `requireString` style). Concretely:
   - **`PluginManifestSchema`** validates `plugin.yaml` (name, version, `trust` enum, `capabilities`
     record, optional `allow` block). This is the SDK's R1.2 "manifest is the single source of truth"
     enforced as a schema, not prose.
   - **`PluginConfigSchema`** (or a per-plugin `configSchema` a plugin may supply) validates the
     `.spur/plugins/<name>.yaml` override layer before merge.
   - Schemas live with their owners (manifest/config schemas in the plugin SDK; the existing
     agent/workflow/rule schemas stay in their owning packages) and are exported as the **validation
     SSOT** for that file type — a file is never consumed unvalidated. `safeParse` failures are surfaced
     as the loader's `validate()` step (R2.3/R2.4): a bad **bundled** manifest fails fast, a bad
     `local` one is logged and skipped.

**Consequences.** The plugin system is the project's **foundational extension substrate**, not an
optional add-on: it is designed from day one to carry first-party primitives (harnesses, rules,
providers, history sources, workflow actions), even though those are migrated onto it incrementally in
follow-on tasks rather than up front. This raises the bar on the loader (two-class fail-fast/fail-soft),
the registries (public, SemVer-significant contracts), and the trust engine (`bundled` is unconditionally
allowed) — captured in slices 5a/5b and reflected in tasks 0012/0013/0015. The decomposition still holds:
each slice passes the gate independently, and R10 backward-compat is preserved (no working code is moved
in this phase). Runtime sandboxing is accepted out of scope (PRD §5.4 + ADR-010); the harness seam is
unblocked via the structural `AgentShim` overlay, which doubles as the first proof that a primitive can
live on the substrate. `05_FEATURES.md` records the plugin feature as `💤 deferred (needs design)` with
this ADR as the design anchor; `02_ROADMAP.md` Phase 5+ gains the sub-task breakdown. No plugin code
ships from task 0006 — it is a design/decision deliverable. A future migration task (moving the seven
built-in harnesses onto bundled plugins) will be the substrate's first real exercise; it is named in the
roadmap but not yet scheduled.
