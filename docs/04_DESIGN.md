# 04 Design — Spur

**Version:** 1.0.0
**Status:** Active
**Derived from:** `docs/03_ARCHITECTURE.md`, current codebase
**Last Updated:** 2026-05-30
**Owner:** Robin Min

The external, user-facing design surface: every CLI command, the config schema, and the persisted
data shapes. Feature-internal design lives in code. When this conflicts with `docs/00_ADR.md`, the
ADR wins.

## 1. CLI Surface

All commands accept `--json` for machine-readable output and return a meaningful exit code. The
binary is `spur` (`apps/cli/src/index.ts`, run under Bun).

### 1.1 Committed product commands

#### `spur init [--name <name>] [--json]`
Scaffold a local Spur project. Writes `.spur/config.json` and records the config artifact.

#### `spur agent run <prompt> [--agent <name>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--json]`
Execute a prompt or slash command via a coding agent. `--agent` (default `auto`) selects the first
usable Tier-1 agent; `current` reads `SPUR_AGENT` env var; explicit name resolves directly.
`--continue` resumes the previous session. `--mode text|json` (default `text`) passes output format
to the agent CLI. `--cwd` sets the working directory. `--json` emits a machine-readable envelope
(`{ exitCode: number|null, stdout, stderr, signal?, durationMs }`). Slash commands like
`/plugin:command` are translated per-agent (claude pass-through, codex `$`, pi `/skill:`).
Exit 0 on success, 1 on agent-not-found, 2 on invalid arguments, 3 on agent execution failure.

#### `spur agent list [--json]`
Detect installed agents; prints `ok|missing <name> [version]`. Backed by `ts-ai-runner`
`AgentDetector`. Agents: claude, codex, gemini, pi, opencode, antigravity, openclaw.

#### `spur agent doctor [agent] [--json]`
Readiness check per agent; prints `usable|needs-auth|missing <agent> tier=<n> [version]`.
Exit 1 if any **tier-1** agent is not usable. Backed by `ts-ai-runner` `DoctorRunner`.

#### `spur rule run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>] [--json]`
Evaluate constraint rules over the working tree. `--preset` (default `recommended`) or `--file` for
an ad-hoc rule file; `--rule <id>` filters to one rule. `--fail-on error|warning|info` (default
`error`) sets the exit-1 threshold. Backed by `ts-rule-engine`.

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
| `spur status [path] [--json]` | Project health: config present, package.json present, git context; optional path metadata (size, isFile, isDirectory). |
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
