---
doc: 03_ARCHITECTURE
owns: HOW — module boundaries, data flow, runtime model, invariants
authority: derived
version: 1.45.0
derived_from: [01_PRD, 00_ADR]
owner: Robin Min
updated_at: 2026-09-09
read_before: cross-module, seam, or schema work
edit_rules: 99 §6.4
sync: [T1]
---

# 03 Architecture — Spur

This document describes the **current** architecture of Spur. It specifies module boundaries
and invariants. Exact non-UI contracts are indexed by [04 Design](04_DESIGN.md); visual
and interaction rules live in root [DESIGN.md](../DESIGN.md). Task receipts stay in task records.

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
└── drizzle/         0000_spur_cli_foundation.sql + incremental _spur_cli_ migrations +_legacy_reference/ (inert)

### 1.1 External dependency boundary (ADR-004/006/021)

Per-app edges as they exist today (manifest-verified):

```
apps/cli ────► packages/{app, config, domain}
               + @gobing-ai/ts-{utils, infra, runtime, ai-runner,        (semver)
                                rule-engine, dual-workflow-engine, llm-jsonl-importer}
apps/server ─► packages/{config, contracts} + @gobing-ai/ts-{infra, runtime}
               (+ packages/app — never direct DB — per ADR-021.b)
apps/web ────► packages/contracts (types via oRPC client only)
packages/app ───► packages/domain + the engine packages
packages/domain ► @gobing-ai/ts-db (sole importer — §8.1)
```

| Layer | Owns |
| ------- | ------ |
| `ts-utils` | output, errors, api-response, cursor, date, access |
| `ts-infra` | logger, EventBus, telemetry, scheduler, job-queue interfaces |
| `ts-runtime` | runtime context, FileSystem, ProcessExecutor; Spur config loading is owned by `packages/config` |
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

### 1.2.1 Composition-root merged-config wiring (built — ADR-082)

The merged `loadSpurConfig` result is loaded **once per process at the composition root** — CLI
`main()`, server startup — and threaded through the dispatch/service context as the only
app-config source. ts-infra's `runNodeApplication` keeps only the project-shaped `bootstrap`
section (`configFile` + `bootstrapSection`; no `appConfig` validator, `appRt.appConfig` unread).
Per-slice loads in `packages/app` services (workflow-service ×4, team-service) and CLI call sites
(history-refresh, workflow.ts) are replaced by the threaded object; services degrade to current
defaults when the threaded config is absent/null.

Invariants (enforceable):

1. `loadSpurConfig` is imported only by `packages/config/**`, the two composition roots
   (`apps/cli/src/index.ts`, `apps/server/src/{serve,context}.ts`), and tests — enforced by the
   extended `config/rules/boundary/config-loading-ownership.yaml`.
2. A config value defined only in the global layer reaches every CLI command; a project-layer
   value wins the same key (1.2 merge semantics, unchanged).
3. Config-load failure aborts dispatch once, at the root, with one `--json` error envelope naming
   the failing layer — never one error per consumer.
4. Role resolution against the byte-identical `DEFAULT_AGENT_ROLES` fallback (ADR-078) carries
   explicit provenance (`config` | `fallback`); `spur agent doctor` reports an active fallback.

Shapes: `docs/design/universal-config-loading.md`.

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

The server/web tier is a local-first planning and operations board. Its bootstrap splits by runtime
(ADR-019, amended by ADR-036):

- **Bun entry (`index.ts`)** → `runNodeApplication` (`@gobing-ai/ts-infra/application-node`):
  YAML config loading, file log sink, owned DB adapter, full module registry, and local static assets.
- **Worker entry (`worker.ts`)** → portable `runApplication` (`@gobing-ai/ts-infra/application`):
  lazy singleton plus `createWorkerApp`; health/OpenAPI routes and static-asset fallback only.

`src/server-config.ts` is shared and runtime-agnostic. `src/bootstrap.ts` is the Bun composition
root; `src/worker-app.ts` is the Worker-safe HTTP root. The Worker graph must not import
`node:*`, `bun:*`, local filesystem, SQLite, scheduler, queue, or process-control implementations.

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

**D61 implementation (ADR-108):** shared planning-check services own state-aware essential errors;
corpus audits are explicit and unsuppressed; workflow identity/progress reuse the existing resolver
and projections. The migration contracts are in
[`essential-workflow-checks.md`](design/essential-workflow-checks.md).

Two execution models behind one host (ADR-009):

- **State-machine** — states, transitions, guards; a single readable driver loop for linear/looping
  workflows. Terminal states partition into success/failure via an optional `failureStates` subset of
  `terminalStates` (ADR-044): the driver finalizes a failure terminal via `lifecycle.fail()`, so the
  run's status, persisted row, `workflow.run.failed` event, and CLI exit code all agree; absent
  `failureStates`, every terminal finalizes as `done` (backward compatible).
- **Transition-flow** — DAG with conditional branching for multi-phase pipelines.

