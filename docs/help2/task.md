# spur task

Manage tasks: WBS-numbered, markdown-backed work items linked to features. The task CLI owns
status transitions, frontmatter fields, and section edits — never mutate a task file by hand.

## Subcommands

| Subcommand | Description |
| --- | --- |
| `create <title>` | Create a task with race-safe WBS allocation |
| `show <wbs>` | Show a task by WBS |
| `update <wbs> [status]` | Update status, a section, or a frontmatter field |
| `deps <wbs> <op> [values...]` | Mutate the `dependencies[]` frontmatter array |
| `sections <wbs> <op> [name]` | Initialize, add, or list canonical task sections |
| `list` | List tasks with optional filtering |
| `refresh` | Re-scan the task corpus and report counts |
| `refresh-roster <wbs>` | Regenerate a parent's sub-task roster block |
| `batch-create` | Create many tasks from a validated JSON file (all-or-nothing) |
| `record <wbs>` | Record pipeline results into the task file |
| `verdict <wbs>` | Derive a PASS/PARTIAL/FAIL verdict from verify answer text |
| `check [wbs]` | Validate a task file through the four-layer check |
| `resolve <file-path>` | Resolve a file path to its owning task WBS |
| `path <wbs>` | Resolve a WBS to its task file path |
| `scaffold-tests <wbs>` | Generate BDD test stubs from the task's acceptance criteria |
| `run-link <wbs>` | Record a pipeline provenance link |
| `verifyall-aggregate` | Aggregate per-task verify outcomes into one batch verdict |
| `migrate` | One-time task corpus normalization pass |
| `migrate-anchors` | Rewrite stale `file:line` anchors to current line numbers |

All verbs accept `--json` (and `--json-envelope`); folder-scoped verbs accept `--folder <path>`.

## spur task create

```bash
spur task create <title> [--feature <id>] [--parent <wbs>] [--template <variant>]
spur task create [--folder <path>] [--dedupe-within <seconds>] [--allow-duplicate-name]
spur task create [--skip-ready] [--agent <selector>] [--json]
```

| Flag | Description |
| --- | --- |
| `--feature <id>` | Link to a feature for traceability |
| `--parent <wbs>` | Parent WBS for sub-task grouping |
| `--template <variant>` | `standard` \| `feature-impl` \| `issue` \| `review` \| `meta` \| `brainstorm` |
| `--dedupe-within <seconds>` | Override the dedup window (on by default for 300 s when `--feature` is set) |
| `--allow-duplicate-name` | Disable the dedup guard entirely |
| `--skip-ready` | Backlog capture only — skip ready preparation (no model dispatch) |
| `--agent <selector>` | Agent used for ready preparation |

```bash
spur task create "Implement OAuth callback" --feature F7
spur task create "Add unit tests" --parent 0010
spur task create "Research caching options" --template brainstorm --skip-ready
```

> **Heads-up:** by default, `create` may run a *ready preparation* step that dispatches your
> configured agent to enrich the new task. Pass `--skip-ready` for plain backlog capture.

## spur task show

```bash
spur task show <wbs> [--folder <path>] [--json]
```

Prints one task (under `--json`, the frontmatter is a top-level field).

## spur task update

Three composable mutation modes, applied in order (section → scalar fields → status):

```bash
spur task update 0010 wip                                       # (a) lifecycle transition
spur task update 0010 --section Plan --from-file ./plan.md      # (b) section replace
spur task update 0010 --feature F7 --priority P0                # (c) scalar fields
```

| Flag | Description |
| --- | --- |
| `--section <name>` | Section name to write (requires `--from-file`) |
| `--from-file <path>` | File to read the section body from |
| `--feature <id>` | Set the `feature_id` edge |
| `--priority <p>` | Set priority (`P0`–`P3`) |
| `--ac-numbering <mode>` | Opt the task into the requirements↔AC coverage check |
| `--ac-altitude <mode>` | `graduating` (default) or `task-local` (skip the feature-AC subset rule) |
| `--no-lifecycle` | Suppress the lifecycle workflow run (pipeline use) |
| `--force-done` | Allow `done` with a non-PASS verdict; records an override |
| `--reason <text>` | Rationale for a forced-done override |
| `--verdict-dir <path>` | Directory holding `<wbs>-verdict.json` artifacts |

Statuses: `backlog → todo → wip → testing → done` (plus `blocked`, `cancelled`). Guards run at
`wip → testing` and `testing → done` (each evaluates the transition target via the structural
check).

> **`done` is guarded twice:** the Plan section must be non-empty, and the recorded verify
> verdict must be PASS. `--force-done --reason "..."` records an audited override for the
> verdict only — the structural walk through each hop still applies. `--section "Q&A"` is the
> one appending section: it adds a timestamped entry instead of replacing (start the body with
> `<!-- qa:replace -->` to replace wholesale).

