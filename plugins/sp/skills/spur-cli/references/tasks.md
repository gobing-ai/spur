---
name: spur-cli-tasks
description: "spur-cli noun reference: operate `spur task` as the project's task-file CLI — create tasks (with template variants), edit sections, drive the status lifecycle, record pipeline verdicts, derive verdicts, query the four-layer readiness matrix via `check --json`, and re-scan the corpus. The committed-corpus side of the planning layer that the spine orchestrates against."
see_also:
  - spur-cli
---

# spur task — the task-file CLI

`spur task` is the CLI for the **task corpus** — the markdown task files under `docs/tasks/` (DD-08).
Each verb is deterministic and machine-gated: WBS allocation is race-safe, section edits are
file-wins, `record` writes pipeline verdicts mechanically, and `check` is the four-layer readiness
matrix the rest of the planning layer reads.

This is a **companion reference**, not an orchestrator. It documents *what each verb is and how to
use it well*. The end-to-end planning + execution loop (intake → feature → decomposition →
pipeline run) lives in **`sp:spur-dev`** — do not reimplement that loop here. When you need to
*drive* a task through its lifecycle, reach for `sp:spur-dev`; when you need to know *which verb
does what*, this skill.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `create <title>` | Allocate a new task (race-safe WBS) | `--feature <id>` `--parent <wbs>` `--template <variant>` `--folder` `--json` |
| `show <wbs>` | Print one task's frontmatter + body | `--folder` `--json` |
| `update <wbs> [status]` | Lifecycle transition, section replace, **or** frontmatter set | `--section <name> --from-file <path>` `--feature <id>` `--priority <p>` `--no-lifecycle` `--folder` `--json` |
| `list` | List tasks, filtered | `--status <s>` `--phase <p>` `--parent <wbs>` `--feature <id>` `--folder` `--json` |
| `refresh` | Re-scan the corpus and report counts (**`kanban.md` retired** — web Task Kanban is SSOT) | `--folder` `--json` |
| `migrate` | One-time A17 corpus normalization pass | `--dry-run` `--folder` `--json` |
| `refresh-roster <wbs>` | Regenerate a parent task's sub-task roster block in `## Plan` | `--folder` `--json` |
| `batch-create` | Create many tasks from a validated JSON array | `--file <path>` `--folder` `--json` |
| `record <wbs>` | Write Testing/Review from a verify verdict; optional Solution + transition | `--verdict-file <path>` `--solution-from-diff` `--transition <status>` `--folder` `--json` |
| `verdict <wbs>` | Derive PASS/PARTIAL/FAIL/UNKNOWN from verify answer text → verdict JSON; see [answer-file shape](tasks/verbs.md#answer-file-shape-what---from-answer-parses) | `--from-answer <path>` `--folder` `--json` |
| `check [wbs]` | Four-layer validation; the readiness matrix | `--strict` `--strict-core` `--folder` `--json` |
| `resolve <file-path>` | Map a file path to its owning task WBS | `--strict` `--folder` `--json` |
| `path <wbs>` | Map a WBS to its absolute task file path (inverse of `resolve`) | `--folder` `--json` |

All verbs accept `--json` for machine consumption and `--folder <path>` to target a non-default
tasks folder. **Exit codes:** `0` success, `1` error, `2` invalid usage.

## Creating tasks

```bash
spur task create "Add email validation" --feature H2 --parent 0040
```

- **`--feature <id>`** wires traceability: it derives the task's `Background` from the feature's
  `Goal` and records `feature_id` in frontmatter (L4 traceability reads this edge).
- **`--parent <wbs>`** groups the new task under a parent WBS for sub-task decomposition.
- **`--template <variant>`** selects the section-matrix variant that shapes the new file's sections:
  `standard·feature-impl·issue·review·meta·brainstorm`. The default is **`feature-impl` when
  `--feature` is given, else `standard`**. An unknown variant is exit `2`.

The same `--template` axis drives both *which sections the new file carries* (per the
Section-Status-Matrix) and *its creation status*: a spec'd task (a `--feature` link, or a batch item
with `background`/`requirements`) is created at **`todo`**; a bare capture is created at **`backlog`**.
See [tasks/verbs.md](tasks/verbs.md) for the variant detail.

Many tasks at once (the decomposition output) go through `batch-create` with a JSON **array** file.
After child creation succeeds, the CLI refreshes each referenced parent roster and advances a parent
still at `todo` to `wip`; the JSON result includes `parentsWired[]` for these best-effort side
effects. Shape and gating live in `sp:spur-dev`'s decomposition reference.

## Editing a task: status vs. section vs. frontmatter

`update` is multi-mode. **The first positional after the WBS is a status; `--section` switches to
section-edit mode; `--feature`/`--priority` set a frontmatter scalar.** Status and `--section` are
mutually exclusive.

**Lifecycle transition** (positional status):

```bash
spur task update 0040 wip
```

Valid statuses: `backlog · todo · wip · testing · blocked · done · cancelled` (the lifecycle engine
enforces legal transitions). Two transitions are **guarded by `check`**: `wip→testing` runs
`spur task check <wbs>`, and `testing→done` runs `spur task check <wbs> --strict-core` — a failing
gate blocks the transition (§7.5).

**`--no-lifecycle`** suppresses lifecycle workflow run creation (use during pipeline-driven
transitions so nested lifecycle runs are not orphaned).

**Section replace** (file-wins, crash-safe):

```bash
spur task update 0040 --section Review --from-file /tmp/review.md
```

