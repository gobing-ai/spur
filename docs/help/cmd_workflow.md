# spur workflow

> Validate and execute workflow YAML files. Declare multi-step pipelines as state machines
> (kind: `state-machine`) — `task-pipeline.yaml` runs the standard single-task pipeline,
> `feature-dev.yaml` runs a whole feature, `idea-pipeline.yaml` and `wrapup-pipeline.yaml`
> own the new 0167 ideation and post-execution phases. Backed by
> `@gobing-ai/ts-dual-workflow-engine` (`WorkflowService` + `DbWorkflowPersistenceAdapter`).

## Subcommands

| Subcommand | Description |
|---|---|
| `validate <file>` | Validate a workflow definition (load + Zod-validate) |
| `run <file>` | Execute a workflow definition |
| `continue [run-id]` | Resume a paused (HITL) workflow run |
| `list` | List available workflow YAML files across project + global layers |
| `trace [run-id]` | Show persisted workflow run history |
| `cancel` | Cancel a running async workflow (SIGTERM the worker) |
| `clean` | Clean stale non-terminal workflow runs |

## spur workflow validate

```
spur workflow validate [options] <file>
```

| Argument | Description |
|---|---|
| `file` | Workflow YAML file |

| Flag | Description |
|---|---|
| `--no-schema` | Skip JSON schema validation |
| `--json` | Output machine-readable JSON |

### Example

```bash
spur workflow validate config/workflows/basic.yaml --json
# → { "ok": true, "valid": true, "workflow": { "kind": "state-machine", "name": "basic", ... } }
```

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
| `--dry-run` | Validate and walk transitions without executing actions |
| `--async` | Start the run in a detached background process; return the run id immediately |
| `--no-plan` | Suppress the run-start plan preview (synchronous runs only) |
| `--json` | Output machine-readable JSON |

### Examples

```bash
spur workflow run config/workflows/basic.yaml
spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0089"}'
spur workflow run config/workflows/basic.yaml --dry-run --json
spur workflow run config/workflows/task-pipeline.yaml --async          # detached worker
spur workflow run config/workflows/task-pipeline.yaml --async --json    # machine-readable run id
```

> **`--vars` takes a JSON object** — there is no `--var key=value` form. Correct:
> `--vars '{"wbs":"0089"}'`. Wrong: `--var wbs=0089` (errors at the commander boundary).
>
> **`--vars` values must be strings** — arrays/objects get rejected. To pass a list, encode it
> as a JSON string: `--vars '{"tasks":"[\"0042\",\"0043\"]"}'`.

### Run + observability (synchronous human runs only)

Before executing, prints a **run-start plan preview** (`plan: <state> → … → <terminal>`,
parsed from the definition) and then streams **live per-step progress** from the workflow
EventBus:

```
plan: precheck → implement → test → review → approve → verify → record → done
▶ precheck [running]
  → note: "Pipeline start for task 0042."
✓ precheck (ok, 0.12s)
▶ implement [running]
  → agent.run: /sp:dev-run --mode implement 0042 --auto
  → shell: spur task update 0042 wip --no-lifecycle
✓ implement (ok, 38.4s)
…
```

The preview and live progress are **suppressed under `--json`** (the envelope stays
byte-identical) and on the detached **`--async` path** (ignored stdio → use
`spur workflow trace`). `--no-plan` suppresses only the preview. Mechanism:
[`design/workflow-observability.md`](../design/workflow-observability.md).

### `--async` worker

`--async` starts the run in a detached background process (session/process-group leader)
and returns the run id immediately. The worker self-records its pid (== group id) onto the
run row at creation time; `spur workflow cancel` SIGTERMs the negated pid to reach the
worker + any `agent.run` grandchild it spawned. Monitor with `spur workflow trace <run-id>`.

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

> **Dry-run note:** `--dry-run` walks the transition graph, but `shell` actions may still
> execute on some engine versions. The dry-run validates the state graph and transition
> paths.

## spur workflow continue

```
spur workflow continue [options] [run-id]
```

| Argument | Description |
|---|---|
| `run-id` | Run ID to resume (default: the most recent paused run) |

