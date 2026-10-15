# spur workflow

> Validate and execute workflow YAML files. Declare multi-step pipelines as state machines
> (kind: `state-machine`) or transition-flows — `task-pipeline.yaml` runs the standard single-task
> pipeline, `feature-dev.yaml` runs a whole feature, `idea-pipeline.yaml` and `wrapup-pipeline.yaml`
> own ideation and post-execution phases. Backed by `@gobing-ai/ts-dual-workflow-engine`
> via `WorkflowAppService` (embedded-schema injection for validate/run parity — ADR-style task 0431).

## Subcommands

| Subcommand | Description |
|---|---|
| `validate <file>` | Validate a workflow definition (schema + semantic) |
| `show <file>` | Render a workflow definition as a fenced mermaid FSM diagram (read-only) |
| `run <file>` | Execute a workflow definition |
| `continue [run-id]` | Resume a paused (HITL) workflow run |
| `list` | List available workflow YAML files across project + global layers |
| `trace [run-id]` | Show persisted workflow run history (or follow a live run) |
| `progress <run-id>` | Project a run's structured progress: current state, per-action attempts, candidate next transitions |
| `summary` | Measured execution summary of runs (per-stage time, wait, tool calls, tokens) or a batch roll-up |
| `profile <workflow>` | Per-node step profile of a workflow's last N runs with the cache-window flags (read-only) |
| `cost` | Per-workflow wall-clock/cost from real (terminal, non-dry) runs; with `--budget`, the pipeline budget gate |
| `cancel <run-id>` | Cancel a single non-terminal run by id (mark as failed; SIGTERM async worker when live) |
| `clean` | Housekeeping: finalize stale non-terminal runs **and** reclaim retained run logs |
| `inline <op>` | Host-inline run lifecycle transport for the inline pipeline driver (begin, trace, close, decide, persist-out/check, dispatch) |
| `commit-guard <op>` | Run-scoped commit guard: stage only the paths this run wrote (`start` / `stage` / `check`) |

## spur workflow validate

```
spur workflow validate [options] <file>
```

| Argument | Description |
|---|---|
| `file` | Workflow YAML file |

| Flag | Description |
|---|---|
| `--no-schema` | Skip JSON schema validation (semantic checks still run) |
| `--json` | Output machine-readable JSON |

Loads the definition with the same **embedded schema map** the CLI injects for published
`@gobing-ai/spur/schemas/...` refs, so `validate` does not depend on a resolvable
`node_modules/@gobing-ai/spur` (CI cwd / compiled binary safe).

A workflow may declare YAML `extensions.actions` / `extensions.guards` (relative module paths
next to the workflow file). `validate`, `run` (incl. `--dry-run`), and `continue` load those
modules onto the engine host before any step (0533/D4). The declaration is the trust gate;
a missing or mis-shaped module, an absolute path, or `..` fails the command before any step.

