---
name: task-verbs
description: Per-verb flag detail, template variants, verdict + check JSON shapes, and exit codes for spur task.
see_also:
  - spur-cli
---

# `spur task` — verb detail

Ground truth for every `spur task` verb. The CLI is the source of behavior; this reference mirrors
it so you don't have to read the command source. If a flag isn't listed here, it doesn't exist —
don't assume one. Authority for surface + semantics: `docs/04_DESIGN.md §7.1`.

**Exit codes (all verbs):** `0` success, `1` error, `2` invalid usage. `--json` follows the
`api-response` envelope (`{ ok, data? }`).

## `create <title>`

Allocate one task with a race-safe WBS (a create-lock serializes ID allocation; fail-loud, no
blocking retry).

| Flag | Effect |
| ---- | ------ |
| `--feature <id>` | Records `feature_id` in frontmatter; derives `Background` from the feature's `Goal` (L4 edge). |
| `--parent <wbs>` | Groups under a parent WBS for sub-task decomposition. |
| `--template <variant>` | Selects the section-matrix variant for the new file. |
| `--folder <path>` | Target a non-default tasks folder. |
| `--json` | Emit `{ ref: { id, filePath } }`. |

(See also the full verb map in [tasks.md](../tasks.md).)

**Template variants** (`TASK_VARIANTS`): `standard`, `feature-impl`, `issue`, `review`, `meta`,
`brainstorm`. The variant chooses which sections the new file carries (via the Section-Status-Matrix)
and its scaffold body. **Default:** `feature-impl` when `--feature` is given, else `standard`. An
unknown variant is exit `2`.

**Creation status** follows the matrix: a spec'd task (a `--feature` link, or a batch item with
`background`/`requirements`) is created at **`todo`** ("ready to execute"); a bare capture is created
at **`backlog`** ("still preparing"). `Solution` first appears at `wip`.

## `show <wbs>` / `list`

- `show <wbs>` prints one task's frontmatter + body. With `--json`, frontmatter is a top-level field.
- `list` filters: `--status <s>` (or legacy `--phase <p>`), `--parent <wbs>`, `--feature <id>`
  (linked `feature_id` edge). `--json` emits an array.

## `update <wbs> [status] | --section <name> --from-file <path> | --feature/--priority`

Multi-mode. Status and `--section` are **mutually exclusive**; `--feature`/`--priority` set a
frontmatter scalar.

- **Status** (positional): legal transition over `backlog → todo → wip → testing → blocked → done →
  cancelled`. Two transitions run a `check` guard (§7.5): `wip→testing` → `spur task check <wbs>`;
  `testing→done` → `spur task check <wbs> --strict-core`. A failing gate blocks the transition.
- **`--no-lifecycle`**: suppress lifecycle workflow run creation (use inside pipeline runs to avoid
  orphaned nested lifecycle runs).
- **Section** (`--section` **requires** `--from-file`): replaces the entire named section body from
  the file. No inline-body flag. Section names: `Background`, `Acceptance Criteria`, `Plan`,
  `Solution`, `Testing`, `Review`, `References`, `History`.
- **Frontmatter** (`--feature <id>`, `--priority <p>`): sets the scalar frontmatter field on an
  existing task — the only post-create path, allow-listed to `feature_id` / `parent_wbs` / `priority`.

Exit code `2` when neither mode's required args are supplied (e.g. `--section` without `--from-file`,
or no status and no `--section`/frontmatter flag).

## `batch-create --file <path>`

Create many tasks from a JSON file passed via **`--file <path>`** (not a positional). The file is a
**bare top-level array** (not wrapped in an object). Each item is `.strict()` — unknown keys are
rejected, and creation is **all-or-nothing**:

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

