---
description: "Review code for a task or path — multi-dimensional review across functional traceability, SECUA quality, and architectural depth. Triggers: \"review this\", \"check the code\", \"SECUA review\", \"dev review\", \"audit this\"."
role: reviewer
argument-hint: "[<wbs|path>] [--agent <inline|auto|name>] [--focus <dims>] [--fix (deprecated)]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Review

Wraps the **sp:functional-review**, **sp:code-verification**, and **sp:code-improvement** skills.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<wbs\|path>]` | Task WBS or source path to review. | cwd |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing review. | omit |
| `--focus` `<dims>` | Review dimensions (functional / SECUA / architecture). | all |
| `--fix` | Deprecated no-op + warning; route remediation to /sp:dev-verify --fix. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-review [<wbs|path>] [--agent <inline|auto|name>] [--focus <dims>] [--fix (deprecated)]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- WBS mode (`<wbs>`): `Skill(skill="sp:functional-review", args="<wbs> $ARGUMENTS")` + `Skill(skill="sp:code-verification", args="review $ARGUMENTS")` + `Skill(skill="sp:code-improvement", args="<wbs> $ARGUMENTS")` (functional traceability + SECUA framework + architectural depth; the three skills return review fragments and the coordinator (`sp:super-reviewer`) writes the combined `## Review` — F92 0593 R1)
- Path mode (`<path>`): `Skill(skill="sp:code-verification", args="review $ARGUMENTS")` + `Skill(skill="sp:code-improvement", args="<path> $ARGUMENTS")` (advisory SECUA quality + architectural depth; performs no task mutation)
- `--fix`: Deprecated (no-op + warning message; route remediation to `/sp:dev-verify --fix`). **`--next` removed** (feature H8, 2026-07-31) — it was a deprecated no-op; route progression to `/sp:dev-next`. **was: `--next` deprecated no-op.**
