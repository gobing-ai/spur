---
doc: 04_DESIGN
owns: SURFACE — every CLI command, flag, config key, env var, table, DTO
authority: derived
version: 1.2.0
derived_from: [03_ARCHITECTURE, codebase]
owner: Robin Min
updated_at: 2026-06-13
read_before: changing a command, flag, env var, or schema
edit_rules: 99 §6.5
sync: [T3]
---

# 04 Design — Spur

The external, user-facing design surface: every CLI command, the config schema, and the persisted
data shapes. Feature-internal design lives in code.

## 1. CLI Surface

All commands accept `--json` for machine-readable output and return a meaningful exit code. The
binary is `spur` (`apps/cli/src/index.ts`, run under Bun).

### 1.0 CLI grammar

The canonical invocation shape is:

```
spur <noun> [<verb>] [positionals] [--flags]
```

**Noun-verb contract:**

- Every multi-verb noun follows `spur <noun> <verb> …`. The verb is the second positional token.
- `init`, `status`, and `migrate` are the only sanctioned **verb-less** commands. They accept
  flags and optional positionals directly.
- All other nouns require a verb. Commander enforces this: calling `spur workflow` without a verb
  prints commander's help and exits 1.

**Help dispatch:**

| Invocation | Behavior |
|---|---|
| `spur` / `spur help` / `spur --help` | Top-level help: commander's standard flat command listing (alphabetical, with summaries) |
| `spur <noun> --help` | Commander-generated command-scoped help (options, subcommands) |

The CLI surface is built on `commander` + `@commander-js/extra-typings`. Each noun exports a
`registerXxxCommand(program, context)` function from `apps/cli/src/commands/<noun>.ts`. Adding a
noun requires writing its registration function and importing it in `apps/cli/src/index.ts`.
Commander handles option parsing, `--help` rendering, and subcommand dispatch — no custom
help rendering overrides remain.


### 1.1 Committed product commands

#### `spur init [--name <name>] [--force] [--minimal] [--json]`
Scaffold a local Spur project. Writes `.spur/config.yaml` (§2.1) and records the config artifact. Unless
`--minimal`, scaffolds `.spur/` from the default config assets (§2.3): `.spur/rules/` (with the
`recommended-pre-check.yaml` + `recommended-post-check.yaml` presets) and `.spur/workflows/basic.yaml`.
The set of scaffolded files is an explicit reviewed manifest (`scaffold-manifest.ts`) — adding a default
is a one-line manifest edit, not new control flow. Files are read from the resolved config source, not
embedded as string literals. Always creates `.spur/agents/` (with a `.gitkeep`) for team-mode agent
specs, regardless of `--minimal`. On first run it seeds `~/.config/spur/` from the bundled `dist/config`
assets (existing files are never overwritten), so `spur rule run` resolves a real ruleset from any
project. Re-running is blocked (exit 1) unless `--force` is given, preventing a stray `init` from
clobbering a configured project. `--json` emits
`{ ok, project, config, created[], skipped[], globalConfigSeeded }`.

#### `spur agent run <prompt> [--agent <name>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--drain] [--json]`
**The single LLM execution surface.** Every model invocation in Spur routes through this verb — sp
skills that generate prose (AC, decompositions, reviews), workflow `agent.run` actions, and team-mode
runs all call `spur agent run`; Spur owns no other path that reaches a model (it is not a BYOK LLM
platform — ADR/PRD). This keeps agent resolution, auth, slash-command translation, and team identity in
one place, and is the seam where a future remote/SSE execution channel attaches without touching callers.
Execute a prompt or slash command via a coding agent. `--agent` (default `auto`) selects the first
usable Tier-1 agent; `current` reads `SPUR_AGENT` env var; explicit name resolves directly.
`--continue` resumes the previous session. `--mode text|json` (default `text`) passes output format
to the agent CLI. `--cwd` sets the working directory. `--json` emits a machine-readable envelope
(`{ exitCode: number|null, stdout, stderr, signal?, durationMs }`). Slash commands like
`/plugin:command` are translated per-agent (claude pass-through, codex `$`, pi `/skill:`).
Team identity (purpose, tags, system prompt) is sourced from the agent **spec** (`agent create`
flags below), not from `run` flags. `--drain` resolves the addressed `--agent <id>` as an **agent
spec id** (a different namespace from the coding-agent type), folds that spec's pending inbox
messages into the prompt, and rewrites `--agent` to the spec's underlying type before dispatch
(Phase 1-3 has no live stdin, so prepending is how deferred messages reach the agent).
Exit 0 on success, 1 on agent-not-found, 2 on invalid arguments, 3 on agent execution failure.

#### `spur agent list [--json] [--specs]`
Detect installed agents; prints `ok|missing <name> [version]`. Backed by `ts-ai-runner`
`AgentDetector`. Agents: claude, codex, gemini, pi, opencode, antigravity, openclaw. With `--specs`,
lists the team agent specs under `.spur/agents/` instead (`<id> <type> <purpose>`; `--json` includes
the spec path).

#### `spur agent doctor [agent] [--json]`
Readiness check per agent; prints `usable|needs-auth|missing <agent> tier=<n> [version]`.
Exit 1 if any **tier-1** agent is not usable. Backed by `ts-ai-runner` `DoctorRunner`.

