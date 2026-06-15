---
name: task-verbs
description: Per-verb flag detail, JSON shapes, and exit codes for spur task.
see_also:
  - spur-tasks
---

# `spur task` — verb detail

Ground truth for every `spur task` verb. The CLI is the source of behavior; this reference mirrors
it so you don't have to read the command source. If a flag isn't listed here, it doesn't exist —
don't assume one.

## `create <title>`

Allocate one task with a race-safe WBS (a create-lock serializes ID allocation; fail-loud, no
blocking retry).

| Flag | Effect |
| ---- | ------ |
| `--feature <id>` | Records `feature-id` in frontmatter; derives `Background` from the feature's `Goal` (L4 edge). |
| `--parent <wbs>` | Groups under a parent WBS for sub-task decomposition. |
| `--folder <path>` | Target a non-default tasks folder. |
| `--json` | Emit `{ ref: { id, filePath } }`. |

There is **no `--template` flag.** A single create uses the default template. Per-task template
selection is a `batch-create` item field only.

## `show <wbs>` / `list`

- `show <wbs>` prints one task's frontmatter + body (`--json` for structured).
- `list` filters: `--status <s>` (or legacy `--phase <p>`), `--parent <wbs>`. `--json` emits an
  array.

## `update <wbs> [status] | --section <name> --from-file <path>`

Dual-mode and mutually exclusive:

- **Status** (positional): legal transition over `backlog → todo → wip → testing → blocked → done →
  cancelled`. `done` is guarded — refuses when the `Plan` section is empty.
- **Section** (`--section` **requires** `--from-file`): replaces the entire named section body from
  the file. No inline-body flag. Section names: `Background`, `Acceptance Criteria`, `Plan`,
  `Solution`, `Testing`, `Review`, `References`, `History`.

Exit code `2` when neither mode's required args are supplied (e.g. `--section` without `--from-file`,
or no status and no `--section`).

## `batch-create <file>`

Create many tasks from a JSON file. The file is a **bare top-level array** (not wrapped in an
object). Each item is `.strict()` — unknown keys are rejected:

```json
[
  {
    "name": "Add email validation",
    "feature_id": "H2",
    "parent_wbs": "0040",
    "priority": "P1",
    "tags": ["validation"],
    "template": "feature-impl",
    "background": "…",
    "requirements": "…"
  }
]
```

Valid `template` values: `feature-impl`, `issue`, `review`, `meta`. `priority`: `P0`–`P3`. Only
`name` is required. The schema lives at `apps/cli/schemas/task-batch.schema.json`; the
decomposition heuristics that produce this array live in `sp:spur-dev`.

## `refresh`

Rebuild the tasks INDEX from the files on disk. **Files win** — never writes a task file from the
index. Run after hand-edits or when the index looks stale.

## `check [wbs]`

The four-layer validator (design §3). Bare = whole corpus; with a WBS = one task. `--strict`
elevates warnings to failures.

`--json` emits an array of per-task results:

```json
[
  {
    "wbs": "0040",
    "status": "wip",
    "pass": false,
    "findings": [
      { "severity": "error", "layer": "L4", "section": "Acceptance Criteria", "message": "…" }
    ],
    "missingSections": ["Testing"]
  }
]
```

- `severity`: `error` | `warning` (under `--strict`, warnings count as failures).
- `layer`: which check layer raised it (frontmatter / sections / structure / L4 traceability).
- `pass`: per-task verdict. Process exit code is `1` if **any** task fails.

Parse this matrix to answer readiness questions — don't re-implement the checks in prose.

## `resolve <wbs>`

Decides a task's `resolve_info` — the HITL resume hook the pipeline reads when a paused run needs a
human decision recorded. `--json` for structured output.
