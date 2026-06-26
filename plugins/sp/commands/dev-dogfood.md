---
description: Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report
argument-hint: "<testee> [--agent <name|auto>] [--max-retry <n>] [--save] [--task] [--full]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "Skill"]
---

# Dev Dogfood

Wraps the **sp:dogfood-testing** skill.

Drive an agent skill, slash command, or CLI invocation **end-to-end** as a real user would, fix what
breaks along the way (within a bounded retry budget), monitor the whole run, and emit a comprehensive
report of what happened, what broke, was fixed, and should be improved.

## When to use

- Debugging or hardening an agent skill / slash command you are actively developing.
- Validating that a command works end-to-end before shipping it.
- Producing a structured findings report (and optionally a fix task) from a real run, instead of
  re-typing the same dogfood instructions every session.

> ⚠️ **Repo mutation warning.** By default (`--max-retry 2`), this command applies `Edit`/`Write`
> fixes directly to the working tree. **For a first run against any unfamiliar testee, always use
> `--max-retry 0` (observe-only)** — it monitors and reports without mutating the repo. Review the
> findings, then re-run with `--max-retry 2` (or higher) to apply fixes.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `testee` | What to exercise — a slash command, agent skill, or CLI invocation (positional, required). Quote it if it contains flags. | (required) |
| `--agent <name\|auto>` | **Testee-scoped:** the agent the **testee** runs under (forwarded into the testee invocation). The driver always runs in the current session. **Omit it** to forward nothing — the testee runs under its own default. | (omitted → forward nothing) |
| `--max-retry <n>` | Fix attempts per failed step. **`0` = observe-only**: monitor and report, never mutate the repo. Recommended for first runs against unfamiliar testees. | `2` |
| `--save` | Write the report to `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`. | off |
| `--task` | File the findings as a review-template task via `spur task create --template review`. | off |
| `--full` | Include **all** severity findings (P1–P4) in the report and `--task` output. Default filters to P1+P2 only. | off |

`--save` and `--task` are independent and composable. A **mandatory summary footer** (result +
issues + findings) is always printed inline regardless of `--save`.

> **Testee-scoped `--agent`.** Unlike the other `/sp:dev-*` commands (where `--agent` picks the agent
> doing the work), here the driver is always the current session; `--agent` sets the agent the
> **testee** runs under. Example: `/sp:dev-dogfood "/sp:dev-run 0125 --auto" --agent codex` runs the
> testee as `/sp:dev-run 0125 --auto --agent codex` while this session monitors and reports. See the
> skill's [§Testee-scoped agent](../skills/dogfood-testing/SKILL.md).

## Behavior

Thin wrapper: the 4-phase protocol (Plan → Execute+fix → Monitor → Report), the live ledger, the
report template, and the `--save`/`--task` sinks are all owned by the skill. This command parameterizes
the testee, the retry budget, the testee agent, and the sinks.

## Implementation

Delegates to **sp:dogfood-testing** skill:

```
Skill(skill="sp:dogfood-testing", args="$ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation, argument substitution, and the
  `Edit`/`Write`/`Bash` toolset work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:dogfood-testing`
  skill's protocol directly and run the `spur` CLI for the `--task` sink.

## See Also

- **`sp:dogfood-testing`** — the backbone skill that owns the protocol, ledger, and report template.
- **`/sp:dev-verify`** — requirements-traceability verdict for a coded task (PASS/PARTIAL/FAIL).
- **`/sp:dev-review`** — SECU code review of a task's diff.
- **`/sp:dev-run`** — runs a task (e.g. the one produced by `--task`) through the fix pipeline.
