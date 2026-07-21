---
description: Initialize a new Spur project — scaffold config + docs, then customize for this project's stack and scope
argument-hint: "[--name <name>] [--minimal] [--force] [--skip-docs]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Spur Init

Wraps **spur init** (deterministic scaffold) + **sp:doc-evolve** (project customization).

## Usage

/sp:spur-init [--name <name>] [--minimal] [--force] [--skip-docs]

## Implementation

```bash
spur init $ARGUMENTS
```
- Customize (Phase 2): `Skill(skill="sp:doc-evolve", args="customize --project <name>")`

<!-- adapter:generated v1 snapshot:91feea73d699 — regenerate: `bun plugins/sp/scripts/generate-adapters.ts`; a fresh session is required to trust an in-session dogfood of a just-edited wrapper -->
