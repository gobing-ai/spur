# spur workflow

> Validate and execute workflow YAML files. Declare multi-step pipelines as state machines.

## Subcommands

| Subcommand | Description |
|---|---|
| `validate <file>` | Validate a workflow definition |
| `run <file>` | Execute a workflow definition |
| `continue [run-id]` | Resume a paused (HITL) workflow run |
| `list` | List available workflow YAML files |
| `trace [run-id]` | Show persisted workflow run history |

## spur workflow validate

```
spur workflow validate [options] <file>
```

| Argument | Description |
|---|---|
| `file` | Workflow YAML file |

| Flag | Description |
|---|---|
| `--no-schema` | Skip schema validation |
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
| `--run-id <id>` | Persisted run id for workflow run |
| `--vars <json>` | Per-run variable overrides as a JSON object |
| `--dry-run` | Validate and walk transitions without executing actions |
| `--json` | Output machine-readable JSON |

### Examples

```bash
spur workflow run config/workflows/basic.yaml
spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0089"}'
spur workflow run config/workflows/basic.yaml --dry-run --json
```

> **`--vars` takes a JSON object** — there is no `--var key=value` form.
> Correct: `--vars '{"wbs":"0089"}'`. Wrong: `--var wbs=0089` (errors at the commander boundary).

### JSON shape (dry-run)

```json
{
  "runId": "4fa7a9a1-...",
  "workflowName": "basic",
  "mode": "state-machine",
  "status": "failed",
  "finalState": "fix",
  "transitionsTaken": 3,
  "reason": "iteration-bound-exceeded"
}
```

> **Dry-run note:** `--dry-run` walks transitions, but `shell` actions may still execute on some
> engine versions. The dry-run validates the state graph and transition paths.

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

### Example

```bash
spur workflow continue              # resume most recent paused run
spur workflow continue <run-id>     # resume a specific run
spur workflow continue --yes        # resume without prompting
```

## spur workflow list

```
spur workflow list [options]
```

| Flag | Description |
|---|---|
| `--json` | Output machine-readable JSON |

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
  "totalFiles": 6
}
```

### Verified bundled workflows (2026-06-19)

| Workflow | Purpose |
|---|---|
| `basic.yaml` | Canonical implement → check → fix → done loop |
| `feature-dev.yaml` | Feature development pipeline |
| `task-lifecycle.yaml` | Task status transitions |
| `feature-lifecycle.yaml` | Feature status transitions |
| `task-pipeline.yaml` | Task execution pipeline (precheck → implement → test → review → record) |
| `planning-pipeline.yaml` | Planning pipeline (brainstorm → spec → plan → decompose) |

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

## Workflow Action and Guard Kinds

**Actions** (runtime via Spur builtins): `note`, `shell`, `event.emit`, `agent.run`, `rule.check`,
`file.exists`, `file.read`, `hitl.confirm`, `hitl.select`, `hitl.input`, `http.request`.

**Guards:** `shell`, `always`, `never`, `action-ok`.

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.4 Orchestrating
- `config/workflows/` — bundled workflow definitions