Definitions are YAML (Zod-validated, variable interpolation). Persistence is via a SQLite adapter
(`DbWorkflowPersistenceAdapter`) over ts-db; in-memory for tests. `WorkflowService` (packages/app)
wires the host + persistence and exposes validate/run/list; persisted runs power
`spur workflow trace`. After load, `validate` / `run` (incl. `--dry-run`) / `continue` register
YAML-declared `extensions.actions` / `extensions.guards` onto that host (0533/D4) — relative to
the workflow file, fail-closed, no absolute or `..` paths. The planning layer's task/feature
lifecycles run as workflow definitions on this engine (§12.2) — its first long-lived,
externally-triggered consumer (ADR-022).

### 6.1 Consolidated per-run run log (built — ADR-045 / feature D2)

The workflow service subscribes a per-run sink to the bounded, redacted observability stream.
Run logs are projections, not a second persistence authority; capture is failure-isolated from
workflow execution. Lifecycle, retention and streaming contracts:
[workflow run log](design/workflow-run-log.md).

### 6.2 Resume and guard vars contract

Resume restores persisted variables and overlays caller variables before guard evaluation.
Guard context carries action outcomes; shell interpolation must preserve literal values at the
process boundary. Exact variable and resume contracts:
[planning workflows](design/planning-workflow-contracts.md) and
[workflow commands](design/cli-contracts.md).

### 6.3 Interactive task-pipeline control inversion (ADR-047 amendment)

Interactive task pipelines are controlled by the host session interpreting the canonical YAML.
Deterministic nodes still call their existing application/CLI owners; eligible model stages use
the host's supported execution surface. Operator decisions stay host-owned. Headless execution
uses the workflow service and subprocess runner.
See [execution selector contract](design/dev-agent-flag-and-dogfood-skill.md).

## 7. History Import & Analytics (`ts-llm-jsonl-importer`, `spur history`)

The importer owns source-independent ingestion:

~~~text
discover → checkpoint resume → read → split/map/transform
  → validate → redact → deduplicate → ETL load → checkpoint
~~~

Raw agent JSONL is the history source of truth; normalized rows, checkpoints, ledgers and
rollups are derived. A source extends SourceDefinition rather than the control flow. Full
reconciliation removes stale derived rows and reports degraded sources explicitly.

Analysis owns SQL aggregation and versioned artifacts; reporting is a database-free artifact
renderer. Missing evidence stays unavailable. The daily operation composes import, analysis
and retention. Correlation, diagnostic interpretation and Board read models consume importer
output; the generic importer does not own those interpretations. Board transport is SQL-free
and can fall back to exact queries when projections are absent or stale.

Details: [history data processing](design/history-data-processing.md),
[Board](design/history-board-module.md), [CLI contracts](design/history-cli-contracts.md).

### History refresh process isolation (ADR-101; built — 0716–0717, 0803)

Schedule, completion and Board producers converge on one application enqueue function.
A partial unique index allows at most one pending or processing history.refresh job across
server processes: pending requests coalesce; processing requests report already-running.

The worker runs the source-local CLI in a child process, keeping importer filesystem/SQLite
work outside Hono/oRPC. Bounded stdout is diagnostic text; child exit/timeout determines queue
success or failure. Deadlines propagate to child cleanup, and lease recovery must not reclaim
a live attempt. Persistence or child failures cannot become queue success.

Process and queue contract: [history refresh isolation](design/history-refresh-process-isolation.md).
Execution/lease ownership: §26.

## 8. Data & Storage (ADR-007/008)

| Location | Purpose |
| ---------- | --------- |
| `.spur/` | Project config `config.yaml` (ADR-017), local rule/workflow definitions, team agent specs (`agents/`) |
| `~/.config/spur/` | Global config layer, seeded from bundled assets; resolution is bundled > global > local (ADR-015) |
| SQLite DB (`DATABASE_URL` or `.spur/spur.db`) | CLI domain tables + history ETL/ledger/checkpoint + workflow/rule run history + inbox |
| Agent JSONL files | Canonical raw history (never copied into the DB) |
| Task/feature markdown | Planning SSOT (ADR-020); the DB holds only derived data (§12.1) |
| `logs/` | Process and observer logs |

Schema is composed from package-owned SQL and applied through the `__spur_cli_migrations` journal
(`0000` foundation + incremental `_spur_cli_`-marked migrations). Tables: `workspaces`, `runs`,
`phase_runs`, `transition_runs`, `workflow_states`, `artifacts`, `history_import_ledger`,
`history_import_checkpoint`, typed `history_message` / `history_tool_call`, lazy generic
`history_etl_<source>`, `history_run_session` (E6 run→session mapping, ADR-059), `inbox_messages`,
`rule_runs`, `rule_eval_runs`, plus the workflow engine's tables. Generic ETL tables materialize
only when an accepted record targets them; schema application and empty scans create none.

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
| ------ | ------------ |
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

## 12. Planning Layer (built — ADR-020–023)

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

**Built — ADR-109 (F21 tasks 0787–0788).** Task creation orchestration in
`packages/app` reuses the canonical ready competency and existing AgentService execution.
TaskService and PlanningWriteService remain deterministic for CLI, HTTP and internal callers.
Single creation preserves a capture identity across preparation failure; batch preparation and
candidate validation finish before the batch write boundary. Host planning prepares inline and
uses the deterministic batch path, while handoff checks current preparation evidence separately
from structural validation and execution prerequisites. Concrete shapes live in the
[task creation satellite](design/task-creation-readiness.md).