- `--section` **requires** `--from-file` — there is no inline-body flag; the new body is always
  read from a file (this is what makes edits crash-safe and reviewable). Exit `2` otherwise.
- Section names match the DD-08 task headings: `Background`, `Acceptance Criteria`, `Plan`,
  `Solution`, `Testing`, `Review`, `References`, `History`.
- The write replaces the **whole** named section body; assemble the full section in the temp file
  first, then point `--from-file` at it.

**Frontmatter set** (the only post-create path to scalar fields, allow-listed to
`feature_id`/`parent_wbs`/`priority`):

```bash
spur task update 0040 --feature H2
spur task update 0040 --priority P1
```

The section-write-then-replace pattern is the workflow agents use to fill in `Plan` / `Solution` /
`Testing` / `Review` during a run. See
[tasks/section-editing.md](tasks/section-editing.md) for the full recipe. For pipeline
output specifically, prefer **`record`** (below) over hand-assembling Testing/Review files.

## Recording pipeline results — `record`

`spur task record <wbs>` writes the `Testing` and `Review` sections **from a verify verdict**, so the
pipeline's record step is one CLI call instead of awk/sed/jq plumbing:

```bash
spur task record 0040 --transition testing
spur task record 0040 --verdict-file .spur/run/0040-verdict.json --solution-from-diff --transition testing
```

- Reads the verdict JSON (default `.spur/run/<wbs>-verdict.json`); renders `Testing` as a
  per-requirement table and `Review` as a P1–P4 findings table. A missing/malformed verdict degrades
  to an `UNKNOWN` verdict — it never throws.
- **`--solution-from-diff`** backfills `Solution` from `git diff -U0` hunk headers **only when the
  Solution section is still bare** — a safety net, not an overwrite.
- **`--transition <status>`** optionally advances the lifecycle after writing (e.g. `testing`).
  `record` **never transitions to `done`** — the `testing→done` gate stays in the workflow (0108).

The verdict shape (`wbs`, `verdict`, `requirements[]`, `checks[]`) and the rendered tables are
documented in [tasks/verbs.md](tasks/verbs.md).

## The readiness matrix — `check --json`

`spur task check` is the **deterministic four-layer gate** over the corpus (design §3): L1
frontmatter, L2 section-matrix, L3 structure/format, L4 traceability. Run it bare for the whole
corpus, or with a WBS for one task:

```bash
spur task check --json              # whole corpus
spur task check 0040 --json         # one task
spur task check --strict --json     # elevate ALL warnings to failures
spur task check 0040 --strict-core  # the testing→done gate variant
```

`--json` emits the structured matrix — per-task findings (missing sections, broken feature edges,
AC-coverage orphans via L4 traceability) keyed by WBS, plus a per-task `pass` verdict. **Query this,
do not re-derive it**: parse the JSON to answer "which tasks are ready?", "what's blocking 0040?",
or "are there orphaned scenarios?" rather than reading task files and re-implementing the checks.

The two flags are distinct gate profiles:

- **`--strict`** elevates *all* warnings to failures (the strictest reading).
- **`--strict-core`** fails only on hard-core errors — Solution `file:line`, Review P1–P4, and
  `gate:true` required-section misses — *without* the blanket elevation. This is the variant wired
  as the `testing→done` lifecycle guard.

See [tasks/verbs.md](tasks/verbs.md) for the JSON shape per finding.

## Corpus scan — `refresh` (kanban.md retired)

```bash
spur task refresh
```

Re-scans the task corpus and reports counts (`Corpus scanned — N tasks across M folder(s)`). With
`--json`, emits `{ folders, tasks }`. **`kanban.md` generation is retired** (A17 cutover) — the web
Task Kanban board is the daily driver. `refresh` does not write task files.

## Path resolution — `resolve` / `path`

```bash
spur task resolve docs/tasks/0040_add-email-validation.md
spur task resolve src/lib/validation.ts --json
spur task path 0040 --json
```

- `resolve <file-path>` maps a file path to its **owning task** (returns WBS + file). Strategies, in
  order: direct task-file match, filename WBS parse, then walk-up the tree (A10). `--strict` disables
  basename-WBS fallback. Exit `1` when no task owns the path.
- `path <wbs>` is the inverse — absolute task file path for a WBS.

## What this skill is NOT

- **Not the pipeline.** Driving a task through `task-pipeline.yaml`, HITL surfacing, and
  `workflow continue` is `sp:spur-dev`'s execution half — not here (R3).
- **Not validation logic.** This skill tells you *to run* `check`; the rules it enforces live in
  the CLI (`task check` / `feature check`), never restated as prose checks here.
- **Not features.** Feature authoring, hierarchical IDs, and AC conventions live in the companion
  **`spur feature` (see [features.md](features.md))**.

## References

| Reference | Covers |
| --------- | ------ |
| [tasks/verbs.md](tasks/verbs.md) | Per-verb flag detail, template variants, verdict + check JSON shapes, exit codes |
| [tasks/section-editing.md](tasks/section-editing.md) | The temp-file → `--section`/`--from-file` recipe; which sections to fill when; `record` vs. hand-editing |

## See also

- **`sp:spur-dev`** — the umbrella skill that orchestrates these verbs into the planning +
  execution loop. Use it to *drive* work; use this skill to *look up a verb*.
- **`spur feature` (see [features.md](features.md))** — the companion for `spur feature` (hierarchical IDs, AC conventions,
  traceability).