## spur task list

```bash
spur task list [--status <s>] [--phase <p>] [--parent <wbs>] [--feature <id>] [--json]
```

Filters combine with AND; `--phase` is a legacy alias for `--status`, and `--feature` is the
enumeration primitive feature-level loops are built on.

## spur task deps

```bash
spur task deps <wbs> <op> [values...] [--json]
```

`op` is `set` \| `add` \| `remove` \| `clear`. Validation (WBS format, existence, self-edge,
duplicates, cycles) runs before any write:

```bash
spur task deps 0010 set 0008 0009
spur task deps 0010 add 0007
spur task deps 0010 remove 0008
spur task deps 0010 clear
```

## spur task sections

```bash
spur task sections <wbs> <op> [name] [--json]
```

`op` is `init` (add every required missing section) \| `add <name>` \| `list` (read-only matrix
view). Use `update --section --from-file` for body content.

## spur task refresh / refresh-roster

```bash
spur task refresh [--json]
spur task refresh-roster <wbs> [--json]
```

`refresh` re-scans the corpus and reports folder/task counts (writes nothing).
`refresh-roster` regenerates a parent task's sub-task roster block in its `## Plan` —
idempotent, and a clean no-op for tasks without children.

## spur task batch-create

```bash
spur task batch-create --file <path> [--skip-ready] [--agent <selector>] [--json]
```

Many tasks from one schema-validated JSON file — **all or nothing**: if any row fails
validation, none are created. This is the bulk-creation gate for agents and scripts.

## spur task record / verdict

```bash
spur task record <wbs> [--verdict-file <path>] [--solution-from-diff] [--transition <status>] [--json]
spur task verdict <wbs> [--from-answer <path>] [--json]
```

`verdict` derives PASS/PARTIAL/FAIL/UNKNOWN from the verify answer text and writes
`.spur/run/<wbs>-verdict.json`. `record` writes the Testing/Review sections from that verdict,
optionally backfills `## Solution` from `git diff` (`--solution-from-diff`) and transitions
status. `record` never transitions to `done` — that gate stays with `update`.

## spur task check

```bash
spur task check [wbs] [--strict] [--as <status>] [--fix] [--corpus] [--since <ref>] [--json]
```

Four layers: frontmatter schema (L1), status-driven section matrix (L2), format (L3),
traceability (L4 — edges resolve, AC coverage, parent↔child roll-ups). `--as <status>` evaluates
the task as if it were in that status (this is how the `testing → done` guard checks the done
row); `--fix` repairs structural findings in place; `--strict` elevates warnings.

> `--strict-core` still exists as a compatibility alias for older callers, but target-state
> selection via `--as` is what supplies done semantics today.

## spur task resolve / path

```bash
spur task resolve <file-path> [--strict] [--json]
spur task path <wbs> [--json]
```

Inverse lookups: a file path to its owning WBS (exit 1 when nothing owns it), and a WBS to its
absolute task file path.

## spur task scaffold-tests

```bash
spur task scaffold-tests <wbs> [--file <path>] [--json]
```

Generates BDD test stubs from the task's acceptance-criteria scenarios — the bridge from
planning to the test suite.

## spur task run-link

```bash
spur task run-link <wbs> [--source <source>] [--run-id <id>] [--json]
```

Records a pipeline provenance link (default source: `chain`; auto chains use `next-auto`) so
completion gates can prove a real verify/record path ran.

## spur task verifyall-aggregate

```bash
spur task verifyall-aggregate --from-file <path> [--json]
```

Reads a JSON array of per-task outcomes (`{wbs,outcome}` rows — `PASS`, `PARTIAL`, `FAIL`,
`NOT-STARTED`, `UNKNOWN`) and emits the deterministic batch verdict, with `NOT-STARTED` tasks
excluded from the rollup. The batch-verify replacement for ad-hoc prose rollups.

## spur task migrate / migrate-anchors

```bash
spur task migrate [--dry-run] [--json]
spur task migrate-anchors [--dry-run] [--json]
```

One-time maintenance passes: corpus normalization, and qualification of stale `file:line`
anchors. Both are idempotent; `--dry-run` reports without writing. Not part of the daily loop.

## See also

- [feature](./feature.md) — the containers tasks link to
- [Daily development workflow](./daily-development-workflow.md) — tasks in the loop

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: task.txt + verbs/task_*.txt) >
docs/help carry-over (accuracy) > DeepWiki TOC (structure signal only).
Verified: every command, verb, and flag above matches the live snapshots.
-->
