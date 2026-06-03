# 04 Design — Spur

**Version:** 1.0.0
**Status:** Active
**Derived from:** `docs/03_ARCHITECTURE.md`, current codebase
**Last Updated:** 2026-06-03
**Owner:** Robin Min

The external, user-facing design surface: every CLI command, the config schema, and the persisted
data shapes. Feature-internal design lives in code. When this conflicts with `docs/00_ADR.md`, the
ADR wins.

## 1. CLI Surface

All commands accept `--json` for machine-readable output and return a meaningful exit code. The
binary is `spur` (`apps/cli/src/index.ts`, run under Bun).

### 1.1 Committed product commands

#### `spur init [--name <name>] [--force] [--minimal] [--json]`
Scaffold a local Spur project. Writes `.spur/config.json` and records the config artifact. Unless
`--minimal`, also creates `.spur/rules/` (with `recommended.yaml` + `spur-dev.yaml` presets) and
`.spur/workflows/basic.yaml`. Always creates `.spur/agents/` (with a `.gitkeep`) for team-mode agent
specs, regardless of `--minimal`. On first run it seeds `~/.config/spur/rules/` from the presets
bundled with `@gobing-ai/ts-rule-engine` (existing files are never overwritten), so `spur rule run
--preset recommended` resolves a real ruleset from any project. Re-running is blocked (exit 1) unless
`--force` is given, preventing a stray `init` from clobbering a configured project. `--json` emits
`{ ok, project, config, created[], skipped[], globalRulesSeeded }`.

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

#### `spur agent create <id> --type <agent-type> [flags]` · `spur agent edit <id>` · `spur agent delete <id> [--force]`
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

#### `spur rule run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>] [--json]`
Evaluate constraint rules over the working tree. `--preset` (default `recommended`) or `--file` for
an ad-hoc rule file; `--rule <id>` filters to one rule. `--fail-on error|warning|info` (default
`error`) sets the exit-1 threshold. Rule roots resolve highest-priority-first: `SPUR_RULES_PATH`,
local `.spur/rules`, the user-global `~/.config/spur/rules`, then the presets bundled with
`ts-rule-engine` as a fallback so `recommended` works before `spur init` seeds the global layer. A
run that resolves **zero rules** exits 1 (fail-loud: a gate that checks nothing is not a pass).
Setting `SPUR_GLOBAL_RULES_DIR` overrides the global root and suppresses the bundled fallback for a
hermetic run. Backed by `ts-rule-engine`.

#### `spur rule validate [--file <path>|--preset <name>|<path>] [--json]` · `spur rule list [--preset <name>] [--json]`
- `validate` — load and normalize a rule file or preset without evaluating it.
- `list` — list discovered local rules from `.spur/rules`; with `--preset`, list the resolved preset rules.
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

## 2. Configuration

### 2.1 Project config — `.spur/config.json`
Written by `spur init`:
```json
{ "version": 1, "project": "<name>", "database": ".spur/spur.db", "generatedBy": "@gobing-ai/spur-cli" }
```

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

## 6. Plugin System (Design — deferred, no code shipped; ADR-012)

> Forward design only. The shapes below are the SDK/loader contract ADR-012 commits to; they become
> active as Phase-5 slices land. Mechanism lives in `03 §11`.

All plugin files are **YAML**, validated by a per-file-type Zod schema (the SSOT for that file) —
one format across the project, no new parser. A file is never consumed unvalidated; `safeParse`
failures surface in the loader's `validate()` step (bad **bundled** → fail-fast, bad `local` →
logged and skipped).

### 6.1 Manifest — `plugin.yaml` (`PluginManifestSchema`)

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Unique plugin id. |
| `version` | semver string | Plugin version. |
| `trust` | enum | `bundled` \| `curated` \| `local` \| `untrusted`. |
| `capabilities` | record | Declared capabilities by kind (command, api, ui, event, harness, provider, rule, skill/worker). A plugin may register only what it declares and its tier permits. |
| `allow` | block (optional) | Declared resource grants (forward-looking; not runtime-enforced in Phase 1). |

### 6.2 Config override — `.spur/plugins/<name>.yaml` (`PluginConfigSchema`)

Per-plugin override layer, validated (by `PluginConfigSchema` or a plugin-supplied `configSchema`)
**before** merge over the plugin's defaults.

### 6.3 Trust ladder

`bundled` > `curated` > `local` > `untrusted`. Used for **registration-time capability gating**
only. `bundled` is never gated. `untrusted` is **not loaded** (fail-closed). Runtime sandboxing is
out of scope (PRD §5.4).
