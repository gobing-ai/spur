---
description: Reverse engineer a codebase with selectable depth, focus, and output format
argument-hint: "[<path>] [--mode <briefing|structure|architecture|design|full>] [--focus <all|stack|dependencies|data|flows|api|security|quality|performance>] [--format <markdown|json|both>] [--output <file>] [--agent <inline|auto|name>]"
allowed-tools: ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "Skill"]
---

# Dev Reverse

Wraps the **sp:reverse-engineering** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<path>]` | Path to reverse-engineer. | cwd |
| `--mode` `<briefing\|structure\|architecture\|design\|full>` | Depth of the report. | structure |
| `--focus` `<all\|stack\|dependencies\|data\|flows\|api\|security\|quality\|performance>` | Analysis lens. | all |
| `--format` `<markdown\|json\|both>` | Output format. | markdown |
| `--output` `<file>` | Write to a file instead of stdout. | stdout |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing analysis. | inline |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-reverse [<path>] [--mode <briefing|structure|architecture|design|full>] [--focus <all|stack|dependencies|data|flows|api|security|quality|performance>] [--format <markdown|json|both>] [--output <file>] [--agent <inline|auto|name>]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:reverse-engineering", args="$ARGUMENTS")`

