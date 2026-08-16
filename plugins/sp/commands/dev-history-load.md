---
description: "On-demand cumulative history load + narrowed analyze: run spur history import (checkpoint-resume, additive) then spur history analyze, optionally narrowed to a session/task/window, with optional forensics render. Triggers: load history, import agent conversations, analyze my history, history for this conversation"
role: scribe
argument-hint: "[--source <name>] [--session <id>] [--task <wbs>] [--since <iso>] [--until <iso>] [--report] [--dry-run] [--json]"
allowed-tools: ["Bash", "Read"]
---

# Dev History Load

Runs the on-demand history load+analyze sequence: `spur history import` (all sources, checkpoint
resume — additive and self-healing) then `spur history analyze`, with narrowing flags routed to the
verb that accepts them. Wraps the shipped CLI sequence in one discoverable surface; owns no import
logic, no state, and no cadence.

## Argument Flags

| Flag                 | Description                                                    | Default  |
| -------------------- | -------------------------------------------------------------- | -------- |
| `--source` `<name>`  | Agent source to import and analyze (both verbs).               | all      |
| `--session` `<id>`   | Narrow the analyze to a single session id.                     | omitted  |
| `--task` `<wbs>`     | Narrow the analyze to a single task WBS.                       | omitted  |
| `--since` `<iso>`    | Inclusive lower bound on the analyze window.                   | omitted  |
| `--until` `<iso>`    | Inclusive upper bound on the analyze window.                   | omitted  |
| `--report`           | Render `spur history report --mode forensics` after analyze.   | off      |
| `--dry-run`          | Preview the sequence; import scans without persisting.         | off      |
| `--json`             | Emit one JSON result object; no banner text interleaved.       | off      |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-history-load
/sp:dev-history-load --source omp --session <session-id>
/sp:dev-history-load --task <wbs> --since 2026-08-01 --until 2026-08-15
/sp:dev-history-load --report
/sp:dev-history-load --dry-run
/sp:dev-history-load --json
```

**Cumulative by checkpoint, not by this command.** Re-running imports only newly appended
conversation data — the shipped import checkpoint resume (task 0470 R6) makes repeat runs additive
and never double-counts. This command never prunes reports and never re-implements the daily
pipeline; for the periodic cadence (import-all → analyze → artifact → 90-day prune, self-healing),
run `spur history daily` instead.

**Fail-hard on a degraded source (deliberate).** Any non-zero import exit — including exit 2 for a
mixed/degraded fan-out — aborts the sequence before analyze and propagates the exit code. If one
source is steady-state degraded (e.g. corrupt transcript chunks in a tool's own logs), a bare run
never completes; scope the run with `--source <name>` (repeat per source as needed), or use
`spur history daily`, whose fan-out treats degraded sources as non-fatal.

## Implementation

Run the load-then-analyze sequence per `plugins/sp/scripts/history-load.ts` — import first, analyze
only after import exits 0, narrowing forwarded to `analyze` only:

```
bun plugins/sp/scripts/history-load.ts $ARGUMENTS
```
