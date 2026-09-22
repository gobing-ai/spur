---
description: Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report
role: reviewer
argument-hint: "<testee> [--agent <inline|auto|name>] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "Skill"]
---

# Dev Dogfood

Wraps the **sp:dogfood-testing** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<testee>` | Skill / command / CLI to exercise end-to-end. | required |
| `--agent` `<inline\|auto\|name>` | **Testee-scoped** agent the testee runs under — forwarded into the testee invocation; the dogfood driver always runs in the current session. | omit (forward nothing) |
| `--max-retry` `<n>` | Max auto-fix retries per step. `0` = observe-only. Mandatory (as `0` or `N`) for pipeline-driving testees and testees with a mutating `--fix` mode. | 2 |
| `--save` | Compatibility no-op; saving is now default. Retained until evidenced retirement. | off |
| `--task` | **Creates** a new review-template task for the findings (`spur task create --template review`) — it does not attach to or update the task under test. | off |
| `--chain-follow` | **Reads existing chained-leg evidence** (verdict artifacts, task-file diffs, review tables) after a chained leg completes, for attribution — it never executes the chained leg itself. Without it the driver stops at the testing boundary. | off |
| `--full` | Full report verbosity (all sections). | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-dogfood <testee> [--agent <inline|auto|name>] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:dogfood-testing", args="$ARGUMENTS")`