Semantic validation also checks HITL decision policy (0911): `decision` is legal only on
`hitl.confirm`/`hitl.select`; `mode: evidence` is rejected in `pause: true` states/nodes, allows
one evidence action per state/node, requires existing producer nodes and valid select choices,
and rejects unknown decision keys/modes. Details: [CLI contracts](../design/cli-contracts.md#explicit-decision-modes-task-0911).
The `decision-routing-example.yaml` walkthrough was retired from the catalogue (task 0946, D64 §10);
the file survives as a test fixture (`packages/app/tests/services/fixtures/`). Bundled workflows
already ship `mode: never` on their human gates; a local override copies them
into `.spur/workflows/` (no hot reload — restart the process after config or YAML changes).

### Example

```bash
spur workflow validate .spur/workflows/basic.yaml --json
# → { "ok": true, "valid": true, "workflow": { "kind": "state-machine", "name": "basic", ... } }
```

## spur workflow show

```
spur workflow show [options] <file>
```

| Argument | Description |
|---|---|
| `file` | Workflow YAML file |

| Flag | Description |
|---|---|
| `--format <name>` | Projection to render: `mermaid` (default) or `todo` |
| `--json` | Output machine-readable JSON |

Render a workflow definition: mermaid FSM diagram (default) or declared-step todo checklist.
Read-only — never executes the definition.

## spur workflow run

```
spur workflow run [options] <file>
```

| Argument | Description |
|---|---|
| `file` | Workflow YAML file |

| Flag | Description |
|---|---|
| `--run-id <id>` | Persisted run id for the workflow run |
| `--vars <json>` | Per-run variable overrides as a JSON object, e.g. `'{"taskId":"0042"}'` |
| `--from <state-id>` | Start a **fresh** run at this state/node (which must be declared `startable: true`) instead of the entry point |
| `--from-run <run-id>` | With `--from`: inherit the source run's effective vars (engine-internal `__*` keys excluded) and record lineage |
| `--dry-run` | Validate and walk transitions without executing actions |
| `--async` | Start the run in a detached background process; return the run id immediately |
| `--no-plan` | Suppress the run-start plan preview (synchronous human runs only) |
| `--quiet` | Suppress plan and per-step progress; keep the final summary |
| `--silent` | Suppress all routine output; errors still set a non-zero exit status |
| `--verbose` | Include transitions and correlation diagnostics (implies `--detail full`) |
| `--detail <level>` | Human detail: `minimal` \| `invocation` (default) \| `full` |
| `--trace-file` | Append a redacted schema-versioned JSONL trace under `.spur/workflow/` |
| `--no-log` | Opt out of writing the consolidated `.spur/run/<RUNID>.log` (written+retained by default) |
| `--steer` | Accept in-process steering commands on stdin at declared action boundaries (sync only) |
| `--json` | Output machine-readable JSON |

`run` pre-loads the workflow with the **same embedded-schema options as `validate`**, then
hands the loaded def to the engine — so validate/run share one `$schema` resolution contract
and do not fall through to a stale published package path under ancestor `node_modules`.
YAML `extensions.*` use that same load path (see `validate` above).

When no `agent` is set in `--vars`, `agent.default` from `.spur/config.yaml` is injected so
pipeline `agent.run` stages pick up the project default. The `--agent` value-semantics contract
(one rule, executor precedence chain, `implementAgent` override) lives in
[cross-cutting.md](../../plugins/sp/skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface);
precedence: explicit `--vars '{"agent":…}'` → pinned workflow var → `agent.default`.

### Examples

```bash
spur workflow run .spur/workflows/basic.yaml
spur workflow run .spur/workflows/task-pipeline.yaml --vars '{"wbs":"0089"}'
spur workflow run .spur/workflows/basic.yaml --dry-run --json
spur workflow run .spur/workflows/task-pipeline.yaml --async          # detached worker
spur workflow run .spur/workflows/task-pipeline.yaml --async --json    # machine-readable run id
spur workflow run .spur/workflows/basic.yaml --quiet
spur workflow run .spur/workflows/basic.yaml --verbose --trace-file
```

> **`--vars` takes a JSON object** — there is no `--var key=value` form. Correct:
> `--vars '{"wbs":"0089"}'`. Wrong: `--var wbs=0089` (errors at the commander boundary).
>
> **`--vars` values must be strings** — arrays/objects get rejected. To pass a list, encode it
> as a JSON string: `--vars '{"tasks":"[\"0042\",\"0043\"]"}'`.
>
> **Output exclusivity:** `--quiet` and `--verbose` cannot combine (exit `2`); `--silent`
> cannot combine with either. `--steer` cannot combine with `--json` or `--async` (exit `2`).

### Run + observability (synchronous human runs only)

Before executing, prints a **run-start plan preview** (`plan: <state> → … → <terminal>`,
parsed from the definition) and then streams **live per-step progress** from the workflow
EventBus. Preview and live progress are **suppressed under `--json`** and on the detached
**`--async` path** (use `spur workflow trace`). `--no-plan` suppresses only the preview.

By default a consolidated log is written to `.spur/run/<RUNID>.log` and retained after the run
(subject to `workflows.logRetentionDays`); pass `--no-log` to skip it (propagates to `--async`
workers).

### `--async` worker

`--async` starts the run in a detached background process (session/process-group leader)
and returns the run id immediately. The worker self-records its pid onto the run row;
`spur workflow cancel` SIGTERMs the worker group when live. Monitor with
`spur workflow trace <run-id>` (optionally `--follow`).

### JSON shape (dry-run or completed)

```json
{
  "runId": "4fa7a9a1-...",
  "workflowName": "basic",
  "mode": "state-machine",
  "status": "done",
  "finalState": "done",
  "transitionsTaken": 3,
  "reason": null
}
```

**Pass/fail:** `status` is authoritative. `done` → exit 0; `failed` / `paused` / other non-done
→ non-zero. Workflows may declare `failureStates` (a subset of `terminalStates`); landing in one
finalizes as `status: "failed"` with `reason: "terminal:<state>"` and `finalState` set to that
terminal. Without `failureStates`, every terminal still reports `status: "done"` (backward
compatible). Use `finalState` only to see *which* terminal was reached after checking `status`.

**Run-scoped artifacts:** non-entity-scoped files under `.spur/run/` are often prefixed with the
run id (e.g. `.spur/run/<runId>-…`). `__runId` is injected by every `spur workflow run`. Entity-scoped
paths (`.spur/run/<wbs>-*`) are unchanged.

## spur workflow continue

```
spur workflow continue [options] [run-id]
```

| Argument | Description |
|---|---|
| `run-id` | Run ID to resume (default: the most recent paused run) |

| Flag | Description |
|---|---|
| `--yes` | Skip the CLI resume confirmation only (does **not** set the HITL gate answer) |
| `--force` | Proceed with resume even if workflow definition drift is detected |
| `--answer <yes\|no\|cancel>` | Inject a HITL gate answer into resume vars before guards re-evaluate (0433): the value lands in the pending gate's answer var (`options.var`, else `__hitlAnswer`; 0932 R2). Does **not** imply `--yes`. Invalid values exit `2`. Required for headless (`--json` / non-TTY) resumes (0901 R3). |
| `--answer-text <text>` | Answer a pending `hitl.input` gate with free text (H1 R27): the text lands in the gate's answer var (`options.var`, else `__hitlInput`) before guards re-evaluate. Mutually exclusive with `--answer` (exit `2`); each answer flag is validated against the pending gate kind, so a mismatch exits `2` with the run still paused. Counts toward the headless guard (0901 R3); forwarded by `--async`. |
| `--async` | Detach the resume into a background worker process and report started/failed after the worker claims the run (0901 R4). |
| `--no-log` | Skip writing the consolidated run log for the resumed run (0901 R6). |
| `--json` | Output machine-readable JSON |

Resume a paused (HITL) run. Omit `run-id` to discover the most-recent paused run and confirm
(skipped with `--yes`). Headless `hitl.confirm` often persists a default `no` before pause —
use `--answer yes|no|cancel` to override that value on resume. `--yes` and `--answer` are
distinct concerns. Continue re-resolves the workflow file and loads the same YAML `extensions.*`
onto the host before guards re-evaluate (0533/D4).

### Example

```bash
spur workflow continue                         # resume most recent paused run (may prompt)
spur workflow continue <run-id>                # resume a specific run
spur workflow continue --yes                   # skip CLI confirm only
spur workflow continue <run-id> --yes --answer yes   # approve a headless-persisted no
spur workflow continue <run-id> --yes --answer no
spur workflow continue --answer yes --json     # still prompts if run-id omitted and no --yes
```

## spur workflow list

```
spur workflow list [--json]
```

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

List available workflow YAML files across project (`.spur/workflows/`) and global
(`~/.config/spur/workflows/`) layers, grouped by source.

### JSON shape

```json
{
  "layers": [
    { "id": "project", "path": ".../.spur/workflows" },
    { "id": "global", "path": "~/.config/spur/.spur/workflows" }
  ],
  "entries": [
    { "name": "basic", "kind": "state-machine", "valid": true, "path": "basic.yaml", "source": "project" }
  ],
  "totalFiles": 8
}
```

### Bundled workflows (project `.spur/workflows/` after `spur self init`)

| Workflow | Purpose |
|---|---|
| `basic.yaml` | Canonical implement → soft-check → fixall → done loop |
| `task-pipeline.yaml` | Task execution pipeline (precheck → … → verify → record → done) |
| `feature-dev.yaml` | Feature umbrella pipeline |
| `idea-pipeline.yaml` | Front-half planning: idea → feature + AC + task batch (`/sp:dev-idea`, `/sp:dev-plan`) |
| `wrapup-pipeline.yaml` | Post-execution wrap-up |

(The `decision-routing-example.yaml` authoring sample was retired from the catalogue by task 0946,
D64 §10; it remains as a decision-policy test fixture under `packages/app/tests/services/fixtures/`.)

## spur workflow trace

```
spur workflow trace [options] [run-id]
```

| Argument | Description |
|---|---|
| `run-id` | Run ID for per-run timeline detail |

| Flag | Default | Description |
|---|---|---|
| `--workflow <name>` | — | Filter by workflow name |
| `--status <status>` | — | Filter by status: `done` \| `failed` \| `running` |
| `--since <iso-date>` | — | Filter runs started on or after this date |
| `--last <n>` | `20` | Limit results |
| `--follow` | — | Replay timeline and poll until terminal (requires `run-id`; human stream, not with `--json`) |
| `--poll <ms>` | `1000` | Follow polling interval (min `50`) |
| `--output` | — | With `--follow`: stream `.spur/run/<RUNID>.md` instead of the DB timeline |
| `--timeout <ms>` | — | With `--follow`: bound the wait; on expiry print a checkpoint line (run ID, last status, elapsed) and exit `1` without cancelling the run |
| `--json` | — | Output machine-readable JSON |

No argument: list recent runs (default last 20, newest first). With `<run-id>`: per-run timeline
of state entries, transitions, and action executions.

### Follow examples

```bash
spur workflow trace <run-id> --follow            # stream until terminal
spur workflow trace <run-id> --follow --poll 500
spur workflow trace <run-id> --follow --output   # tail the consolidated run log
spur workflow trace <run-id> --follow --timeout 600000  # bounded wait; timeout never cancels the run
```

## spur workflow progress

```
spur workflow progress [options] <run-id>
```

| Argument | Description |
|---|---|
| `run-id` | Run ID to project |

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

Read-only projection of one run's execution progress: the current state, every declared
action with its recorded attempts, the candidate next transitions, recorded artifacts, and
any projection diagnostics. The projection is derived entirely in `packages/app`
(`projectWorkflowProgress`); this verb renders it and adds no projection logic of its own.

`--json` emits that projection verbatim (schemaVersion, runId, workflow, status,
definitionDigest, currentState, states, transitions, artifacts, nextTransitions,
diagnostics, projectedAt). Human mode renders the same object.

A running or incomplete run exits `0`: values the run has not answered yet print as
`unknown` and the projection's `diagnostics` name what is missing. An **unknown run id**
exits `1` with `Run <run-id> not found.` (NOT_FOUND under `--json-envelope`) — never an
empty success.

### Example

```bash
spur workflow progress <run-id> --json
```

## spur workflow summary

```
spur workflow summary (--progress <[label=]file>... | --rollup <[label=]file>...) [--transcript <path>] [--since <iso>] [--markdown]
```

| Flag | Description |
|---|---|
| `--progress <[label=]file>` | `spur workflow progress <run-id> --json` output of a run (repeatable) |
| `--rollup <[label=]file>` | Close-written `.spur/run/<run>-summary.json` (repeatable; excludes `--progress`) |
| `--transcript <path>` | Transcript JSONL path (default: the active host session) |
| `--since <iso>` | Measure from this instant |
| `--markdown` | Render the Markdown table instead of JSON |

The measured execution summary `/sp:dev-run` and `/sp:dev-runall` print: the host transcript
windowed by each state visit's attempt timestamps, per stage time, operator wait, tool calls,
tokens (total / non-cached) and the actor split, with driver overhead as its own row. `--rollup`
renders one row per run plus the batch total (and the wall span when runs overlap). No transcript
or no window → `n/a`, exit `0`. Exit `2`: usage error, untimed progress or unreadable input.
Absorbed from the retired `run-summary` plugin script (script-absorption PR-6).

## spur workflow profile

```
spur workflow profile <workflow> [--last <n>] [--window <sec>] [--spur-bin <cmd>] [--json]
```

| Argument | Description |
|---|---|
| `workflow` | Workflow name |

| Flag | Description |
|---|---|
| `--last <n>` | Number of recent done runs to sample (default 20) |
| `--window <sec>` | Cache window W in seconds (default 300) |
| `--spur-bin <cmd>` | spur invocation for the trace reads (default: this spur) |
| `--json` | Output machine-readable JSON |

Read-only per-node step profile for `sp:spur-doctor`, built from `spur workflow trace`: per node and
action kind the run count, executions, p50/max `durationMs`, p50 idle gap, session mode and
`cacheHit` p50 with coverage, plus the ADR-115 cache-window flags (`step-over-window`,
`resume-after-idle`, `resume-cold-cache`, `agent-run-over-2w`). Unknown evidence is `?`/`null`,
never `0`. Exit `0` profile produced, `1` a spur call failed or its JSON did not parse.

## spur workflow cost

```
spur workflow cost [--workflow <name>]... [--by-state] [--include-bookkeeping] [--since <YYYY-MM-DD>] [--budget <file>] [--measured-file <json>] [--json]
```

| Flag | Description |
|---|---|
| `--workflow <name>` | Restrict to a workflow (repeatable) |
| `--by-state` | Report per-state rows instead of per-workflow rows |
| `--include-bookkeeping` | Keep bookkeeping workflows in the default cohort |
| `--since <YYYY-MM-DD>` | Only runs created on/after this UTC date |
| `--budget <file>` | Run the pipeline budget gate against this budget file |
| `--measured-file <json>` | With `--budget`: read measured values from this file instead of the DB |
| `--json` | Output machine-readable JSON |

Per-workflow wall-clock and cost from REAL (terminal, non-dry) runs in `.spur/spur.db`; the
default cohort is every definition in `.spur/workflows/` minus bookkeeping workflows. Unknown
measurements render as `null`, never `0`. With `--budget <file>` the command runs the
per-pipeline budget gate instead (measured-file requires budget): exit `1` on any over-budget,
missing-budget, or silent-raise failure. `--json` emits the byte-stable baseline payload
(workflow + state rows, key-sorted). Absorbed from the retired `real-run-cost` and
`pipeline-budgets` scripts (script-absorption PR-9); workflow-promotion keeps its own
selected-run replay query and is not served by this aggregate payload.

## spur workflow cancel

```
spur workflow cancel [options] <run-id>
```

| Argument | Description |
|---|---|
| `run-id` | Run ID to cancel |

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

Cancel a single non-terminal run by id (mark as failed). When an async worker is live,
SIGTERMs the worker process group. For bulk/stale cleanup use `spur workflow clean`.

## spur workflow clean

```
spur workflow clean [options]
```

| Flag | Default | Description |
|---|---|---|
| `--older-than <minutes>` | `30` | Staleness threshold for non-terminal run finalization |
| `--force` | — | Finalize **all** non-terminal runs regardless of age |
| `--logs` | — | Scope to retained run-log reclamation only (skip stale-run finalization) |
| `--dry-run` | — | List what would be cleaned without writing (both scopes) |
| `--json` | — | Output machine-readable JSON |

Housekeeping **two scopes** (unless scoped by flag):

1. **Stale-run finalization** — bulk-finalize orphaned `running`/`pending` runs as `failed`.
2. **Run-log reclamation** — remove retained `.spur/run/<RUNID>.log` files older than
   `workflows.logRetentionDays` in `.spur/config.yaml` (default 30 days). Never touches
   `.spur/workflow/<RUNID>.jsonl` or `*-partial.md`.

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

## Workflow Action and Guard Kinds

**Action kinds** (run by the engine at state entry):

| Kind | Purpose |
|---|---|
| `note` | Human-readable annotation (no side effect) |
| `shell` | Shell command; var interpolation is data, not shell (shell-metachar safe) |
| `agent.run` | Spawn an agent step via `spur agent run` |
| `hitl.confirm` / `hitl.input` / `hitl.select` | HITL gates (pause + answer vars) |
| `event.emit` | Publish to the workflow EventBus |
| `file.exists` / `file.read` / `file.read-into-var` | Filesystem helpers |
| `http.request` | HTTP call helper |
| `rule.check` | Invoke constraint-rule evaluation |
| `response.validate` | Structured response validation |

**Guard kinds** (used in `transitions[].guard`):

| Kind | Purpose |
|---|---|
| `shell` | Run a shell command; non-zero exit = guard failed (vars treated as data) |
| `always` | Always allow the transition |
| `never` | Always block the transition |
| `action-ok` | Succeed if the most recent action in the source state succeeded |

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.4 Orchestrating
- [End-to-end Workflow Design](../design/e2e-workflow-for-system-development.md) — pipeline contracts, HITL taxonomy
- [Workflow Observability](../design/workflow-observability.md) — `--async` and the live progress stream
- Plugin skill reference: `plugins/sp/skills/spur-cli/references/workflows.md`
- `.spur/workflows/` — project workflow definitions after `spur self init`
- `docs/04_DESIGN.md` — §1.1 `spur workflow` family
