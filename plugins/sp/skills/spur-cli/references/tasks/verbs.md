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
`background`/`requirements`) is created at **`todo`**; a bare capture is created at
**`backlog`** ("still preparing"). Which sections a status carries is a runtime contract — query
`spur task sections <wbs> list --json` or `spur task check <wbs> --json`; do not restate the matrix.

## `show <wbs>` / `list`

- `show <wbs>` prints one task's frontmatter + body. With `--json`, frontmatter is a top-level field.
- `list` filters: `--status <s>` (or legacy `--phase <p>`), `--parent <wbs>`, `--feature <id>`
  (linked `feature_id` edge). `--json` emits an array.

## `update <wbs> [status] | --section <name> --from-file <path> | --feature/--priority`

Multi-mode. Status and `--section` are **mutually exclusive**; `--feature`/`--priority` set a
frontmatter scalar.

- **Status** (positional): legal transition over `backlog → todo → wip → testing → blocked → done →
  cancelled`. Two transitions run a target-aware `check` guard (§7.5): `wip→testing` →
  `spur task check <wbs> --as testing`; `testing→done` → `spur task check <wbs> --as done`
  (F92 R3 — each evaluates the transition target, so `testing→done` checks the `done` row).
  A failing gate blocks the transition. The `wip→testing` guard additionally requires a Solution
  section citing concrete `file:line` evidence — a missing/unsubstantiated Solution is rejected with
  `[invalid-solution]`.
- **`--no-lifecycle`**: suppress lifecycle workflow *run record* creation (use inside pipeline runs
  to avoid orphaned nested lifecycle runs). **It is not a guard bypass** — the `wip→testing` and
  `testing→done` `check` gates above still run; the CLI evaluates them inline when the FSM guard
  does not. `--force-done` waives the verify **verdict** only, never the section matrix.
- **Section** (`--section` **requires** `--from-file`): replaces the entire named section body from
  the file. No inline-body flag. Section names: `Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`, `Testing`, `Review`, `References`, `History`, `Notes`.
- **Frontmatter** (`--feature <id>`, `--priority <p>`): sets the scalar frontmatter field on an
  existing task — the only post-create path, allow-listed to `feature_id` / `parent_wbs` / `priority`.

Exit code `2` when neither mode's required args are supplied (e.g. `--section` without `--from-file`,
or no status and no `--section`/frontmatter flag).

## `deps <wbs> <op> [values...]`

Mutate the `dependencies[]` frontmatter array on an existing task. Operations run validation (WBS format, existence, self-edge, duplicates, cycle detection) before any write.

| Op | Usage | Description |
| --- | --- | --- |
| `set` | `spur task deps <wbs> set <dep-wbs...>` | Replace `dependencies[]` with given WBS values |
| `add` | `spur task deps <wbs> add <dep-wbs...>` | Append given WBS values (deduped) |
| `remove` | `spur task deps <wbs> remove <dep-wbs...>` | Drop given WBS values |
| `clear` | `spur task deps <wbs> clear` | Empty `dependencies[]` array |

Flags: `--folder <path>`, `--json`. Exit codes: `0` success, `1` error, `2` usage error, `3` validation error.
`--json` shape: `{ "ref": { "id": "0316", "filePath": "..." }, "dependencies": ["0315"] }`.

## `sections <wbs> <op> [name]`

CLI-safe, matrix-enforced task section mutation. Section names are validated against canonical sections (`Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`, `Root Cause`, `Testing`, `Review`, `References`, `History`, `Notes`). Universal sections (`History`, `References`, `Notes`) are always allowed; `Root Cause` is carried by the `issue` template variant.

| Op | Usage | Description |
| --- | --- | --- |
| `init` | `spur task sections <wbs> init` | Add every required section for task's status not already present (idempotent) |
| `add` | `spur task sections <wbs> add <name>` | Add a single canonical section |
| `list` | `spur task sections <wbs> list` | Read-only: return matrix required/optional/forbidden, present, and missing sections |

Flags: `--folder <path>`, `--json`. Exit codes: `0` success, `1` error, `2` usage error, `3` validation error.

## `run-link <wbs>`

Record a pipeline run provenance link for a task WBS (used by `--next` auto chains).

Flags: `--source <source>` (default `chain`), `--run-id <id>`, `--json`.
`--json` shape: `{ "id": "trl_...", "wbs": "0316", "runId": "...", "kind": "pipeline", "existed"?: true }`.
Idempotent: skips if a pipeline link already exists for the task. Exit codes: `0` success, `1` error.

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

Write `Testing` from a verify verdict artifact — the **deterministic Testing writer** (F92 0593 R1) —
with a **bare-only `Review` backfill** (never overwrites authored Review), optional `Solution`
backfill, and a lifecycle transition. Collapses the pipeline's record step to one call.

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
- `requirements[]` → the `Testing` per-requirement table (deterministic transcript).
- `checks[]` → the P1–P4 findings table used for the **bare-only `Review` backfill** — the done-gate's
  `## Review` L3 layer is satisfied by the `review` coordinator's authored table; `record` writes the
  fallback shape only when the section is bare. With no requirements/checks, each renders exactly one
  "none recorded" row (a clean verify is a valid outcome; the matrix requires a table, not an empty section).
- `--solution-from-diff` parses `+++ b/<path>` + `@@ +new @@` hunk headers into sorted, unique
  `` `file:line` `` rows; falls back to `--name-only` at `:1` when there are no hunk lines.

