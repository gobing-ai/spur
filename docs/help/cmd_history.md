# spur history

> Import and analyze coding-agent session history. Keeps **raw data in files**; the DB
> holds only validated ETL rows, an import ledger, and per-file checkpoints. Backed by
> `@gobing-ai/ts-llm-jsonl-importer`.

## Subcommands

| Subcommand | Description |
|---|---|
| `import` | Import session history from a JSONL file or a history root (`--source all` fans out with per-source failure isolation) |
| `analyze` | Aggregate imported history with SQL and write a versioned JSON artifact (Q1-Q10 forensic query set) |
| `report` | Render a previously-generated artifact as a spend + forensic report (pure renderer — never opens the DB) |
| `daily` | Run-once daily pipeline: import-all → analyze → write artifact → prune reports older than 90 days |

## spur history import

```
spur history import [options] --source <source>
```

| Flag | Default | Description |
|---|---|---|
| `--source <source>` | `all` | One of `pi`, `claude`, `codex`, `gemini`, `opencode`, `antigravity`, `openclaw`, `omp`, `grok`, `agy`, `all` |
| `--file <path>` | — | Import one JSONL file |
| `--root <path>` | — | Scan a history root for sessions |
| `--mode <mode>` | `incremental` (root) / `force-file` (single file) | `full`, `incremental`, or `force-file` |
| `--dry-run` | — | Scan without persisting imported records |
| `--source-timeout <ms>` | — | Per-source timeout when fanning out across sources |
| `--json` | — | Output machine-readable JSON |

Reports scanned files, processed lines, imported/duplicate records, parse/validation errors.
Exit 1 if any errors. Backed by `ts-llm-jsonl-importer`.

### Example

```bash
spur history import --source claude --root ~/.claude/projects --mode incremental
spur history import --source codex --file ./session.jsonl --dry-run
spur history import --source gemini --root ~/.gemini/sessions/ --mode full
```

## spur history analyze

```
spur history analyze [options]
```

| Flag | Description |
|---|---|
| `--since <iso>` | Inclusive lower bound on message timestamp |
| `--until <iso>` | Inclusive upper bound on message timestamp |
| `--source <source>` | Narrow to one source (default `all`) |
| `--session <id>` | Narrow to a single session id |
| `--run <runId>` | Narrow to a single workflow run id |
| `--task <wbs>` | Narrow to a single task WBS |
| `--top <n>` | Leaderboard depth for byTool/bySession (default 20) |
| `--out <path>` | Write the artifact to this path instead of the dated reports dir |
| `--json` | Emit the artifact as JSON instead of the human summary |

Aggregates imported history into token/cost analytics (totals + per-source + per-model + daily)
and writes a versioned JSON artifact that `report` renders. Estimates cost from per-model pricing.

### Example

```bash
spur history analyze --since 2026-06-01 --json
spur history analyze --task 0564 --top 10
```

## spur history report

```
spur history report [options] [path]
```

Renders a previously-generated analyze artifact as a spend + forensic report. Pure renderer —
never opens the database. `path` defaults to the `latest.json` pointer.

| Flag | Description |
|---|---|
| `--mode <name>` | Report mode: `default` \| `forensics` (registry-resolved; unknown names fail) |
| `--task <wbs>` | Narrow to a single task WBS the artifact was analyzed with |
| `--top <n>` | Leaderboard depth for byTool/bySession (re-slices the artifact) |
| `--json` | Emit the parsed artifact as JSON instead of the human report |

`--task` / `--top` narrow the already-loaded artifact client-side; a missing or mismatched
task dimension is an explicit error, never a silent unfiltered render.

## spur history daily

```
spur history daily [options]
```

Run-once daily pipeline: import-all (fan-out, per-source isolation) → analyze → write artifact →
prune reports older than 90 days. Import uses checkpoint resume, so a missed night self-heals on
the next run with no gap and no double-count.

| Flag | Description |
|---|---|
| `--since <iso>` / `--until <iso>` | Bound the import/analyze window |
| `--root <path>` | History root override |
| `--source-timeout <ms>` | Per-source timeout |
| `--mode <name>` | Report mode sidecar pass-through (`default` \| `forensics`) |
| `--json` | Output machine-readable JSON |

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.5 History Analytics
- `docs/04_DESIGN.md` — §1.1 `spur history` import / analyze / report
