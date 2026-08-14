---
description: Author a validated, smoke-tested constraint rule
role: scribe
argument-hint: "\"<description>\" [--file <path>] [--preset <target>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Rule Add

Wraps the **sp:spur-cli** skill.

## Usage

/sp:rule-add "<description>" [--file <path>] [--preset <target>]

## Implementation

- `Skill(skill="sp:spur-cli", args="rule add $ARGUMENTS")`

