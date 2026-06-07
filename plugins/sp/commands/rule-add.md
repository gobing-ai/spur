---
description: Turn a natural-language constraint or anti-pattern into a validated, smoke-tested YAML rule
argument-hint: "\"<description>\" [--file <path>] [--preset <target>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Rule Add

Wraps the **sp:spur-rules** skill (`add` operation).

Codify a new constraint: **first check whether an existing rule/preset already covers the concern**
(extend or refine it rather than duplicate — on your confirmation), and only author from scratch when
it is genuinely new. Then select the right evaluator, write the real config shape, validate the file,
and smoke-test it in both directions (fires on a known-bad fixture, stays quiet on a known-good one)
before trusting it. Optionally wire it into a preset.

## When to use

- A new standard or anti-pattern emerges and you want the gate to enforce it forever.
- You can describe the constraint in plain language but don't know the evaluator/config shape.
- You're not sure if it's already covered — the command checks the catalog first and recommends
  extend/refine over adding a near-duplicate.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `description` | What the rule should enforce (required, positional) | (required) |
| `--file <path>` | Output rule file path | `.spur/rules/<category>/<rule-id>.yaml` |
| `--preset <target>` | Wire the new rule into this preset after authoring | (author only) |

## Behavior

Thin wrapper: ensure a description is present, pass `--file`/`--preset` through. The skill owns
evaluator selection, real config-shape generation, file placement by concern, the
validate-and-smoke-test core, and preset wiring. The rule is not "done" until it validates and both
smoke-test directions pass.

## Implementation

Delegates to **sp:spur-rules** skill:

```
Skill(skill="sp:spur-rules", args="add $ARGUMENTS")
```
