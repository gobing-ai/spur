# spur history

> Import and analyze coding-agent session history. Keeps raw data in files; the DB holds only
> validated ETL rows, an import ledger, and per-file checkpoints.

## Subcommands

| Subcommand | Description |
|---|---|
| `import` | Import session history from a JSONL file or a history root |
| `analyze` | Summarize imported history |
| `report` | Reporting surface (implementation deferred — TODO marker) |

## spur history import

```
spur history import [options]
```

| Flag | Default | Description |
|---|---|---|
| `--source <source>` | `pi` | One of `pi`, `claude`, `codex`, `gemini`, `opencode`, `antigravity`, `openclaw` |
| `--file <path>` | — | Import one JSONL file |
| `--root <path>` | — | Scan a history root for sessions |
| `--mode <mode>` | — | `full`, `incremental`, or `force-file` |
| `--dry-run` | — | Scan without persisting imported records |
| `--json` | — | Output machine-readable JSON where supported |

### Example

```bash
spur history import --source claude --root ~/.claude/projects --mode incremental
spur history import --source codex --file ./session.jsonl --dry-run
```

## spur history analyze

```
spur history analyze [options]
```

| Flag | Description |
|---|---|
| `--since <iso-date>` | Lower bound for analysis |
| `--json` | Output machine-readable JSON where supported |

### Example

```bash
spur history analyze --since 2026-06-01
```

## spur history report

```
spur history report [--json]
```

> Reporting is a TODO marker — the verb is registered but its implementation is deferred.

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — history import + analytics.
