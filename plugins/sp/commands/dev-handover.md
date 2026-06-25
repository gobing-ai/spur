---
description: Generate a structured handover document when blocked — captures goal, progress, blocker, rejected approaches, and next steps
argument-hint: "\"<blocker description>\""
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Handover

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#12-handover) for the authoritative reference.

When blocked on a task, generate a structured handover document capturing: the goal,
progress so far, the blocker (what is stuck and why), approaches tried and rejected, and
concrete next steps for the next agent. Writes to the task's `## Notes` or a standalone
handover file.

## When to use

- A task is blocked and needs to be handed off.
- Token limits, expertise mismatch, or capacity require work transfer.
- The operator says "hand this off" or "write a handover."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `blocker` | What is blocking progress (required, positional) | (required) |

## Behavior

Inline procedure (no skill delegation):

1. Identify the current task context: read the active task via `spur task list --status wip --json`. If a WBS is known, use it; otherwise work from the current conversation.
2. Gather context:
   - **Goal:** from the task's `## Background` / `## Requirements`.
   - **Progress:** from `## Solution`, `## Testing`, `## Review` sections and the conversation.
   - **Blocker:** the `"<blocker description>"` argument.
   - **Rejected approaches:** what was tried and why it failed (from the conversation + prior handover).
   - **Next steps:** concrete actions for the next agent.
3. Format as a markdown document with sections: Goal, Progress, Blocker, Rejected Approaches, Next Steps.
4. Write the document:
   - If a task context exists, write to the task's `## Notes` via `spur task update <wbs> --section Notes --from-file <path>`.
   - Otherwise, write to `docs/handover/<YYYY-MM-DD>-<slug>.md` (create `docs/handover/` if absent).
5. Print the path to the handover document.

## Implementation

Implements the inline procedure defined in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#12-handover). No `Skill()` delegation.

**Arguments received:** `$ARGUMENTS`. Parse per the Arguments table above.

## Platform Notes

- **Claude Code:** native — `Bash`/`Read`/`Write` tools work directly.
- **Other platforms:** Run the `spur` CLI and doc generation manually per the procedure above.