- `apps/cli` task/feature commands stay transport wrappers (ADR-021) over `packages/app`
  services.
- Task DTOs for any future board cross the oRPC seam via `packages/contracts` (ADR-005) — domain
  types never leak into contracts. The server/web shape itself is a separate design task
  (ADR-021 consequence b).
- `plugins/sp` centralizes agent-facing behavior in **skills** (Fat Skills — ADR-023); slash
  commands and subagents are thin wrappers of skills. Skills delegate deterministic execution to
  CLI verbs where they exist, but are not limited to CLI wrapping. The environment-improvement
  lens (built — ADR-084/085) is a plugin-level mapping projected into
  those skills' report contracts, not a third analysis skill: §22.
- Cross-cutting needs reuse the owning ts-libs package (`ts-utils` output/errors, `ts-runtime`
  FileSystem, `.spur/config.yaml` via ADR-017) — no parallel local re-implementations.

### 12.5 Lifecycle projection and corpus-gate convergence (task 0625)

Lifecycle state and generated markdown converge at the application service that applies the
transition. A landed feature hop refreshes the touched feature's marker region, including when
a later hop rejects and the service rethrows. Dry runs, refused confirmations and no-op proposals
do not refresh projections. The global feature index remains derived.

~~~text
linked tasks → derive feature status → apply hops → refresh touched feature
  → return outcome or rethrow later failure
~~~

Broad refresh is explicit at the CLI boundary. Projection checks validate content and identity,
not merely file existence. See [projection integrity](design/lifecycle-projection-integrity.md).

## 13. Dev-Command Argument Contract (built — ADR-032 amendment)

The agent-facing input contract stays inside each hand-authored command file and is projected to
platform adapters by Superskill. The three representations have separate ownership:

| Representation | Owner | Content |
| --- | --- | --- |
| `argument-hint` frontmatter | command file | canonical invocation syntax only |
| `## Argument Flags` | command file | public positionals and flags, command-local descriptions, deterministic defaults |
| shared flag glossary | `spur-dev` reference | canonical cross-command semantics and compatibility vocabulary |

`validate-commands.ts` parses command structure and hint-to-table parity. The command-contract and
flag-parity tests derive the dev-command inventory from `plugins/sp/commands/dev-*.md`, validate
shared glossary membership across that complete set, and retain the numbered `dev-operations.md`
parity check as an additional catalog constraint.

Invariants:

1. Every dev command has exactly `Argument Flags`, `Usage`, and `Implementation` level-two headings
   in that order.
2. Dev-command `argument-hint` values contain no Markdown link or prose definition.
3. Canonical public positionals and flags match bidirectionally between the hint and table.
4. Each shared flag resolves to one glossary entry or an explicitly documented contextual meaning.
5. Aliases and deprecated spellings remain compatibility metadata; they do not silently become
   canonical hint syntax or disappear without migration evidence.
6. No generated command registry or committed platform adapter participates in validation.

Concrete shapes and rollout: `docs/design/dev-command-argument-contract.md`.

## 14. Web Board Modules & Team-Scoped Composition (ADR-052)

`apps/web` renders the Board as a set of **auto-discovered modules**: `apps/web/src/modules/discover.ts`
eagerly globs sibling directories that export a named `module: WebModule` (`id`, `route`,
`sidebarLabel`, `order`, `component`). A new module needs **no registry edit** — discovery is
automatic; `order` only places it in the sidebar. Current modules: `teams`, `inbox`, `task-kanban`,
`observability`, `features`, plus shell-level pieces (sidebar, project switcher).

### 14.1 Current shipped state: two channels merged client-side

Spur has **two independent channels** between the Board and a backend coding agent. They are merged
_for display_ by the Inbox module; they are never merged in storage and delivery is unchanged.

| | Durable message queue | Process pipe |
| --- | --- | --- |
| Write path | `TeamService.sendMessage` → DAO `enqueue` | `POST /api/team/processes/:id/stdin` |
| Read path | `TeamService.getInbox` / `listRecent` / `drainPending` | `GET /api/team/processes/:id/stream` (SSE) |
| Delivery to agent | `spur agent loop` calls `drainPending`, prepends to prompt | written straight to `PipeProcess` stdin |
| Storage | SQLite (`inbox_messages`), durable, `queued → injected` lifecycle | in-memory ring buffer, bounded (default 500), lost on restart |
| Ordering cursor | `createdAt` | `seq` (monotonic) + `ts` |

The merge is a **pure function** in `apps/web/src/modules/inbox/timeline.ts`:
`mergeTimeline(messages, frames, agentId) → TimelineEntry[]` — a discriminated union
(`kind: message | frame`, `direction: in | out`). Pure keeps R5/R6 testable without mounting a
component. The oldest frame's `ts` is the process-frame **history boundary** (R6): entries older
than it are messages only, rendered behind a marker; an agent with no frames renders a message-only
timeline, not an error.

### 14.2 Shared process-stream helpers (R9)

`parseFrame`, `appendFrame`, `nextBackoff`, and `streamUrl` live once in
`apps/web/src/lib/process-stream.ts` and are imported by both `teams/MemberTerminal` and the Inbox
agent timeline. No duplicated frame-parsing logic.

### 14.3 Accepted G3 boundary (ADR-052)

