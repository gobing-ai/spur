---
description: Author a validated, dry-run-verified workflow in the right execution mode
argument-hint: "\"<description>\" [--kind <state-machine|transition-flow>] [--file <path>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Workflow Add

Wraps the **sp:spur-workflows** skill (`add` operation).

Author a new workflow. **First choose the execution mode** — `state-machine` (loops/retries, one
active state) vs `transition-flow` (pipeline, action-per-node) — surfacing the recommendation with its
reason and the rejected alternative, and confirm before authoring. Then **check whether an existing
workflow already covers the process** (extend it rather than duplicate, on confirmation); author from
scratch only when the process is genuinely new. Write the real schema shape for the chosen mode,
validate the file, and dry-run it to the expected terminal state before trusting it.

## When to use

- A new multi-step process should become a declarative workflow.
- The process is describable in plain language but the right mode/schema shape is unknown.
- Coverage is uncertain — this command checks existing workflows first and recommends extend over
  authoring a near-duplicate.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `description` | The process the workflow should run (required, positional) | (required) |
| `--kind <mode>` | Force the execution mode (`state-machine` / `transition-flow`); skips the recommend-and-confirm gate | (agent-recommended, confirmed) |
| `--file <path>` | Output workflow file path | `config/workflows/<name>.yaml` |

## Behavior

Thin wrapper: ensure a description is present, pass `--kind`/`--file` through. The skill owns the
mode-selection gate, the find-existing-workflow reconciliation, real schema-shape generation per mode,
file placement, and the validate-and-dry-run core. The workflow is not "done" until it validates and
the dry-run reaches the expected terminal state.

## Implementation

Delegates to **sp:spur-workflows** skill:

```
Skill(skill="sp:spur-workflows", args="add $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:spur-workflows`
  skill's `add` operation directly and pass the description/flags as arguments in chat.
