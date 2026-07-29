---
description: "Review agent session logs, identify performance bottlenecks and behavioral anti-patterns, and generate a structured task file with proposed fixes. Triggers: post-mortem, performance analysis, session review, find issues, identify bottlenecks"
argument-hint: "[--sessions <glob>] [--feature <id>] [--template <name>] [--priority <P1|P2|P3|P4>] [--no-task] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob", "Skill"]
---

# Dev Find Issue

Wraps the **sp:issue-finding** skill — forensic session log analysis that identifies performance
bottlenecks, ranks root causes by time cost, proposes targeted fixes, and generates a structured
task file via `spur task create`.

## Usage

```
/sp:dev-findissue                                    # analyze most recent sessions for cwd
/sp:dev-findissue --sessions "~/.omp/.../2026-07-29T*"
/sp:dev-findissue --feature J4 --priority P2
/sp:dev-findissue --no-task                          # report findings to stdout only
/sp:dev-findissue --json                             # emit findings as JSON
```

| Argument | Description | Default |
|----------|-------------|---------|
| `--sessions <glob>` | Session JSONL file(s) or directory to analyze | most recent for cwd |
| `--feature <id>` | Feature ID to link the generated task to | (none) |
| `--template <name>` | Task template: `meta` (umbrella) or `standard` (single issue) | `meta` |
| `--priority <P1\|P2\|P3\|P4>` | Priority of the generated task | `P2` |
| `--no-task` | Report findings to stdout only; do not create a task | off |
| `--json` | Emit findings as JSON instead of creating a task | off |

**See also:** `/sp:dev-runall` (batch execution), `/sp:dev-dogfood` (end-to-end testing),
`sp:daily-summary` (activity reporting), `sp:reverse-engineering` (codebase archaeology).

## Implementation

Invoke the issue-finding skill, forwarding all arguments:

```
Skill(skill="sp:issue-finding", args="$ARGUMENTS")
```
