---
doc: 03_ARCHITECTURE
owns: HOW — module boundaries, data flow, runtime model, invariants
authority: derived
version: 1.2.0
derived_from: [01_PRD, 00_ADR]
owner: Robin Min
updated_at: 2026-06-12
read_before: cross-module, seam, or schema work
edit_rules: 99 §6.4
sync: [T1]
---

# 03 Architecture — Spur

This document describes the **current** architecture of Spur. It specifies module boundaries
and invariants, not schemas or signatures (those live in code).

## 1. Topology

Bun-workspace monorepo (no Turborepo, ADR-002). Spur owns three apps and four local packages
(ADR-001 as amended); all reusable engines are external `@gobing-ai/ts-*` packages (ADR-006).

spur/
├── apps/
│   ├── cli/         Primary surface — commander dispatch (ADR-014) + transport-wrapper commands
│   ├── server/      Hono + oRPC OpenAPI handler; Bun + Cloudflare Worker entrypoints
│   └── web/         Astro + Cloudflare adapter; typed oRPC OpenAPI client
├── packages/
│   ├── app/         Application services — Agent/History/Plugin/Rule/Team/Workflow (ADR-021)
│   ├── contracts/   oRPC transport contracts ONLY (health/DTOs) — @gobing-ai/spur-contracts
│   ├── config/      Config SSOT — merged schema + the single `.spur/config.yaml` loader; core/loader split (ADR-027)
│   ├── domain/      DAOs + schema + analytics + migrations; sole ts-db importer (ADR-011)
├── plugins/sp/      Agent-facing layer: Fat Skills + thin command/subagent wrappers (ADR-016/023)
├── config/          Spur-owned default config SSOT — rules/, workflows/, plugins/ (ADR-015)
├── tooling/typescript/   Shared tsconfig presets (base/server/react)
└── drizzle/         0000_spur_cli_foundation.sql + incremental _spur_cli_ migrations + _legacy_reference/ (inert)

### 1.1 External dependency boundary (ADR-004/006/021)

Per-app edges as they exist today (manifest-verified):

```
apps/cli ────► packages/{app, config, domain}
               + @gobing-ai/ts-{utils, infra, runtime, ai-runner,        (semver)
                                rule-engine, dual-workflow-engine, llm-jsonl-importer}
apps/server ─► packages/{config, contracts} + @gobing-ai/ts-{infra, runtime}
               (gains packages/app — never direct DB — when the planning layer
                lands, per ADR-021.b)
apps/web ────► packages/contracts (types via oRPC client only)
packages/app ───► packages/domain + the engine packages
packages/domain ► @gobing-ai/ts-db (sole importer — §8.1)
```

| Layer | Owns |
|-------|------|
| `ts-utils` | output, errors, api-response, cursor, date, access |
| `ts-infra` | logger, EventBus, telemetry, scheduler, job-queue interfaces |
| `ts-runtime` | runtime context, FileSystem, ProcessExecutor, config loader |
| `ts-db` | DbAdapter, BaseDao, migrations, QueueJobDao |
| `ts-ai-runner` | `AgentDetector`, `DoctorRunner`, `AiRunner` |
| `ts-rule-engine` | `RuleEngine`, evaluators, presets, formatters, rule types |
| `ts-dual-workflow-engine` | FSM + transition-flow drivers, persistence, schema SQL |
| `ts-llm-jsonl-importer` | `runJsonlImport`, `SourceDefinition`, schema SQL |

**Hard constraints (enforceable as rules):**

1. No `@spur/*` imports — that scope does not exist here.
2. `packages/contracts` holds transport DTOs only; domain types live in their owning ts-libs package.
3. `apps/web` imports contract **types** via oRPC client — never server internals.
4. CLI commands are transport wrappers over package APIs — no domain logic reimplemented inline.
5. Cross-workspace imports use `@gobing-ai/*` aliases, never deep relative paths.
6. `.spur/config.yaml` is loaded only through `@gobing-ai/spur-config` — no surface parses or
   schema-validates the config itself (§1.2, ADR-027).

