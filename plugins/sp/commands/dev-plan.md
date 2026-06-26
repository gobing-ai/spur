---
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create
argument-hint: "\"<description>\" [--feature <id>] [--parent <feature-id>] [--agent <name|auto>] [--design] [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
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
| `--auto` | Let the agent decide whether a design doc is warranted (cross-cutting-seam detection). Ignored when `--design` is present | off |

### Design-doc generation (`--design` / `--auto`)

The planning half can author a design satellite for the feature. The two flags compose into a
three-state truth table:

| Flags | Behavior |
|-------|----------|
| `--design` (with or without `--auto`) | **Always** author/update the satellite + index. `--design` wins; `--auto` is ignored. |
| `--auto` (no `--design`) | **Agent decides** during intake: if a cross-cutting seam is detected (a new command, module, schema, or transport — an ADR-worthy change) → author the doc and **report** the slug + a one-line rationale (no confirmation pause); otherwise skip and say so. |
| neither | **Never** author. Default behavior — no design artifact, no `04` change. |

Generation is idempotent: an existing satellite is **updated in place**, never overwritten or
duplicated (constitution §4.5 + sync trigger T9). Full procedure: skill Step 5.5.

## Behavior

Thin wrapper: intake Q&A, feature creation/selection, AC generation, the two CLI gates,
and decomposition are all owned by the skill. This command parameterizes the planning-half
entry point.

### Agent override

`--agent` is an **inline** command (per the two-surface contract in
[cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Honor `--agent`"): the default
(no flag) runs the model steps — AC generation and decomposition synthesis — **in the current
session**, writing results directly via `spur task update --section --from-file`. An explicit
`--agent <name>` or `--agent auto` spawns those steps via `spur agent run` instead. The default
never shells out; that is the contract for an inline command.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `plan` operation directly and pass the description/flags as
  arguments in chat.
