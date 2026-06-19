# spur task

> Manage tasks. WBS-numbered, markdown-backed work items linked to features.

## Subcommands

| Subcommand | Description |
|---|---|
| `create <title>` | Create a new task with race-safe WBS allocation |
| `show <wbs>` | Show a task by WBS |
| `update <wbs> [status]` | Update a task status or replace a section |
| `list` | List tasks with optional filtering |
| `refresh` | Regenerate `kanban.md` from the task corpus (deterministic) |
| `batch-create` | Create many tasks from a validated JSON file (all-or-nothing) |
| `check [wbs]` | Validate a task file through the four-layer check |
| `resolve <file-path>` | Resolve a file path to its owning task WBS |

## spur task create

```
spur task create [options] <title>
```

| Argument | Description |
|---|---|
| `title` | Task title |

| Flag | Description |
|---|---|
| `--feature <id>` | Feature ID for traceability and Goal→Background derivation |
| `--parent <wbs>` | Parent WBS for sub-task grouping |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

### Example

```bash
spur task create "Implement OAuth callback handler" --feature F71
spur task create "Add unit tests" --parent 0089
```

## spur task show

```
spur task show [options] <wbs>
```

| Argument | Description |
|---|---|
| `wbs` | Task WBS number |

| Flag | Description |
|---|---|
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

### JSON shape

```json
{
  "wbs": "0088",
  "name": "customize new workflows...",
  "status": "done",
  "filePath": "...",
  "frontmatter": { ... }
}
```

## spur task update

Two modes (mutually exclusive):

### Mode (a): Lifecycle transition

```
spur task update [options] <wbs> [status]
```

### Mode (b): Section replace

```
spur task update [options] <wbs> --section <name> --from-file <path>
```

| Argument | Description |
|---|---|
| `wbs` | Task WBS number |
| `status` | New status (for lifecycle transition) |

| Flag | Description |
|---|---|
| `--section <name>` | Section name to replace (requires `--from-file`) |
| `--from-file <path>` | File to read section body from (requires `--section`) |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

### Examples

```bash
spur task update 0089 wip                                    # lifecycle transition
spur task update 0089 done                                   # guarded — requires non-empty Plan
spur task update 0089 --section Plan --from-file ./plan.md   # section replace
spur task update 0089 --section Solution --from-file ./solution.md
```

> **`done` is guarded:** `task update <wbs> done` refuses with "Plan section is empty or
> placeholder-only" if `### Plan` is empty. Fill the Plan section first.

### Task statuses

```
backlog → todo → wip → testing → blocked → done  (also: cancelled)
```

## spur task list

```
spur task list [options]
```

| Flag | Description |
|---|---|
| `--status <s>` | Filter by status |
| `--phase <p>` | Filter by phase (legacy alias for `--status`) |
| `--parent <wbs>` | Filter by parent WBS |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

### JSON shape

Array of task objects: `[{ wbs, name, status, filePath, frontmatter }, ...]`

## spur task refresh

```
spur task refresh [options]
```

| Flag | Description |
|---|---|
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

Regenerates `kanban.md` from the task corpus. Pure function, deterministic — safe to run anytime.

## spur task batch-create

```
spur task batch-create [options]
```

| Flag | Description |
|---|---|
| `--file <path>` | Path to the batch JSON file (validated against `task-batch.schema.json`) |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

All-or-nothing: if any task in the batch fails validation, none are created. This is the
LLM→CLI gate for bulk task creation.

## spur task check

```
spur task check [options] [wbs]
```

| Argument | Description |
|---|---|
| `wbs` | Task WBS number (validates all tasks when omitted) |

| Flag | Description |
|---|---|
| `--strict` | Elevate warnings to failures |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

Four-layer check: L1 Zod frontmatter (hard) · L2 section presence · L3 format · L4 traceability.

## spur task resolve

```
spur task resolve [options] <file-path>
```

| Argument | Description |
|---|---|
| `file-path` | File path to resolve |

| Flag | Description |
|---|---|
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

Resolves a file path to its owning task WBS. Exit 0 + JSON `{wbs, filePath}` if the path is a
task file; exit 1 "No owning task found" otherwise. Only matches task files (`docs/tasks/NNNN_*.md`).

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.1 Planning
- `docs/04_DESIGN.md` — §7.1 task commands
