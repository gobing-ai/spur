---
description: "Render the session-forensics report from imported history data (8 CLI-derivable sections plus 6 model-authored), identify bottlenecks and behavioral anti-patterns, and optionally create a structured fix task behind --create-task. Triggers: post-mortem, performance analysis, session review, find issues, identify bottlenecks"
role: reviewer
argument-hint: "[<topic>] [--sessions <glob>] [--source <auto|pi|claude|codex|gemini|opencode|antigravity|openclaw|omp|grok|agy|all>] [--feature <id>] [--template <meta|issue|standard>] [--priority <P0|P1|P2|P3>] [--severity <S0|S1|S2>] [--category <list>] [--since <iso>] [--until <iso>] [--top <n>] [--min-cost <duration>] [--strict-topic] [--create-task] [--agent <inline|auto|name>] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob", "Skill"]
---

# Dev Find Issue

Wraps the **sp:issue-finding** skill — report-first session forensics over the history data plane.
The CLI renders the 8 derivable report sections (`spur history report --mode forensics`); the skill
identifies bottlenecks, proposes fixes, and — only with `--create-task` — generates a structured
task file via `spur task create`.

## Argument Flags

| Flag                                                                                                 | Description                                                                                                                   | Default    |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `[<topic>]`                                                                                          | Narrow the analysis to a topic.                                                                                               | omitted    |
| `--sessions` `<glob>`                                                                                | Session log glob (fallback input).                                                                                            | recent     |
| `--source` `<auto\|pi\|claude\|codex\|gemini\|opencode\|antigravity\|openclaw\|omp\|grok\|agy\|all>` | Agent source to scan (CLI vocabulary; `all` fans out, `auto` resolves at runtime).                                            | auto       |
| `--feature` `<id>`                                                                                   | Attach the generated task to a feature.                                                                                       | omitted    |
| `--template` `<meta\|issue\|standard>`                                                               | Task template shape (`--create-task` only); `issue` is the explicit single-finding override, `standard` the generic override. | meta       |
| `--priority` `<P0\|P1\|P2\|P3>`                                                                      | Filter / assign task priority.                                                                                                | P2         |
| `--severity` `<S0\|S1\|S2>`                                                                          | Filter / assign severity.                                                                                                     | all        |
| `--category` `<list>`                                                                                | Comma list of categories to keep.                                                                                             | all        |
| `--since` `<iso>`                                                                                    | Start of the scan window.                                                                                                     | configured |
| `--until` `<iso>`                                                                                    | End of the scan window.                                                                                                       | now        |
| `--top` `<n>`                                                                                        | Limit to top N findings.                                                                                                      | omitted    |
| `--min-cost` `<duration>`                                                                            | Minimum wasted duration to report.                                                                                            | omitted    |
| `--strict-topic`                                                                                     | Drop findings off-topic.                                                                                                      | off        |
| `--create-task`                                                                                      | Generate a fix task for findings.                                                                                             | off        |
| `--agent` `<inline\|auto\|name>`                                                                     | Who runs the model-bearing analysis.                                                                                          | omit       |
| `--json`                                                                                             | Emit structured JSON.                                                                                                         | off        |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-find-issue
/sp:dev-find-issue "test-loop spinning"
/sp:dev-find-issue --sessions "~/.omp/agent/sessions/-xprojects-spur-new/2026-07-29T*"
/sp:dev-find-issue "L3 guard format discovery" --feature H51 --priority P1 --severity S1
/sp:dev-find-issue --category test-loop,guard --min-cost 30m
/sp:dev-find-issue --source claude --since 2026-07-28 --create-task --json
```

**Report-first (task 0556).** Default output is the markdown report to stdout; no task file is
written. Task creation moved behind `--create-task`. `--use-history` and `--no-task` are removed:
the history data plane is now the primary source (no flag needed), and the old report-only behavior
is the new default. Raw JSONL remains a fallback under the three conditions documented in
`sp:issue-finding`.

**Data-plane preflight.** Forensics read the imported history plane as-is. If findings come back
empty or stale, run `/sp:dev-history-load` (on-demand cumulative `spur history import` + analyze,
checkpoint resume — task 0567) before re-running forensics; it owns the interactive preflight, while
`spur history daily` owns the periodic cadence.

**See also:** skill `sp:issue-finding` (SSOT), `/sp:dev-runall`, `/sp:dev-dogfood`,
`sp:daily-summary`, `sp:reverse-engineering`.

## Implementation

Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface), then invoke the issue-finding skill, forwarding all arguments:

```
Skill(skill="sp:issue-finding", args="$ARGUMENTS")
```