Valid `template` values match `TASK_VARIANTS`: `standard`, `feature-impl`, `issue`, `review`, `meta`,
`brainstorm`. `priority`: `P0`–`P3`. Only `name` is required. An item with `background`/`requirements`
is created at `todo`; a bare item at `backlog`. The schema lives at
`apps/cli/schemas/task-batch.schema.json`; the decomposition heuristics that produce this array live
in `sp:spur-dev`.

## `record <wbs>`

Write `Testing` + `Review` from a verify verdict, with optional `Solution` backfill and a lifecycle
transition. Collapses the pipeline's record step to one call.

| Flag | Effect |
| ---- | ------ |
| `--verdict-file <path>` | Verdict JSON (default `.spur/run/<wbs>-verdict.json`). |
| `--solution-from-diff` | Backfill `Solution` from `git diff -U0` **only when Solution is bare**. |
| `--transition <status>` | Optional lifecycle transition after writing. **Never `done`.** |

**Verdict shape** (`.spur/run/<wbs>-verdict.json`):

```json
{
  "wbs": "0040",
  "verdict": "PASS",
  "requirements": [{ "id": "AC-1", "status": "MET", "evidence": "…" }],
  "checks": [{ "name": "SECU", "status": "P3", "evidence": "…" }]
}
```

- `verdict`: `PASS` | `PARTIAL` | `FAIL` | `UNKNOWN`. A missing/malformed/empty file degrades to
  `UNKNOWN` (empty arrays) — `record` never throws.
- `requirements[]` → the `Testing` per-requirement table. `checks[]` → the `Review` P1–P4 findings
  table. With no requirements/checks, each renders exactly one "none recorded" row (a clean verify is
  a valid outcome; the matrix requires a table, not an empty section).
- `--solution-from-diff` parses `+++ b/<path>` + `@@ +new @@` hunk headers into sorted, unique
  `` `file:line` `` rows; falls back to `--name-only` at `:1` when there are no hunk lines.

## `check [wbs]`

The four-layer validator (design §3): L1 frontmatter, L2 section-matrix, L3 structure/format, L4
traceability. Bare = whole corpus; with a WBS = one task. The matrix is loaded from
`.spur/tasks/section-matrix.yaml`.

- **`--strict`** elevates *all* warnings to failures.
- **`--strict-core`** is the `testing→done` gate variant: fails only on **hard-core errors** —
  Solution `file:line`, Review P1–P4, and `gate:true` required-section misses — *without* the blanket
  warning elevation.

**L4 traceability** resolves `feature_id` / `parent_wbs` / `dependencies` edges and checks **AC
coverage** (DD-09): a task's scenarios must be a subset of its linked feature's AC by normalized
title — orphans warn by default.

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
- `layer`: which check layer raised it (`L1` frontmatter / `L2` sections / `L3` structure / `L4`
  traceability).
- `pass`: per-task verdict. Process exit code is `1` if **any** task fails.

Parse this matrix to answer readiness questions — don't re-implement the checks in prose.

## `refresh`

Re-scan the task corpus and report counts (`{ folders, tasks }` with `--json`). Human output:
`Corpus scanned — N tasks across M folder(s)`. **`kanban.md` generation is retired** (A17 cutover) —
the web Task Kanban board is the daily driver. Does not write task files.

## `migrate`

One-time A17 task corpus normalization pass (`CorpusMigrator`). Normalizes live corpus files under
the active tasks folder (or `--folder`).

| Flag | Effect |
| ---- | ------ |
| `--dry-run` | Full report without writing files. |
| `--folder <path>` | Custom tasks folder. |
| `--json` | Machine-readable report envelope. |

## `resolve <file-path>`

Map a file path to its **owning task** — returns the WBS + task file. Strategies, in order: direct
task-file match, filename WBS parse, then walk-up the directory tree (A10). Use `--strict` to match
only the exact corpus path, with no basename-WBS fallback. Returns exit `1` if no task owns the path.
`--json` for structured output.

## `verdict <wbs>`

