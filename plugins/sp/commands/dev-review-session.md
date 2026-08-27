---
description: "Review the active coding-agent session immediately: summarize outcomes, distinguish resolved and open issues with evidence, and propose bounded improvements. Triggers: review this session, session wrap-up, immediate retrospective, what happened, what was resolved"
role: reviewer
argument-hint: "[<focus>]"
allowed-tools: ["Bash", "Read", "Grep", "Glob", "Skill"]
---

# Dev Review Session

Wraps the **sp:session-review** skill for a lightweight, report-only review of the active host
session. It uses the current conversation plus read-only repository evidence, runs inline so the
session context is preserved, and never launches a workflow, imports history, creates a task, or
applies a remediation.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<focus>]` | Optional question or operation to emphasize without excluding material session outcomes. | full active session |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-review-session
/sp:dev-review-session "why the verification loop repeated"
```

## Implementation

Invoke the skill directly in the active host session; do not delegate to a subagent or subprocess.

```
Skill(skill="sp:session-review", args="$ARGUMENTS")
```
