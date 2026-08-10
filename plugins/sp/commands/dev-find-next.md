---
description: "Prompt-first feature frontier prioritizer — answers 'which feature should we work on now?' with a ranked, evidence-carrying frontier, and emits rank-distorting tree defects as proposals /sp:dev-featurechange consumes. Triggers: find next, which feature, feature ranking, frontier priority, what should I work on."
argument-hint: "[--agent <inline|auto|name>] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob", "Skill"]
---

# Dev Find Next

Wraps the **sp:next-feature** skill — a prompt-first prioritizer that ranks the open feature frontier
by **derived** importance and urgency, shows its evidence per candidate, gates unactionable features
instead of ranking them, and emits tree structure defects as proposals only.

Answers *"which X"* — the question `/sp:dev-next` deliberately does not (next-router routing-table
§0 step 1c). Advancing a chosen target remains `/sp:dev-next`'s job; applying tree changes remains
`/sp:dev-featurechange`'s job.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing analysis. | inline |
| `--json` | Emit the ranked frontier, gated list, and proposals as a JSON envelope. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```text
/sp:dev-find-next
/sp:dev-find-next --json
```

Read-only with respect to the corpus and docs: the command performs no `spur feature move`, no sync
apply, and no task/feature mutation. Defect proposals conform to the
`docs/plans/feature-tree-restructure-map.md` schema and are applied only through
`/sp:dev-featurechange` (dry-run → confirm → apply).

**See also:** skill `sp:next-feature` (SSOT), `sp:next-router` (`/sp:dev-next`),
`sp:conflict-finding` (the prompt-first template), `sp:spur-cli`.

## Implementation

Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface), then invoke the next-feature skill, forwarding all arguments:

```text
Skill(skill="sp:next-feature", args="$ARGUMENTS")
```
