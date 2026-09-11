# spur history

Import and analyze coding-agent history: conversation JSONL from supported agent sources becomes
a local SQLite corpus you can query for spend, cache efficiency, and per-task forensics.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `import` | Import agent conversation JSONL (`--source all` fans out with per-source isolation) |
| `analyze` | Aggregate imported history into a versioned JSON artifact |
| `reset` | Destructively wipe every history table (requires `--yes`) |
| `report` | Render a previously generated artifact as a spend + forensic report |
| `daily` | Run-once pipeline: import-all → analyze → write artifact → prune old reports |

## spur history import

```bash
spur history import [--source <source>] [--file <path>] [--root <path>] [--mode <mode>]
spur history import [--dry-run] [--source-timeout <ms|none>] [--json]
```

| Flag | Description |
| --- | --- |
| `--source <source>` | `pi` \| `claude` \| `codex` \| `gemini` \| `opencode` \| `antigravity` \| `openclaw` \| `omp` \| `grok` \| `agy` \| `all` (default: `all`) |
| `--file <path>` | Import one JSONL file (single-source only) |
| `--root <path>` | Scan a history root directory |
| `--mode <mode>` | `full` \| `incremental` \| `force-file` |
| `--dry-run` | Scan without persisting |
| `--source-timeout <ms\|none>` | Per-source timeout (default 600000 = 10 min) |

`--source all` is the fan-out: every source imports under per-source failure isolation, so one
broken log never blocks the rest. A single `--source` is the n=1 case of the same contract.

```bash
spur history import                          # everything, checkpointed
spur history import --source claude --root ~/.claude/projects/
spur history import --source pi --file ./session.jsonl --mode incremental
```

## spur history analyze

```bash
spur history analyze [--since <iso>] [--until <iso>] [--source <source>] [--session <id>]
spur history analyze [--run <runId>] [--task <wbs>] [--top <n>] [--out <path>] [--json]
```

Aggregates the imported corpus through the forensic query set and writes a versioned JSON
artifact. Narrow with `--task <wbs>` (via task-run links), `--session`, or `--run`;
`--top` sets leaderboard depth; `--out` redirects the artifact path.

## spur history report

```bash
spur history report [path] [--task <wbs>] [--top <n>] [--json]
```

Pure renderer of an analyze artifact — it never opens the database. Pass an artifact `path` or
let it pick the latest; `--task` and `--top` narrow the already-loaded artifact client-side.

## spur history daily

```bash
spur history daily [--since <iso>] [--until <iso>] [--root <path>] [--mode <name>]
spur history daily [--source-timeout <ms|none>] [--json]
```

The run-once daily pipeline: import-all (checkpoint resume — a missed night self-heals on the
next run) → analyze → write artifact → prune reports older than 90 days. `--mode forensics`
additionally renders the artifact as a markdown sidecar.

## spur history reset

```bash
spur history reset [--yes] [--json]
```

Destructively wipes every history table (normalized rows, ETL state, rollups, checkpoints).
Requires `--yes`. Task corpus and run provenance are untouched; a full `spur history import`
rebuilds everything.

> **POLA:** import is incremental and checkpointed — re-running `import` or `daily` never
> double-counts. `reset` is the only destructive verb in this noun.

## See also

- [Daily development workflow](./daily-development-workflow.md) — history in the loop

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: history.txt + verbs/history_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