Derive a PASS / PARTIAL / FAIL / UNKNOWN verdict from a verify-step answer text file (the agent's
structured evidence write-up). Replaces the pipeline's verify→record transition's previous grep/shell
ladder (0108; ADR-022). On a readable answer, emits `.spur/run/<wbs>-verdict.json` (mkdir-p the
directory first).

| Flag | Effect |
| ---- | ------ |
| `--from-answer <path>` | Path to the verify answer text file (default `.spur/run/<wbs>-verify-answer.txt`). |
| `--folder <path>` | Custom tasks folder. |
| `--json` | Emit the verdict JSON envelope to stdout. |

Verdict shape (always written to `.spur/run/<wbs>-verdict.json` regardless of `--json`):

```json
{
  "wbs": "0040",
  "verdict": "PASS",
  "requirements": [{ "id": "R1", "status": "MET", "evidence": "…" }],
  "acceptanceCriteria": [{ "id": "AC-1", "status": "MET", "evidence": "…" }],
  "checks": [{ "name": "design-conformance", "status": "PASS", "evidence": "…" }],
  "source": "spur-task-verdict"
}
```

- `verdict`: `PASS` | `PARTIAL` | `FAIL` | `UNKNOWN`. A missing/unreadable answer file is a CLI
  input error and exits non-zero before writing a verdict artifact.
- Behavior-bearing requirements and AC need `test` or `command` evidence; static-reference-only rows
  cap the verdict at `PARTIAL`.
- Exit code: `0` on `PASS`, `1` on `PARTIAL` / `FAIL` / `UNKNOWN` (so the pipeline's verify→record
  guard can gate on exit code AND read the JSON).

## `refresh-roster <wbs>`

Regenerate a parent task's sub-task roster block in `## Plan` — the marker-delimited table that the
L4 roll-up gate (`runL4Rollup`, task 0121) reads. Idempotent: same children → same block. Invoked
automatically by `spur task batch-create` for each distinct `parent_wbs` after the atomic create
lands (task 0178, F1); invoke manually after a child status change outside `batch-create`.

| Flag | Effect |
| ---- | ------ |
| `--folder <path>` | Custom tasks folder. |
| `--json` | Emit `{ written, childCount, wbs }` machine-readable. |

Human output: `Roster refreshed for <wbs> (N sub-task(s)).` on a successful write, or
`Task <wbs> has no sub-tasks — nothing to roster.` when the parent has no children.

## `path <wbs>`

Resolve a WBS to its absolute task file path. Inverse of `resolve <file-path>`.

| Flag | Effect |
| ---- | ------ |
| `--folder <path>` | Custom tasks folder. |
| `--json` | Emit `{ wbs, filePath }` machine-readable. |

Human output: the absolute path on stdout. Exit `1` with `Task <wbs> not found` when the WBS is
unallocated.

## Command surface (quick)

```
spur task create   <title> [--feature <id>] [--parent <wbs>] [--template <v>] [--folder] [--json]
spur task show     <wbs> [--folder] [--json]
spur task update   <wbs> [status] [--section <n> --from-file <p>] [--feature <id>] [--priority <p>] [--no-lifecycle] [--folder] [--json]
spur task list     [--status <s>] [--phase <p>] [--parent <wbs>] [--feature <id>] [--folder] [--json]
spur task refresh  [--folder] [--json]
spur task migrate  [--dry-run] [--folder] [--json]
spur task refresh-roster <wbs> [--folder] [--json]
spur task batch-create --file <path> [--folder] [--json]
spur task record   <wbs> [--verdict-file <p>] [--solution-from-diff] [--transition <s>] [--folder] [--json]
spur task verdict  <wbs> [--from-answer <p>] [--folder] [--json]
spur task check    [wbs] [--strict] [--strict-core] [--folder] [--json]
spur task resolve  <file-path> [--strict] [--folder] [--json]
spur task path     <wbs> [--folder] [--json]
```