#### `spur agent create <id> --type <agent-type> [--json] [flags]` · `spur agent edit <id>` · `spur agent delete <id> [--force]`
Manage team agent specs under `.spur/agents/<id>.yaml` (backed by `ts-ai-runner` agent-spec helpers
and the app-layer `TeamService`).
- `create` — write a spec. Flags: `--name`, `--workspace`, `--purpose`, `--tags <a,b>`, `--model`,
  `--autonomy`, `--system-prompt`, `--no-identity-preamble`, `--auto-start`. The id is validated
  (`[a-z][a-z0-9_-]{1,63}`); a duplicate id is refused. An empty `--purpose` falls back to
  `"<type> agent"` so the written YAML round-trips. `--json` emits `{ ok, spec }`.
- `edit` — open the spec in `$EDITOR`, or print its path when `$EDITOR` is unset. Errors if missing.
- `delete` — remove the spec; refuses (exit 2) without `--force`; errors (exit 1) if missing.

#### `spur message send --to <id> <body> [--from <id>] [--json]` · `spur message inbox --agent <id> [--json]` · `spur message reply <msg-id> <body> [--json]`
Durable inter-agent messaging over the SQLite `inbox_messages` table (backed by `TeamService` →
`ts-ai-runner` `MessageService` → `ts-db` `InboxMessageDao`).
- `send` — enqueue a message; `--from` defaults to `operator`. Prints `queued <id> → <to>`.
- `inbox` — list messages addressed to `--agent` (`<id> <status> <from> <body> <createdAt>`); reports
  "No messages" when empty.
- `reply` — look up the original message, address the reply back to its `from_id`, and thread it via
  `in_reply_to`. Rejects an unknown id, or an operator-originated message (null sender) with no peer.

#### `spur team assign <task-id> <agent-id>` · `spur team status [--json]` · `spur team start` · `spur team stop`
Team coordination (backed by `TeamService`).
- `assign` — set `assignee: <agent-id>` in the YAML frontmatter of `docs/tasks/<task-id>_*.md`
  (replacing any existing assignee). Errors if no matching task file is found.
- `status` — list every spec under `.spur/agents/` with its run status (`stopped` in Phase 1-3, since
  there is no daemon yet); `--json` emits `{ agents: [...] }`.
- `start` / `stop` — Phase-4 deferred stubs that print the daemon-not-available message and exit 0.

#### `spur rule run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>] [--stop-on-first [<severity>]] [--fix-mode <mode>] [--dry-run] [--verbose] [--json]`
Evaluate constraint rules over the working tree. `--preset` (default `recommended-pre-check`) or
`--file` for an ad-hoc rule file; `--rule <id>` filters to one rule. `--fail-on error|warning|info` (default
`error`) sets the exit-1 threshold. `--stop-on-first [<severity>]` (default `error` when bare) stops
evaluation after the first rule with findings at or above the given severity — this controls
**traversal** (when to stop), orthogonal to `--fail-on` which controls **verdict** (what to fail on).
They compose: stop early, then threshold the partial findings via `--fail-on`. Omitting
`--stop-on-first` preserves the default exhaustive scan.

`--fix-mode none|suggest|auto` (default `none`) controls fix collection and application:
- `none` — fixes not collected. Byte-identical to the pre-`--fix-mode` behavior.
- `suggest` — collect candidate fixes, surface them (`fixes[]` in `--json`), **write nothing**.
- `auto` — collect AND apply. Effective per-rule mode is `min(rule.fix.mode, maxFixMode)`.
  `--dry-run` previews the diff without writing.

Exit code is governed by `--fail-on` based on **findings** alone; applying a fix does NOT retroactively
clear the exit code (the operator re-runs to confirm green). `--verbose` streams per-rule progress with
execution time to stderr (e.g. `✓ passed - 0.12s`). Rule roots resolve highest-priority-first:
`SPUR_RULES_PATH`, local `.spur/rules`, the user-global `~/.config/spur/rules`, then the generic demo
rules bundled with `ts-rule-engine` as a fallback so a preset's categories resolve before `spur init`
seeds the global layer. A run that resolves **zero rules** exits 1. Setting `SPUR_GLOBAL_RULES_DIR`
overrides the global root and suppresses the bundled fallback for a hermetic run. Backed by
`ts-rule-engine`.

#### `spur rule validate [--file <path>|--preset <name>|<path>] [--json]` · `spur rule list [--preset <name>] [--json]` · `spur rule trace [run-id] [--preset <name>] [--status <s>] [--since <date>] [--last <n>] [--json]`
- `validate` — load and normalize a rule file or preset without evaluating it.
- `list` — list the effective rule-file inventory grouped by source layer and category (`local`, `global`,
  and any `SPUR_RULES_PATH` override, deduped by relative path); with `--preset`, list the resolved preset
  rules.
- `trace` — query persisted rule run history from SQLite. No argument: list recent runs (default last 20,
  newest first) with filters `--preset`, `--status` (`done`|`failed`), `--since` (ISO date), `--last` (positive
  integer). With `<run-id>`: per-run detail showing summary metadata and per-rule evaluation rows in
  execution order with finding counts, duration, and status. `--json` returns structured DTOs.
  Runs are persisted inline by `spur rule run` when a DB is available (direct writes from the
  `ts-rule-engine` `RulePersistenceAdapter`; Spur writes via `DbRulePersistenceAdapter`).
Backed by `ts-rule-engine`. Help dispatch per §1.0.

