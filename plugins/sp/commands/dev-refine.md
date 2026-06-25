---
description: Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria
argument-hint: "<wbs> [--focus <mode>] [--description <text>] [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Refine

Wraps the **sp:spur-dev** skill (task refinement).

Refine a task's requirements by analyzing existing content for quality issues and improving them through targeted Q&A. Read the task's current state, identify ambiguities and gaps in the acceptance criteria, and ask targeted questions to tighten the spec. Updates the task's sections via `spur task update --section` after each Q&A round.

## When to use

- Task has vague or incomplete Requirements section.
- Requirements lack acceptance criteria or testability.
- Background section is too brief.
- Need to clarify scope boundaries or constraints.
- Pre-planning refinement before decomposition.
- The operator says "refine this task" or "tighten the requirements."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | WBS number or task file path (required, positional) | (required) |
| `--description <text>` | Additional context to guide Q&A synthesis | (none) |
| `--focus <mode>` | Predefined hint bundle that expands into domain hints (see below) | `all` |
| `--auto` | Skip interactive Q&A — use AI synthesis only | off |

### Smart Positional Detection

| Input Pattern | Detection | Example |
|---------------|-----------|---------|
| Digits only | WBS number | `0274` |
| Ends with `.md` | File path | `docs/tasks/0274_my-task.md` |

### `--focus` Values

Selects a predefined **hint bundle** that expands into domain hints for the refinement skill.

| Value | Domain Hints | When to Use |
|-------|-------------|-------------|
| `all` | `purpose,scope,constraints,dependencies,acceptance_criteria,users,timeline` | Complete refinement |
| `requirements` | `purpose,scope,acceptance_criteria` | Standard refinement |
| `background` | `purpose,scope` | Brief tasks needing context |
| `constraints` | `constraints,dependencies,timeline` | Technical depth needed |
| `acceptance` | `acceptance_criteria,users` | Focus on verification |
| `quick` | `scope,acceptance_criteria` | Fast refinement |

## Behavior

Thin wrapper: task reading, gap analysis, Q&A, and section updates are all owned by the skill.

## Workflow

1. **Resolve wbs** → Load task file from WBS or path.
2. **Analyze** → Check content for gaps and ambiguities against the focus bundle.
3. **Question** → Generate targeted Q&A based on the expanded domain hints.
4. **Synthesize** → Update Background, Requirements, and Constraints sections via `spur task update --section`.
5. **Profile** → Auto-set template/preset based on scope and complexity.

## Examples

| Command | Effect |
|---------|--------|
| `/sp:dev-refine 0274` | Full refinement (all categories) |
| `/sp:dev-refine 0274 --focus acceptance` | Focus on acceptance criteria only |
| `/sp:dev-refine 0274 --focus quick` | Fast: scope + acceptance only |
| `/sp:dev-refine 0274 --description "CLI tool for auth"` | Add context hint |
| `/sp:dev-refine 0274 --auto` | AI synthesis only (no interactive Q&A) |
| `/sp:dev-refine 0274 --focus quick --auto` | Quick + auto |

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:spur-dev` skill's `refine` operation directly.
