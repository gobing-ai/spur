---
description: Fan out independent tasks or investigations in parallel via subagents — choose the right pattern and synthesize results
argument-hint: "--tasks <selector> [--mode <fan-out|review-panel|investigation>] [--agent <name|auto>] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Parallel

Wraps the **sp:parallel-execution** skill.

Fan out independent work across subagents. Choose the right fan-out pattern for the job, spawn subagents in parallel, and synthesize their outputs into a single coherent result.

## When to use

- A batch of tasks has independent items that can run concurrently.
- A review needs multiple lenses applied in parallel.
- An investigation benefits from multiple search angles.
- The operator says "fan out", "run in parallel", or "parallelize this."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--tasks <selector>` | Task selector — same syntax as `dev-runall` (`feature:<id>`, `status:<s>`, comma-separated WBS list) | (required) |
| `--mode <fan-out\|review-panel\|investigation>` | Fan-out pattern. `fan-out`: independent-task batch (default). `review-panel`: competency-lens review. `investigation`: N-way investigation. | `fan-out` |
| `--agent <name\|auto>` | Spawn each subagent under this agent. Omit → each subagent uses the configured default executor. | (configured default) |
| `--json` | Output machine-readable JSON | off |

## Behavior

Thin wrapper: delegates to `sp:parallel-execution` which owns the decision framework, fan-out patterns, and result synthesis. This command parameterizes the task selector and mode.

### Fan-out mode (default)

1. Resolve `--tasks` selector to a task set via `spur task list --json`.
2. Topo-sort by dependencies; identify the independent subset (zero dependency edges, no file-overlap).
3. Dispatch each independent task to a subagent via `spur agent run`.
4. Synthesize subagent outputs per the [result-synthesis contract](../skills/parallel-execution/references/result-synthesis.md).
5. Report: per-task results + synthesis stats.

### Review-panel mode

1. Read the target task's diff or artifact.
2. Dispatch N subagents, each through one review lens (security, efficiency, correctness, usability, architecture).
3. Synthesize: dedup findings, surface conflicts, emit unified P1–P4 table.

### Investigation mode

1. Formulate N independent search angles for the question.
2. Dispatch each angle to a subagent.
3. Dedup and merge findings; rank by confidence.

## Implementation

```
Skill(skill="sp:parallel-execution", args="$ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation, `spur agent run` for subagent spawns.
- **Other platforms:** Run the decision framework manually; spawn subagents via platform-native multi-agent mechanism.

## See Also

- **sp:parallel-execution** — the backing competency skill (decision framework, fan-out patterns, result synthesis).
- **sp:super-coder** — the batch orchestrator that can run in parallel mode.
- **sp:spur-dev** — the sequential pipeline spine.
