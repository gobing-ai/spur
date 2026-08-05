---
description: Refine a batch of tasks via structured Q&A — resolve a set (feature or selector), refine each in dependency-correct order, emit a batch report; optional implement-ready depth
argument-hint: "--feature <id> | --tasks <selector> [--focus <mode>] [--description <text>] [--depth <standard|ready>] [--agent <inline|auto|name>] [--auto] [--keep-going] [--status <s>] [--json]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refineall

Wraps the **sp:spur-dev** skill. Batch counterpart of `/sp:dev-refine` — same per-task refine
operation, applied to a resolved set (typically every task under a feature). Pass
`--depth ready` to force an implement-ready freeze on every task (does not L3-SKIP).

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--feature` `<id>` | Refine all tasks in a feature. | required (one of `--feature` / `--tasks`) |
| `--tasks` `<selector>` | Task selector to refine (alternative to `--feature`). | required (one of `--feature` / `--tasks`) |
| `--focus` `<mode>` | Refinement focus mode. | omitted |
| `--description` `<text>` | Override description for each task. | omitted |
| `--depth` `<standard\|ready>` | Spec depth bar (see flag glossary). | `standard` |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing refinement. | inline |
| `--auto` | Skip objective HITL gates. | off |
| `--keep-going` | Continue past per-task failures. | off |
| `--status` `<s>` | Only refine tasks in a status. | backlog,todo |
| `--json` | Emit structured JSON. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-refineall --feature <id> [shared refine flags…] [--depth <standard|ready>] [--agent <inline|auto|name>]
/sp:dev-refineall --tasks <selector> [shared refine flags…] [--depth <standard|ready>] [--agent <inline|auto|name>]
```

Flags: `--feature` (sugar for `feature:<id>`), `--tasks <selector>`, shared refine flags
(`--focus`, `--description`, `--depth`, `--agent`, `--auto`),
plus `--keep-going`,
`--status` (default `backlog,todo`),
`--json`. Prefer `--auto` for batch
scale. Full procedure: `plugins/sp/skills/spur-dev/references/dev-operations.md` § refineall.

**Depth:** default `standard` keeps the cheap L3 SKIP gate under `--auto`. Use
`--depth ready` when handing a feature to another implementer (frozen Design/Requirements/Plan);
thread `--depth` into each per-task refine.

> **`--next` dropped** (feature H8, 2026-07-31). Batch-level chaining was a token bomb — each refine
> hop is an LLM call, and a large feature means N refine chains fanned out at once. For batch
> chaining, run `/sp:dev-refineall` first (this command, no `--next`), then
> `/sp:dev-runall --feature <id> --next` which chains each task's run → verify → wrap sequentially.
> **was: `--next` declared with a self-contradicting "avoid --next" warning.**

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Batch orchestration: `Skill(skill="sp:spur-dev", args="refineall $ARGUMENTS")`
- Per-task refine (inner): `Skill(skill="sp:spur-dev", args="refine <wbs> $SHARED_FLAGS")`
