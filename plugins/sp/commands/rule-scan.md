---
description: Discover recurring anti-patterns worth codifying as rules
requires: [cli:spur, local-fs]
role: reviewer
argument-hint: "[<path-or-glob>]"
allowed-tools: ["Bash", "Read", "Grep", "Glob", "Skill"]
---

# Rule Scan

Wraps the **sp:spur-cli** skill.

## Usage

/sp:rule-scan [<path-or-glob>]

## Implementation

- `Skill(skill="sp:spur-cli", args="rule scan $ARGUMENTS")`

