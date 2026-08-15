---
description: Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria; optional implement-ready depth
role: planner
argument-hint: "<wbs> [--focus <mode>] [--description <text>] [--depth <standard|ready>] [--agent <inline|auto|name>] [--auto] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refine

Wraps the **sp:spur-dev** skill. Prefer Design at plan/create (default); refine is the **fallback**
for blank Design/AC/Plan after `--skip-design` or incomplete create. Use `--depth ready` when another
agent will implement and L3-clean is not enough (frozen APIs, anti-patterns, file targets, handoffs).

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<wbs>` | Task WBS to refine. | required |
| `--focus` `<mode>` | Refinement focus mode. | omitted |
| `--description` `<text>` | Override the task description. | omitted |
| `--depth` `<standard\|ready>` | Spec depth bar (see flag glossary). | `standard` |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing refinement. | omit |
| `--auto` | Skip objective HITL gates. | off |
| `--next` | Hand off to the next-router on success. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-refine <wbs> [--focus <mode>] [--description <text>] [--depth <standard|ready>] [--agent <inline|auto|name>] [--auto] [--next]
```

Under `--auto` with **`--depth standard`** (default), SKIP only when target sections have no L3
findings: Background, Requirements, Acceptance Criteria, Design, Plan. Solution is not a refine
target. Under **`--depth ready`**, do **not** SKIP on L3-clean alone — run the implement-ready
checklist (dev-operations § refine) and rewrite Design/Requirements/Plan until another agent can
implement without inventing design. Stage floor: the `planner` role per
[`roles.md`](../references/roles.md) — this command names roles, never tiers (0538 R4);
ready synthesis may use a higher tier when the task spans packages/seams.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`
- Contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § refine.

`--next`: chain-to-completion with
propagation. `routing-table.md` row A1 dispatches `/sp:dev-refine <wbs> --auto --next` so a
backlog/todo task chains refine → run → verify without per-step re-invocation. **was: `--next` declared but never defined.**
