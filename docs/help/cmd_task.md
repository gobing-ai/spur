# spur task

> Manage tasks. WBS-numbered, markdown-backed work items linked to features. The task CLI
> owns status transitions, scalar frontmatter fields, and section edits; it never mutates
> `docs/tasks/<wbs>_*.md` directly. Backed by `PlanningWriteService` over the section-status
> matrix and the lifecycle FSM.

## Subcommands

| Subcommand | Description |
|---|---|
| `create <title>` | Create a new task with race-safe WBS allocation |
| `show <wbs>` | Show a task by WBS (frontmatter at top level under `--json`) |
| `update <wbs> [status]` | Lifecycle transition, or `--section`/`--feature`/`--priority` mutation |
| `list` | List tasks with optional filtering (status / parent / feature) |
| `refresh` | Re-scan the task corpus and report counts (`kanban.md` retired — A17 cutover) |
| `refresh-roster <wbs>` | Regenerate a parent's sub-task roster block inside its `## Plan` |
| `batch-create` | Create many tasks from validated JSON (all-or-nothing) |
| `record <wbs>` | Write Testing/Review from verify verdict; optional Solution backfill + status move |
| `verdict <wbs>` | Derive PASS/PARTIAL/FAIL gate verdict from a verify answer file |
| `check [wbs]` | Validate a task file (or all tasks) through the four-layer check |
| `resolve <file-path>` | Map a file path to its owning task WBS |
| `path <wbs>` | Resolve a WBS to its absolute task file path |
| `migrate` | Run the A17 task corpus normalization report/apply pass |

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
| `--template <variant>` | Template variant: `standard · feature-impl · issue · review · meta · brainstorm` (default: `feature-impl` when `--feature` is given, else `standard`; unknown variant → exit 2) |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

### Example

```bash
spur task create "Implement OAuth callback handler" --feature F71
spur task create "Add unit tests" --parent 0089
spur task create "Brainstorm feature X" --template brainstorm
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
| `--json` | Output machine-readable JSON (frontmatter is a top-level field) |

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

Three mutation modes, composable in one invocation (applied in order: section → scalar fields → status):

### Mode (a): Lifecycle transition

```
spur task update [options] <wbs> <status>
```

### Mode (b): Section replace (body-only)

```
spur task update [options] <wbs> --section <name> --from-file <path>
```

### Mode (c): Scalar frontmatter field (allow-listed)

```
spur task update [options] <wbs> --feature <id>
spur task update [options] <wbs> --priority <P0..P3>
```

| Argument | Description |
|---|---|
| `wbs` | Task WBS number |
| `status` | New status (for lifecycle transition) |

| Flag | Description |
|---|---|
| `--section <name>` | Section name to replace (requires `--from-file`; body-only format) |
| `--from-file <path>` | File to read section body from (requires `--section`) |
| `--feature <id>` | Set the `feature_id` frontmatter field (allow-listed post-create path) |
| `--priority <p>` | Set the `priority` frontmatter field (`P0`–`P3`) |
| `--no-lifecycle` | Suppress lifecycle workflow run creation (used by `task-pipeline.yaml` to avoid orphaned lifecycle runs) |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

### Examples

```bash
spur task update 0089 wip                                    # lifecycle transition
spur task update 0089 done                                   # guarded — requires non-empty Plan
spur task update 0089 --section Plan --from-file ./plan.md   # section replace
spur task update 0089 --section Solution --from-file ./solution.md
spur task update 0089 --feature F71                          # set feature_id edge
spur task update 0089 --priority P0                          # set priority
spur task update 0089 wip --no-lifecycle                     # pipeline-only flag
```

> **`done` is guarded:** `task update <wbs> done` refuses if the `### Plan` section is empty
> or placeholder-only. Fill the Plan section first, then transition.

### Task statuses

```
backlog → todo → wip → testing → blocked → done  (also: cancelled)
```

`done` is re-enterable (reopen with warning + mandatory History entry).

## spur task list

```
spur task list [options]
```

| Flag | Description |
|---|---|
| `--status <s>` | Filter by status |
| `--phase <p>` | Filter by phase (legacy alias for `--status`) |
| `--parent <wbs>` | Filter by parent WBS |
| `--feature <id>` | Filter by linked feature ID (`feature_id` edge — exact match) |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

Filters combine with AND. The `--feature` filter is the enumeration primitive for
feature-level execution loops (e.g. `feature-dev.yaml`'s `execute-tasks` state).

### JSON shape

Array of task objects: `[{ wbs, name, status, filePath, frontmatter }, ...]`

## spur task refresh

```
spur task refresh [options]
```

| Flag | Description |
|---|---|
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON (emits `{folders, tasks}`) |

Re-scans the task corpus and reports folder/task counts. The generated `kanban.md` artifact
was retired in the A17 cutover (task 0192) once the web Task Kanban board became the daily
driver — this verb no longer writes any file.

## spur task refresh-roster

```
spur task refresh-roster [options] <wbs>
```

| Argument | Description |
|---|---|
| `wbs` | Parent task WBS number |

| Flag | Description |
|---|---|
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON: `{wbs, childCount, written}` |

Regenerate a parent's sub-task roster block inside its `## Plan` (the generator half of the
0121 roll-up gate, task 0123). Scans `parent_wbs` children, renders a WBS·title·status
table between `refresh-roster` auto-gen markers, and writes idempotently — inserting the
block (preserving hand-written Plan content) when absent, rewriting in place when present.
Zero children → clean no-op (`written:false`); no `## Plan` → error.

