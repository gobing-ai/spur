---
name: spur-cli-history
description: "spur-cli noun reference: operate `spur history` to import coding-agent transcripts, aggregate versioned forensic artifacts, render an artifact without database access, or run the checkpoint-resumed daily pipeline."
see_also:
  - spur-cli
---

# spur history - local forensic analytics

`spur history` is the local history data plane: import transcripts into SQLite, aggregate a
versioned artifact, render that artifact, or run the daily composition. Command registration and
CLI guards live in `apps/cli/src/commands/history.ts` (`registerHistoryCommand`); payload contracts
live in `packages/app/src/services/history-service.ts` (`FanOutResult`, `DailyResult`,
`HistoryService`, `runHistoryReport`) and `packages/domain/src/analytics/artifact.ts`
(`HistoryArtifact`).

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `import` | Import one source or fan out across all supported sources | `--source <source>` `--file <path>` `--root <path>` `--mode <mode>` `--dry-run` `--source-timeout <ms>` `--json` |
| `analyze` | Aggregate imported rows and write a versioned forensic artifact | `--since <iso>` `--until <iso>` `--source <source>` `--session <id>` `--run <runId>` `--task <wbs>` `--top <n>` `--out <path>` `--json` |
| `report [path]` | Purely render an existing artifact; default to `latest.json` | `--mode <name>` `--task <wbs>` `--top <n>` `--json` |
| `daily` | Run import-all → analyze → artifact → 90-day report pruning once | `--since <iso>` `--until <iso>` `--root <path>` `--source-timeout <ms>` `--mode <name>` `--json` |

Every JSON-capable verb also advertises `--json-envelope`; use the facade's machine-output contract.

## `import` - isolated fan-out

```bash
bun run apps/cli/src/index.ts history import --source all --dry-run --json
bun run apps/cli/src/index.ts history import --source codex --mode incremental --json
bun run apps/cli/src/index.ts history import --source codex --file session.jsonl --mode force-file --json
```

- `--source all` and a single source use the same per-source fan-out path. A failed/timed-out source
  does not abort its siblings.
- Modes are `incremental`, `full`, and `force-file`. `--file` with the default `all` source is a
  usage error. `--file --mode full` requires `--dry-run`; use `force-file` for a real single-file
  write.
- JSON contains `entries`, `warnings`, `exitCode`, and CLI/importer `provenance`. For real-data
  validation, invoke the source-local CLI and record that provenance; never trust a bare global
  `spur` that may be stale.
- Exit `0` when every source is clean/empty, `2` for a mixed failure or any degraded source, and `1`
  when all sources fail. CLI usage guards also exit `1` on this noun.

## `analyze` - artifact writer

`analyze` performs SQL aggregation over imported history and writes a stable, versioned
`HistoryArtifact`. Selectors combine with AND. `--top` bounds leaderboards, not totals. `--out`
overrides the dated report path; otherwise the service writes under `.spur/reports/history/` and
updates `latest.json`. Human mode renders a summary; `--json` emits the artifact.

## `report` - pure artifact renderer

`report` never opens the database. It reads an explicit artifact or the `latest.json` pointer,
validates the schema version, optionally narrows the loaded artifact with `--task` / `--top`, and
renders `default` or `forensics` mode. Unknown modes, invalid `--top`, missing/mismatched task
dimensions, missing artifacts, and schema mismatches exit `1` instead of silently widening output.

## `daily` - run-once composition

`daily` runs incremental import-all, analyze, artifact write, and report-directory pruning in one
process. `--since` / `--until` scope analysis only, not import. Checkpoints make a missed run resume
without double-counting. The result carries `{ fanOut, artifact, pruned, coverage, reportPath? }`;
its exit code is the fan-out exit code. `--mode` adds a rendered sidecar after analysis.

For the full artifact and data-plane contracts, use `docs/04_DESIGN.md` history sections and
`docs/design/history-data-processing.md`; do not infer fields from rendered prose.
