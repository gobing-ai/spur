---
description: "Review the active coding-agent session immediately: summarize outcomes, distinguish resolved and open issues with evidence, and propose bounded improvements. With --fix auto (alias --triage): apply pure-doc / one-to-two-line fixes inline, then file remaining findings as one or more implement-ready tasks. With --fix all: fix every actionable finding inline and file no task. Triggers: review this session, session wrap-up, immediate retrospective, what happened, what was resolved, triage findings"
role: reviewer
argument-hint: "[<focus>] [--fix <none|auto|all>] [--triage]"
allowed-tools: ["Bash", "Read", "Grep", "Glob", "Skill"]
---

# Dev Review Session

Wraps the **sp:session-review** skill for a lightweight review of the active host session. By
default it is report-only: current conversation plus read-only repository evidence, run inline so
the session context is preserved — no workflow launch, history import, task creation, or
remediation. With `--fix auto`, it first triages the findings, then applies direct fixes (pure
documentation work and one-to-two-line fixes) inline and files everything remaining as one or more
implement-ready tasks for further fixing; `--triage` is an alias of `--fix auto`. With `--fix all`,
it defers nothing: every actionable finding is fixed inline and no task is filed. The result includes a non-overlapping time breakdown —
work time, operator wait, tool calls and tokens (total / non-cached) per stage, measured from the host transcript by
`session-timeline.mjs` — with durations in `M:SS` or `H:MM:SS` form and `n/a` only when that
measurement is unavailable. The transcript resolves from `--transcript`, else
`CLAUDE_CODE_SESSION_ID`, else `PI_SESSION_FILE` (the pi host sets it and no Claude session id); a
skill-injected `<skill name="…">` body counts as activity in `injectedPrompts`, never as a segment.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<focus>]` | Optional question or operation to emphasize without excluding material session outcomes. | full active session |
| `--fix` `<none\|auto\|all>` | Remediation after the report. `none`: report-only. `auto`: bucket findings → apply pure-doc / 1–2-line fixes inline → file the remainder as one or more implement-ready tasks. `all`: fix every actionable finding inline, file no task. | none |
| `--triage` | Alias of `--fix auto`; an explicit `--fix` wins when both are passed. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-review-session
/sp:dev-review-session "why the verification loop repeated"
/sp:dev-review-session --fix auto        # same as --triage
/sp:dev-review-session --fix all
/sp:dev-review-session "F95 findings" --triage
```

## Implementation

Invoke the skill directly in the active host session; do not delegate to a subagent or subprocess.

```
Skill(skill="sp:session-review", args="$ARGUMENTS")
```
