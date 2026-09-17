---
description: Lens-routed refactoring with a preservation contract — taste lenses classify findings against the shared schema; cutting/breaking changes pause for operator approval
role: reviewer
argument-hint: "[<description>] [--scope <path>] [--focus <api|architect|tests|ui|auto>] [--fix <none|blockers-first|all>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Dev Refactor

Wraps the **sp:code-refactoring** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<description>]` | Free-text steering for the lenses (e.g. "pagination consistency"). | — |
| `--scope` `<path>` | Path bound; no edit may land outside it. | working tree |
| `--focus` `<api\|architect\|tests\|ui\|auto>` | Lens set; comma list allowed (`api,tests`). | auto |
| `--fix` `<none\|blockers-first\|all>` | Apply policy; `blockers-first` = P1/P2. | none |
| `--check` `<cmd>` | Verification command for baseline and per-fix checks. | project gate |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing analysis. | inline |
| `--auto` | Skip objective gates only; cutting/breaking taste gates still pause. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-refactor [<description>] [--scope <path>] [--focus <api|architect|tests|ui|auto>] [--fix <none|blockers-first|all>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:code-refactoring", args="$ARGUMENTS")`
