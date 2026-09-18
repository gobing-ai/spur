---
description: Refine or re-audit a task — fill missing sections via Q&A, or with --depth ready verify existing claims and fixes against the tree, correct them, and promote to todo
role: planner
argument-hint: "<wbs> [--focus <mode>] [--description <text>] [--depth <standard|ready>] [--agent <inline|auto|name>] [--auto] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refine

Wraps the **sp:spur-dev** skill. Three jobs:

| Job | Invocation |
| --- | --- |
| Fill blank Design/AC/Plan after `--skip-design` or an incomplete create (fallback; Design normally comes from plan/create) | `/sp:dev-refine <wbs> --auto` |
| Evaluate and correct an existing task: a review-triage filing, a stale backlog item, anything whose claims or proposed fixes may no longer hold | `/sp:dev-refine <wbs> --depth ready` (add `--auto` to skip Q&A) |
| Freeze a spec for another implementer; also the recovery command when `spur task create` ready preparation fails | `/sp:dev-refine <wbs> --auto --depth ready` |

`standard` checks only that target sections are structurally complete. It never re-checks what
they say. Use `ready` whenever the existing content itself is in doubt.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<wbs>` | Task WBS to refine. | required |
| `--focus` `<mode>` | Gap-analysis focus: `all\|requirements\|background\|constraints\|acceptance\|quick`. | `all` |
| `--description` `<text>` | Operator framing injected into Q&A/synthesis. | omitted |
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
implement without inventing design:

1. Audit every existing claim against the current tree: facts, cited sources, fix soundness across
   all callers, test observability, environment, concurrent work, and scope.
2. Correct what is wrong and record each change in a dated `**Refine corrections (<date>)**` block
   in Background.
3. Run `spur task check <wbs> --as todo --json`, fill unset priority/estimate, and promote
   `backlog → todo`.
4. Report checklist rows `{id, pass, evidence}`.

Refine targets `backlog`/`todo` tasks; a `wip`-or-later task needs explicit operator consent and is
never demoted. Stage floor: the `planner` role per
[`roles.md`](../references/roles.md) — this command names roles, never tiers (0538 R4);
ready synthesis may use a higher tier when the task spans packages/seams.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`
- Contract: `plugins/sp/skills/spur-dev/references/dev-operations.md` § refine.

`--next`: chain-to-completion with
propagation. `routing-table.md` row A1 dispatches `/sp:dev-refine <wbs> --auto --next` so a
backlog/todo task chains refine → run → verify without per-step re-invocation. **was: `--next` declared but never defined.**
