---
description: Refine a batch of tasks via structured Q&A — resolve a set (feature or selector), refine each in dependency-correct order, emit a batch report
argument-hint: "--feature <id> | [`--tasks`](../skills/spur-dev/references/flag-glossary.md#flag-tasks) <selector> [--focus <mode>] [--description <text>] [[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/flag-glossary.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/flag-glossary.md#flag-subprocess)] [--auto] [--keep-going] [--status <s>] [--json]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refineall

Wraps the **sp:spur-dev** skill. Batch counterpart of `/sp:dev-refine` — same per-task refine
operation, applied to a resolved set (typically every task under a feature).

## Usage

```
/sp:dev-refineall --feature <id> [shared refine flags…] [--inline|--subprocess]
/sp:dev-refineall --tasks <selector> [shared refine flags…] [--inline|--subprocess]
```

Flags: [`--feature`](../skills/spur-dev/references/flag-glossary.md#flag-feature) (sugar for `feature:<id>`), `--tasks <selector>`, shared refine flags
([`--focus`](../skills/spur-dev/references/flag-glossary.md#flag-focus), [`--description`](../skills/spur-dev/references/flag-glossary.md#flag-description), `--agent`, [`--auto`](../skills/spur-dev/references/flag-glossary.md#flag-auto)),
plus [`--keep-going`](../skills/spur-dev/references/flag-glossary.md#flag-keep-going),
[`--status`](../skills/spur-dev/references/flag-glossary.md#flag-status) (default `backlog,todo`),
[`--json`](../skills/spur-dev/references/flag-glossary.md#flag-json). Prefer `--auto` for batch
scale. Full procedure: `plugins/sp/skills/spur-dev/references/dev-operations.md` § refineall.

> **`--next` dropped** (feature H8, 2026-07-31). Batch-level chaining was a token bomb — each refine
> hop is an LLM call, and a large feature means N refine chains fanned out at once. For batch
> chaining, run `/sp:dev-refineall` first (this command, no `--next`), then
> `/sp:dev-runall --feature <id> --next` which chains each task's run → verify → wrap sequentially.
> **was: `--next` declared with a self-contradicting "avoid --next" warning.**

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Batch orchestration: `Skill(skill="sp:spur-dev", args="refineall $ARGUMENTS")`
- Per-task refine (inner): `Skill(skill="sp:spur-dev", args="refine <wbs> $SHARED_FLAGS")`