G3 removes the display merge above. `agent.team.<teamId>` is the v1 workspace context: the team
config already owns its work folder and roster. Teams owns roster/process lifecycle/terminal/activity;
Inbox owns durable `inbox_messages`; Workspace is a Board composition shell that passes `teamId`
scope into existing Team, Inbox, and Task views. It introduces no workspace persistence, service,
HTTP route, or CLI noun. Until task 0197 lands, §14.1–14.2 describe the shipped transitional state.

### 14.4 Module-scoped DESIGN.md palette (R10–R13)

Board modules consume shared design tokens and may scope them locally. Visual values and
interaction/accessibility rules are owned by root [DESIGN.md](../DESIGN.md).

### 14.5 Module shell convention (built — ADR-081; feature F72)

A multi-view Board module composes a **shell**: `<Module>Shell.tsx` plus an append-only `tabs.ts`
(`{ id, label, component }`; never reorder or rename — the tab strip and persisted UI state key on
`id`). Header anatomy is one row: icon + name + live chip left, module-specific inline filters
middle, tab strip right. Width rule: the default module layout is the centered `max-w-[1600px]`
column; a density-first module whose primary canvas is a multi-lane board MAY go full-bleed, with
header and body sharing one horizontal padding so lanes align under the header. Tasks
(`task-kanban/TasksShell.tsx` + `tabs.ts`, F72) is the first full-bleed instance; its shell absorbs
the old in-board toolbar (phase select, lane toggles, combined WBS/feature input, `+ New Task`) and
`TaskFilters.tsx` is deleted.

Embed rule: a module embedded under another module (Workspace ⊃ Tasks) exports a **headerless**
view (`TaskKanbanView`) rendering pure content; the shell is the route component only. Header-owned
state (phase folder, lane visibility) reaches the board as optional controlled props with
uncontrolled in-board defaults, so the embed keeps working with no shell present. Enforceable
invariants: one shell per module route; `tabs.ts` files are append-only; a full-bleed module shares
exactly one horizontal padding between header and body; the headerless embed never imports its
module's shell. Shapes: `docs/design/tasks-module-shell-parity.md`.

## 15. Agent-Facing Plugin Surface Parity (ADR-053/054)

Hand-authored plugin commands and references own the agent-facing surface. The CLI facade
owns verb/flag semantics, the lifecycle spine owns orchestration, and AGENTS.md provides
navigation. Superskill generates platform adapters from those sources.

A parity check compares source-local CLI help with each documented surface in both directions,
including explicit exclusions. This is a build-time documentation boundary, not a runtime seam.
See [plugin parity](design/plugin-surface-parity.md).

## 16. Actionable Observability Context (foundation current — ADR-056; task 0526)

Cataloged events retain their domain-local ts-libs payloads until they cross Spur's canonical
observability seam. `registerSystemEventTap` and the CLI `SystemEventEmitter` call one pure envelope
builder before persistence; SSE uses the same projection. The history read path recognizes legacy
raw payloads and projects them into the current envelope without rewriting storage.

The task-0526 foundation is current. Board semantic rendering and additive workflow/rule trace
context remain downstream consumers in tasks 0527–0528; neither creates another envelope builder.

```text
Spur / @gobing-ai/ts-* typed event
  → SYSTEM_EVENT_CATALOG entry
  → buildSystemEventEnvelope(event, project context)
  → redacted + bounded system_events payload / SSE frame
  → Board semantic table + tooltip

workflow_runs / rule_runs
  → existing trace services
  → additive contextual DTO projection
  → human trace + JSON
```

Invariants:

- ts-libs event maps do not depend on Spur project context or presentation vocabulary.
- Redaction precedes recursive bounds and every persistence/streaming sink.
- `metadata-only` is an allow-list; it never retains business payloads or complete finding/output bodies.
- Indexed `system_events` correlation columns remain query authority; envelope correlation is the
  portable display projection.
- Legacy rows are adapted on read; no history migration or payload rewrite is required.
- Remediation values name only existing commands, Board filters, or local artifact paths and are
  omitted when exact reconstruction is impossible.
- Trace stores remain replay authority; System Events never reconstruct workflow or rule traces.

Shapes: `docs/design/actionable-observability-context.md`.

### 16.1 J9 semantic presentation (built — ADR-066/067/068; tasks 0601/0602)

The event catalog owns identity and operational policy. An envelope projector redacts and bounds
producer facts before an exhaustive typed presenter registry derives description, fields,
summary and outcome. Read-time history reprojection does not rewrite the ledger or correlation.

Producers emit facts; the Board renders canonical slots without event-specific interpretation.
Every catalog event has one presenter. Unsupported outcomes remain omitted; presenters see only
bounded projected data. Details: [event tracking](design/event-tracking.md) and
[observability context](design/actionable-observability-context.md).

### 16.2 J91 human table projection (built — ADR-073/074; task 0605)

A table projector follows the semantic presenter, deriving correlators, actionLabel and agent
from bounded data and optional row actor data. The Board maps those slots generically; no new
client interpretation seam or envelope version is introduced.

Human cells omit opaque IDs; remediation commands stay separate from Action; missing agent
identity is omitted. Actor data is not persisted as envelope context. Data contracts:
[human table projection](design/system-events-human-table.md). UI rules: root DESIGN.md.

