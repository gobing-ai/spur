---
description: Initialize a new Spur project — scaffold config + docs, then customize for this project's stack and scope
argument-hint: "[--name <name>] [--minimal] [--force]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Spur Init

Wraps **spur init** (deterministic scaffold) + **sp:doc-evolve** (project customization).

## Usage

/sp:spur-init [--name <name>] [--minimal] [--force]

## Implementation

```bash
spur init --json $ARGUMENTS
```
- Parse the JSON envelope once and retain it as `scaffoldResult`; summarize its created/skipped files in one block.
- Customize (Phase 2): `Skill(skill="sp:doc-evolve", args="customize --project <scaffoldResult.project>")`.
  Reuse the retained project value; do not rerun init or replay its create/exists transcript.
