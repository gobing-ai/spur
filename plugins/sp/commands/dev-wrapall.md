---
description: Wrap up a batch of completed tasks — learnings, metrics, doc-sync, feature transition, optional branch cleanup
argument-hint: "[--since <iso-date>] [--feature <id>] [--status <s>] [--auto] [--merge]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Wrapall

Wraps the **wrapup-pipeline.yaml** workflow for batch post-execution wrap-up.

Run after a batch of tasks complete to capture learnings, record metrics, sync docs, advance a
feature through legal lifecycle edges, and optionally clean up branches. Wrap-up does NOT mutate
task statuses — it consumes completed tasks and produces artifacts.

## When to use

- A batch of tasks just reached `done` and you want to wrap up the whole set.
- The operator says "wrap all done tasks" or "wrap up feature A1."
- After `/sp:dev-runall --tasks ...` completed successfully and `--wrap` was not used.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--since <iso-date>` | Filter done tasks by frontmatter `updated_at >= date` (v1 approximation until a dedicated completion timestamp exists) | (no filter) |
| `--feature <id>` | All tasks under feature + advance feature through legal lifecycle edges to `done` | (no feature) |
| `--status <s>` | Filter tasks by status | `done` |
| `--auto` | Skip objective confirmations. Branch-cleanup HITL still pauses (irreversible). | off |
| `--merge` | Run branch cleanup after wrap-up. IRREVERSIBLE — always pauses for confirmation. | off |

## Behavior

Thin wrapper: resolves the task list via `spur task list --json`, builds the `--vars` JSON, and
invokes the wrapup pipeline.

### Task resolution

1. If `--feature <id>` is given: `spur task list --feature <id> --status <status> --json`
2. If `--since <date>` is given: filter the list by frontmatter `updated_at >= <date>`
3. If neither: `spur task list --status <status> --json`

The resolved WBS list is passed as `vars.tasks`.

### Feature transition

When `--feature <id>` is set, the pipeline's `feature-transition` state advances the feature through
legal lifecycle edges only:

1. `backlog -> active` (always)
2. `active -> verifying` (`spur feature check <id>` guard)
3. `verifying -> done` (`spur feature check <id> --strict` guard)

Never `backlog|active -> done` directly. Task statuses are NOT mutated.

### Branch cleanup

`--merge` triggers the irreversible HITL gate. It always pauses — even under `--auto` — because
branch operations are irreversible. The operator must explicitly confirm.

## Implementation

`$ARGUMENTS` passes all flags. The wrapper resolves the task list, constructs the vars JSON, and
invokes the pipeline:

```bash
# Resolve task list
if [ -n "$FEATURE" ]; then
  TASKS=$(spur task list --feature "$FEATURE" --status "$STATUS" --json | jq -c '[.[].wbs]')
else
  TASKS=$(spur task list --status "$STATUS" --json | jq -c '[.[].wbs]')
fi
# Apply --since filter if given (frontmatter updated_at >= date)

spur workflow run .spur/workflows/wrapup-pipeline.yaml \
  --vars "{\"tasks\":$TASKS,\"feature\":\"$FEATURE\",\"profile\":\"$PROFILE\",\"merge\":\"$MERGE\"}"
```

On HITL pause (branch-cleanup with `--merge`), surface the run id and continue instruction:
`spur workflow continue <run-id> --yes` to approve, or provide feedback.

## Platform Notes

- **Claude Code:** native — `$ARGUMENTS` and `Bash` for `spur task list` + `spur workflow run`.
- **Other platforms:** resolve tasks via `spur task list --json`, then invoke
  `spur workflow run .spur/workflows/wrapup-pipeline.yaml` with the constructed `--vars` JSON.