#### `spur workflow validate <workflow.yaml> [--json] [--no-schema]` · `spur workflow run <workflow.yaml> [--run-id <id>] [--vars <json>] [--dry-run] [--json]` · `spur workflow continue [run-id] [--yes] [--json]` · `spur workflow list [--json]` · `spur workflow trace [run-id] [--workflow <name>] [--status <s>] [--since <date>] [--last <n>] [--json]`
- `validate <file>` — load + Zod-validate a workflow definition.
- `run <file> [--run-id <id>] [--vars <json>] [--dry-run]` — execute; prints `<status>: <name> -> <finalState>`;
  exit 1 unless `done`. `--vars` takes a JSON object of per-run variable overrides
  (e.g. `--vars '{"taskId":"0042"}'`), merged over the workflow's `vars` for `${vars.*}` resolution.
  `--dry-run` validates the definition and walks the transition graph without executing actions
  — useful for verifying workflow structure before committing side effects.
- `continue [run-id] [--yes]` — resume a paused (HITL) run (E3, design §6 / D04). Omit `run-id` to
  discover the most-recent paused run and confirm (skipped with `--yes`). Resolves the run's
  `workflow_name` back to its YAML, then `resumeRun`. Works for both lifecycle and pipeline runs;
  exit 1 if no paused run, the run isn't paused, or it doesn't resolve to `done`. (A state pauses when
  it declares `pause: true`; the workspace schema supports `pause`.)
- `list` — list available workflow YAML files across project (`.spur/workflows/`) and global
  (`~/.config/spur/workflows/`) layers, grouped by source.
- `trace` — query persisted workflow run history. No argument: list recent runs (default last 20,
  newest first) with filters `--workflow`, `--status`, `--since`, `--last`. With `<run-id>`:
  per-run timeline of state entries, transitions, and action executions interleaved by `created_at`.
  Action lines include the action kind, duration when finalized, and an in-flight/success/failure marker.
Backed by `ts-dual-workflow-engine` (`WorkflowService` + `DbWorkflowPersistenceAdapter`).

#### `spur history import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--json]`
Import agent conversation JSONL. `--source` ∈ {pi, claude, codex, gemini, opencode, antigravity,
openclaw}. `--mode` ∈ {full, incremental, force-file} (defaults: `incremental` for root scans,
`force-file` when `--file` is given). Reports scanned files, processed lines, imported/duplicate
records, parse/validation errors; exit 1 if any errors. Backed by `ts-llm-jsonl-importer`.

#### `spur history analyze [--since <iso-date>] [--json]`
Aggregate imported ETL records into token/cost analytics (totals + per-source + per-model + daily).
Reads `history_etl_*` tables; estimates cost from per-model pricing.

#### `spur history report [--json]`
Reserved CLI surface for richer history reports. Currently prints a TODO marker so migration can
stabilize before the report implementation is designed.

### 1.2 Supporting utilities

| Command | Behavior |
|---------|----------|
| `spur status [path] [--json]` | Project health: config present, package.json present, git context, team agent spec ids found under `.spur/agents/`; optional path metadata (size, isFile, isDirectory). |
| `spur serve [--port <n>] [--host <addr>] [--no-open] [--cwd <path>] [--json]` | Start the web server (local fallback). Options: `--port` (env PORT, default 3000), `--host` (env HOST, default localhost), `--no-open` skip browser, `--json` print {port,url,pid}. |
| `spur migrate [--json]` | Temporary helper: apply CLI-owned schema migrations; reports `{ ok, applied }`. |
| `spur --help` / `spur --version` | Commander-rendered usage / binary version (ADR-014). |

## 2. Configuration

### 2.1 Project config — `.spur/config.yaml` (ADR-017)
Written by `spur init`. Single YAML config surface; the legacy `.spur/config.json` project marker is
retired. Resolution order: project `.spur/config.yaml` (cwd) → fallback `~/.config/spur/config.yaml`.

Two top-level concerns:
- **Portable `bootstrap:` block** — consumed by `@gobing-ai/ts-infra` `runNodeApplication`. Shared across
  `spur-cli` and (future) `spur-server`. Keys map 1:1 to ts-infra's `LoggingOptions` /
  `TelemetryOptions` / `DatabaseOptions` / `SchedulerOptions`.
- **Spur app section** — everything except `bootstrap:`, validated by a local zod schema
  (`spurAppConfigSchema`). Keys are agent/rules/workflows/redaction/version/name, plus the
  planning-layer `tasks:`/`features:` blocks (§9): `tasks.folders` (path → `{baseCounter, label?}`),
  `tasks.active`, `features.dir`. Zod (`@gobing-ai/spur-config` `tasksConfigSchema`/`featuresConfigSchema`)
  is the SSOT; `apps/cli/schemas/spur-config.schema.json` mirrors it for editor/CI validation.

```yaml
version: "1"
name: <project-name>
bootstrap:
  logging:
    enabled: true
    level: info           # debug | info | warn | error
    console: true
    json: true
  telemetry:
    enabled: false        # CLI: off by default (per-invocation latency)
    serviceName: spur-cli
    environment: development
  database:
    enabled: true
    driver: bun-sqlite
    url: .spur/spur.db    # ${DATABASE_URL} interpolation supported
  scheduler:
    enabled: false        # CLI is run-once; no scheduler
agent:
  default: pi
rules:
  paths:
    - .spur/rules/**/*.yaml
workflows:
  paths:
    - .spur/workflows/
redaction:
  enabled: false
tasks:
  folders:
    docs/tasks: { baseCounter: 0, label: Core }   # legacy folders/base_counter absorbed
  active: docs/tasks                               # default folder for `spur task create`
features:
  dir: docs/features
```

