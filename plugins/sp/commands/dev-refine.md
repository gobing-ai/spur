---
description: Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria
argument-hint: "<wbs> [[`--focus`](../skills/spur-dev/references/dev-operations.md#flag-focus) <mode>] [[`--description`](../skills/spur-dev/references/dev-operations.md#flag-description) <text>] [--agent <name|auto>] [--auto] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refine

Wraps the **sp:spur-dev** skill. Prefer Design at plan/create (default); refine is the **fallback**
for blank Design/AC/Plan after `--skip-design` or incomplete create.

## Usage

```
/sp:dev-refine <wbs> [--focus <mode>] [--description <text>] [--agent <name|auto>] [--auto] [--next]
```

Under [`--auto`](../skills/spur-dev/references/dev-operations.md#flag-auto), SKIP only when target sections have no L3 findings: Background, Requirements,
Acceptance Criteria, Design, Plan. Solution is not a refine target. Stage floor: `standard`
(fallback `capable-2`).

## Implementation

- `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`
- Contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § refine.

[`--next`](../skills/spur-dev/references/dev-operations.md#flag-next): chain-to-completion with
propagation. `routing-table.md` row A1 dispatches `/sp:dev-refine <wbs> --auto --next` so a
backlog/todo task chains refine → run → verify without per-step re-invocation. **was: `--next` declared but never defined.**
