---
description: Review code for a task — SECU framework review across Security, Efficiency, Correctness, and Usability
argument-hint: "<wbs> [--agent <name|inherit|auto>] [--focus <lens>] [--fix <none|blockers-first|all>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Review

Wraps the **sp:code-verification** skill (review mode).

Review code changes for a task using the SECU framework (**S**ecurity, **E**fficiency,
**C**orrectness, **U**sability). Analyzes the task's diff, produces severity-ranked findings, and
writes them to the task's `## Review` section. Source-oriented: unlike `/sp:dev-verify`, it runs the
SECU review only — no requirements-traceability verdict and no pipeline gate artifact.

## When to use

- A task's implementation is complete and needs a focused quality/security audit.
- The operator says "review this" or "check the code."
- You want SECU findings without the full verify verdict (use `/sp:dev-verify` for that).

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--agent <name\|inherit\|auto>` | Agent override: `<name>` = explicit agent, `inherit` = pipeline default, `auto` = resolve current agent | inherit |
| `--focus <lens>` | SECU dimensions: `all`, `security`, `efficiency`, `correctness`, `usability`, or comma-separated | `all` |
| `--fix <strategy>` | Post-review repair: `none`, `blockers-first`, `all` | `none` |

## Behavior

Thin wrapper: diff scope, SECU analysis, findings ranking, and write-back are all owned by the
skill.

### Agent override

`--agent` controls which agent executes the review. Passed through `$ARGUMENTS` to the backing
`sp:code-verification` skill. Semantics: `<name>` = explicit agent, `inherit` = pipeline default,
`auto` = resolve from current runtime.

## Implementation

Delegates to **sp:code-verification** skill (review mode). `$ARGUMENTS` passes all flags including `--agent` through verbatim:

```
Skill(skill="sp:code-verification", args="review $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:code-verification` skill's review mode directly.
