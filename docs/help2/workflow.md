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
| `summary` | Measured execution summary of runs, or a batch roll-up |
| `profile <workflow>` | Per-node step profile of the last N runs with cache-window flags |
| `cost` | Per-workflow wall-clock/cost from real runs; with `--budget`, the pipeline budget gate |
| `clean` | Housekeeping: finalize stale runs and reclaim retained logs |
| `inline <op>` | Inline pipeline driver transport: run lifecycle, trace rows, decide, persist-out/check, dispatch |
| `commit-guard <op>` | Stage only the paths this run wrote (`start` / `stage` / `check`) |

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
| `--from <state-id>` | Start a fresh run at this state/node (must be declared `startable: true`) instead of the entry point |
| `--from-run <run-id>` | With `--from`: inherit the source run's effective vars and record lineage |
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
spur workflow continue [run-id] [--yes] [--force] [--answer <yes|no|cancel>] [--answer-text <text>] [--json]
```

Resume a paused (HITL) run; omit the id to take the most recent paused run. The three flags do
different jobs: `--yes` skips only the CLI confirmation, `--answer` injects the HITL gate answer
before guards re-evaluate (it does **not** imply `--yes`; `--answer-text` answers a pending
input gate with free text), and `--force` proceeds despite
workflow-definition drift.

```bash
spur workflow continue <run-id> --yes --answer yes
```

## spur workflow cancel / clean / trace

```bash
spur workflow cancel <run-id> [--json]
spur workflow clean [--older-than <minutes>] [--force] [--logs] [--dry-run] [--json]
spur workflow trace [run-id] [--workflow <name>] [--status <status>] [--since <iso-date>]
spur workflow trace [--last <n>] [--follow] [--poll <ms>] [--output] [--timeout <ms>] [--json]
```

`cancel` stops one non-terminal run by id (a live async worker's process group is SIGTERMed).
`clean` is the bulk/stale variant: finalize runs stuck past `--older-than` minutes (default 30)
and reclaim retained logs (`--logs` scopes to logs only; `--force` takes everything non-terminal;
`--dry-run` lists without writing). `trace` is the observability verb — recent runs, one run's
timeline, or `--follow` polling a live run until terminal (`--output` streams the run log
instead; `--timeout` sets a caller deadline in milliseconds).

```bash
spur workflow trace <run-id> --follow
spur workflow clean --older-than 60 --dry-run
```

## spur workflow summary

```bash
spur workflow summary (--progress <[label=]file>... | --rollup <[label=]file>...) [--transcript <path>] [--since <iso>] [--markdown]
```

| Flag | Description |
| --- | --- |
| `--progress <[label=]file>` | Progress JSON of a run (repeatable) |
| `--rollup <[label=]file>` | Close-written `<run>-summary.json` (repeatable; excludes `--progress`) |
| `--transcript <path>` | Transcript JSONL path (default: the active host session) |
| `--since <iso>` | Measure from this instant |
| `--markdown` | Render the Markdown table instead of JSON |

## spur workflow profile

```bash
spur workflow profile <workflow> [--last <n>] [--window <sec>] [--spur-bin <cmd>] [--json]
```

| Flag | Description |
| --- | --- |
| `--last <n>` | Recent done runs to sample (default 20) |
| `--window <sec>` | Cache window in seconds (default 300) |
| `--spur-bin <cmd>` | spur invocation for the trace reads |
| `--json` | Output machine-readable JSON |

## spur workflow cost

```bash
spur workflow cost [--workflow <name>]... [--by-state] [--include-bookkeeping] [--since <YYYY-MM-DD>] [--budget <file>] [--measured-file <json>] [--json]
```

| Flag | Description |
| --- | --- |
| `--workflow <name>` | Restrict to a workflow (repeatable) |
| `--by-state` | Report per-state rows instead of per-workflow rows |
| `--include-bookkeeping` | Keep bookkeeping workflows in the default cohort |
| `--since <YYYY-MM-DD>` | Only runs created on/after this UTC date |
| `--budget <file>` | Run the pipeline budget gate against this budget file |
| `--measured-file <json>` | With `--budget`: read measured values from this file instead of the DB |
| `--json` | Output machine-readable JSON |

Per-workflow wall-clock and cost from REAL (terminal, non-dry) runs in `.spur/spur.db` (default
cohort: every definition in `.spur/workflows/` minus bookkeeping workflows). With `--budget`,
runs the per-pipeline budget gate instead: exit `1` on over-budget, missing-budget, or
silent-raise failure. `--json` emits the byte-stable baseline payload (workflow + state rows,
key-sorted). Absorbed from the retired `real-run-cost` / `pipeline-budgets` scripts (PR-9).

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

## spur workflow inline

```
spur workflow inline <op> [options]
```

The installed-CLI transport the inline pipeline driver
(`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`) calls around a host-inline run.
It replaced the plugin scripts `inline-run-setup`, `inline-run-dispatch` and `persist-out-check`
(script-absorption PR-4). These ops boot without the CLI database or config: they never create
`.spur/spur.db` in the cwd (the runners open the run-owning tree's database), print no banner, and
load config only for `decide` and `dispatch-failure`. Exit codes: `0` ok, `1` fail closed (the
driver must stop), `2` usage error (an unknown flag included). A run id must be one safe filename
component; an unsafe one is refused before any write.

## spur workflow inline begin

| Flag | Description |
|---|---|
| `--run-id <id>` | Inline run id (one safe filename component under `.spur/run/`) |
| `--file <definition>` | Workflow definition file or name to resolve |
| `--spur-bin <path>` | Spur invocation that resolves the definition (default: `SPUR_BIN`, then this CLI) |

Create or idempotently attach the authoritative run row and the two-file run record.

## spur workflow inline fingerprint

| Flag | Description |
|---|---|
| `--task-file <path>` | Task spec file (required) |
| `--feature-file <path>` | Feature spec file |

Print the engine's `sha256:<hex>` proof-input digest; creates nothing.

## spur workflow inline action

| Flag | Description |
|---|---|
| `--run-id <id>` | Inline run id |
| `--node <state>` | State the action ran in |
| `--kind <kind>` | Action kind (`shell`, `agent.run`, `operator-wait`, …) |
| `--status <status>` | `done` \| `failed` |
| `--ok <bool>` | `true` \| `false` (required, exact) |
| `--duration-ms <n>` | Host-measured duration; omitted, it is measured from `node-enter` |
| `--estimated` | The duration was host-reported, not timed around the action |
| `--project-root <path>` | Tree that owns the run row (default: the cwd tree) |

## spur workflow inline node-enter

| Flag | Description |
|---|---|
| `--run-id <id>` | Inline run id |
| `--node <state>` | State being entered |
| `--project-root <path>` | Tree that owns the run row |

## spur workflow inline actions

| Flag | Description |
|---|---|
| `--run-id <id>` | Inline run id |
| `--file <json>` | JSON array of `{node, kind, status, ok, durationMs, estimated?}` rows, validated before any write |
| `--project-root <path>` | Tree that owns the run row |

## spur workflow inline close

| Flag | Description |
|---|---|
| `--run-id <id>` | Inline run id |
| `--status <status>` | `done` \| `failed` \| `paused` |
| `--reason <terminal-reason>` | Closed enum; required with `--status failed` |
| `--no-summary` | Skip the measured execution summary (`.spur/run/<run-id>-summary.md`) |
| `--project-root <path>` | Tree that owns the run row |

## spur workflow inline decide

| Flag | Description |
|---|---|
| `--run-id <id>` | Inline run id |
| `--node <state>` | State the decision belongs to |
| `--options-json <file>` | One decide option object (`{id, decision, params?, evidence? \| instructions?, resultFile}`) |

## spur workflow inline persist-out

| Flag | Description |
|---|---|
| `--from <worktree>` | Source worktree |
| `--task-file <path>` | Merged task file whose cited/owned evidence rides along (repeatable) |

Copy a worktree's inline-run provenance and owned evidence into this tree (fail closed).

## spur workflow inline persist-check

| Flag | Description |
|---|---|
| `--from <worktree>` | Worktree about to be removed |
| `--task-file <path>` | Task file whose `<wbs>-` evidence the worktree owns (repeatable) |
| `--run-id <id>` | Run id whose `<run-id>-` evidence the worktree owns (repeatable) |
| `--root <invoke-tree>` | Invoking (main) tree (default: the git common dir's parent) |
| `--success-json <path>` | `persist-out` result to read skips from |

WT-4 pre-removal assertion: exit `1` when owned evidence is missing, divergent or unforwarded.

## spur workflow inline attribution

| Flag | Description |
|---|---|
| `--run-id <id>` | Inline run id |
| `--stage <state>` | Inline stage |
| `--executor <name>` | Executor used; omitted records the explicit no-attribution marker |
| `--agent <name>` | Agent used |
| `--model <m>` | Model used |

## spur workflow inline dispatch-failure

| Flag | Description |
|---|---|
| `--run-id <id>` | Inline run id |
| `--stage <state>` | Inline stage whose dispatch failed |
| `--decision <decision>` | `escalate` \| `stop` \| `host-inline` |
| `--text <record>` | Bounded failure record |
| `--text-file <path>` | File holding the failure record (exactly one of `--text` / `--text-file`) |
| `--executor <name>` | Executor that failed |
| `--agent <name>` | Agent that failed |
| `--model <m>` | Model that failed |

Classifies the record (capacity vs capability) and writes `.spur/run/<run-id>-dispatch-fallback.json`.

## spur workflow commit-guard

```
spur workflow commit-guard <start|stage|check> [options] [-- <paths…>]
```

Run-scoped staging guard for driver commit steps (replaced the plugin script `commit-guard`,
script-absorption PR-4). `start` fingerprints HEAD and the dirty files into
`.spur/run/<run>-tree-start.json`; `stage` stages only listed paths the run wrote and prints
`{staged, foreign}`; `check` prints `{foreign}` and stages nothing. Exit codes: `0` ok, `1` usage or
a failed probe (nothing staged), `2` `stage` refused a path, `3` a target is unmerged or carries
conflict markers.

## spur workflow commit-guard start

| Flag | Description |
|---|---|
| `--run <id>` | Run id the snapshot belongs to |

## spur workflow commit-guard stage

| Flag | Description |
|---|---|
| `--run <id>` | Run id whose tree-start snapshot partitions the paths |
| `--base <sha>` | Diff base (default: the snapshot HEAD) |

## spur workflow commit-guard check

| Flag | Description |
|---|---|
| `--run <id>` | Run id whose tree-start snapshot defines "written by this run" |
| `--base <sha>` | Diff base (default: the snapshot HEAD) |

## See also

- [Daily development workflow](./daily-development-workflow.md) — pipelines in the loop
- [task](./task.md) — the entity the task pipeline drives

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: workflow.txt + verbs/workflow_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
