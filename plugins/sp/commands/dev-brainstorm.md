---
description: Interactive solution design — heuristic discovery interview followed by structured ideation with trade-offs and confidence scoring
role: planner
argument-hint: "<topic> [--depth <basic|detailed|comprehensive>] [--options <n>] [--agent <inline|auto|name>] [--skip-discovery] [--wayfind] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Brainstorm

Wraps the **sp:brainstorm** and **sp:wayfinder** skills.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<topic>` | Topic or problem statement to explore. | required |
| `--depth` `<basic\|detailed\|comprehensive>` | Breadth vs. depth of the exploration. | detailed |
| `--options` `<n>` | Number of solution options to generate. | 3 |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing ideation. | omit |
| `--skip-discovery` | Skip the discovery interview; ideate immediately. | off |
| `--wayfind` | Spawn a wayfinder feature for multi-session routing. | off |
| `--task` `[<feature-id>]` | Create a tracking task under a feature. | omitted |
| `--feature` `[<parent-id>]` | Attach the result to a parent feature. | omitted |
| `--next` | Hand off to the next-router on success. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-brainstorm <topic> [--depth <basic|detailed|comprehensive>] [--options <n>] [--agent <inline|auto|name>] [--skip-discovery] [--wayfind] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Default: `Skill(skill="sp:brainstorm", args="dev-brainstorm --context <decision-tree> --options <n>")`
- `--wayfind`: `Skill(skill="sp:wayfinder", args="chart --destination <destination> --context <decision-tree>")`

`--next`: chain-to-completion with
propagation. Only meaningful with `--feature` (the front-half artifact exit): on a clean
`feature check`, chain into `/sp:dev-plan --feature <ID>` so the planning half runs end-to-end.
Ignored without `--feature` (there is no task in a lifecycle to advance). **was: `--next` declared but never defined.**