### 1.2 Config-loading boundary (ADR-027)

`.spur/config.yaml` has one loader, in `@gobing-ai/spur-config`. The package splits into a
dependency-free **core** (`.`: merged `spurConfigSchema`, `DEFAULT_*` constants, config types) and a
node-only **`./loader`** (`loadSpurConfig`, `resolveConfigFile`, `resolvePlanningFolders`,
embedded-schema resolution). The split exists because importing `yaml`/`node:fs` into the Cloudflare
Workers bundle crashes miniflare — so the server imports only the core; CLI and `packages/app` (on
Bun) import the loader.

This replaced five parallel paths that had diverged before ADR-027: the CLI's structured-config
loader, the app's raw-`yaml` `resolvePlanningFolders`, a CLI `resolveConfigFile`, the server's inline
folder literals, and the server's legacy `docs/.tasks/config.jsonc` read. All consumers now derive
the typed result from the single facade; config-shape types (`TaskFoldersConfig`) have one owner.
Enforced by `config/rules/boundary/config-loading-ownership.yaml`.

## 2. Runtime Model

Phase 1 is single-process: the CLI owns the work and is the writer of record (ADR-010).

```mermaid
flowchart TD
    User([User]) -->|spur <command>| CLI
    subgraph Process["apps/cli (Bun)"]
        CLI[commander dispatch] --> Ctx[CliContext<br/>config · fs · lazy migrated DB]
        CLI --> APP[packages/app services<br/>Agent · History · Rule · Team · Workflow]
        APP --> AR[ts-ai-runner]
        APP --> RE[ts-rule-engine]
        APP --> WF[ts-dual-workflow-engine]
        APP --> HI[ts-llm-jsonl-importer]
        APP --> DOM[packages/domain<br/>DAOs · analytics · migrations]
        DOM --> DB[(SQLite via ts-db)]
        RE -. persistence adapter .-> DB
        WF -. persistence adapter .-> DB
        HI --> DB
        AR -->|subprocess| Agent[[Coding agent CLI]]
    end
    JSONL[(Agent JSONL files)] -.read.-> HI
```

The CLI never calls an engine around the service layer (ADR-021); engines reach SQLite only
through persistence adapters constructed from `packages/domain`.

The server/web tier is today a thin read-oriented slice (health vertical, Phase 4 expansion);
its real shape — including the planning-layer board — is the pending server/web design task
(ADR-021.b). The server bootstrap splits by runtime (ADR-019):

- **Bun entry (`index.ts`)** → `runNodeApplication` (`@gobing-ai/ts-infra/application-node`):
  YAML config loading, file log sink, owned DB adapter, `Bun.serve` started inside `start(appRt)`.
- **Worker entry (`worker.ts`)** → portable `runApplication` (`@gobing-ai/ts-infra/application`):
  lazy singleton (cached promise, no top-level await), inline config, zero `node:*` imports.

Both entries share `src/bootstrap.ts` (`createApp`, `serverBootstrapConfig`) — the Hono app
factory and bootstrap config block are runtime-agnostic.
## 3. CLI Architecture (`apps/cli`)

No file inventory here — that rots (99 §6.4 lesson); boundaries only:

- **Dispatch:** one commander `Command`; each noun registers via
  `registerXxxCommand(program, context)` (ADR-014). Commander owns parsing, subcommand dispatch,
  and `--help` rendering.
- **Commands** parse flags, call a `packages/app` service, format output, return an exit code —
  no business logic in the app (ADR-021).
- **CliContext** carries cwd/env/fs/output/`setExitCode` and lazily builds + migrates the SQLite
  adapter on first DB access.
- **DAOs, migrations, analytics** live in `packages/domain` (`dao/`, `migrations.ts` composing
  domain + engine schema SQL, `analytics/`). DAOs use the adapter's prepared-statement API.

## 4. Type Seam — oRPC (ADR-005)

