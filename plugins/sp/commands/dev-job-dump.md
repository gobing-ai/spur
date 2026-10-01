---
description: Dump remaining work to a Markdown handoff file
role: scribe
argument-hint: "--file <path>"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Job Dump

Wraps the **sp:spur-dev** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--file <path>` | Markdown file to write or refresh with the current job handoff. | required |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-job-dump --file <path>

## Implementation

Follow [job-dump](../skills/spur-dev/references/dev-operations.md#11a-job-dump), using the shared
handoff template to capture the current job and its remaining work.

Skill(skill="sp:spur-dev", args="job-dump $ARGUMENTS")