## spur task batch-create

```
spur task batch-create [options] --file <path>
```

| Flag | Description |
|---|---|
| `--file <path>` | Path to the batch JSON file (validated against `task-batch.schema.json`) — required |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

All-or-nothing: if any task in the batch fails validation, none are created. This is the
**LLM→CLI gate** for bulk task creation.

## spur task record

```
spur task record [options] <wbs>
```

| Argument | Description |
|---|---|
| `wbs` | Task WBS number |

| Flag | Description |
|---|---|
| `--verdict-file <path>` | Path to verdict JSON (default: `.spur/run/<wbs>-verdict.json`) |
| `--solution-from-diff` | Backfill `## Solution` from `git diff` when bare |
| `--transition <status>` | Optional lifecycle transition (e.g. `testing`) |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

Write Testing/Review from the verify verdict; optional Solution backfill from `git diff` and
status transition. **Never transitions to `done`** — the gate stays in the workflow.

## spur task verdict

```
spur task verdict [options] <wbs>
```

| Argument | Description |
|---|---|
| `wbs` | Task WBS number |

| Flag | Description |
|---|---|
| `--from-answer <path>` | Path to the verify answer text file (default: `.spur/run/<wbs>-verify-answer.txt`) |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

Derive the **PASS/PARTIAL/FAIL** gate verdict from the verify-step answer file and write
`.spur/run/<wbs>-verdict.json`. PASS only if the agent reported PASS **and** `spur task check`
passes; otherwise FAIL. The deterministic replacement for grep-over-prose in the pipeline
verify step (task 0109). Consumed by the completion gate and by `spur task record`.

## spur task check

```
spur task check [options] [wbs]
```

| Argument | Description |
|---|---|
| `wbs` | Task WBS number (validates all tasks when omitted) |

| Flag | Description |
|---|---|
| `--strict` | Elevate ALL warnings to failures |
| `--strict-core` | Gate variant: fail only on hard-core errors (the `testing → done` guard) |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

**Four-layer check:** L1 Zod frontmatter (hard) · L2 section presence (status matrix) · L3
format · L4 traceability. The L4 layer covers:

- **Edge resolution:** `feature_id` / `parent_wbs` / `dependencies` resolve to real tasks.
- **AC coverage (DD-09):** task scenarios must be a subset of the linked feature's AC by
  normalized title (warnings by default; `--strict` elevates).
- **Parent↔child roll-up (ADR-020 amendment 2026-06-25, task 0121):** for a decomposition
  parent, warn when the parent is `done` with an open child, when all children are closed
  but the parent is still open, or when the parent `## Plan` lacks a sub-task roster
  table — all warnings, `--strict` elevates; inert for tasks with no children.

## spur task resolve

```
spur task resolve [options] <file-path>
```

| Argument | Description |
|---|---|
| `file-path` | File path to resolve |

| Flag | Description |
|---|---|
| `--strict` | Match only the exact corpus path (no basename-WBS fallback) |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

Resolves a file path to its owning task WBS. Exit 0 + JSON `{wbs, filePath}` if the path is a
task file; exit 1 "No owning task found" otherwise. Strategies: direct match, filename WBS
parse, walk-up (A10).

## spur task path

```
spur task path [options] <wbs>
```

| Argument | Description |
|---|---|
| `wbs` | Task WBS number |

| Flag | Description |
|---|---|
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

Resolve a WBS to its absolute task file path. The inverse of `spur task resolve`.

## spur task migrate

```
spur task migrate [options]
```

| Flag | Description |
|---|---|
| `--dry-run` | Produce the full report without writing files |
| `--folder <path>` | Custom tasks folder |
| `--json` | Output machine-readable JSON |

Runs the A17 corpus normalization pass over the active task folder. Dry-run reports the same
per-file changes without writing; apply writes through the corpus migrator's atomic write path.
Idempotent: a second run over a migrated corpus is a no-op. The live `docs/tasks2/` corpus was
migrated 2026-07-04 (task 0192); subsequent runs are no-ops.

## See Also

- [Daily Development Guide](./how_to_use_spur_for_daily_software_development.md) — §5.1 Planning
- [spur feature](./cmd_feature.md) — hierarchical features that tasks link to
- `docs/04_DESIGN.md` — §7.1 `spur task` commands (canonical surface)
