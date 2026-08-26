---
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, idea-eval, feature-create, AC, feature-check, system-design, decompose, batch-create (Design by default), handoff
role: planner
argument-hint: "\"<idea>\" [--auto] [--skip-design] [--approve-taste] [--agent <auto|name>]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Idea

Wraps the **sp:spur-dev** skill; the machine is **idea-pipeline.yaml** — the stage
contract below maps to that workflow's transitions.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `"<idea>"` | Vague idea to turn into a feature with AC and tasks. | required |
| `--auto` | Skip objective HITL gates only (taste gates still pause). | off |
| `--skip-design` | Omit system-design and per-task Design. | off |
| `--approve-taste` | With `--auto`: set idea_approved + design_approved so idea-eval / design-approval do not pause. | off |
| `--idea-approved` | Compatibility alias for idea_approved=true (subset of --approve-taste). | off |
| `--design-approved` | Compatibility alias for design_approved=true (subset of --approve-taste). | off |
| `--agent` `<auto\|name>` | Who runs the model-bearing ideation. The pipeline's `agent.run` stages are headless — they always dispatch a subprocess, so `--agent inline` is rejected there with the stable special error (exit 2). Use `omit` (resolves to `agent.default`), `auto` (tier-resolves an executor), or a name (pins that executor). | agent.default |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-idea "<idea>"
  [--auto]              # skip objective HITL only (feature-check, batch-create)
  [--skip-design]       # design package off (system-design + task Design)
  [--approve-taste]     # with --auto: skip idea-eval + design-approval pauses
  [--agent <auto|name>]          # who runs the model-bearing ideation (default: agent.default)
```

There is **no** `--design` force flag. Design is default-on; only `--skip-design` opts out.

**Aliases (one-release / scripts):** `--idea-approved` and `--design-approved` still map into the same
vars as subsets of `--approve-taste` (`idea_approved` / `design_approved`). Prefer `--approve-taste`.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:spur-dev", args="idea $ARGUMENTS")`
- Stage contract (discovery → idea-eval → feature-create → AC → feature-check → system-design →
  decompose → batch-create → handoff): `plugins/sp/skills/spur-dev/references/dev-operations.md` § idea.
