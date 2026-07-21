---
name: sp-dev-brainstorm
description: Interactive solution design — heuristic discovery interview followed by structured ideation with trade-offs and confidence scoring
disable-model-invocation: true
---

# Dev Brainstorm

Wraps the **sp:brainstorm** and **sp:wayfinder** skills.

## Usage

$sp-dev-brainstorm <topic> [--depth <basic|detailed|comprehensive>] [--options <n>] [--agent <name|auto>] [--skip-discovery] [--wayfind] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]

## Implementation

- Default: Invoke the **sp:brainstorm** skill with args `dev-brainstorm --context <decision-tree> --options <n>`.
- `--wayfind`: Invoke the **sp:wayfinder** skill with args `chart --destination <destination> --context <decision-tree>`.

<!-- adapter:generated v1 snapshot:381b4354a16b — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
