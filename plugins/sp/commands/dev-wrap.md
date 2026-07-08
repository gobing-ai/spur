---
description: Wrap up a single completed task — learnings, metrics, doc-sync, optional feature transition and branch cleanup
argument-hint: "<wbs> [--auto] [--merge] [--dry-run]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "AskUserQuestion"]
---

# Dev Wrap

Wraps the **wrapup-pipeline.yaml** workflow for single-task post-execution wrap-up.

Run after a task completes (status `done`) to capture learnings, record metrics, sync docs, and
optionally advance the feature and clean up the branch. Wrap-up does NOT mutate task status —
it consumes completed tasks and produces artifacts.

## When to use

- A task just reached `done` and you want to capture learnings + metrics.
- The operator says "wrap up 0042" or "wrap this task."
- After `/sp:dev-run <wbs>` completed successfully and `--wrap` was not used.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `<wbs>` | Task WBS number (required, positional) | (required) |
| `--auto` | Set `profile=auto` — routes around objective confirmations BEFORE entry. Branch-cleanup (irreversible) still pauses. Not `--yes-to-everything`. | off |
| `--merge` | Run branch cleanup after wrap-up. IRREVERSIBLE — always pauses for confirmation. | off |
| `--dry-run` | Pass-through to `spur workflow run --dry-run`. Validates transitions without writing corpus or memory artifacts. | off |

## Behavior

Thin wrapper: builds the `--vars` JSON and invokes the wrapup pipeline.

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml \
  --vars '{"tasks":"[\"<wbs>\"]","profile":"interactive|auto","merge":"true|false"}' \
  [--dry-run]
```

> **`tasks` is a JSON-encoded string, not a JSON array.** `spur workflow run --vars` accepts only
> string values (`--vars values must be strings`); the pipeline's guards parse the string with
> `jq length`.

The pipeline runs: task-resolve -> doc-sync -> learning-capture -> metrics-record -> (feature-transition) -> (branch-cleanup) -> done.

### Lifecycle respect

- Task statuses are NOT mutated by wrap-up.
- For feature transition, use `/sp:dev-wrapall --feature <id>` (batch wrap-up supports feature transition).
- Branch cleanup (`--merge`) is an irreversible HITL gate — always pauses, even under `--auto`.

### Structured input binding

When a structured-input tool (`AskUserQuestion` on Claude Code, or the platform equivalent) is available, the branch-cleanup confirmation (merge strategy, target branch, and cleanup scope) is presented via a single call with multiple questions. This is asked even under `--auto` because branch operations are irreversible — the operator must explicitly confirm all parameters before execution proceeds. Fall back to a single confirmation prompt (rendered as markdown) only when no structured-input tool is available.


### `--auto` behavior

`--auto` sets `profile=auto` in the wrapup-pipeline vars. Per the Auto-Decision Principles
([cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Auto-Decision Principles"):

- **Objective confirmations** are routed around BEFORE entry — the workflow engine does not
  auto-dismiss `hitl.confirm` states.
- **Irreversible gates** (`branch-cleanup`) still pause — the operator must explicitly confirm
  the branch operation. `--auto` does not auto-click irreversible gates
  (Auto-Decision Principle #6).
- `--auto` is NOT `--yes-to-everything`. It auto-continues on objective pass; it surfaces
  irreversible decisions to the human.

## Implementation

`$ARGUMENTS` passes the WBS and flags. The wrapper extracts the WBS (first positional) and
translates `--auto`/`--merge` into the vars JSON:

```bash
# Extract WBS (first positional argument)
WBS="<first positional from $ARGUMENTS>"
PROFILE="interactive"
MERGE="false"
DRYRUN=""
# Parse --auto -> PROFILE="auto"
# Parse --merge -> MERGE="true"
# Parse --dry-run -> DRYRUN="--dry-run"

# tasks must be a JSON-encoded STRING (--vars values are strings); jq -nc guarantees the shape.
VARS=$(jq -nc --arg tasks "[\"$WBS\"]" --arg profile "$PROFILE" --arg merge "$MERGE" \
  '{tasks:$tasks, profile:$profile, merge:$merge}')
spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars "$VARS" $DRYRUN
```

On HITL pause (branch-cleanup with `--merge`), surface the run id and continue instruction:
`spur workflow continue <run-id> --yes` to approve, or provide feedback.

## Platform Notes

- **Claude Code:** native — `$ARGUMENTS` and `Bash` for `spur workflow run`.
- **Other platforms:** invoke `spur workflow run .spur/workflows/wrapup-pipeline.yaml` with the
  constructed `--vars` JSON.
