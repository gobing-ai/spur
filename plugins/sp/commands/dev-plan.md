---
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create
argument-hint: "\"<description>\" [--feature <id>] [--parent <feature-id>] [--agent <name|auto>] [--design] [--auto] [--design-approved]"
allowed-tools: ["Bash", "Read", "Write", "Skill", "AskUserQuestion"]
---

# Dev Plan

Wraps the **sp:spur-dev** skill (planning half).

Convert a feature description into a validated feature file with BDD acceptance criteria
and a decomposed, CLI-validated task batch. The planning-half pipeline: intake →
`spur feature create` → AC generation → `spur feature check` gate loop → decomposition →
`task-batch.schema.json` gate → `spur task batch-create`. Every write is CLI-gated; no
corpus mutation occurs until each gate passes.

## When to use

- A feature description arrives and needs structured planning.
- A feature exists but needs decomposition into tasks.
- The operator says "plan this" or "create tasks for this feature."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `description` | Feature description (required, positional) | (required) |
| `--feature <id>` | Plan tasks for an existing feature instead of creating one | (creates new) |
| `--parent <feature-id>` | Parent feature for hierarchical ID allocation | (top-level) |
| `--agent <name\|auto>` | Spawn the model steps (AC generation, decomposition) under a specific agent via `spur agent run`. Omit (the default) to run them **in the current session** — no subprocess | (in-session) |
| `--design` | Always author/update the feature's design satellite (`docs/design/<slug>.md`) + its `04_DESIGN.md` index row | off |
| `--auto` | Set `profile=auto` (skip phasing HITL) AND enable design-doc auto-detection. Taste gates (design-approval) still pause. Not `--yes-to-everything`. | off |
| `--design-approved` | Pass `design_approved=true` to the planning workflow when the operator already approved the design in this session; under `--auto`, routes around the design-approval taste gate. | off |

### Design-doc generation (`--design` / `--auto`)

The planning half can author a design satellite for the feature. The two flags compose into a
three-state truth table:

| Flags | Behavior |
|-------|----------|
| `--design` (with or without `--auto`) | **Always** author/update the satellite + index. `--design` wins; `--auto` is ignored. |
| `--auto` (no `--design`) | **Agent decides** design doc AND sets `profile=auto` (skips phasing HITL). If a cross-cutting seam is detected → author the doc and **report** the slug + a one-line rationale; otherwise skip and say so. |
| neither | **Never** author. Default behavior — no design artifact, no `04` change. `profile` stays `interactive`. |

Generation is idempotent: an existing satellite is **updated in place**, never overwritten or
duplicated (constitution §4.5 + sync trigger T9). Full procedure: skill Step 5.5.


### `--auto` behavior

`--auto` sets `profile=auto` in the planning-pipeline vars. Per the Auto-Decision Principles
([cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Auto-Decision Principles"):

- **Objective HITL gates** (`phasing`) are routed around BEFORE entry — the workflow engine
  does not auto-dismiss `hitl.confirm` states. The YAML transitions skip the phasing state
  entirely when `profile=auto`.
- **Taste gates** (`design-approval`) still pause — the operator must explicitly approve the
  design doc. `--auto` does not auto-click taste gates unless `--design-approved` records explicit
  prior approval in the workflow vars.
- `--auto` is NOT `--yes-to-everything`. It auto-continues on objective pass; it surfaces
  taste decisions to the human.

## Behavior

Thin wrapper: intake Q&A, feature creation/selection, AC generation, the two CLI gates,
and decomposition are all owned by the skill. This command parameterizes the planning-half
entry point.

### Structured input binding

When a structured-input tool (`AskUserQuestion` on Claude Code, or the platform equivalent) is available, the intake questionnaire (scope, constraints, success criteria, and design preference) is collected as a single call with multiple questions — each dimension is an independent axis, so all can be presented simultaneously. This enables autonomous handoff to the planning skill without mid-stream pauses. Fall back to sequential prompts (rendered as markdown) only when no structured-input tool is available.

### Agent override

`--agent` is an **inline** command (per the two-surface contract in
[cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Honor `--agent`"): the default
(no flag) runs the model steps — AC generation and decomposition synthesis — **in the current
session**, writing results directly via `spur task update --section --from-file`. An explicit
`--agent <name>` or `--agent auto` spawns those steps via `spur agent run` instead. The default
never shells out; that is the contract for an inline command.

## Implementation

Delegates to **sp:spur-dev** skill. The planning workflow invocation includes
`"design_approved":"true"` only when `--design-approved` is present:

```
Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `plan` operation directly and pass the description/flags as
  arguments in chat.
