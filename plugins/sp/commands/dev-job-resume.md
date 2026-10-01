---
description: Resume remaining work from a Markdown handoff file
role: planner
argument-hint: "--file <path>"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Job Resume

Wraps the **sp:spur-dev** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--file <path>` | Markdown handoff file to read before continuing the remaining work. | required |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-job-resume --file <path>

## Implementation

Follow [job-resume](../skills/spur-dev/references/dev-operations.md#11b-job-resume): validate the
handoff against current state, then continue through the existing owner of the recorded operation.

Skill(skill="sp:spur-dev", args="job-resume $ARGUMENTS")
