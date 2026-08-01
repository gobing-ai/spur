---
description: Interactive solution design — heuristic discovery interview followed by structured ideation with trade-offs and confidence scoring
argument-hint: "<topic> [--depth <basic|detailed|comprehensive>] [--options <n>] [--agent <name|auto>] [--skip-discovery] [--wayfind] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Brainstorm

Wraps the **sp:brainstorm** and **sp:wayfinder** skills.

## Usage

/sp:dev-brainstorm <topic> [--depth <basic|detailed|comprehensive>] [--options <n>] [--agent <name|auto>] [--skip-discovery] [--wayfind] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]

## Implementation

- Default: `Skill(skill="sp:brainstorm", args="dev-brainstorm --context <decision-tree> --options <n>")`
- `--wayfind`: `Skill(skill="sp:wayfinder", args="chart --destination <destination> --context <decision-tree>")`

[`--next`](../skills/spur-dev/references/dev-operations.md#flag-next): chain-to-completion with
propagation. Only meaningful with [`--feature`](../skills/spur-dev/references/dev-operations.md#flag-feature) (the front-half artifact exit): on a clean
`feature check`, chain into `/sp:dev-plan --feature <ID>` so the planning half runs end-to-end.
Ignored without `--feature` (there is no task in a lifecycle to advance). **was: `--next` declared but never defined.**

