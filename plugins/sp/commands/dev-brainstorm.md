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

