# spur workflow

Validate and execute workflow YAML files: multi-step pipelines declared as state machines —
implement/check/fix loops, the single-task pipeline, feature umbrellas, ideation and wrap-up
phases.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `validate <file>` | Validate a workflow definition |
| `run <file>` | Execute a workflow definition |
| `show <file>` | Render a definition: mermaid diagram (default) or todo checklist |
| `continue [run-id]` | Resume a paused (HITL) workflow run |
| `cancel <run-id>` | Cancel a single non-terminal run by id |
| `list` | List available workflow YAML files |
| `trace [run-id]` | Show persisted workflow run history |
| `progress <run-id>` | Project a run's structured progress: current state, action attempts, next transitions |
| `clean` | Housekeeping: finalize stale runs and reclaim retained logs |

## spur workflow validate

```bash
spur workflow validate <file> [--no-schema] [--json]
```

Schema plus semantic validation. Use it as the gate after editing any workflow YAML:

```bash
spur workflow validate .spur/workflows/basic.yaml --json
```

## spur workflow run

```bash
spur workflow run <file> [--run-id <id>] [--vars <json>] [--dry-run] [--async]
spur workflow run [--no-plan] [--quiet] [--silent] [--verbose] [--detail <level>]
spur workflow run [--trace-file] [--no-log] [--steer] [--json]
```

| Flag | Description |
| --- | --- |
| `--run-id <id>` | Persisted run id for the workflow run |
| `--vars <json>` | Per-run variable overrides as a JSON object |
| `--dry-run` | Validate and walk transitions without executing actions |
| `--async` | Start in a detached background process; monitor with `trace` |
| `--no-plan` | Suppress the run-start plan preview (synchronous runs only) |
| `--quiet` | Suppress plan and per-step progress; keep the final summary |
| `--silent` | Suppress all routine output; errors still set a non-zero exit |
| `--verbose` | Include transitions and correlation diagnostics |
| `--detail <level>` | Human detail: `minimal` \| `invocation` \| `full` |
| `--trace-file` | Append a redacted JSONL trace under `.spur/workflow/` |
| `--no-log` | Skip the consolidated `.spur/run/<RUNID>.log` |
| `--steer` | Accept in-process steering commands on stdin at action boundaries |

```bash
spur workflow run .spur/workflows/task-pipeline.yaml --vars '{"wbs":"0010"}'
spur workflow run .spur/workflows/basic.yaml --dry-run --json
spur workflow run .spur/workflows/task-pipeline.yaml --vars '{"wbs":"0010"}' --async
```

> **Three gotchas, learned the hard way:**
>
> - `--vars` takes a **JSON object** — there is no `--var key=value` form.
> - `--vars` values must be **strings** — pass lists as JSON strings:
>   `--vars '{"tasks":"[\"0010\",\"0011\"]"}'`.
> - Output flags are exclusive: `--quiet` and `--verbose` cannot combine; `--silent` combines
>   with neither; `--steer` cannot combine with `--json` or `--async` (all exit `2`).

Synchronous human runs print a plan preview and live per-step progress (both suppressed under
`--json` and on `--async`). `status` in the result JSON is authoritative: `done` → exit 0, any
other terminal → non-zero.

## spur workflow show / list

```bash
spur workflow show <file> [--format <name>] [--json]
spur workflow list [--json]
```

`show` renders a definition read-only: a mermaid FSM diagram by default, or a declared-step
checklist with `--format todo`. `list` enumerates workflow YAML files from the configured
`workflows.paths` — shipped installs resolve the package's `bundled:workflows` layer, and the
unconfigured fallback is `.spur/workflows/`. A project YAML dropped into `.spur/workflows/` is
invisible to `list` until you add that path to config, though `workflow show <name>` still
finds it via its project-then-bundled name probe.

## spur workflow continue

```bash
spur workflow continue [run-id] [--yes] [--force] [--answer <yes|no|cancel>] [--json]
```

Resume a paused (HITL) run; omit the id to take the most recent paused run. The three flags do
different jobs: `--yes` skips only the CLI confirmation, `--answer` injects the HITL gate answer
before guards re-evaluate (it does **not** imply `--yes`), and `--force` proceeds despite
workflow-definition drift.

```bash
spur workflow continue <run-id> --yes --answer yes
```

## spur workflow cancel / clean / trace

```bash
spur workflow cancel <run-id> [--json]
spur workflow clean [--older-than <minutes>] [--force] [--logs] [--dry-run] [--json]
spur workflow trace [run-id] [--workflow <name>] [--status <status>] [--since <iso-date>]
spur workflow trace [--last <n>] [--follow] [--poll <ms>] [--output] [--json]
```

`cancel` stops one non-terminal run by id (a live async worker's process group is SIGTERMed).
`clean` is the bulk/stale variant: finalize runs stuck past `--older-than` minutes (default 30)
and reclaim retained logs (`--logs` scopes to logs only; `--force` takes everything non-terminal;
`--dry-run` lists without writing). `trace` is the observability verb — recent runs, one run's
timeline, or `--follow` polling a live run until terminal (`--output` streams the run log
instead).

```bash
spur workflow trace <run-id> --follow
spur workflow clean --older-than 60 --dry-run
```

## spur workflow progress

```bash
spur workflow progress <run-id> [--json]
```

Read-only projection of one run: the current state, every declared action with its recorded
attempts, and the candidate next transitions. The projection is computed in `packages/app`
(`projectWorkflowProgress`) and the verb only renders it, so `--json` is the projection itself.
A running or incomplete run exits `0` and prints unanswered values as `unknown`; an unknown
run id exits `1` with `Run <run-id> not found.`

```bash
spur workflow progress <run-id> --json
```

## See also

- [Daily development workflow](./daily-development-workflow.md) — pipelines in the loop
- [task](./task.md) — the entity the task pipeline drives

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: workflow.txt + verbs/workflow_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
