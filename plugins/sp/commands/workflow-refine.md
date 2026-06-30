---
description: Refine an existing workflow, then re-validate and re-dry-run it
argument-hint: "<workflow-file> [--intent \"<goal>\"] [--dry-run]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Workflow Refine

Wraps the **sp:spur-cli** facade (workflow noun) (`refine` operation).

Adjust an existing workflow: fix a run that never reaches its terminal state (a guard/condition that
never passes, a wrong transition target, an exhausted `iterationBound`), add a missing step, change
branch/error behavior through explicit guards, or wire in a missing variable / `env.allow` entry. Applies the
**smallest** change that meets the intent, then re-runs the same validate-and-dry-run core an authored
workflow goes through. **Mode changes are out of scope** — switching kinds is a rewrite; use
`/sp:workflow-add` for that.

## When to use

- A workflow stalls short of its expected terminal state.
- A step, branch, or retry bound needs adding or adjusting.
- A missing variable / env allow-entry or branch behavior needs fixing.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `workflow-file` | Path to the workflow YAML (required, positional) | (required) |
| `--intent "<goal>"` | Plain-language refinement goal (drives dimension selection) | (inferred) |
| `--dry-run` | Emit a diff of the change without writing | false |

## Behavior

Thin wrapper: resolve the target file, pass `--intent`/`--dry-run` through. The skill identifies the
refinement dimension (stuck run / missing step / error policy / loop bound / variable), applies the
minimal change with a rationale comment, optionally previews a diff (`--dry-run`), and re-verifies via
the shared validate-and-dry-run core — the run that previously stalled must now reach the expected
terminal. Never restructures to mask a flaw; never switches execution mode.

## Implementation

Delegates to **sp:spur-cli** facade (workflow noun):

```
Skill(skill="sp:spur-cli", args="workflow refine $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:spur-cli` (workflow)
  skill's `refine` operation directly and pass the target/flags as arguments in chat.
