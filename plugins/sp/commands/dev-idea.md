---
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, idea-eval, feature-create, AC, feature-check, system-design, decompose, batch-create (Design by default), handoff
argument-hint: "\"<idea>\" [--auto] [--skip-design] [--approve-taste]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Dev Idea

Wraps the **idea-pipeline.yaml** workflow.

## Usage

```
/sp:dev-idea "<idea>"
  [--auto]              # skip objective HITL only (feature-check, batch-create)
  [--skip-design]       # design package off (system-design + task Design)
  [--approve-taste]     # with --auto: skip idea-eval + design-approval pauses
```

| Flag | Axis | Effect |
|------|------|--------|
| *(none)* | interactive | All HITL; design package on by default |
| [`--auto`](../skills/spur-dev/references/dev-operations.md#flag-auto) | HITL depth | Skip **objective** gates; **taste** gates still pause |
| [`--skip-design`](../skills/spur-dev/references/dev-operations.md#flag-skip-design) | scope | No system-design; omit per-task Design (refine later) |
| [`--approve-taste`](../skills/spur-dev/references/dev-operations.md#flag-approve-taste) | taste re-entry | Only meaningful with `--auto`: sets `idea_approved` + `design_approved` so idea-eval and design-approval do not pause |

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

| Flag | Vars |
|------|------|
| `--auto` | `profile=auto` |
| `--skip-design` | `design=skip` |
| `--approve-taste` | `idea_approved=true` **and** `design_approved=true` |
| `--idea-approved` (alias) | `idea_approved=true` |
| `--design-approved` (alias) | `design_approved=true` |
