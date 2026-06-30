---
description: Author a validated, smoke-tested constraint rule
argument-hint: "\"<description>\" [--file <path>] [--preset <target>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Rule Add

Wraps the **sp:spur-cli** facade (rule noun) (`add` operation).

Codify a new constraint. **First check whether an existing rule/preset already covers the concern**
(extend or refine it rather than duplicate — on user confirmation); author from scratch only when the
concern is genuinely new. Then select the right evaluator, write the real config shape, validate the
file, and smoke-test it in both directions (fires on a known-bad fixture, stays quiet on a known-good
one) before trusting it. Optionally wire it into a preset.

## When to use

- A new standard or anti-pattern emerges and the gate should enforce it forever.
- The constraint is describable in plain language but its evaluator/config shape is unknown.
- Coverage is uncertain — this command checks the catalog first and recommends extend/refine over
  adding a near-duplicate.

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

Delegates to **sp:spur-cli** facade (rule noun):

```
Skill(skill="sp:spur-cli", args="rule add $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:spur-cli`  skill's `add` operation directly and pass the description/flags as arguments in chat.
