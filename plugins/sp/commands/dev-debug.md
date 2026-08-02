---
description: "Systematic debugging protocol — reproduce, isolate, diagnose root cause, apply minimal fix, and verify with regression tests"
argument-hint: "\"<symptom | failing command>\" [--scope <path>] [--task [<wbs>]] [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/flag-glossary.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/flag-glossary.md#flag-subprocess)]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Debug

Wraps the **sp:sys-debugging** skill.

## Usage

/sp:dev-debug "<symptom | failing command>" [--scope <path>] [--task [<wbs>]] [--agent <name|auto>] [--inline|--subprocess]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:sys-debugging", args="$ARGUMENTS")`
