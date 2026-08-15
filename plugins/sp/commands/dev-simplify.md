---
description: Simplify code for clarity without changing behavior — reduce complexity in recent changes (or a given scope), preserving behavior exactly
role: coder
argument-hint: "[<path-or-scope>] [--scope <recent|all|path>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Dev Simplify

Wraps the **sp:code-simplification** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<path-or-scope>]` | Path or scope to simplify. | recent |
| `--scope` `<recent\|all\|path>` | Scope of the simplification pass. | recent |
| `--check` `<cmd>` | Validation command to iterate against. | project gate |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing simplification. | omit |
| `--auto` | Skip objective HITL gates (taste gates: over-engineering removal & cross-file utility extraction still require approval). | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-simplify [<path-or-scope>] [--scope <recent|all|path>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:code-simplification", args="$ARGUMENTS")`
- **Interaction & Confirmation Model**:
  - **Over-Engineering Removal**: Classify abstractions as Accidental LLM Over-engineering vs Intentional Reserved Patterns. Present target, reason, pros, cons, and recommendation with rationale before removing indirection.
  - **Common Pattern Consolidation**: Follow the 5-stage lifecycle:
    1. Identify repeating operations across scope.
    2. Confirm proposed shared helper/utility signature and module location with operator.
    3. Implement shared helper in isolation with unit tests.
    4. Refactor call-sites incrementally.
    5. Run regression verification suite (`--check <cmd>`).