## 17. Inter-Agent Control Plane (ADR-057 — waves 1–2 landed; wave 3 follow helper landed)

Current shipped coordination is two independent channels (`03` §14.1): durable `inbox_messages`
drained by `spur agent loop`, and a supervised process pipe (stdin POST + bounded SSE ring).
Wave 1 (task 0529) persists an `OccupantRef` + `coordination_runs` row when a run is addressed by
spec id (`flags['spec-id']` is set before `--drain` rewrites `--agent` to the spec's **executor
name** when the spec records one — falling back to the coding-agent type only via the
`spec-without-executor-field` shim, task 0537; `--spec <id>` is the canonical carrier since 0542)
and injects `SPUR_SPEC_ID` / `SPUR_TEAM_ID` / `SPUR_RUN_ID` / `SPUR_SERVE_URL` on supervised spawn.
Wave 2 (task 0530) ships the identity-pinned wait surface: `spur agent wait <specId>` (pins
`specId+runId+generation`, typed errors `occupant_gone|run_replaced|wait_stalled|timeout`)
and atomic `spur message send --wait` (snapshots the occupant before enqueue, waits on that
pin in the same process). Wave 3 (task 0531) replaced the 100 ms `system_events` poll with
`followSystemEventsAfter` (snapshot sequence, then follow `sequence > snapshot`; identity /
stall / timeout still heartbeat at 100 ms). Lifecycle is derived by a pure projector
(`working` = latest `agent.invoke.start`; `idle` = latest `agent.invoke.exit` + empty queued
inbox; `blocked` requires a first-class signal, none yet). First-class `blocked` remains
accepted design.
Task 0685 adds an exact-one selector above this unchanged pin layer: `--role` resolves a configured
Layer-1 role or executor name through `AgentInstanceStore.byRole` / `byExecutor`; zero or multiple
matches fail with count + candidates. `agent wait` and `message send --wait` snapshot the resolved
spec's occupant; an unwaited send queues to the resolved `specId` without requiring an occupant.
The Board Inbox `mergeTimeline` remains display-only; G3 (ADR-052) still owns un-merging it and
is not this section's work.

### 17.1 Target topology

```text
Agent A (spec reviewer)
  → spur message send --to implementer
  → inbox_messages (queued)
  → implementer agent loop drain
  → OccupantRef { specId, agentKind, processId, runId, generation }
  → CoordinationRun + artifact paths
Agent A
  → spur agent wait implementer --run <runId> --until invoke-exit
  → snapshot system_events seq → follow cataloged events → re-probe occupant
  → read artifactRefs (files), never a PTY
```

The process pipe stays the operator attach path. It is not the agent-to-agent command bus.

### 17.2 Invariants (enforceable)

1. No production module may open a socket to another coding-agent process for coordination.
2. No production module may read another pane's terminal buffer, screen manifest, or OSC title
   to decide agent lifecycle or to return “the other agent's output.”
3. No production module may write synthetic keystrokes to another agent's stdin as a substitute
   for `spur message send`.
4. `POST /api/team/processes/:id/stdin` remains operator/process-pipe only; `agent loop` delivery
   stays `drainPending` → prepend until a later accepted design replaces it.
5. Wait and send-wait pin `specId` + `runId` + `generation`. A replacement occupant cannot
   satisfy an in-flight wait.
6. `TeamService` / `AgentService` mutation methods return without blocking on wait. Waits live
   on the CLI or connection side and follow `system_events` / EventBus after a snapshot sequence.
7. New coordination verbs land on `agent` or `message` only (ADR-051). A new noun is a new ADR.
8. Semantic wait targets (`idle`, `working`, `blocked`) are derived only from cataloged events
   or an explicit report API. Presentation fields (titles, tokens, Board timeline rows) never
   satisfy a wait.
9. Coordination-run rows store artifact **paths**, not stdout/stderr bodies. Redaction runs
   before persist.

Shapes: `docs/design/inter-agent-control-plane.md`.

## 18. Transition-Shim Gate (ADR-058 — task 0541, feature B2)

Production compatibility paths carry @transition-shim IDs registered in
config/transition-shims.json. The gate reconciles code markers and manifest entries in both
directions and rejects missing metadata. Tests, vendors, build output and docs are excluded.
An empty manifest represents completed migration; each live shim has a removal condition.
Gate contract: [configuration contracts](design/configuration-contracts.md).

## 19. Agent Executor Selection — Two-Layer Contract (features B2/B3, tasks 0535–0542, 0572)

Executor selection is a two-layer contract. **Layer 1** maps _role → tier/stages_ and its SSOT is
code: `DEFAULT_AGENT_ROLES` in `packages/config/src/index.ts` (ADR-061 / task 0572) declares the
four roles — `scribe`·cheap, `coder`·standard, `reviewer`·capable-1, `planner`·capable-2 — with an
optional closed-vocabulary `agent.roles` overlay (per-field merge, validated at config load) that
wins over the constant; a project re-tiers/re-stages a known role, never invents one. Layer 1 never
names an executor, model, or vendor. **Layer 2** maps _tier → executor_ and is owned by the operator
in `.spur/config.yaml` (`agent.executors` entries carrying a `tier` field). `packages/config`
exposes the four-id `AGENT_ROLE_NAMES` literal beside the SSOT. The CLI resolves roles in
`apps/cli/src/context.ts` (`resolveAgentRoles`) so `--agent <role>` resolves before any spawn; the
runtime regex parse of `plugins/sp/references/roles.md` is deleted outright (no shim — values are
byte-identical), and roles.md survives as a parity-gated projection: its tier/stages half is
asserted equal to `DEFAULT_AGENT_ROLES` by `plugins/sp/tests/roles.test.ts` (R9) and its
command→role half stays plugin-owned. Plugin-internal stage floors read the projection
(`plugins/sp/scripts/stage-registry-adapter.ts`, 0538 R4) and degrade to the `standard` floor when
it is unreachable.