`${ENV_VAR}` interpolation works via `ts-runtime` `interpolateTree` (used inside
`runNodeApplication`).

### 2.2 App config — `@gobing-ai/spur-config` (Zod)
Env-derived config (`ln(env)`), consumed by both the CLI context and the server Bun entry:

| Key | Env var | Default |
|-----|---------|---------|
| `database.url` | `DATABASE_URL` | `:memory:` |
| `server.port` | `PORT` | `3000` |
| `server.host` | `HOST` | `localhost` |
| `server.openBrowser` | — | `true` (spur serve only) |
| `server.webDistPath` | — | `null` (S5 local static path) |
| `telemetry.enabled` | `SPUR_TELEMETRY_ENABLED` | `false` |
| `telemetry.endpoint` | `SPUR_TELEMETRY_ENDPOINT` | — |
| `logging.level` | `SPUR_LOG_LEVEL` | `info` (debug\|info\|warn\|error) |

Boolean env vars are parsed strictly (`true/1/yes/on` vs `false/0/no/off`); other values throw.

### 2.3 Default config assets — repo-root `./config` (ADR-015)

Repo-root `./config` is the single source of truth for all Spur default config, separated from source
code:

```
config/
  rules/
    recommended-pre-check.yaml      # default preset for `spur rule run`
    recommended-post-check.yaml     # stricter dev gate (coverage)
  workflows/
    basic.yaml                      # canonical implement → check → fix loop
    feature-dev.yaml                # agent-driven feature loop with pre/test/post gates
    task-lifecycle.yaml             # task status state-machine (ADR-022)
    feature-lifecycle.yaml          # feature status state-machine (ADR-022)
    task-pipeline.yaml              # task execution pipeline with guards
  tasks/
    section-matrix.yaml             # Section-Status-Matrix for `spur task check` (§7.4)
  templates/                        # task/feature/bdd body templates (§8); CLI never hardcodes body content (DD-11)
    task/{default,feature-impl,issue,review,meta}.md
    feature/default.md
    bdd/{gherkin,checklist}.md
  plugins/
    .gitkeep                        # home for future bundled plugins (ADR-012)
```

**Build → install → init flow:**

| Stage | Action |
|-------|--------|
| Build (`build:bundle`) | Copy `./config` → `apps/cli/dist/config`; shipped via the package `files` array. |
| Install (`bun install -g`) | `dist/config` ships inside the package — no `postinstall` (unreliable for global installs). |
| First run / `spur init` | `seedGlobalConfig()` copies `dist/config/{rules,workflows}` → `~/.config/spur/` (never overwrites). |
| `spur init` scaffold | Per the `scaffold-manifest.ts` list, copy resolved defaults → `.spur/` unless present or `--force`. |
| Runtime resolution | `bundled` (`dist/config` + ts-rule-engine demo rules) > global (`~/.config/spur`) > local (`.spur`). |

**Ownership split.** `@gobing-ai/ts-rule-engine` ships only generic demo rules (one per builtin
evaluator) + a generic `example.yaml` preset for its own tests. Spur owns its presets and workflows
here. The bare `recommended` preset is removed; `recommended-pre-check` is the default (BREAKING, ADR-015).

**`--compile` caveat.** The compiled binary (`dist/cli/spur`) cannot read a sibling `dist/config`; it
relies on the `~/.config/spur` seed. The published global install (`dist/index.js`) reads `dist/config`
directly and is the primary path.

No symlinks participate in install or init — config propagates by copy-and-resolve only.

## 3. Data Shapes

### 3.1 Tables (composed package-owned schema, ADR-007)

| Table | Owner | Purpose |
|-------|-------|---------|
| `workspaces` | CLI | Static workspace binding (name, root, purpose, default agent) |
| `runs`, `phase_runs`, `transition_runs`, `workflow_states` | CLI + workflow engine | Workflow run model |
| `artifacts` | CLI | Captured output references |
| `history_import_ledger` | importer | One row per imported record (hash, source, file, line) |
| `history_import_checkpoint` | importer | Incremental position, composite PK `(source, source_file)` |
| `history_etl_<source>` | importer | Validated per-source ETL rows (`payload_json`, `imported_at`) |
| `inbox_messages` | ts-db (`InboxMessageDao`) | Durable inter-agent message queue; indexed on `(to_id, status)`. Added by migration `0001_spur_cli_team_inbox`; composed into `CLI_SCHEMA_SQL` via `INBOX_MESSAGES_SCHEMA_SQL`. |
| `rule_runs`, `rule_eval_runs` | ts-rule-engine (≥0.3.15) | Persisted rule-run history powering `spur rule trace`; added by migration `0002_spur_cli_rule_history`. `applied_fix_count` is re-stamped by Spur after `applyFixes`. |

### 3.2 SourceDefinition (history import)
One config object per source: `source` discriminant, `displayName`, `filePatterns`, `defaultRoots`,
`splitConfig` (one-to-one | one-to-many | custom), `fieldMap` (raw→canonical), optional
`fieldTransforms`, and a Zod `schema` validating canonical fields. Adding a source = one variant.

