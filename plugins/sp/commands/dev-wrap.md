---
description: Wrap up a single completed task — learnings, metrics, doc-sync, optional feature transition and branch cleanup
argument-hint: "<wbs> [--auto] [--merge]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
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
| `--auto` | Skip objective confirmations. The branch-cleanup HITL gate still pauses (irreversible). | off |
| `--merge` | Run branch cleanup after wrap-up. IRREVERSIBLE — always pauses for confirmation. | off |

## Behavior

Thin wrapper: builds the `--vars` JSON and invokes the wrapup pipeline.

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml \
  --vars '{"tasks":["<wbs>"],"profile":"interactive|auto","merge":"true|false"}'
```

The pipeline runs: task-resolve -> doc-sync -> learning-capture -> metrics-record -> (feature-transition) -> (branch-cleanup) -> done.

### Lifecycle respect

- Task statuses are NOT mutated by wrap-up.
- For feature transition, use `/sp:dev-wrapall --feature <id>` (batch wrap-up supports feature transition).
- Branch cleanup (`--merge`) is an irreversible HITL gate — always pauses, even under `--auto`.

## Implementation

`$ARGUMENTS` passes the WBS and flags. The wrapper extracts the WBS (first positional) and
translates `--auto`/`--merge` into the vars JSON:

```bash
# Extract WBS (first positional argument)
WBS="<first positional from $ARGUMENTS>"
PROFILE="interactive"
MERGE="false"
# Parse --auto -> PROFILE="auto"
# Parse --merge -> MERGE="true"

spur workflow run .spur/workflows/wrapup-pipeline.yaml \
  --vars "{\"tasks\":[\"$WBS\"],\"profile\":\"$PROFILE\",\"merge\":\"$MERGE\"}"
```

On HITL pause (branch-cleanup with `--merge`), surface the run id and continue instruction:
`spur workflow continue <run-id> --yes` to approve, or provide feedback.

## Platform Notes

- **Claude Code:** native — `$ARGUMENTS` and `Bash` for `spur workflow run`.
- **Other platforms:** invoke `spur workflow run .spur/workflows/wrapup-pipeline.yaml` with the
  constructed `--vars` JSON.
