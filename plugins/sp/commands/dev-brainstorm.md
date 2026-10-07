---
description: Interactive solution design — heuristic discovery interview followed by structured ideation with trade-offs and confidence scoring
role: planner
argument-hint: "<topic> [--depth <basic|detailed|comprehensive>] [--options <n>] [--agent <inline|auto|name>] [--skip-discovery] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Brainstorm

Wraps the **sp:brainstorm** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<topic>` | Topic or problem statement to explore. | required |
| `--depth` `<basic\|detailed\|comprehensive>` | How deep the discovery interview walks the decision tree. | detailed |
| `--options` `<n>` | Number of solution approaches to generate. | 3 |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing ideation. | omit |
| `--skip-discovery` | Skip the discovery interview; ideate immediately. | off |
| `--task` `[<feature-id>]` | Artifact exit: create one `todo` task from the chosen approach, optionally under `<feature-id>`. | omitted |
| `--feature` `[<parent-id>]` | Artifact exit: create a validated feature (Goal/Scope/BDD AC) from the chosen approach, optionally under `<parent-id>`. | omitted |
| `--next` | With `--feature` only: on a clean `feature check`, chain into `/sp:dev-plan --feature <ID>`. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-brainstorm "<topic>" [--depth <basic|detailed|comprehensive>] [--options <n>] [--agent <inline|auto|name>] [--skip-discovery] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]
```

Two phases:

1. **Discovery** — a grilling interview, one question at a time, each with a recommended answer;
   the codebase is explored before the operator is asked. Produces a resolved decision tree.
   `--skip-discovery` replaces it with the skill's lightweight clarification step.
2. **Ideation** — `--options` approaches, each with trade-offs, implementation notes, confidence
   and the decisions it depends on; one is marked recommended.

Without an exit flag the brainstorm output is the result. `--task` and `--feature` are mutually
exclusive (passing both is an error); the operator confirms the chosen approach before either
writes to the corpus. `--next` is ignored without `--feature`.

If discovery shows the destination itself is too foggy to spec in one session, stop and recommend
`/sp:dev-find-way "<topic>"` with the resolved decision tree as its starting notes. Never chart a
multi-session map from this command.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Discovery protocol: [grilling-interview.md](../skills/brainstorm/references/grilling-interview.md).
- Ideation: `Skill(skill="sp:brainstorm", args="dev-brainstorm --context <decision-tree> --options <n>")`
- Artifact exits and `--next`: [dev-operations.md § 12. brainstorm](../skills/spur-dev/references/dev-operations.md#12-brainstorm).
