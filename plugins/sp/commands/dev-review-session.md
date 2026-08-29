---
description: "Review the active coding-agent session immediately: summarize outcomes, distinguish resolved and open issues with evidence, and propose bounded improvements. With --triage: apply pure-doc / one-to-two-line fixes inline, then file remaining findings as one new task. Triggers: review this session, session wrap-up, immediate retrospective, what happened, what was resolved, triage findings"
role: reviewer
argument-hint: "[<focus>] [--triage]"
allowed-tools: ["Bash", "Read", "Grep", "Glob", "Skill"]
---

# Dev Review Session

Wraps the **sp:session-review** skill for a lightweight review of the active host session. By
default it is report-only: current conversation plus read-only repository evidence, run inline so
the session context is preserved — no workflow launch, history import, task creation, or
remediation. With `--triage`, it first triages the findings, then applies direct fixes (pure
documentation work and one-to-two-line fixes) inline and files everything remaining as exactly one
new task for further fixing.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<focus>]` | Optional question or operation to emphasize without excluding material session outcomes. | full active session |
| `--triage` | After the report: bucket findings → apply pure-doc / 1–2-line fixes inline → create one task for the remainder. | off (report-only) |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-review-session
/sp:dev-review-session "why the verification loop repeated"
/sp:dev-review-session --triage
/sp:dev-review-session "F95 findings" --triage
```

## Implementation

Invoke the skill directly in the active host session; do not delegate to a subagent or subprocess.

```
Skill(skill="sp:session-review", args="$ARGUMENTS")
```
