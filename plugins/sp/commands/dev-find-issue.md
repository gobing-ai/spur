---
description: "Review agent session logs, identify performance bottlenecks and behavioral anti-patterns, and generate a structured task file with proposed fixes. Triggers: post-mortem, performance analysis, session review, find issues, identify bottlenecks"
argument-hint: "[<topic>] [--sessions <glob>] [--source <auto|omp|claude|codex|gemini|opencode|antigravity|openclaw|pi>] [--feature <id>] [--template <meta|issue|standard>] [--priority <P0|P1|P2|P3>] [--severity <S0|S1|S2>] [--category <list>] [--since <iso>] [--until <iso>] [--top <n>] [--min-cost <duration>] [--strict-topic] [--use-history] [--no-task] [--agent <inline|auto|name>] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob", "Skill"]
---

# Dev Find Issue

Wraps the **sp:issue-finding** skill — forensic session log analysis that identifies performance
bottlenecks, ranks root causes by time cost, proposes targeted fixes, and generates a structured
task file via `spur task create`.

## Argument Flags

| Flag                                                                                 | Description                          | Default    |
| ------------------------------------------------------------------------------------ | ------------------------------------ | ---------- |
| `[<topic>]`                                                                          | Narrow the analysis to a topic.      | omitted    |
| `--sessions` `<glob>`                                                                | Session log glob to scan.            | recent     |
| `--source` `<auto\|omp\|claude\|codex\|gemini\|opencode\|antigravity\|openclaw\|pi>` | Agent source to scan.                | auto       |
| `--feature` `<id>`                                                                   | Attach findings to a feature.        | omitted    |
| `--template` `<meta\|issue\|standard>`                                               | Output template shape.               | standard   |
| `--priority` `<P0\|P1\|P2\|P3>`                                                      | Filter / assign priority.            | omitted    |
| `--severity` `<S0\|S1\|S2>`                                                          | Filter / assign severity.            | omitted    |
| `--category` `<list>`                                                                | Comma list of categories to keep.    | all        |
| `--since` `<iso>`                                                                    | Start of the scan window.            | configured |
| `--until` `<iso>`                                                                    | End of the scan window.              | now        |
| `--top` `<n>`                                                                        | Limit to top N findings.             | omitted    |
| `--min-cost` `<duration>`                                                            | Minimum wasted duration to report.   | omitted    |
| `--strict-topic`                                                                     | Drop findings off-topic.             | off        |
| `--use-history`                                                                      | Incorporate indexed history.         | off        |
| `--no-task`                                                                          | Do not create a task for findings.   | off        |
| `--agent` `<inline\|auto\|name>`                                                     | Who runs the model-bearing analysis. | inline     |
| `--json`                                                                             | Emit structured JSON.                | off        |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-find-issue
/sp:dev-find-issue "test-loop spinning"
/sp:dev-find-issue --sessions "~/.omp/agent/sessions/-xprojects-spur-new/2026-07-29T*"
/sp:dev-find-issue "L3 guard format discovery" --feature H51 --priority P1 --severity S1
/sp:dev-find-issue --category test-loop,guard --min-cost 30m --no-task
/sp:dev-find-issue --source claude --since 2026-07-28 --json
/sp:dev-find-issue --sessions plugins/sp/skills/issue-finding/examples/session-test-loop.jsonl --no-task
```

| Argument                      | Description                                                                              | Default                         |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- |
| `[topic]`                     | Optional focus text or smart positional (path/glob → sessions; category phrase → filter) | (full taxonomy)                 |
| `--sessions <glob>`           | Session JSONL file(s) or directory                                                       | most recent for resolved source |
| `--source <name>`             | `auto`, `omp`, `claude`, `codex`, `gemini`, `opencode`, `antigravity`, `openclaw`, `pi`  | `auto`                          |
| `--feature <id>`              | Feature ID to link the generated task to                                                 | (none)                          |
| `--template <name>`           | `meta` (umbrella), `issue` (single), or `standard`                                       | `meta`                          |
| `--priority <P0\|P1\|P2\|P3>` | Task frontmatter priority (not bottleneck severity)                                      | `P2`                            |
| `--severity <S0\|S1\|S2>`     | Minimum bottleneck severity to keep                                                      | (all)                           |
| `--category <list>`           | Comma-separated category ids (`test-loop`, `guard`, …)                                   | `all`                           |
| `--since` / `--until`         | Session start time bounds                                                                | (none)                          |
| `--top <n>`                   | Cap number of fixes/requirements                                                         | (no cap)                        |
| `--min-cost <duration>`       | Drop findings under this waste floor (`30m`, `2h`)                                       | (none)                          |
| `--strict-topic`              | Drop off-topic findings even if severe                                                   | off                             |
| `--use-history`               | Optional `spur history` import/analyze for cost aggregates                               | off                             |
| `--no-task`                   | Markdown report only                                                                     | off                             |
| `--json`                      | JSON findings only (no task)                                                             | off                             |

**See also:** skill `sp:issue-finding` (SSOT), `/sp:dev-runall`, `/sp:dev-dogfood`,
`sp:daily-summary`, `sp:reverse-engineering`.

## Implementation

Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface), then invoke the issue-finding skill, forwarding all arguments:

```
Skill(skill="sp:issue-finding", args="$ARGUMENTS")
```
