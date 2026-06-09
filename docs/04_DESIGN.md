# 04 Design — Spur

**Version:** 1.0.0
**Status:** Active
**Derived from:** `docs/03_ARCHITECTURE.md`, current codebase
**Last Updated:** 2026-06-06
**Owner:** Robin Min

The external, user-facing design surface: every CLI command, the config schema, and the persisted
data shapes. Feature-internal design lives in code. When this conflicts with `docs/00_ADR.md`, the
ADR wins.

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

#### `spur agent run <prompt> [--agent <name>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--purpose <text>] [--tags <a,b>] [--system-prompt <text>] [--task <id>] [--drain] [--json]`
Execute a prompt or slash command via a coding agent. `--agent` (default `auto`) selects the first
usable Tier-1 agent; `current` reads `SPUR_AGENT` env var; explicit name resolves directly.
`--continue` resumes the previous session. `--mode text|json` (default `text`) passes output format
to the agent CLI. `--cwd` sets the working directory. `--json` emits a machine-readable envelope
(`{ exitCode: number|null, stdout, stderr, signal?, durationMs }`). Slash commands like
`/plugin:command` are translated per-agent (claude pass-through, codex `$`, pi `/skill:`).
Team-mode identity flags map into the agent's identity preamble: `--purpose`, `--tags` (comma-list),
`--system-prompt`, `--task <id>`. `--drain` resolves the addressed `--agent <id>` as an **agent spec
id** (a different namespace from the coding-agent type), folds that spec's pending inbox messages into
the prompt, and rewrites `--agent` to the spec's underlying type before dispatch (Phase 1-3 has no
live stdin, so prepending is how deferred messages reach the agent).
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
seeds the global layer. A run that resolves **zero rules** exits 1 (fail-loud: a gate that checks nothing is
not a pass). Setting `SPUR_GLOBAL_RULES_DIR` overrides the global root and suppresses the bundled
fallback for a hermetic run. Backed by `ts-rule-engine`.

#### `spur rule validate [--file <path>|--preset <name>|<path>] [--json]` · `spur rule list [--preset <name>] [--json]`
- `validate` — load and normalize a rule file or preset without evaluating it.
- `list` — list the effective rule-file inventory grouped by source layer and category (`local`, `global`,
  and any `SPUR_RULES_PATH` override, deduped by relative path); with `--preset`, list the resolved preset
  rules.
- `help` / `--help` — print the command-scoped rule usage, including subcommands, options, examples,
  and exit codes. `spur help rule` is equivalent.
Backed by `ts-rule-engine`.

#### `spur workflow validate <workflow.yaml> [--json]` · `spur workflow run <workflow.yaml> [--run-id <id>] [--json]` · `spur workflow list [--json]`
- `validate <file>` — load + Zod-validate a workflow definition.
- `run <file> [--run-id <id>]` — execute; prints `<status>: <name> -> <finalState>`; exit 1 unless `done`.
- `list` — list persisted workflow runs.
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
| `spur migrate [--json]` | Temporary helper: apply CLI-owned schema migrations; reports `{ ok, applied }`. |
| `spur help` / `spur version` | Usage / version. |

Per ADR-013, every top-level command module exports its own `helpText()` usage renderer. The
dispatcher imports those renderers with aliases and registers them for `spur <command> --help`,
`spur <command> help`, and `spur help <command>`; global help remains a compact command index.

## 2. Configuration

### 2.1 Project config — `.spur/config.yaml` (ADR-017)
Written by `spur init`. Single YAML config surface; the legacy `.spur/config.json` project marker is
retired. Resolution order: project `.spur/config.yaml` (cwd) → fallback `~/.config/spur/config.yaml`.

Two top-level concerns:
- **Portable `bootstrap:` block** — consumed by `@gobing-ai/ts-infra` `runNodeApplication`. Shared across
  `spur-cli` and (future) `spur-server`. Keys map 1:1 to ts-infra's `LoggingOptions` /
  `TelemetryOptions` / `DatabaseOptions` / `SchedulerOptions`.
- **Spur app section** — everything except `bootstrap:`, validated by a local zod schema
  (`spurAppConfigSchema`). Keys are agent/rules/workflows/redaction/version/name.

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
```

`${ENV_VAR}` interpolation works via `ts-runtime` `interpolateTree` (used inside
`runNodeApplication`).

### 2.2 App config — `@gobing-ai/spur-config` (Zod)
Server/web layer config (`buildConfigFromEnv`):

| Key | Env var | Default |
|-----|---------|---------|
| `database.url` | `DATABASE_URL` | `:memory:` |
| `server.port` | `PORT` | `3000` |
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
| `inbox_messages` | ts-db (`InboxMessageDao`) | Durable inter-agent message queue; indexed on `(to_id, status)`. Added by migration `0001_spur_team_inbox`; composed into `CLI_SCHEMA_SQL` via `INBOX_MESSAGES_SCHEMA_SQL`. |

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
| Server route seam | Removed | `mountPluginRoutes` / `collectPluginOpenApiPaths` — re-addable when plugins exist |
| Plugin config override | Removed | Per-plugin `.spur/plugins/<name>.yaml` — re-addable |
| Event registry | Removed | Glob-pattern + rate-limiting wrapper over `EventBus` — re-addable |
