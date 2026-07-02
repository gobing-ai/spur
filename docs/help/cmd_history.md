# spur history

> Import and analyze coding-agent session history. Keeps **raw data in files**; the DB
> holds only validated ETL rows, an import ledger, and per-file checkpoints. Backed by
> `@gobing-ai/ts-llm-jsonl-importer`.

## Subcommands

| Subcommand | Description |
|---|---|
| `import` | Import session history from a JSONL file or a history root |
| `analyze` | Aggregate imported ETL records into token/cost analytics |
| `report` | Reporting surface (implementation deferred — prints a TODO marker) |

## spur history import

```
spur history import [options] --source <source>
```

| Flag | Default | Description |
|---|---|---|
| `--source <source>` | `pi` | One of `pi`, `claude`, `codex`, `gemini`, `opencode`, `antigravity`, `openclaw` |
| `--file <path>` | — | Import one JSONL file |
| `--root <path>` | — | Scan a history root for sessions |
| `--mode <mode>` | `incremental` (root) / `force-file` (single file) | `full`, `incremental`, or `force-file` |
| `--dry-run` | — | Scan without persisting imported records |
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
spur history analyze [--since <iso-date>] [--json]
```

| Flag | Description |
|---|---|
| `--since <iso-date>` | Lower bound for analysis |
| `--json` | Output machine-readable JSON |

Aggregates imported ETL records from the `history_etl_*` tables into token/cost analytics
(totals + per-source + per-model + daily). Estimates cost from per-model pricing.

### Example

```bash
spur history analyze --since 2026-06-01 --json
```

## spur history report

```
spur history report [--json]
```

> **Reserved CLI surface** for richer history reports. Currently prints a TODO marker so
> migration can stabilize before the report implementation is designed.

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.5 History Analytics
- `docs/04_DESIGN.md` — §1.1 `spur history` import / analyze / report
