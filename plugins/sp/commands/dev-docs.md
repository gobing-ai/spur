---
description: Refresh project documentation after implementation — update ADR, architecture, design, and feature docs
argument-hint: "[--scope <doc>] [--since <ref>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Docs

Wraps the **sp:doc-evolve** skill (documentation refresh).

After implementation lands, refresh the project's key documentation: update `04_DESIGN.md`
surface shapes, flip `05_FEATURES.md` status rows, sync `02_ROADMAP.md` phase markers,
and check for drift per `docs/99_PROJECT_CONSTITUTION.md`. Delegates to the
constitution-driven doc-evolve skill.

## When to use

- A feature or command has shipped and docs need syncing.
- Phase-exit documentation audit.
- The operator says "update the docs" or "sync the design doc."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--scope <doc>` | Limit to one doc: `04`, `05`, `02`, `all` | `all` |
| `--since <ref>` | Git ref to diff against for change detection | (working tree vs HEAD) |

## Behavior

Thin wrapper: delegates to `sp:doc-evolve` for drift detection, sync checks, and
documentation edits per the constitution's edit rules.

## Implementation

Delegates to **sp:doc-evolve** skill:

```
Skill(skill="sp:doc-evolve", args="sync $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:doc-evolve` skill directly.
