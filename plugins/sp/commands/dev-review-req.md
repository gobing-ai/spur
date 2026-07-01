---
description: Code review workflow — pre-commit self-review or request structured agent review with SECUA lenses
argument-hint: "[<wbs>] [--mode <self|request>] [--agent <name|auto>] [--focus <lens>]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Review Req

Wraps the **sp:code-review** skill.

Two modes:
- **`self`** — Pre-commit self-review checklist (catches 60-80% of issues before anyone else sees them).
- **`request`** — Request a structured agent review with SECUA lenses and receive a P1–P4 findings table.

## When to use

- `--mode self` — before committing or creating a PR.
- `--mode request` — when you want a second opinion on a diff.
- Processing review findings into actionable tasks.
- The operator says "review my changes" or "check before commit."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required for `--mode request`) | (required for request) |
| `--mode <self\|request>` | `self`: pre-commit checklist. `request`: structured agent review. | `self` |
| `--agent <name\|auto>` | Spawn the review under a specific agent (request mode) | (current session for self; configured default for request) |
| `--focus <lens>` | SECUA lenses for request mode: `all`, `security`, `efficiency`, `correctness`, `usability`, `architecture`, or comma-separated | `all` |

## Behavior

Thin wrapper: delegates to `sp:code-review` which owns the pre-commit checklist, review-request packaging, and findings-processing workflows. The skill contains the review lenses; this command parameterizes the mode and focus.

## Implementation

```
Skill(skill="sp:code-review", args="<mode> <wbs>")
```

## See Also

- **sp:code-review** — the backing competency skill (checklist, review lenses, findings processing).
- **sp:code-verification** — post-implementation pipeline review (`/sp:dev-verify`).
- **/sp:dev-run** — the run step that produces the changes being reviewed.