Resolution (`AgentService.resolveAgent`): an explicit role starts at its tier's cheapest eligible
executor; an explicit executor name is a permanent pin (0536 R2, beats role routing); a bare binary
name survives under the `agent-bare-binary-name` shim with a one-time warning; `auto`/omitted falls
to the declared role (command frontmatter or workflow step `role:`), else `agent.default` as the
default role (0542 R2, shim `agent-default-executor`); on miss, Tier-1 priority. `extractPhase`
prompt-regex stage detection is retired (0536 R4) — the prompt text never derives a stage or role;
the stage door is the explicit `--stage` flag. Role names, executor names, and spec ids are proven
pairwise disjoint at config load (0537 R4), so one `--agent` value never means two things. A
spec-addressed run (`--spec <id>`, legacy `--agent <specId>`) rewrites the selector to the spec's
executor name when the spec records one (0537), restoring the operator's `{ agent, model }` + tier;
specs without an executor field fall back to `type` (shim `spec-without-executor-field`), and a
dangling executor reference fails loudly at drain, spawning nothing.

**Invariants (enforceable)**

1. `--agent` accepts only a Layer-1 role, a configured executor name, a bare binary name (shim), or
   `auto`/`inline`; anything else exits 2 before a process spawns (0536 R3).
2. Role names, executor names, and spec ids never collide in one config — a config that collides
   them fails to load naming both names (0537 R4).
3. A spec whose `executor` is absent from `agent.executors` fails at drain naming the spec and the
   missing executor; it never silently downgrades to a bare binary (0537 R5).
4. The prompt text never derives a stage or role (`extractPhase` retired); undeclared callers land
   on the default role visibly.

Shapes: `04 §2.1` (`agent.roles`); `packages/config/src/index.ts` (`DEFAULT_AGENT_ROLES`,
`AgentRoleConfigSchema`); `config/config.global.yaml` (the ADR-078 SSOT); `plugins/sp/references/roles.md` (projection).

## 20. Workflow Composition and Canonical Pipelines (ADR-069/072 accepted; ADR-071 accepted design)

D5 implemented an existing-seam, infrastructure-first migration. Workflow definitions remain the
orchestration graph; they do not become a second application layer. Shared deterministic behavior
is owned behind existing application and persistence interfaces. The canonical task and docs
pipelines enforce the final-state proof invariant described in ADR-071 and §20.3.

### 20.1 Options and decision

Workflow YAML remains the orchestration authority. The chosen model extends existing application,
engine action, persistence and read-projection seams with action-effect classification,
input-bound proof, literal executable/argument gates and path-only artifact metadata.
It adds no new DSL, controller, package, store or public command.
Architectural choices and tradeoffs remain in ADR-069/071/072; proof invariants follow below.

### 20.2 Ownership topology

```text
workflow YAML
  ├─ graph, guards, retries, failure policy, capability selection
  ├─ deterministic app/CLI capability ──→ existing application owner
  ├─ command.gate ──→ literal executable/args + ProcessExecutor + attempt evidence
  ├─ run.artifact ──→ existing ArtifactDao (run id + kind + path only)
  ├─ workflow-local extension ──→ policy unique to one graph
  └─ agent.run ──→ model judgment through existing role/executor resolution

resolved workflow
  └─ static contract checker (composition baseline retired, task 0767; facts read live via extractResolvedWorkflowFacts) ──→ field-level graph/effect/artifact/caller diff

repository snapshot + normative task/feature sections
  └─ ProofInputFingerprint ──→ digest carried by gate/review/verify evidence
```

The baseline freezes behavior visible at the pipeline boundary: resolved graph, callers, terminal
states, artifact owners, failure policy, model-query locations, and every action's two effects:
`stateEffect: read|write|may-write` for repository/corpus inputs and
`evidenceEffect: none|write` for declared result artifacts. It is checked data, not another
executor. Unknown or extension-defined actions fail closed as `stateEffect: may-write` until their
owning capability declares and enforces a narrower contract. An evidence write is proof-neutral only
when its target is declared, confined, and tagged with the current proof-input digest.

`ProofInputFingerprint` deepens the existing alternate-index snapshot code used by `agent.run`. It
hashes the working repository outside configured task/feature folders, then combines that tree with
a canonical projection of normative corpus input: task identity/dependencies plus Background,
Requirements, Acceptance Criteria, Design, and Plan; feature identity plus Goal, Scope, and
Acceptance Criteria. Derived Review/Testing/Solution evidence, lifecycle status, timestamps, and
`.spur/run` artifacts are not proof inputs; their writers must be explicitly declared as evidence
writes. A write outside those confined projections changes the digest and invalidates the proof.

