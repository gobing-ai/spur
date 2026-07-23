---
description: Run a batch of tasks through their pipelines in dependency-correct order — resolve a set, topo-sort, run each via task-pipeline.yaml, emit a batch report
argument-hint: "--tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <name|auto>] [--json] [--wrap] [--continue]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Runall

Wraps the **sp:spur-dev** skill.

## Usage

/sp:dev-runall --tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <name|auto>] [--json] [--wrap] [--continue]

## Implementation

- `Skill(skill="sp:spur-dev", args="runall $ARGUMENTS")`