| Flag | Description |
|---|---|
| `--yes` | Resume without prompting for confirmation |
| `--json` | Output machine-readable JSON |

Resume a paused (HITL) run. Omit `run-id` to discover the most-recent paused run and confirm
(skipped with `--yes`). Resolves the run's `workflow_name` back to its YAML, then
`resumeRun`. Works for both lifecycle and pipeline runs; exit 1 if no paused run, the run
isn't paused, or it doesn't resolve to `done`. A state pauses when it declares `pause: true`.

### Example

```bash
spur workflow continue              # resume most recent paused run
spur workflow continue <run-id>     # resume a specific run
spur workflow continue --yes        # resume without prompting
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

### Bundled workflows (in `config/workflows/`)

| Workflow | Purpose | Owning phase |
|---|---|---|
| `basic.yaml` | Canonical implement → check → fix → done loop | Example |
| `task-lifecycle.yaml` | Task status FSM (backlog → todo → wip → testing → done) | Entity FSM |
| `feature-lifecycle.yaml` | Feature status FSM (backlog → active → verifying → done) | Entity FSM |
| `task-pipeline.yaml` | Task execution pipeline (precheck → implement → test → review → approve → verify → record → done) | Execution |
| `feature-dev.yaml` | Feature umbrella (brainstorm → plan → execute-tasks → feature-verify → done) | Umbrella execution |
| `planning-pipeline.yaml` | Front-half planning (phasing → feature-id → design-gen → design-approval → handoff) | Planning |
| `idea-pipeline.yaml` | **New in 0167** — idea → feature + AC + task batch (discovery → … → handoff) | Ideation |
| `wrapup-pipeline.yaml` | **New in 0167** — post-execution wrap-up (task-resolve → doc-sync → … → done) | Post-execution |

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
| `--json` | — | Output machine-readable JSON |

Query persisted workflow run history. No argument: list recent runs (default last 20,
newest first). With `<run-id>`: per-run timeline of state entries, transitions, and
action executions interleaved by `created_at`. Action lines include the action kind,
duration when finalized, and an in-flight / success / failure marker.

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

Cancel a running async workflow. SIGTERMs the worker (process-group leader) so the worker
+ any `agent.run` grandchild are both reached. Async runs only — synchronous runs complete
inline.

## spur workflow clean

```
spur workflow clean [options]
```

| Flag | Default | Description |
|---|---|---|
| `--older-than <minutes>` | `30` | Staleness threshold in minutes |
| `--force` | — | Clean ALL non-terminal runs regardless of age (overrides `--older-than`) |
| `--dry-run` | — | List what would be cleaned without writing |
| `--json` | — | Output machine-readable JSON |

Clean stale non-terminal workflow runs. Default targets runs older than 30 minutes. With
`--force`, cleans every non-terminal run regardless of age. `--dry-run` reports what would
be removed without writing.

## Workflow Action and Guard Kinds

**Action kinds** (run by the engine at state entry):

| Kind | Purpose |
|---|---|
| `note` | Human-readable annotation (no side effect) |
| `shell` | Shell command (e.g. `spur task check <wbs>`) |
| `agent.run` | Spawn an agent step via `spur agent run` |
| `hitl.confirm` | Pause for operator confirmation (HITL gate) |
| `event.emit` | Publish to the workflow EventBus |
| `file.exists` / `file.read` | Read-side helpers |
| `http.request` | HTTP call helper |

**Guard kinds** (used in `transitions[].guard`):

| Kind | Purpose |
|---|---|
| `shell` | Run a shell command; non-zero exit = guard failed |
| `always` | Always allow the transition |
| `never` | Always block the transition |
| `action-ok` | Succeed if the most recent action in the source state succeeded |

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.4 Orchestrating
- [End-to-end Workflow Design](../design/e2e-workflow-for-system-development.md) — pipeline contracts, HITL taxonomy, the 26-step map
- [Workflow Observability](../design/workflow-observability.md) — `--async` and the live progress stream
- `config/workflows/` — bundled workflow definitions
- `docs/04_DESIGN.md` — §1.1 `spur workflow` family