`command.gate` owns bounded attempts, process execution, PASS/FAIL normalization, and persisted
attempt evidence. It accepts literal executable/args only and delegates directly to
`ProcessExecutor`; a compound gate belongs in the named project script, not a runtime shell string.
`run.artifact` owns safe `.spur/run` path resolution and path-only artifact metadata. Domain
mutations continue through the normal application/CLI boundaries so task and feature lifecycle
guards cannot be bypassed. Exact shapes live in
`docs/design/workflow-composition-contract.md`.

### 20.3 Proof-state invariant

A verification verdict proves one final proof-input digest. Mutating remediation and proof
establishment are separate phases:

```text
remediation write|may-write                         → invalidated
invalidated + quality PASS(digest D)                → quality-passed(D)
quality-passed(D) + review PASS(D)                  → reviewed(D)
reviewed(D) + observe-only verify --fix none PASS(D) → verified(D)
verified(D) + confined evidence write tagged D      → verified(D)
any state write|may-write or current digest != D    → invalidated
```

The task pipeline now implements this flow (task 0703): `verify.onEnter:0` is the midpoint
`proof.fingerprint` compare (`expect: ${vars.proofDigest}`), the agent action is
`/sp:dev-verify ... --fix none` (`stateEffect: read`), a repairable non-PASS routes once through
the bounded `verify → test-fix` hop (budget shared with the quality gate), and `test-recheck`
re-captures the digest so the re-entered chain certifies a fresh state. The verdict artifact
carries a proof block naming one digest across quality, review, and verification; `verify → record`
and `record → done` guards refuse missing, malformed, or mismatched proof evidence. The docs
pipeline also uses measured, read-only verification (`--fix none`) before record, with a
proof bracket and the standard verdict artifact (tasks 0704/0769).

Only `verified(D)` may cross the completion boundary, and the boundary re-captures D immediately
before transition. This statically disqualified the former `task-pipeline2.yaml`: both its
editing-capable verify action and post-PASS residual `agent.run` could mutate proof inputs before
record. That graph was deleted rather than promoted (ADR-076, 2026-08-20). The rule stands for any
future candidate: residual logic must be read-only or loop through remediation and the entire proof
chain.

Enforceable invariants:

1. Resolved action effects come from live definitions and the effect classifier, not a composition snapshot (ADR-108).
2. Unknown action kinds and editing-capable model actions are `stateEffect: may-write`, never implicitly `read`.
3. Quality, review, and final verification evidence must carry the same current proof-input digest.
4. Any state write, possible state write, or digest mismatch clears all earlier proof stages.
5. A gate never accepts missing, malformed, or non-token output as PASS.
6. Evidence metadata contains bounded references and the proof-input digest; file bodies and raw process output never enter the row.
7. Workflow actions cannot bypass task/feature lifecycle services or direct-write their corpus files.

### 20.4 Canonical topology and migration

Separate definitions remain where lifecycle or rollback boundaries differ: docs, wrap-up,
idea/design review, task execution and integration-HEAD PR review. The task pipeline is the
canonical task graph; retired duplicate candidates have no active callers.
Agent stages select roles; coordination targets exact occupants. See
[workflow composition](design/workflow-composition-contract.md).

## 21. Workflow Progress Projection (built — ADR-070)

`WorkflowProgressProjection` is a pure application read module built inside `packages/app` beside
`WorkflowService`; it is not a new engine, DAO schema, or controller. Its narrow interface accepts a
run id and returns a projection assembled from the resolved definition and existing persisted truth.

### 21.1 Data flow

```text
run id
  ├─ definition resolver ──→ resolved states/actions/edges + definition digest
  ├─ runs ─────────────────→ workflow identity, terminal status, metadata_json.definitionDigest
  ├─ PhaseRunDao ──────────→ state visits
  ├─ TransitionRunDao ─────→ taken edges/current state
  ├─ ActionRunDao ─────────→ attempts, timing, and outcomes
  └─ ArtifactDao ──────────→ path-only run artifacts
           │
           ▼
  WorkflowProgressProjection ──→ one internal progress DTO + explicit diagnostics
```

Before the first action, the persistence composition merges `{ definitionDigest }` into the run
record's existing `metadata_json`; it never replaces the object. The same atomic merge contract is
used for `dryRun`, while terminal failure and stale-run finalization retain their current keys.
Existing and unknown metadata keys survive every write. A continued run retains its launch digest;
a different currently resolved digest becomes `definition-drift`, never an overwrite.

No schema or second progress store is added. Definition actions receive the stable key
`<state>:<onEnter|onExit>:<ordinal>` after extensions resolve. Persisted action rows currently carry
`node` and `kind`, not that key, so mapping uses ordered node/kind occurrences within a state visit.
An ambiguous mapping is surfaced as a diagnostic and never guessed. Definition drift, missing
launch digests, orphan rows, and unavailable definitions are explicit degraded states.

### 21.2 Follow model

The follower snapshots the latest System Event sequence, queries the complete persisted projection,
then follows events strictly after the snapshot. A correlated event only wakes a re-query; it never
changes progress directly. On timeout, disconnect, or event gap, bounded polling re-queries the same
sources. Duplicate or lost events therefore affect latency, not truth.

