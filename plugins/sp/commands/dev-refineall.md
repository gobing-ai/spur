---
description: Refine a batch of tasks via structured Q&A — resolve a set (feature or selector), refine each in dependency-correct order, emit a batch report
argument-hint: "--feature <id> | --tasks <selector> [--focus <mode>] [--description <text>] [--agent <name|auto>] [--auto] [--keep-going] [--status <s>] [--json] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refineall

Wraps the **sp:spur-dev** skill. Batch counterpart of `/sp:dev-refine` — same per-task refine
operation, applied to a resolved set (typically every task under a feature).

## Usage

```
/sp:dev-refineall --feature <id> [shared refine flags…]
/sp:dev-refineall --tasks <selector> [shared refine flags…]
```

Flags: `--feature` (sugar for `feature:<id>`), `--tasks <selector>`, shared refine flags
(`--focus`, `--description`, `--agent`, `--auto`, `--next`), plus `--keep-going`,
`--status` (default `backlog,todo`), `--json`. Prefer `--auto` for batch scale; avoid `--next`
on large features (use refineall then `/sp:dev-runall`). Full procedure:
`plugins/sp/skills/spur-dev/references/dev-operations.md` § refineall.

## Implementation

- Batch orchestration: `Skill(skill="sp:spur-dev", args="refineall $ARGUMENTS")`
- Per-task refine (inner): `Skill(skill="sp:spur-dev", args="refine <wbs> $SHARED_FLAGS")`
