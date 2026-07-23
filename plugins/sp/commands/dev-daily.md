---
description: "Generate a daily summary report from agent usage data, git history, and notes"
argument-hint: "[--date <YYYY-MM-DD>] [--dry-run] [--output <path>] [--no-git] [--no-ccusage]"
allowed-tools: ["Bash", "Read"]
---

# Dev Daily

Runs the daily-summary generator — see [daily-summary/SKILL.md](../skills/daily-summary/SKILL.md) for the authoritative procedure. `sp:daily-summary` is `disable-model-invocation`, so it cannot be fired via the Skill tool; this command runs its script directly.

## Usage

/sp:dev-daily [--date <YYYY-MM-DD>] [--dry-run] [--output <path>] [--no-git] [--no-ccusage]

## Implementation

Run the generator per [daily-summary/SKILL.md](../skills/daily-summary/SKILL.md): `bun plugins/sp/scripts/daily-summary/daily-summary.ts $ARGUMENTS`.
