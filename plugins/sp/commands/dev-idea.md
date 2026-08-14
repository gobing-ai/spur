---
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, idea-eval, feature-create, AC, feature-check, system-design, decompose, batch-create (Design by default), handoff
role: planner
argument-hint: "\"<idea>\" [--auto] [--skip-design] [--approve-taste]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Dev Idea

Wraps the **idea-pipeline.yaml** workflow.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `"<idea>"` | Vague idea to turn into a feature with AC and tasks. | required |
| `--auto` | Skip objective HITL gates only (taste gates still pause). | off |
| `--skip-design` | Omit system-design and per-task Design. | off |
| `--approve-taste` | With `--auto`: set idea_approved + design_approved so idea-eval / design-approval do not pause. | off |
| `--idea-approved` | Compatibility alias for idea_approved=true (subset of --approve-taste). | off |
| `--design-approved` | Compatibility alias for design_approved=true (subset of --approve-taste). | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-idea "<idea>"
  [--auto]              # skip objective HITL only (feature-check, batch-create)
  [--skip-design]       # design package off (system-design + task Design)
  [--approve-taste]     # with --auto: skip idea-eval + design-approval pauses
```

There is **no** `--design` force flag. Design is default-on; only `--skip-design` opts out.

**Aliases (one-release / scripts):** `--idea-approved` and `--design-approved` still map into the same
vars as subsets of `--approve-taste` (`idea_approved` / `design_approved`). Prefer `--approve-taste`.

## Implementation

Map flags → workflow vars, then:

```bash
spur workflow run .spur/workflows/idea-pipeline.yaml --vars '{
  "idea":"<text>",
  "profile":"interactive|auto",
  "design":"auto|skip",
  "design_approved":"false|true",
  "idea_approved":"false|true"
}'
```
