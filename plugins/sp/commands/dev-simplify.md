---
description: Simplify code for clarity without changing behavior — reduce complexity in recent changes (or a given scope), preserving behavior exactly
argument-hint: "[<path-or-scope>] [--scope <recent|all|<path>>] [--check <cmd>] [--auto]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Dev Simplify

Wraps the **sp:code-simplification** skill.

Reduce the complexity of recently-changed code (or a specified scope) while preserving exact
behavior — guard clauses over deep nesting, descriptive names, shared functions over duplication,
dead-code removal — applied incrementally with a test run after each change. Quality only: this
does **not** hunt for bugs (that is `/sp:dev-review`) and does **not** add behavior.

## When to use

- A feature works and its tests pass, but the implementation reads heavier than it needs to.
- `/sp:dev-review` flagged readability/complexity and you want the cleanup pass.
- You want a behavior-preserving readability pass over a bounded diff before committing.

Do **not** use it to fix failing lint/types/tests across the tree — that is `/sp:dev-fixall`.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `path-or-scope` | Optional target — a file/dir path, or omit to default to recent changes | recent changes |
| `--scope <recent\|all\|<path>>` | `recent` = files in the current diff; `all` = the named module; `<path>` = an explicit path | `recent` |
| `--check <cmd>` | The narrowest test/build command to run after each change (e.g. `bun test path/x.test.ts`) | auto-detect from the stack |
| `--auto` | Skip confirmations; still reverts any change whose check fails | off |

## Behavior

Thin wrapper: scope selection, Chesterton's-Fence comprehension, the simplification signal tables,
incremental change + test-after-each, and the revert-on-regression rule are all owned by the skill.
The command only forwards `$ARGUMENTS`.

## Implementation

Delegates to the **sp:code-simplification** skill. `$ARGUMENTS` passes the scope and flags through verbatim:

```
Skill(skill="sp:code-simplification", args="$ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:code-simplification` skill directly and pass the scope/flags as its input.
