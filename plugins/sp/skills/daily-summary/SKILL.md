---
name: daily-summary
description: "Generate a daily summary report from agent usage, git history, and your notes."
disable-model-invocation: true
license: Apache-2.0
version: 1.0.0
created_at: 2026-04-17
updated_at: 2026-04-17
platform: sp
tags: [summary, daily, analytics, reporting, engineering-core]
metadata:
  author: cc-agents
  platforms: "claude-code,codex,antigravity,opencode,openclaw"
  category: engineering-core
  interactions:
    - pipeline
    - inversion
  pipeline_steps:
    - data-collection
    - user-input
    - generate-summary
    - validate-output
  openclaw:
    emoji: "📊"
see_also:
  - sp:dev-handover
  - sp:dev-changelog
  - sp:spur-cli
---

# sp:daily-summary — Daily Summary Report Generator

Generate daily summary reports for personal review and AI infrastructure optimization. Combines token usage data (via ccusage), git history, and user annotations into a structured markdown report.

## When to Use

**Trigger phrases:** "daily summary", "end of day", "wrap up", "daily report", "what did I do today"

This command is designed to be run at the end of the workday or first thing the next morning to review previous day's activity.

## Overview

The daily-summary skill:
1. Collects token usage from ccusage CLI (Claude Code, Codex, etc.)
2. Extracts git history (commits, changes) for the day
3. Prompts user for learnings, issues fixed, and pending tasks
4. Generates a timestamped markdown summary
5. Outputs to `docs/daily/summary_yyyymmdd.md`
6. Surfaces the newest history report path when a nightly `spur history daily` artifact exists (R7)

## Quick Start

```bash
# Generate summary for today
node "$(superskill script path sp daily-summary/daily-summary.mjs)"

# Generate summary for a specific date
node "$(superskill script path sp daily-summary/daily-summary.mjs)" --date 2026-04-17

# Show summary without writing file
node "$(superskill script path sp daily-summary/daily-summary.mjs)" --dry-run
```

## Workflows

### Phase 1: Data Collection

1. **Parse arguments** — Extract `--date` (default: today) and `--dry-run`
2. **Collect token usage** — Run `ccusage daily --json` for the date range
3. **Collect git history** — Run `git log --since` and `git diff --stat`
4. **Detect AI-related commits** — Parse commit messages for feat/fix/refactor patterns

### Phase 2: User Input

**Ask one question at a time.** Do not start generating the summary until all three prompts have been answered (empty answers allowed — press Enter to skip). The skill blocks on stdin; each question must be answered before the next is shown.

Interactive prompts for annotations:
```
Daily Summary — 2026-04-17

Please provide the following (press Enter to skip):

1. What did you learn today? (optional)
   > 

2. What issues did you fix? (optional)
   > 

3. What's pending for tomorrow? (optional)
   > 
```

### Phase 3: Generate Summary

Assemble sections into `docs/daily/summary_yyyymmdd.md`

### Phase 4: Validate & Output

- Verify file written successfully
- Display output path to user
- Show summary statistics

## Input Modes

| Input Pattern | Behavior |
|---------------|----------|
| `--date YYYY-MM-DD` | Generate summary for specified date |
| `--date yesterday` | Generate summary for previous day |
| `--dry-run` | Show summary without writing file |
| `--output <path>` | Write to custom path instead of default |
| `--no-git` | Skip git history collection |
| `--no-ccusage` | Skip token usage collection |

## Output

**File:** `docs/daily/summary_yyyymmdd.md`

**Sections:**

| Section | Mandatory | Source |
|---------|-----------|--------|
| Meta | Yes | Auto-detected (date, platforms) |
| Token Usage | If ccusage available | ccusage CLI |
| Git Activity | If git available | git log/diff |
| Commits | Yes | git log |
| Issues Fixed | If provided | User input |
| Learnings | If provided | User input |
| Pending | If provided | User input |
| History Report | If a nightly history artifact exists | `.spur/reports/history/latest.json` pointer (R7) |

## Data Sources

| Source | Tool | Data Retrieved |
|--------|------|---------------|
| Claude Code usage | ccusage daily | Tokens, cost, conversations |
| Git history | git log/diff | Commits, files changed |
| User annotations | Interactive prompt | Learnings, issues, pending |

## Integration

This skill orchestrates existing tools:
- **ccusage** for token usage data (must be installed)
- **git** for version control history
- **User input** for qualitative annotations

## Required Permissions

The skill shells out to external tools. Ensure these are allowed in the agent's permission profile:

| Command | Purpose | Required |
|---------|---------|----------|
| `ccusage daily --json` | Token usage telemetry | Optional (skipped with `--no-ccusage`) |
| `git log`, `git diff`, `git status` | Commit history | Optional (skipped with `--no-git`) |
| File write to `docs/daily/` | Output markdown report | Required unless `--dry-run` |

## Platform Notes

### Claude Code (primary)
```bash
skill(skill="sp:daily-summary", args="--date 2026-04-17")
```

### Other Platforms
Read the skill file and follow the workflow manually.

## Additional Resources

- **Script source:** [scripts/daily-summary/daily-summary.ts](../../scripts/daily-summary/daily-summary.ts) — CLI implementation
- **Tests:** [tests/daily-summary.test.ts](tests/daily-summary.test.ts) — unit coverage for parsing, date ranges, markdown output
- **Related skills:** `sp:dev-handover` (blocker handoff), `sp:dev-changelog` (commit-based changelog), `sp:spur-cli` (task management)
- **Upstream CLI:** [ccusage](https://github.com/ryoppippi/ccusage) — AI agent token usage reporter