```
packages/contracts (oc.route + Zod)
   ├─► apps/server/router.ts   implement(contract).handler(...)   ← compile-time bound
   ├─► apps/server/openapi.ts  OpenAPIGenerator(contract)         ← spec derived, not hand-written
   └─► apps/web/rpc-client.ts  OpenAPILink(contract)              ← typed client
```

Contract↔handler drift is a compile error. OpenAPI is generated, never hand-maintained. Domain types
never enter `packages/contracts`.

## 5. Constraint Rules (`ts-rule-engine`, `spur rule`)

A constraint rule declares an id, severity, target paths, an evaluator, options, and a message.
`RuleEngine.evaluate(rules, cwd)` returns findings; `RuleService` (packages/app) mediates; the
CLI owns exit-code policy. Presets compose via `loadPresetRules`; ad-hoc files via `loadRuleFile`;
formatters are host-registered. Runs persist through the engine's `RulePersistenceAdapter`
(Spur's `DbRulePersistenceAdapter` over ts-db), powering `spur rule trace`. Rules are
configuration — adding one edits YAML, not code. Flags and surface: `04 §1.1`.
## 6. Workflows (`ts-dual-workflow-engine`, `spur workflow`)

Two execution models behind one host (ADR-009):

- **State-machine** — states, transitions, guards; a single readable driver loop for linear/looping
  workflows.
- **Transition-flow** — DAG with conditional branching for multi-phase pipelines.

Definitions are YAML (Zod-validated, variable interpolation). Persistence is via a SQLite adapter
(`DbWorkflowPersistenceAdapter`) over ts-db; in-memory for tests. `WorkflowService` (packages/app)
wires the host + persistence and exposes validate/run/list; persisted runs power
`spur workflow trace`. The planning layer's task/feature lifecycles run as workflow definitions
on this engine (§12.2) — its first long-lived, externally-triggered consumer (ADR-022).

## 7. History Import & Analytics (`ts-llm-jsonl-importer`, `spur history`)

Pipeline (ADR-008), one generic control function over a `SourceDefinition` union:

```
discover files → resume from (source, source_file) checkpoint → read line-by-line
  → split (one-to-one | one-to-many | custom) → fieldMap (raw→canonical)
  → transforms → Zod validate (gate before persist) → redact → SHA-256 dedup
  → load to per-source ETL table → update checkpoint
```

Sources: pi, claude, codex, gemini, opencode, antigravity, openclaw. Adding a source = one
`SourceDefinition` variant; the pipeline never changes. **Analytics**
(`packages/domain/src/analytics`) reads the ETL tables, estimates tokens/cost per model, and
aggregates by source/model/day — a domain consumer, not part of the generic importer.

## 8. Data & Storage (ADR-007/008)

| Location | Purpose |
|----------|---------|
| `.spur/` | Project config `config.yaml` (ADR-017), local rule/workflow definitions, team agent specs (`agents/`) |
| `~/.config/spur/` | Global config layer, seeded from bundled assets; resolution is bundled > global > local (ADR-015) |
| SQLite DB (`DATABASE_URL` or `.spur/spur.db`) | CLI domain tables + history ETL/ledger/checkpoint + workflow/rule run history + inbox |
| Agent JSONL files | Canonical raw history (never copied into the DB) |
| Task/feature markdown *(planned — ADR-020)* | Planning SSOT; the DB holds only derived data (§12.1) |
| `logs/` | Process and observer logs |

Schema is composed from package-owned SQL and applied through the `__spur_cli_migrations` journal
(`0000` foundation + incremental `_spur_cli_`-marked migrations). Tables: `workspaces`, `runs`,
`phase_runs`, `transition_runs`, `workflow_states`, `artifacts`, `history_import_ledger`,
`history_import_checkpoint`, `history_etl_<source>`, `inbox_messages`, `rule_runs`,
`rule_eval_runs`, plus the workflow engine's tables.

### 8.1 Persistence boundary (ADR-011)

Spur consumes `@gobing-ai/ts-db` as a drizzle-free facade with a single-source-of-truth schema
model, so table/DDL/Zod drift is structurally impossible. Five rules, enforced by
`.spur/rules/boundary/dao-boundary.yaml`:

1. **`ts-db` is imported only inside `packages/domain`** — apps and the other local packages consume
   persistence through `@gobing-ai/spur-domain` DAOs, never `ts-db` or the raw adapter directly.
2. **`drizzle-orm` is confined to `packages/domain/src/schema/`** — column builders are input to
   `defineTable`; no other file (DAOs, analytics, apps) may import drizzle.
3. **Tables are defined with `defineTable`** (from `@gobing-ai/ts-db/schema`), never bare
   `sqliteTable`; each schema file exports the `DefinedTable` plus its `.table`.
4. **DDL is derived, never hand-written** — `DOMAIN_SCHEMA_SQL` composes each table's
   `createTableSql`; no raw `CREATE TABLE` for a Drizzle-backed table, no `.sql` text-imports.
5. **Raw string SQL stays inside `packages/domain`** (DAO/migration layer), never in apps.

## 9. Observability & Security

- Logging/telemetry ride `ts-infra` (logger + OpenTelemetry); telemetry is opt-in, default local-only.
- Spur never stores agent API keys — authentication is the agent's concern.
- History redaction strips secrets/PII before any persistence (redaction runs before dedup hashing).
- External content (agent output, JSONL, web) is untrusted input — validated at boundaries.

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Contract/handler drift | `implement(contract)` makes it a compile error |
| Schema drift across engines | Each package owns its schema SQL; CLI composes (ADR-007) |
| Old migrations reactivated | Inert under `_legacy_reference/`; loader filters `_spur_cli_` marker |
| Engine MVP gaps mistaken for parity | Roadmap Phase 3 tracks the depth restore explicitly |
| History raw bloat / parse errors | Raw stays in files; only validated ETL persisted (ADR-008) |
| Lifecycle-on-workflow blocked by engine gaps (long-lived runs, pause/continue, HITL) | Stage-D ts-libs gap tasks gate the dependent waves (ADR-022); upstream-first — no local FSM fallback |
| Legacy board writes corrupt normalized task corpora during the rd3 migration | Freeze legacy `tasks server` read-only at the A17 cutover; the spur board lands in the same batch (triage doc) |

## 11. Plugin Substrate (ADR-012, amended 2026-06-09)

The lifecycle extension seam lives upstream in `@gobing-ai/ts-infra` (≥0.3.6): `Plugin`
(lifecycle-only — `onLoad`/`onStart`/`onStop`/`onUnload` + `failFast`) and `PluginHost`
(register; fail-fast load, fail-soft start/stop/unload in reverse registration order), driven
natively by `runApplication`/`runNodeApplication` via `plugins`/`pluginHost` options. ts-infra
registers its own core services (logger, telemetry, scheduler, user-callback) as built-in
plugins; Spur consumes the lifecycle and does not re-plugin-ize core services. When plugins are
registered, `startAll()` runs before command dispatch.

Deferred/removed until a real plugin consumer exists (shapes in `04 §6`):

- Spur-side SDK, manifest discovery, capability registries, and the four-tier trust ladder —
  removed with the SDK; re-addable on the ts-infra `Plugin` interface (`failFast: true` already
  covers critical-plugin abort).
- Server route seam (`apps/server/src/plugins.ts`) and the Spur `EventRegistry` — removed; the
  `PluginHost`'s raw `EventBus` is the direct event seam.
- Harness registry (Phase 5d) — blocked on upstream `AiRunner` shim injection; task 0015
  (`Blocked`).

## 12. Planning Layer (accepted design — ADR-020–023; not yet built)

The task/feature domain migrated from `cc-agents/plugins/rd3`. This section records the mechanism
and invariants the implementation must satisfy; per-item scope lives in
`docs/plans/2026-06-10-rd3-migration-feature-list.md`, concrete command/schema shapes land in
`04_DESIGN.md` as commands ship. The spec pipeline is a `plugins/sp` fat skill over these
mechanisms (ADR-020/023), not a separate CLI noun.

### 12.1 Markdown as the single source of truth

- **Tasks** live in configured folders (e.g. `docs/tasks/`), **features** in
  `docs/features/FT-<NNN>_<name>.md` — YAML frontmatter + structured markdown body, both
  Zod-validated with a `schema_version` key. Parse-validate-serialize replaces all regex
  read-modify-write.
- **The DB holds only derived data** (lifecycle events, run links, caches) — mirroring ADR-008's
  raw-stays-in-files principle. Deleting the DB loses no planning state.
- **Generated artifacts** (`kanban.md`, `docs/features/INDEX.md`) are outputs of `refresh`
  commands, never hand-edited, never inputs.
- The task/feature domain is **Spur-local** (ADR-006 division: it is Spur's own domain glue, not a
  reusable engine). The generic Gherkin-subset validator is the exception — it is upstreamed to
  ts-libs.
- **Default package home (ADR-021):** task/feature services — including the write service — join
  `packages/app`; frontmatter schemas, file I/O, and derived-data DAOs join `packages/domain`.
  Creating a new local package requires a recorded decision; no package sprawl by default.

### 12.2 Write service & lifecycle (ADR-021/022)

One write service in `packages/app` serves every transport; lifecycle transitions run through
`spur workflow`:

```
spur task/feature <verb> ──┐
                           ├──► write service (packages/app) ──► markdown file
future server routes ──────┘         │
                                     ├─► per-WBS lock + create-lock (one domain)
                                     ├─► lifecycle = spur workflow definition
                                     │     (config/workflows/*; guards = task check;
                                     │      EventBus seam for extensions)
                                     └─► transition → append `## History` + event
```

Invariants:

1. No mutation path bypasses the write service — the legacy CLI/server dual-lock race is
   structurally impossible (a consequence of ADR-021, not a policy).
2. Status lifecycles are `spur workflow` definitions (ADR-022). The frontmatter `status` is the
   single source of truth; engine persistence is derived and rehydratable from the files.
3. Engine gaps for long-lived, externally-triggered lifecycles (pause/continue, HITL) are closed
   upstream in `ts-dual-workflow-engine` — never re-implemented locally.
4. Customization attaches via the engine's EventBus pub/sub seam (`on_transition`,
   `on_guard_fail`, `on_complete`), not engine forks; SSE/board and (later) the scheduler are
   subscribers on the same seam.

### 12.3 BDD traceability chain

```
feature ## Acceptance Criteria (Gherkin / checklist)
   ▲ validated by shared BDD validator
   │
   feature-id frontmatter (single edge — the entire integration surface)
   │
task ## Acceptance Criteria (subset coverage)
   ▲ validated by `spur task check`: edge exists · AC covered · orphan warnings
```

- One shared BDD validator (Gherkin-subset parser + checklist parser + coverage check; AST aligned
  with `@cucumber/gherkin` types, no runtime dependency on it) behind `task check`, `feature
  check`, and pipeline output validation.
- Section-Status-Matrix + per-section format rules are **config** (`./config`, ADR-015 pattern),
  enforced warning-first; only the small core (AC format, Solution `file:line` citation, Review
  P1–P4 table) hard-gates. Tightening follows compliance data, not aspiration.

### 12.4 Boundaries

- `apps/cli` task/feature commands stay transport wrappers (ADR-021) over `packages/app`
  services.
- Task DTOs for any future board cross the oRPC seam via `packages/contracts` (ADR-005) — domain
  types never leak into contracts. The server/web shape itself is a separate design task
  (ADR-021 consequence b).
- `plugins/sp` centralizes agent-facing behavior in **skills** (Fat Skills — ADR-023); slash
  commands and subagents are thin wrappers of skills. Skills delegate deterministic execution to
  CLI verbs where they exist, but are not limited to CLI wrapping.
- Cross-cutting needs reuse the owning ts-libs package (`ts-utils` output/errors, `ts-runtime`
  FileSystem, `.spur/config.yaml` via ADR-017) — no parallel local re-implementations.