### 3.3 Analytics records
`CostRecord` (source, date, model, input/output tokens, costUsd) aggregated into `AnalyticsSummary`
(totals + bySource + byModel + daily). Pricing is per-model USD per 1M tokens.

## 4. Output Conventions

- Human mode: terse, line-oriented, tab-separated where tabular.
- JSON mode (`--json`): a single JSON document to stdout, stable keys for automation.
- Errors go to the error sink with context (what failed, path/identifier); exit codes are meaningful.

## 5. Server/Web Surface (current slice)

| Endpoint | Source |
|----------|--------|
| `GET /api/health` | oRPC `health` procedure → `{ status, timestamp, service, version }` |
| `GET /openapi.json` | Generated from the oRPC contract |
| `GET /` | Redirect to `/api/health` |

Web (`apps/web`) renders live health from the typed oRPC client. Deeper read surface is Phase 4.

### 5.1 Bootstrap (ADR-019)

The server bootstraps through `@gobing-ai/ts-infra` using a runtime-aware split:

| Entry | Bootstrap | Subpath | Workers-Safe? |
|-------|-----------|---------|---------------|
| `src/index.ts` (Bun) | `runNodeApplication` | `ts-infra/application-node` | No (uses `node:fs`) |
| `src/worker.ts` (CF Workers) | `runApplication` | `ts-infra/application` | Yes |

**Shared seam (`src/bootstrap.ts`):**

| Export | Role |
|--------|------|
| `serverBootstrapConfig(env)` | Common `logging`/`telemetry`/`events` block with test-mute guard |
| `createApp(appRt?)` | Hono app factory; optional `ApplicationRuntime` threads `logger`/`events`/`db` into Hono context + oRPC handler `context` |

The Worker entry uses a **lazy singleton** (`let rtPromise`) — no top-level await, `runApplication`
initialized on first `fetch`. The Bun entry uses `runNodeApplication` mirroring the CLI (ADR-017).
## 6. Plugin System (Removed — ADR-012 amended 2026-06-09)

> **Amendment (2026-06-09):** The standalone `@gobing-ai/spur-plugin-sdk` is deleted. The bare
> lifecycle core (`Plugin` + `PluginHost`) lives upstream in `@gobing-ai/ts-infra` (shipped in
> `0.3.6`). Capability registries, trust ladder, manifest-driven discovery, and the server route
> seam are **deferred** — re-addable later on top of the ts-infra `Plugin` interface when a real
> plugin consumer exists. Mechanism lives in `03 §11`.

### 6.1 Current state

Spur consumes the ts-infra `Plugin` interface directly:

```ts
import type { Plugin, PluginHost } from '@gobing-ai/ts-infra/application';
```

The `Plugin` interface provides lifecycle hooks only: `onLoad`, `onStart`, `onStop`, `onUnload`,
plus `failFast`. The `PluginHost` drives registration and lifecycle fan-out (load → start →
stop → unload) with fail-fast load, fail-soft start/stop/unload in reverse registration order.

The `runApplication` / `runNodeApplication` bootstrap accepts `plugins`/`pluginHost` options
and drives the plugin lifecycle natively — no Spur-side host wiring needed.

### 6.2 Deferred (not permanently rejected)

| Concern | Status | Notes |
|---------|--------|-------|
| Manifest (`plugin.yaml`) | Removed | Re-addable as YAML + Zod on the ts-infra `Plugin` interface |
| Capability registries | Removed | 9 registries (api, command, event, harness, provider, rule, skill, ui, worker) — re-addable |
| Trust ladder | Removed | 4-tier (`bundled` > `curated` > `local` > `untrusted`) — re-addable as registration-time gating |
| CLI plugin command | Removed | `spur plugin list|info` — re-addable when plugin discovery returns |
| Server route seam | Removed | `mountPluginRoutes` / `collectPluginOpenApiPaths` — re-addable when plugins exist |
| Plugin config override | Removed | Per-plugin `.spur/plugins/<name>.yaml` — re-addable |
| Event registry | Removed | Glob-pattern + rate-limiting wrapper over `EventBus` — re-addable |

## 7. Planning Layer Surface (reserved — ADR-020; filled by Roadmap §1.5 Stage D)

Landing zone for the rd3-migration design output, reserved now so the system design has a defined
home and lands as subsection fills, not doc restructuring. Nothing below is invokable until
shipped (`05 §9` tracks status).

| Subsection | Will own | Design input until filled |
|------------|----------|---------------------------|
| 7.1 `spur task` commands | Verbs, flags, exit codes — CRUD, WBS, `--section --from-file`, list/kanban, check, batch-create, resolve, migrate | triage doc Group A |
| 7.2 `spur feature` commands | Verbs/flags — CRUD, INDEX refresh, task-links, check, goal derivation | triage doc Group B + the feature-file design spec (`cc-agents/docs/plans/2026-06-10-rd3-tasks-operator-feedback.md`) |
| 7.3 Frontmatter schemas | Zod field tables for task + feature files incl. `schema_version`, `parent_wbs`, `feature-id`, status enums | same design spec + triage A18/X02 | `packages/domain/src/planning/schema.ts`; `taskFrontmatterSchema`, `featureFrontmatterSchema`, `TaskStatus`, `FeatureStatus` (DD-01/02/03/07/10/13/14). |
| 7.4 Section-Status-Matrix + format rules | Config file shapes under `./config` (ADR-015); warning-first enforcement core | triage A13/A14; `03 §12.3` |
| 7.5 Lifecycle workflow definitions | `config/workflows/` task/feature lifecycle YAML shapes + guard wiring | ADR-022; `03 §12.2` |
| 7.6 Task DTOs | oRPC contract shapes for the board | server/web design task (ADR-021.b) |

