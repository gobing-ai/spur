---
description: Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria
argument-hint: "<wbs> [--focus <mode>] [--description <text>] [--agent <inline|auto|name>] [--auto] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refine

Wraps the **sp:spur-dev** skill. Prefer Design at plan/create (default); refine is the **fallback**
for blank Design/AC/Plan after `--skip-design` or incomplete create.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<wbs>` | Task WBS to refine. | required |
| `--focus` `<mode>` | Refinement focus mode. | omitted |
| `--description` `<text>` | Override the task description. | omitted |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing refinement. | inline |
| `--auto` | Skip objective HITL gates. | off |
| `--next` | Hand off to the next-router on success. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-refine <wbs> [--focus <mode>] [--description <text>] [--agent <inline|auto|name>] [--auto] [--next]
```

Under `--auto`, SKIP only when target sections have no L3 findings: Background, Requirements,
Acceptance Criteria, Design, Plan. Solution is not a refine target. Stage floor: `standard`
(fallback `capable-2`).

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`
- Contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § refine.

`--next`: chain-to-completion with
propagation. `routing-table.md` row A1 dispatches `/sp:dev-refine <wbs> --auto --next` so a
backlog/todo task chains refine → run → verify without per-step re-invocation. **was: `--next` declared but never defined.**
