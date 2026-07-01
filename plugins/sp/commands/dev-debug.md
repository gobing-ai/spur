---
description: Structured debugging entry point — reproduce→isolate→root cause→fix→regression test protocol
argument-hint: "\"<error-description-or-log>\" [--agent <name|auto>] [--create-issue]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Debug

Wraps the **sp:sys-debugging** skill.

Systematic debugging protocol: reproduce the failure, isolate to the smallest case, identify root cause, apply a minimal fix, and add a regression test. A disciplined alternative to ad-hoc printf debugging.

## When to use

- A test is failing and you don't know why.
- A runtime error appears in logs or CI output.
- Investigating a flaky test.
- The operator says "debug this" or "why is this broken."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `error-description-or-log` | Error message, stack trace, or failure description (positional, required) | (required) |
| `--agent <name\|auto>` | Spawn the debugging session under a specific agent | (current session) |
| `--create-issue` | Create an issue task (`spur task create --template issue`) from the debugging session when root cause is found | off |

## Behavior

Thin wrapper: delegates to `sp:sys-debugging` which owns the 5-phase protocol (reproduce → isolate → root cause → fix → regression test), the "ask the debugger before the LLM" principle, and the 15-minute escalation rule. With `--create-issue`, the skill creates an issue task capturing the root cause, fix, and regression test.

## Implementation

```
Skill(skill="sp:sys-debugging", args="debug <error-description>")
```

## See Also

- **sp:sys-debugging** — the backing competency skill (5-phase protocol).
- **sp:code-implementation** — the implement step that follows root-cause identification.
- **sp:code-testing** — the test runner for regression tests.