### 7.1 `spur task` commands

Core CRUD and utility verbs. Every subcommand supports `--json` (ADR-010 invariant).
Source: delivery §1.1, design §10.

| Command | Flags | Exit | Notes |
|---------|-------|------|-------|
| `spur task` | — (noun help) | 0 | Lists subcommands if no subcommand given. |
| `spur task create <title>` | `--feature <id>` `--parent <wbs>` `--folder <path>` `--json` | 0/1 | Race-safe WBS allocation; `--feature` enables B09 Goal→Background derivation. |
| `spur task show <wbs>` | `--folder <path>` `--json` | 0/1 | Frontmatter is a top-level field in `--json` output. |
| `spur task update <wbs> <status>` | `--section <name> --from-file <path>` `--folder <path>` `--json` | 0/1/2 | Status transition runs lifecycle guard; `--section` reads body from file. |
| `spur task list` | `--status <s>` `--phase <p>` `--parent <wbs>` `--folder <path>` `--json` | 0/1 | `--phase` is a legacy alias for `--status`. |
| `spur task refresh` | `--folder <path>` `--json` | 0/1 | Regenerate `kanban.md` — pure function, deterministic ordering (A06). |
| `spur task batch-create --file <json>` | `--folder <path>` `--json` | 0/1 | Create many tasks from validated JSON — all-or-nothing; validated against `apps/cli/schemas/task-batch.schema.json` (A08/C03). |
| `spur task resolve <file-path>` | `--folder <path>` `--json` | 0/1 | Maps a path to owning task (WBS + file). Returns 1 if no match. Strategies: direct match, filename WBS parse, walk-up (A10). |
| `spur task check [<wbs>]` | `--strict` `--folder <path>` `--json` | 0/1 | Four-layer validation (§3). L4 traceability: `feature_id`/`parent_wbs`/`dependencies` edge resolution + **AC coverage** (DD-09: task scenarios must be a subset of the linked feature's AC by normalized title — warnings by default). Validates all tasks when `<wbs>` omitted; `--strict` elevates warnings. Matrix loaded from `config/tasks/section-matrix.yaml`. |

**Exit codes:** 0 success, 1 error, 2 invalid usage. Follows the design §10 `api-response` envelope
for `--json` output (`{ ok, data? }`).

**Future verbs** (stub entries, implemented in later waves):

| `spur task migrate` | Reserved (A17) — one-time corpus normalization pass. |

### 7.2 `spur feature` commands

Core feature verbs over `PlanningWriteService` (same write path as tasks). Features use
position-encoding hierarchical IDs (DD-14): single-letter top-level groups, children append one
digit 1–9 per level; ID length = depth; parent = drop the last character; **no `parent_id` field**.
Every subcommand supports `--json` (ADR-010 invariant). Source: delivery §1.2, design §2.2/§2.4.

| Command | Flags | Exit | Notes |
|---------|-------|------|-------|
| `spur feature` | — (noun help) | 0 | Lists subcommands if no subcommand given. |
| `spur feature create <name>` | `--parent <id>` `--folder <path>` `--json` | 0/1 | ID allocated under the create-lock (R1): `--parent` → next free child digit 1–9; no parent → next free group letter A–Z. |
| `spur feature show <id>` | `--folder <path>` `--json` | 0/1 | Returns the feature summary + content; 1 if not found. |
| `spur feature update <id> [status]` | `--field <key> --value <v>` `--folder <path>` `--json` | 0/1/2 | `<status>` runs the lifecycle transition (guarded, §7.5); `--field/--value` sets a scalar frontmatter field. 2 if `--field` given without `--value`. |
| `spur feature list` | `--status <s>` `--priority <p>` `--folder <path>` `--json` | 0/1 | Lists features sorted by ID; optional status/priority filters. |
| `spur feature check [<id>]` | `--strict` `--folder <path>` `--json` | 0/1 | Four-layer validation (§3): L1 schema, L2 section-matrix, L3 BDD AC (shared 0043 module) + one-active-P0-goal over {active,verifying} + ≤9-children (DD-14, corpus-derived), L4 incoming `feature_id` edges + orphan-scenario warnings + **AC coverage** (DD-09: feature scenarios covered by no linked task = warnings) + verifying-readiness (linked tasks not done/cancelled). Validates all features when `<id>` omitted; `--strict` elevates warnings. |
| `spur feature refresh` | `--folder <path>` `--json` | 0/1 | Regenerate `INDEX.md` (deterministic ID-encoded tree, per-node status badge + relative link, §4.3) and repopulate each feature's `## Tasks` auto-gen marker region from task `feature_id` edges. Only the marker region is rewritten; the rest of the feature file and all task files are byte-preserved. |
| `spur feature move <id> --parent <id>` | `--parent <id>` `--dry-run` `--folder <path>` `--json` | 0/1 | Cascade-rename (DD-14): re-IDs the node + all descendants (ID encodes position), renames their files, rewrites each `id` frontmatter + appends a move History line, and updates every task `feature_id` edge. Validates the full old→new plan first (collision / ≤9 / not-into-own-subtree); applies atomically with best-effort rollback. `--dry-run` returns the old→new map + affected tasks with zero writes. Omit `--parent` to move to a top-level group. |

ID rules (DD-14): valid IDs match `^[A-Z][1-9]*$`. The `## Tasks` auto-gen markers are
`<!-- AUTO-GENERATED by spur feature refresh -->` … `<!-- END AUTO-GENERATED -->` (recognized by
`MarkdownDocument.replaceMarkerRegion`). The full `spur feature` surface (create/show/update/list/check/
refresh/move) is now live.

### 7.3 Frontmatter schemas

Task and feature files share a `schema_version: 1` strictness gate (DD-03) and are written only
through `PlanningWriteService` (§7.5). Canonical field tables below; authority is the Zod schemas
in `packages/domain/src/planning/schema.ts` (`taskFrontmatterSchema`, `featureFrontmatterSchema`).

### 7.3.1 Task frontmatter — `taskFrontmatterSchema`
Mirrors `docs/design/rd3-migration-design.md` §2.1. Exported by
`@gobing-ai/spur-domain` from `packages/domain/src/planning/schema.ts`.

| Field           | Zod type | Req | Notes |
|-----------------|----------|-----|-------|
| `schema_version`| `z.literal(1)` | ✔ | Strictness gate; future evolution (DD-03). |
| `name`          | `z.string().min(1)` | ✔ | Title; used in slug. |
| `description`   | `z.string().optional()` | — | No `description == name` default (DD-10). |
| `status`        | `z.enum(TASK_STATUSES)` (transform → lowercase) | ✔ | See §7.3.3; aliases accepted on input only. |
| `type`          | `z.enum(['task','brainstorm']).default('task')` | — | `brainstorm` retained for corpus compat. |
| `profile`       | `z.enum(PROFILES).optional()` | — | Single key (DD-02); legacy `preset` collapsed. |
| `feature_id`    | `z.string().regex(/^[A-Z][1-9]*$/).nullable().optional()` | — | Single traceability edge (DD-07). |
| `parent_wbs`    | `z.string().regex(/^\d{4}$/).nullable().optional()` | — | Single sub-task convention (X02). |
| `priority`      | `z.enum(['P0','P1','P2','P3']).optional()` | — | Aligned with the feature priority scale. |
| `tags`          | `z.array(z.string()).optional()` | — | Free-form filtering. |
| `dependencies`  | `z.array(z.string()).optional()` | — | Soft WBS refs; `check` warns on dangling. |
| `created_at`    | ISO 8601 string | ✔ | Write-service-owned. |
| `updated_at`    | ISO 8601 string | ✔ | Written **only** by the write service. |

Removed from the legacy schema (A17): `impl_progress` (frozen-state problem), `folder` (derivable from
file location), `preset` (collapsed into `profile`).

### 7.3.2 Feature frontmatter — `featureFrontmatterSchema`

Mirrors `docs/design/rd3-migration-design.md` §2.2. No `parent_id` field (DD-14): the parent is derived
by dropping the last character of `id`.

| Field           | Zod type | Req | Notes |
|-----------------|----------|-----|-------|
| `schema_version`| `z.literal(1)` | ✔ | Same evolution mechanism as tasks. |
| `id`            | `z.string().regex(/^[A-Z][1-9]*$/)` | ✔ | Position-encoding hierarchical ID (DD-14). |
| `name`          | `z.string().min(1)` | ✔ | |
| `status`        | `z.enum(FEATURE_STATUSES)` (transform → lowercase) | ✔ | See §7.3.3; `verifying` is canonical. |
| `priority`      | `z.enum(['P0','P1','P2','P3'])` | ✔ | The P0 feature in `active`/`verifying` is the project goal (B09). |
| `tags`          | `z.array(z.string()).optional()` | — | |
| `created_at`    | ISO 8601 string | ✔ | Write-service-owned. |
| `updated_at`    | ISO 8601 string | ✔ | Write-service-owned. |

### 7.3.3 Canonical status vocabularies

Lowercase canonical values (DD-01); display layers capitalize. Input is case-insensitive and
alias-tolerant. The legacy alias map is preserved as input normalization — never as storage.

| Domain    | Canonical values |
|-----------|------------------|
| `TaskStatus`    | `backlog · todo · wip · testing · blocked · done · cancelled` |
| `FeatureStatus` | `backlog · active · verifying · blocked · done · cancelled` (DD-13) |

Input normalization (excerpt, full map lives in `normalizeTaskStatus` / `normalizeFeatureStatus`):
`completed → done`, `in-progress / in_progress / in progress → wip (task) or active (feature)`,
`dropped / canceled / cancel → cancelled`, `review / in-review / in_review → verifying` (feature only),
`pending / new → backlog`, mixed case accepted via `.trim().toLowerCase()`. Storage is always the
lowercase canonical form; aliases never persist.

### 7.4 Section-Status-Matrix + planning event catalog

**Section-Status-Matrix.** Source: `config/tasks/section-matrix.yaml` (schema:
`apps/cli/schemas/section-matrix.schema.json`). Each variant maps a status →
{ required, optional, forbidden } section lists, evaluated by `spur task check` / `spur feature check`
(the L2 layer, design §3.2). Ships permissive (warning-first); the hard-gate core is the `done`
status (Solution + Testing + Review required, `gate: true`) plus the AC/Solution/Review format rules.
Authority for matrix semantics: design §3 (the L2 layer), delivery §3.2.

**Planning event catalog (X04).** The six planning events on `PlanningEventMap` + three engine-seam
events. All planning events are emitted by `PlanningWriteService` (design §7) and persisted to the
`planning_events` table (append-only ledger, rehydratable from `## History`). SSOT for the names is
the code: `packages/app/src/services/planning-write-service.ts` (`PlanningEventName` union) and
`packages/app/src/services/planning-events.ts` (`PlanningEventMap`). Document, never invent.

| Event | Fired when |
|---|---|
| `task.created` | A task file is created (including each item of a `batch-create`). |
| `task.updated` | Any non-status write to a task (section edit, frontmatter change). |
| `task.transitioned` | A task status change completes through the lifecycle workflow (includes cancellation). |
| `feature.created` | A feature file is created. |
| `feature.updated` | Any non-status write to a feature. |
| `feature.transitioned` | A feature status change completes (includes cancellation). |

Engine-seam events (from `ts-dual-workflow-engine`, per lifecycle/pipeline run — ADR-022):

| Event | Fired when |
|---|---|
| `on_transition` | A workflow run moves between states — the seam planning events derive from. |
| `on_guard_fail` | A guard (e.g. `spur task check` pre-gate) blocks a transition. |
| `on_complete` | A workflow run reaches its terminal state. |

### 7.5 Lifecycle workflow definitions

Source: `config/workflows/task-lifecycle.yaml`, `config/workflows/feature-lifecycle.yaml`.
Authority: ADR-022 (lifecycles are engine configuration — no local FSM); design §2.3 (graphs +
guard placements), §5.1 (skeleton). Both are `kind: state-machine` definitions validated against
the engine schema shipped by the CLI, referenced as
`@gobing-ai/spur/schemas/state-machine-workflow.schema.json` (the schema file lives at
`apps/cli/schemas/state-machine-workflow.schema.json` and is exported via the package's
`./schemas/*` map).

| File | States (§2.3) | Initial | Terminal | Guards |
|------|---------------|---------|----------|--------|
| `task-lifecycle.yaml` | `backlog · todo · wip · testing · blocked · done · cancelled` | `backlog` | `[cancelled]` | `wip→testing`: `spur task check <wbs>`; `testing→done`: `spur task check <wbs> --strict-core` |
| `feature-lifecycle.yaml` | `backlog · active · verifying · blocked · done · cancelled` (DD-13) | `backlog` | `[cancelled]` | `active→verifying`: `spur feature check <id>`; `verifying→done`: `spur feature check <id> --strict` |

Guard commands reference the check verbs (tasks: 0051/0057). The engine integration is **live**:
`spur task update <wbs> <status>` (0055) and `spur feature update <id> <status>` (0059) drive these
graphs through the dual-workflow engine via `LifecycleAdapter` / `FeatureLifecycleAdapter`
(create-or-attach a durable run keyed `task:<wbs>` / `feature:<id>`, file-wins re-seed per DD-04,
then `requestTransition` — a denied guard aborts the write with its report). The feature
`active→verifying` guard is non-blocking (warns when linked tasks aren't all done/cancelled, DD-13);
`verifying→done` is blocking (`feature check --strict`); `verifying→active` is rework (mandatory
History entry). Unconditional transitions use the engine's `always` guard (externally-driven via
`requestTransition`, not auto-advance). `done` is re-enterable (reopen, warned); `cancelled` is
truly terminal (no outgoing transitions).

**Drift prevention:** `packages/domain/tests/planning/lifecycle-drift.test.ts` parses both YAMLs
and asserts state sets == the `TASK_STATUSES` / `FEATURE_STATUSES` unions from `schema.ts`. The
YAML files and the 0041 enums can never drift silently.

Validate: `spur workflow validate config/workflows/task-lifecycle.yaml` — full JSON-Schema
validation resolves the `@gobing-ai/spur` workspace package and passes (no `--no-schema`
needed). `feature-dev.yaml` uses the same resolvable ref.

**Task execution pipeline** — `config/workflows/task-pipeline.yaml` (design §6, ADR-022
"orchestration is configuration": YAML over the existing engine, zero engine code). `kind:
state-machine`, `vars: { wbs, profile }`, shape `precheck → implement → test → review → approve(HITL)
→ verify → record → done` (precheck failure short-circuits to `failed`). Invariants: it never touches
files directly — `precheck` is a `spur task check <wbs>` shell guard; `implement/test/review/verify` are
`agent.run` steps carrying `sp:dev-*` inputs; status moves use the normal `spur task update <wbs>
<status>` verb (so the 0055 lifecycle guards apply); `record` writes `## Testing`/`## Review` only via
`spur task update --section`; `approve` is a `hitl.confirm` gate skippable with `--vars '{"profile":"auto"}'`.
**Follow-up:** `task_run_links` linkage (kind=pipeline, R4) needs a small `WorkflowService` run-start hook
— there is no link-writing CLI verb to call from a shell step, so it can't live in pure YAML.

### 7.6 Task DTOs — reserved

oRPC contract shapes (`TaskDto`, `FeatureDto`, `PlanningEventDto`) land with the server/web design
task (ADR-021.b, delivery §5.3). They are not authored here — domain types stay in their owning
packages; transport DTOs belong in `packages/contracts` when built.