## `check [wbs]`

The four-layer validator (design §3): L1 frontmatter, L2 section-matrix, L3 structure/format, L4
traceability. Bare = whole corpus; with a WBS = one task. The matrix is loaded from
`.spur/tasks/section-matrix.yaml`.

- **`--strict`** elevates *all* warnings to failures.
- **`--as <status>`** evaluates the task as if it were already in `<status>` (F92 R2 — the lifecycle
  guards pass the transition target). Validated against canonical task statuses; mutually exclusive
  with `--corpus`. Omitted `--as` uses current-status diagnostics.
- **`--strict-core`** is a **temporary compatibility alias** (F92 R2), retained so installed
  plugins/workflows that call it keep working; target-state selection (`--as`) supplies the real
  done semantics. Fails only on **hard-core errors** —
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

There is **no `verify` verb**. The verify leg is three steps: the agent writes its structured
evidence write-up to `.spur/run/<wbs>-verify-answer.txt`, then `spur task verdict <wbs>` derives
the verdict artifact, then `spur task record <wbs>` lands it into the task.

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

### Answer-file shape (what `--from-answer` parses)

The answer file is **markdown** — exactly what a chained `/sp:dev-verify` leg naturally writes.
The parser (`task-verdict.ts` `extractRequirements` / `extractAcceptanceCriteria`) reads rows from
two table shapes; free-form prose with no tables parses to **zero rows**, which yields
`verdict: "UNKNOWN"` (the honest answer for unparseable input — the fix is to write tables, not to
loosen the parser).

**Requirement rows** — markdown table with `Req` (or `Requirement`) and `Status` (or `Verdict`)
columns; optional `Evidence` third column. Header detection is case-insensitive on the first two
cells:

```markdown
| Req | Status | Evidence |
|-----|--------|----------|
| R1  | MET    | `src/foo.ts:42` |
| R2  | PARTIAL| needs test |
| R3  | UNMET  | not started |
```

`Status` values: `MET` | `PARTIAL` | `UNMET` (matched by word-boundary regex, case-insensitive).

**Acceptance Criteria rows** — markdown table with `AC` (or `Acceptance`) / `Status` / `Evidence
Type` / `Evidence` columns (four cells minimum). Header detection requires the `evidence type`
column to distinguish AC rows from requirement rows:

```markdown
| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC-1 | MET | test    | `tests/foo.test.ts:12` |
| AC-2 | MET | command | `bun run lint` exit 0 |
| AC-3 | N/A | n/a     | non-behavioral — doc-only |
```

`Status`: `MET` | `PARTIAL` | `UNMET` | `N/A`. `Evidence Type`: `test` | `command` | `static-ref`
(or `static`) | `manual-review` (or `manual`) | `llm-judge` (or `judge`) | `n/a` (or `na`).

**Evidence rule (behavior-bearing AC):** an AC row with `status: MET` on a behavior-bearing id
(no `[advisory]`/`[non-core]`/`[non-behavior]`/`[docs-only]` marker) MUST carry `test` or
`command` evidence; any other evidence type downgrades the row to `PARTIAL` and caps the verdict.

**Worked example** — a minimal PASS-producing answer file:

```markdown
## Verify Verdict — 0042

| Req | Status | Evidence |
|-----|--------|----------|
| R1  | MET    | `src/foo.ts:42` implements the guard |
| R2  | MET    | `tests/foo.test.ts` covers the branch |

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC-1 | MET | test | `tests/foo.test.ts:12` exit 0 |
```

A free-form prose answer (no tables, or tables missing the required headers) yields
`verdict: "UNKNOWN"`. The resulting `.spur/run/<wbs>-verdict.json` (with `source:
"spur-task-verdict"`) will then deny the `testing → done` transition — the denial message names
the artifact source and directs the operator to `/sp:dev-verify <wbs>`. Re-run verify with the
table format above.

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
spur task create   <title> [--feature <id>] [--parent <wbs>] [--template <v>] [--dedupe-within <seconds>] [--allow-duplicate-name] [--folder] [--json]
spur task show     <wbs> [--folder] [--json]
spur task update   <wbs> [status] [--section <n> --from-file <p>] [--feature <id>] [--priority <p>] [--no-lifecycle] [--folder] [--json]
spur task deps     <wbs> <set|add|remove|clear> [values...] [--folder] [--json]
spur task sections <wbs> <init|add|list> [name] [--folder] [--json]
spur task list     [--status <s>] [--phase <p>] [--parent <wbs>] [--feature <id>] [--folder] [--json]
spur task refresh  [--folder] [--json]
spur task migrate  [--dry-run] [--folder] [--json]
spur task refresh-roster <wbs> [--folder] [--json]
spur task batch-create --file <path> [--folder] [--json]
spur task record   <wbs> [--verdict-file <p>] [--solution-from-diff] [--transition <s>] [--folder] [--json]
spur task verdict  <wbs> [--from-answer <p>] [--folder] [--json]
spur task check    [wbs] [--strict] [--as <status>] [--strict-core] [--folder] [--json]
spur task resolve  <file-path> [--strict] [--folder] [--json]
spur task path     <wbs> [--folder] [--json]
spur task run-link <wbs> [--source <src>] [--run-id <id>] [--json]
```
