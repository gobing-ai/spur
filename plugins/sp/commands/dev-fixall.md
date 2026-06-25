---
description: Fix all lint, type, and test errors systematically across the working tree
argument-hint: "[<validation-command>] [--max-retry <n>] [--scope <path>]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"]
---

# Dev Fixall

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#10-fixall) for the authoritative reference.

Systematically resolve all validation errors (lint, typecheck, tests) using a deterministic workflow with root cause analysis.

**Core Principle:** NO FIXES WITHOUT ROOT CAUSE FIRST.

**Pipeline Integration:** This is a **standalone utility**, not a pipeline phase shortcut. It does not delegate to an orchestration skill. Use it independently to fix validation errors, or after any pipeline phase that fails checks.

## When to use

- After a batch of changes, the lint/type/test gates are red.
- Pre-commit cleanup — "fix everything before I commit."
- The operator says "fix all errors" or "clean up the build."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `validation-command` | Shell command that exits 0 when all gates pass (positional, optional) | auto-detect from project config |
| `--max-retry <n>` | Maximum fix iterations before asking the operator | `5` |
| `--scope <path>` | Limit fixes to a file or directory | (entire working tree) |

## Auto-Detection

When `validation-command` is omitted, detect from project config:

| Config File | Detection | Validation Command |
|-------------|-----------|-------------------|
| `biome.json` | `"biome"` in filename | `bun run check` |
| `tsconfig.json` | `"tsconfig"` in filename | `bun run typecheck` |
| `package.json` + `bun.lockb` | Bun project | `bun run check` |

For this project, the default is `bun run check` (runs lint + typecheck + test).

## MANDATORY Exit Condition

**The ONLY way to complete successfully:**

1. Run validation command: `eval "$VALIDATION_CMD"`
2. Capture exit code: `EXIT_CODE=$?`
3. Output: `echo "EXIT_CODE=$EXIT_CODE"`
4. **EXIT_CODE must equal 0**

If EXIT_CODE != 0: NOT completed. MUST continue fixing.

**Hallucination Red Flags — STOP if you think:**

- "The errors look fixed" — check exit code, not appearance
- "Most tests pass" — partial success = FAILURE
- "Good enough for now" — 0 is the ONLY acceptable exit code

## 7-Phase Workflow

```
┌─────────────────────────────────────────────────┐
│ RETRY LOOP (max --max-retry iterations)         │
│                                                 │
│  → Phase 1: Detect validation command           │
│  → Phase 2: Capture validation output           │
│  → Phase 3: Auto-fix (biome check --write)      │
│  → Phase 4: Parse and categorize errors         │
│  → Phase 5: Root cause diagnosis                │
│  → Phase 6: Fix by error type group             │
│  → Phase 7: Validate (check EXIT_CODE)          │
│                                                 │
│  If EXIT_CODE = 0: SUCCESS, exit loop           │
│  If EXIT_CODE != 0: continue                    │
│                                                 │
│  If counter >= MAX_RETRY:                       │
│    Ask user: [Continue / Stop]                  │
└─────────────────────────────────────────────────┘
```

### Phase 1 — Detect validation command

Resolve `validation-command` from the positional argument, or auto-detect from project config files.

### Phase 2 — Capture validation output

Run the validation command. If `--scope <path>` is given, append `-- <path>` to scoped commands (`bun run lint -- <path>`, `bun test <path>`). Capture stdout, stderr, and exit code.

### Phase 3 — Auto-fix

Run `biome check --write` (or the project's formatter) to fix trivially auto-fixable issues. Re-run validation. If clean, done.

### Phase 4 — Parse and categorize errors

Group remaining errors by type: build/compile, import/module, type errors, test failures, lint warnings.

### Phase 5 — Root cause diagnosis

For each error group, identify the root cause BEFORE writing a fix. Do not fix symptoms.

### Phase 6 — Fix by error type group

Apply fixes in priority order. Never bypass with `--no-verify`, `--force`, or new suppressions. Never skip or `.skip` a test to go green. Fix the root cause.

### Phase 7 — Validate

Re-run the validation command. Check `EXIT_CODE`. If 0, done. If not 0, continue the retry loop.

## Fix Priority

| Priority | Type | Rationale |
|----------|------|-----------|
| 1 | Build/compile | Blocks everything downstream |
| 2 | Import/module | May cause cascading type failures |
| 3 | Type errors | Often reveals logic bugs |
| 4 | Test failures | Confirms behavior correctness |
| 5 | Lint warnings | Code quality (lowest priority) |

**Critical Rule**: If THREE fixes fail consecutively, STOP. This signals architectural problems.

## Error Patterns

### TypeScript

| Issue | Root Cause Approach |
|-------|---------------------|
| `any` type | Trace where untyped data enters; add types at source |
| Unused variable | Check if removal breaks anything |
| Missing return type | Read function to understand actual return |
| Type mismatch | Compare expected vs. actual; find divergence |

### Bun/V8 Coverage Quirk

Bun uses V8's function coverage which does NOT count implicit class constructors:

```typescript
// biome-ignore lint/complexity/noUselessConstructor: V8 function coverage requires explicit constructor
constructor() {}
```

## Implementation

Implements the inline procedure defined in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#10-fixall). No `Skill()` delegation.

**Arguments received:** `$ARGUMENTS`. Parse per the Arguments table above.

## Platform Notes

- **Claude Code:** native — `Bash`/`Edit`/`Write` tools work directly.
- **Other platforms:** Run the lint/test commands and fixes manually per the procedure above.
