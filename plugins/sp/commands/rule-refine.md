---
description: Refine an existing rule or preset — tighten scope, adjust severity, add exemptions, or disable/override inherited rules — then re-verify
argument-hint: "<rule-file-or-preset> [--intent \"<goal>\"] [--severity <sev>] [--scope <glob>] [--exempt <path>] [--disable <id>] [--override <id>] [--dry-run]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Rule Refine

Wraps the **sp:spur-rules** skill (`refine` operation).

Make an existing rule more precise: kill a false positive by tightening `include`/`exclude`, fix a
false negative, change blocking behavior via severity, exempt a legitimate case, or re-tune an
inherited rule in a preset via `disable`/`overrides`. Applies the **smallest** change that meets the
intent, then re-runs the same validate-and-smoke-test core an authored rule goes through.

## When to use

- A rule is too noisy (false positives) or too lax (false negatives).
- You need to change a rule's severity, scope, or add a documented exemption.
- An inherited preset rule is wrong for this project (`--disable` / `--override`).

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `target` | Rule file path or preset name (required, positional) | (required) |
| `--intent "<goal>"` | Plain-language refinement goal (drives dimension selection) | (inferred from flags) |
| `--severity <sev>` | Change severity: `error`/`warning`/`info` | (unchanged) |
| `--scope <glob>` | Tighten the include/exclude scope | (unchanged) |
| `--exempt <path>` | Add a path-fragment exemption (with rationale comment) | (none) |
| `--disable <id>` | Disable an inherited rule ID (preset target) | (none) |
| `--override <id>` | Re-tune an inherited rule via preset `overrides` | (none) |
| `--dry-run` | Emit a diff of the change without writing | false |

## Behavior

Thin wrapper: resolve `target` as a file path or preset name, pass flags through. The skill identifies
the refinement dimension, applies the minimal change with a rationale comment, optionally previews a
diff (`--dry-run`), and re-verifies via the shared validate-and-smoke-test core. When a change
*widens* scope or *lowers* severity, it also runs an overlap check against sibling rules and stops on
collision. Never widens scope merely to pass a gate.

## Implementation

Delegates to **sp:spur-rules** skill:

```
Skill(skill="sp:spur-rules", args="refine $ARGUMENTS")
```
