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
| `reset` | Destructively wipe every history table (requires `--yes`); task corpus and run provenance are untouched |
| `anatomy <op>` | history-anatomy report cache ops (digest, check, paths, assert-clean, probe, stamp, refresh, publish) behind the `history-anatomy` workflow |
| `timeline` | Per-prompt work/wait time and tokens from the host transcript (JSON) for `sp:session-review` |
| `summary` | Daily summary report: tokens (ccusage), git activity, history health, annotations |

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
| `--capability-origin <spec>` | — | Classify imported skill calls (repeatable): `source:skillName:artifactDigest:capabilityKind:originIdentity` where capabilityKind is one of `command`, `subagent`, `skill` |
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

## spur history reset

```
spur history reset [options]
```

| Flag | Description |
|---|---|
| `--yes` | Confirm the destructive wipe |
| `--json` | Output machine-readable JSON |

Destructively wipe every `history_*` table: normalized rows, per-source ETL, board rollups,
daily stats, and importer checkpoints/ledger. The task corpus and run provenance
(`task_run_links`) are untouched; a full `spur history import` rebuilds everything.

## spur history anatomy

```
spur history anatomy <op> [op flags...]
```

| Argument | Description |
|---|---|
| `op` | `digest <artifact.json>` · `check <report.md>` · `paths --out <env> [--skill-dir d] [--helper p] ...` · `assert-clean --baseline <porcelain> [--expect p]` · `probe --artifact a --target t ...` · `stamp --candidate c --provenance p --out o` · `refresh --report r --out o` · `publish <candidate.md> <target.md>` |

Deterministic cache ops behind the `history-anatomy` workflow (ADR-079; absorbed from the retired
`history-anatomy-cache` plugin script, script-absorption PR-6). Each op keeps its own argv grammar.
`paths` records the running spur as `HA_HELPER` (so a spur upgrade invalidates the cache) and resolves
`HA_SKILL` from `--skill-dir`, else `plugins/sp/skills/history-anatomy` under the cwd, else the
superskill install (`~/.agents/skills/sp-history-anatomy`, `~/.claude/skills/sp-history-anatomy`).
Exit: `0` ok, `1` usage or op failure (`check` prints `PASS` or `FAIL` plus one line per finding).

## spur history timeline

```
spur history timeline [--transcript <path>] [--group <spec>]
```

| Flag | Description |
|---|---|
| `--transcript <path>` | Transcript JSONL path (default: the active host session) |
| `--group <spec>` | Sum segments into stages, e.g. `"1-3,4"` |

Reads the host transcript read-only (`--transcript`, else `CLAUDE_CODE_SESSION_ID` under
`~/.claude/projects`, else `PI_SESSION_FILE`) and prints one JSON timeline: a segment per operator
prompt with work time, operator wait, tool calls and tokens (total / non-cached). No transcript →
`{"available":false,"reason":...}`, exit `0`. Exit `2`: invalid `--group` or unreadable transcript.

## spur history summary

```
spur history summary [--date <date>] [--dry-run] [--output <path>] [--no-git] [--no-ccusage]
```

| Flag | Description |
|---|---|
| `--date <date>` | `YYYY-MM-DD`, `today` or `yesterday` (default: today) |
| `--dry-run` | Print the summary without writing the file |
| `--output <path>` | Write to a custom path |
| `--no-git` | Skip git history collection |
| `--no-ccusage` | Skip token usage collection |

The `sp:daily-summary` report: ccusage token usage, the day's git activity, the history-health
findings from the project `.spur/spur.db`, and operator annotations (prompted unless
`SP_DAILY_SUMMARY_NO_PROMPT=1`; non-TTY stdin supplies the three answers as lines). Writes
`docs/daily/summary_<YYYYMMDD>.md` (or `--output`). Exit `0` written, `1` generation failed.

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.5 History Analytics
- `docs/04_DESIGN.md` — §1.1 `spur history` import / analyze / report
