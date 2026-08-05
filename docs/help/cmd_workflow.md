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
| `run <file>` | Execute a workflow definition |
| `continue [run-id]` | Resume a paused (HITL) workflow run |
| `list` | List available workflow YAML files across project + global layers |
| `trace [run-id]` | Show persisted workflow run history (or follow a live run) |
| `cancel <run-id>` | Cancel a single non-terminal run by id (mark as failed; SIGTERM async worker when live) |
| `clean` | Housekeeping: finalize stale non-terminal runs **and** reclaim retained run logs |

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

### Example

```bash
spur workflow validate .spur/workflows/basic.yaml --json
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
| `--no-plan` | Suppress the run-start plan preview (synchronous human runs only) |
| `--quiet` | Suppress plan and per-step progress; keep the final summary |
| `--silent` | Suppress all routine output; errors still set a non-zero exit status |
| `--verbose` | Include transitions and correlation diagnostics (implies `--detail full`) |
| `--detail <level>` | Human detail: `minimal` \| `invocation` (default) \| `full` |
| `--trace-file` | Append a redacted schema-versioned JSONL trace under `.spur/runs/workflow/` |
| `--no-log` | Opt out of writing the consolidated `.spur/run/<RUNID>.log` (written+retained by default) |
| `--steer` | Accept in-process steering commands on stdin at declared action boundaries (sync only) |
| `--json` | Output machine-readable JSON |

`run` pre-loads the workflow with the **same embedded-schema options as `validate`**, then
hands the loaded def to the engine — so validate/run share one `$schema` resolution contract
and do not fall through to a stale published package path under ancestor `node_modules`.

When no `agent` is set in `--vars`, `agent.default` from `.spur/config.yaml` is injected so
pipeline `agent.run` stages pick up the project default (YAML literal is last fallback;
explicit `--vars '{"agent":…}'` wins).

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
(subject to `workflow.logRetentionDays`); pass `--no-log` to skip it (propagates to `--async`
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
| `--answer <yes\|no\|cancel>` | Inject a HITL gate answer into resume vars as `__hitlAnswer` before guards re-evaluate (0433). Does **not** imply `--yes`. Invalid values exit `2`. |
| `--json` | Output machine-readable JSON |

Resume a paused (HITL) run. Omit `run-id` to discover the most-recent paused run and confirm
(skipped with `--yes`). Headless `hitl.confirm` often persists a default `no` before pause —
use `--answer yes|no|cancel` to override that value on resume. `--yes` and `--answer` are
distinct concerns.

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

### Bundled workflows (project `.spur/workflows/` after `spur init`)

| Workflow | Purpose |
|---|---|
| `basic.yaml` | Canonical implement → soft-check → fixall → done loop |
| `task-pipeline.yaml` | Task execution pipeline (precheck → … → verify → record → done) |
| `feature-dev.yaml` | Feature umbrella pipeline |
| `planning-pipeline.yaml` | Front-half planning |
| `idea-pipeline.yaml` | Idea → feature + AC + task batch |
| `wrapup-pipeline.yaml` | Post-execution wrap-up |

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
| `--output` | — | With `--follow`: stream `.spur/run/<RUNID>.log` instead of the DB timeline |
| `--json` | — | Output machine-readable JSON |

No argument: list recent runs (default last 20, newest first). With `<run-id>`: per-run timeline
of state entries, transitions, and action executions.

### Follow examples

```bash
spur workflow trace <run-id> --follow            # stream until terminal
spur workflow trace <run-id> --follow --poll 500
spur workflow trace <run-id> --follow --output   # tail the consolidated run log
```

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
   `workflow.logRetentionDays` in `.spur/config.yaml` (default 30 days). Never touches
   `.spur/runs/workflow/<RUNID>.jsonl` or `*-partial.md`.

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
- `.spur/workflows/` — project workflow definitions after `spur init`
- `docs/04_DESIGN.md` — §1.1 `spur workflow` family
