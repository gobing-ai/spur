---
description: Generate or extend tests until the unit target is met
argument-hint: "<target> [--coverage <n>] [--agent <name|inherit|auto>] [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Unit

Run a **unit-testing workflow** that drives toward the unit target: focused coverage evidence for the
requested target (per-file line/function `>= 90%` by default) with `100%` passing tests.

Thin wrapper over the `sp:spur-dev` skill's `unit` operation. The skill owns the procedure — the
language-agnostic spine (file vs task-scoped workflows, gap categorization, coverage-vs-quality,
escalation) lives in [unit-testing.md](../skills/spur-dev/references/unit-testing.md), with per-stack
commands/parsing/idioms/gotchas in [stacks/](../skills/spur-dev/references/stacks/) adapters (bun-ts,
python, go). It runs against whatever stack the project uses. This command is standalone; it does not
delegate to the orchestration pipeline.

## When to use

- After implementation, when you want stronger unit coverage.
- When a specific file or module needs focused test extension.
- When a task file needs a dedicated testing pass before verification.

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `target` | Yes | WBS task number, task file path, source file path, or file glob |
| `--coverage <n>` | No | Override the default focused coverage target. Default: `90` |
| `--agent <name\|inherit\|auto>` | No | Agent override: `<name>` = explicit agent, `inherit` = current agent (default), `auto` = resolve current runtime |
| `--auto` | No | Skip confirmations where the delegated workflow supports it |

## Target resolution

The `target` selects the skill's workflow (full detection rules in the reference):

| Input pattern | Detected as | Workflow |
|---------------|-------------|----------|
| Ends with `.ts` / `.js`, or a glob (`*`, `**/*.ts`) | Source path / file glob | File-focused |
| Digits only (e.g. `0274`) | WBS number | Task-scoped |
| Ends with `.md` and is a task file | Task file path | Task-scoped |
| Any other string | Task ref | Task-scoped |

## Agent override

`--agent` is optional; default is the current agent (no external delegation). Supported values:
`inherit` (current agent), `auto` (resolve current runtime to its canonical name), or an explicit
agent name (`claude-code`, `codex`, `openclaw`, `opencode`, `antigravity`, `pi`). The value is passed
through to the skill verbatim and normalized there.

## Examples

```bash
# File-focused: test a specific file
/sp:dev-unit src/utils/helper.ts

# File-focused: stricter threshold
/sp:dev-unit src/utils/helper.ts --coverage 95

# File-focused: glob
/sp:dev-unit "src/**/*.ts"

# Task-scoped: local by default
/sp:dev-unit 0266

# Task-scoped: delegated testing
/sp:dev-unit 0266 --coverage 95 --agent codex --auto
```

## Implementation

Delegates to **sp:spur-dev** skill (unit operation). `$ARGUMENTS` passes all flags including `--agent`
through verbatim:

```
Skill(skill="sp:spur-dev", args="unit $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:spur-dev` skill's `unit` operation directly.
