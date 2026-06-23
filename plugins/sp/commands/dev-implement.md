---
description: Implement a single task — the pipeline's implement step; write the code that satisfies the task's requirements
argument-hint: "<wbs> [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Implement

Wraps the **sp:spur-dev** skill (execution half — implement phase).

Implement a single task: read its `## Requirements` / `## Design` / `## Plan`, write the code that
satisfies them, and follow the task's plan steps. This is the **implement step the pipeline calls** —
it is NOT the pipeline driver. `/sp:dev-run` drives the whole pipeline; `/sp:dev-implement` does the
one implement stage inside it. Keeping them distinct breaks the recursion where the pipeline's
`implement` state used to call `/sp:dev-run` (the command that launched it).

## When to use

- The pipeline's implement phase (called from `task-pipeline.yaml`).
- A focused "just write the code for this task" request, without driving test/review/verify.
- The operator says "implement 0042."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--auto` | Skip confirmations (pipeline / CI use) | off |

## Behavior

Thin wrapper: reading the task spec, writing code per the Design/Plan, and following the plan

## Section ownership — `## Solution`

The implement step **owns** `## Solution` (the change-map). After writing code, before
yielding, the implement agent MUST:

1. Author the `## Solution` section — a markdown table listing each changed file with
   a `file:line` range and a one-line `what/why` summary. This is the durable record of
   what the implementation changed.
2. Write it via the pipeline-sanctioned path:
   ```bash
   spur task update <wbs> --section Solution --from-file /tmp/<wbs>-solution.md
   ```
3. Write **only when the section is bare** — do not clobber a hand-authored change-map.
   Check with `spur task show <wbs> --json` and inspect `## Solution`; skip if it already
   has real content.

The `replaceSection` upsert semantic means missing sections are created, existing sections
are replaced — so the agent never needs to check existence, only bareness.

If the implement agent forgets to write `## Solution`, the pipeline's `record` step
backfills a minimal change-map from `git diff --name-only` as a safety net — but the
implement agent is the **primary author** because it knows *why* each file changed,
not just *that* it changed.

## Implementation

Delegates to **sp:spur-dev** skill (implement operation):

```
Skill(skill="sp:spur-dev", args="implement $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's implement operation directly.
