---
description: Review code for a task — SECUA framework review across Security, Efficiency, Correctness, Usability, and Architecture
argument-hint: "<wbs> [--agent <name|auto>] [--focus <lens>] [--fix <none|blockers-first|all>] [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Review

Wraps the **sp:code-verification** skill (review mode).

Review code changes for a task using the SECUA framework (**S**ecurity, **E**fficiency,
**C**orrectness, **U**sability, **A**rchitecture). Analyzes the task's diff, produces severity-ranked findings, and
writes them to the task's `## Review` section. Source-oriented: unlike `/sp:dev-verify`, it runs the
SECUA review only — no requirements-traceability verdict and no pipeline gate artifact.

## When to use

- A task's implementation is complete and needs a focused quality/security audit.
- The operator says "review this" or "check the code."
- You want SECUA findings without the full verify verdict (use `/sp:dev-verify` for that).

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--agent <name\|auto>` | Spawn the review under a specific agent. Omit (the default) → the review runs under the configured default executor (`omp`). **Current-agent execution is not expressible** (subprocess FSM). | (configured default — `omp`) |
| `--focus <lens>` | SECUA dimensions: `all`, `security`, `efficiency`, `correctness`, `usability`, `architecture`, or comma-separated | `all` |
| `--fix <strategy>` | Post-review repair: `none`, `blockers-first`, `all` | `none` |
| `--auto` | Skip confirmations for the review/fix pass (CI / pipeline use) | off |

## Behavior

Thin wrapper: diff scope, SECUA analysis, findings ranking, and write-back are all owned by the
skill.

### Agent override

`--agent` is a **pipeline** command (per the two-surface contract in
[cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Honor `--agent`"). The review runs
as a spawned step; the calling agent cannot block on itself, so "current agent" is **not expressible**.
Omit the flag → the configured default executor (`omp`) runs the review. An explicit `--agent <name>`
or `--agent auto` spawns that agent instead. Documented honestly — no `inherit` token implies otherwise.

## Implementation

Delegates to **sp:code-verification** skill (review mode). `$ARGUMENTS` passes all flags including `--agent` and `--auto` through verbatim:

```
Skill(skill="sp:code-verification", args="review $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:code-verification` skill's review mode directly.
