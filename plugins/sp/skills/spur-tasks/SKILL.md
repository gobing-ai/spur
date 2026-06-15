---
name: spur-tasks
description: Operate `spur task` as the project's task-file CLI — create tasks, edit sections, drive the status lifecycle, query the readiness matrix via `check --json`, and refresh the index. The committed-corpus side of the planning layer; the deterministic vocabulary `sp:spur-dev` orchestrates against. Triggers on "spur task", "create a task", "edit a task section", "task status", "task check", "task matrix", "task lifecycle", ".spur tasks", "batch-create tasks", or looking up a task verb or convention.
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - reference
    - companion
  verbs:
    - create
    - show
    - update
    - list
    - batch-create
    - refresh
    - check
    - resolve
  openclaw:
    emoji: "📋"
---

# Spur Tasks

`spur task` is the CLI for the **task corpus** — the markdown task files under `docs/tasks/` (DD-08).
Each verb is deterministic and machine-gated: WBS allocation is race-safe, section edits are
file-wins, and `check` is the readiness matrix the rest of the planning layer reads.

This is a **companion reference**, not an orchestrator. It documents *what each verb is and how to
use it well*. The end-to-end planning + execution loop (intake → feature → decomposition →
pipeline run) lives in **`sp:spur-dev`** — do not reimplement that loop here. When you need to
*drive* a task through its lifecycle, reach for `sp:spur-dev`; when you need to know *which verb
does what*, this skill.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `create <title>` | Allocate a new task (race-safe WBS) | `--feature <id>` `--parent <wbs>` `--folder` `--json` |
| `show <wbs>` | Print one task's frontmatter + body | `--folder` `--json` |
| `update <wbs> [status]` | Lifecycle transition **or** section replace | `--section <name> --from-file <path>` `--folder` `--json` |
| `list` | List tasks, filtered | `--status <s>` `--parent <wbs>` `--folder` `--json` |
| `batch-create <file>` | Create many tasks from a JSON array | `--folder` `--json` |
| `refresh` | Rebuild the tasks INDEX from files (files win) | `--folder` `--json` |
| `check [wbs]` | Validate one task / the whole corpus; the readiness matrix | `--strict` `--folder` `--json` |
| `resolve <wbs>` | Decide a task's `resolve_info` (HITL resume hook) | `--folder` `--json` |

All verbs accept `--json` for machine consumption and `--folder <path>` to target a non-default
tasks folder.

## Creating tasks

```bash
spur task create "Add email validation" --feature H2 --parent 0040
```

- **`--feature <id>`** wires traceability: it derives the task's `Background` from the feature's
  `Goal` and records the `feature-id` in frontmatter (L4 traceability reads this edge).
- **`--parent <wbs>`** groups the new task under a parent WBS for sub-task decomposition.
- There is **no `--template` flag on `create`.** A single create always uses the default task
  template. Template selection (`feature-impl` / `issue` / `review` / `meta`) is a
  **`batch-create`-only** field — see [references/verbs.md](references/verbs.md).

Many tasks at once (the decomposition output) go through `batch-create` with a JSON **array** file
— shape and gating live in `sp:spur-dev`'s decomposition reference, not here.

## Editing a task: status vs. section

`update` is dual-mode. **The first positional after the WBS is a status; `--section` switches to
section-edit mode.** They are mutually exclusive.

**Lifecycle transition** (no `--section`):

```bash
spur task update 0040 wip
```

Valid statuses: `backlog → todo → wip → testing → blocked → done → cancelled` (the lifecycle
engine enforces legal transitions; `done` is guarded — it refuses when the `Plan` section is empty).

**Section replace** (file-wins, crash-safe):

```bash
spur task update 0040 --section Review --from-file /tmp/review.md
```

- `--section` **requires** `--from-file` — there is no inline-body flag; the new body is always
  read from a file (this is what makes edits crash-safe and reviewable).
- Section names match the DD-08 task headings: `Background`, `Acceptance Criteria`, `Plan`,
  `Solution`, `Testing`, `Review`, `References`, `History`.
- The write replaces the **whole** named section body; assemble the full section in the temp file
  first, then point `--from-file` at it.

This file-write-then-replace pattern is the section-editing workflow agents use to fill in
`Review` / `Testing` / `Plan` during a pipeline run. See
[references/section-editing.md](references/section-editing.md) for the full recipe.

## The readiness matrix — `check --json`

`spur task check` is the **deterministic gate** over the corpus. Run it bare for the whole corpus,
or with a WBS for one task:

```bash
spur task check --json            # whole corpus
spur task check 0040 --json       # one task
spur task check --strict --json   # elevate warnings to failures
```

`--json` emits the structured matrix — per-task findings (missing sections, broken feature edges,
AC-coverage orphans via L4 traceability) keyed by WBS, plus an aggregate verdict. **Query this, do
not re-derive it**: parse the JSON to answer "which tasks are ready?", "what's blocking 0040?", or
"are there orphaned scenarios?" rather than reading task files and re-implementing the checks. The
matrix is the single source of readiness truth the pipeline and `sp:spur-dev` both consume.

See [references/verbs.md](references/verbs.md) for the JSON shape per finding.

## Keeping the index honest — `refresh`

```bash
spur task refresh
```

Rebuilds the tasks INDEX from the files on disk. **Files win** — `refresh` never overwrites a task
file from the index; it rehydrates the index from the files. Run it after hand-editing task files
outside the CLI, or when the index looks stale.

## What this skill is NOT

- **Not the pipeline.** Driving a task through `task-pipeline.yaml`, HITL surfacing, and
  `workflow continue` is `sp:spur-dev`'s execution half — not here (R3).
- **Not validation logic.** This skill tells you *to run* `check`; the rules it enforces live in
  the CLI (`feature check` / `task check`), never restated as prose checks here.
- **Not features.** Feature authoring, hierarchical IDs, and AC conventions live in the companion
  **`sp:spur-features`**.

## References

| Reference | Covers |
| --------- | ------ |
| [references/verbs.md](references/verbs.md) | Per-verb flag detail, JSON shapes, exit codes |
| [references/section-editing.md](references/section-editing.md) | The temp-file → `--section`/`--from-file` recipe; which sections to fill when |

## See also

- **`sp:spur-dev`** — the umbrella skill that orchestrates these verbs into the planning +
  execution loop. Use it to *drive* work; use this skill to *look up a verb*.
- **`sp:spur-features`** — the companion for `spur feature` (hierarchical IDs, AC conventions,
  traceability).
