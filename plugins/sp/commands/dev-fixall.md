---
description: Fix all lint, type, and test errors systematically across the working tree
argument-hint: "[--scope <path>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Fixall

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#11-fixall) for the authoritative reference.

Run the full fix cycle: lint → typecheck → test, collecting all failures, then fix each
systematically. Re-runs the gates after each fix batch. Stops when all three gates are
green.

## When to use

- After a batch of changes, the lint/type/test gates are red.
- Pre-commit cleanup — "fix everything before I commit."
- The operator says "fix all errors" or "clean up the build."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--scope <path>` | Limit fixes to a file or directory | (entire working tree) |

## Behavior

Inline procedure (no skill delegation):

1. Run `bun run lint` (add `-- <path>` if `--scope` is given). Collect all errors. If clean, skip to step 4.
2. **Lint fix loop:** for each error, diagnose root cause, apply the smallest fix. Re-run `bun run lint` after each batch. Loop until green.
3. Run `bun run test`. Collect all failures. If green, done.
4. **Test fix loop:** for each failure, diagnose (test bug vs implementation bug), apply the fix, re-run the failing test. Loop until all pass.
5. Final verification: `bun run lint && bun run test` — confirm both green simultaneously.
6. Report: list what was fixed (file + one-line summary). If any error could not be resolved, report explicitly — do not suppress.

Never bypass with `--no-verify`, `--force`, or new suppressions. Never skip or `.skip` a test to go green. Fix the root cause.

## Implementation

Implements the inline procedure defined in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#11-fixall). No `Skill()` delegation.

## Platform Notes

- **Claude Code:** native — `$ARGUMENTS` substitution, `Bash`/`Edit`/`Write` tools work directly.
- **Other platforms:** `$ARGUMENTS` is Claude-specific. Run the lint/test commands and fixes manually per the procedure above.