Inline execution remains controlled by the host-session driver. A record-only journal writes the
same run/phase/transition/action observation shapes through the existing persistence interface, but
cannot execute an action or request a transition. Engine-driven and inline runs consequently share
one read model without creating a competing controller.

Enforceable invariants:

1. Projection is deterministic for the same definition digest and persisted row set.
2. System Event payloads never become projection state; every wake-up re-reads persistence.
3. Poll fallback remains enabled until a persisted terminal run status is observed.
4. Ambiguous or orphaned rows produce diagnostics and never synthetic success.
5. Definition-digest writes merge into `runs.metadata_json`; they never erase `dryRun`, `failureReason`, `staleReason`, or unknown keys.
6. Inline journaling is record-only and cannot influence host execution semantics.
7. Public trace JSON/human output stays unchanged until an ADR-051 consent decision lands.

Detailed DTO, source mapping, follower sequence, and fixture matrix:
`docs/design/workflow-observability.md` §D5 detailed progress projection.

## 22. Environment-Improvement Lens and Active Session Review (ADR-084/085/089)

One plugin-owned mapping projects environment-improvement categories into existing dogfood
and history-anatomy reports. It adds no analyzer, workflow, history owner or memory store.
plugins/sp/references/environment-lens.md owns the mapping; active-session review applies it
to live conversation evidence as a read-only placement aid. Environment changes remain proposals,
including in fix mode. See [environment lens](design/environment-improvement-lens.md) and
[session review](design/session-review.md).

## 23. Baseline Taxonomy and Waiver Lifecycle (accepted design — ADR-093; enforcement pending)

Gate artifacts are classified by effect: numeric regression budgets, temporary transition
manifests, live workflow composition and current corpus findings. A snapshot cannot silently
accept new findings. Retired composition/corpus snapshots have no authority.
Each artifact's gate owns exact validation and retention; temporary artifacts carry an owner,
bounded scope and objective removal condition.
See [essential workflow checks](design/essential-workflow-checks.md).

## 24. Production Autonomy Contracts (built — ADR-094–100, tasks 0703–0712)

Production autonomy composes existing owners:

~~~text
agent.run → role/executor resolution → capability attestation
  → typed usage/budget decision → failure transition → bounded escalation artifact
repository state D → review(D) → read-only verify(D) → verified result(D)
checkpoint/index → freshness check → resume or ignore → confined retention cleanup
~~~

These controls add no agent runtime, workflow engine, event bus, analytics store or memory
authority. Prompts/output/logs remain bounded references; unavailable measurements never become
zero. Detailed trust, proof, checkpoint and attestation contracts:
[planning workflows](design/planning-workflow-contracts.md).

## 25. Executor Availability

Merged YAML is the availability authority: `agent.executors[].disabled` is boolean-only (false
after raw global/project merge), and routing/doctor exclude disabled profiles — explicit pins fail
pre-spawn, never substitute, and doctor synthesizes non-probed disabled rows (0796).

Upstream `ts-ai-runner` (≥0.4.57) emits `agent.quota.exhausted` / `agent.quota.recovered` carrying
Spur's exact dispatch attribution into a shared app subscription
(`attachAgentQuotaUpdates`, packages/app). The subscription validates trusted shape (Zod,
`@gobing-ai/spur-config/agent-quota-events`), attributes project/executor/profile, and applies the
update through the config package's exact-name updater
(`setProjectExecutorDisabled`, per-path lock + atomic same-dir commit + loader-cache invalidation,
0797).

The durable record is one pending row per project/executor in the existing SQLite database —
`agent_executor_updates` (migration 0040, `AgentExecutorUpdateDao`) with a conditional
latest-observation upsert and version-specific ack; it survives event-history pruning and restart,
and coalesces superseded observations. The Bun server starts one project-scoped consumer before
autostart/dispatch (drain + bus wake-up feed the same serialized drain) and detaches + drains it
before DB close; the CLI attaches the same subscription to agent/workflow/team run buses with
flush-before-exit (0799). Long-lived dispatch paths reload effective agent config at each
selection/launch boundary; current-invocation exhaustion stays in memory so fallback never waits
for persistence.

Recovery is a reserved explicit contract — `agent.quota.recovered` maps through the same updater
to `disabled: false`; there is no automatic producer, poller, or timer. The two quota events are
bus-consumed, not catalog-registered (board presentation awaits ADR-110 catalog-open ingestion).

ADR-111 records this delivery choice. Shapes, failure contracts, and rejected alternatives live
in [executor availability](design/executor-availability.md).

## 26. Execution policy and renewable job ownership — shipped (A21, task 0813)

Scheduler/queue deadlines and cancellation context belong to ts-infra; process cleanup to
ts-runtime; importer cancellation to the importer; attempt ownership and lease state to ts-db.
Spur resolves application defaults and consumes truthful cancellation, retry and timeout outcomes.

Lease renewal is finite even for execution without a deadline. Age-based recovery must not expire
explicitly unlimited jobs. Durable claim ownership remains an upstream persistence concern;
the finite-deadline sweep is the recovery backstop while that contract is pending.
Details: [execution deadlines](design/execution-deadlines.md).
