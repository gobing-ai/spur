---
name: test-output-discipline
description: Preserve test exit status while keeping routine output small enough for an agent context.
see_also:
  - code-testing
  - test-loop-breaker
---

# Test-output discipline

Prefer the runner's concise reporter and a narrow test selector. Filter only when the runner cannot
produce bounded output, and always preserve the test process exit status.

## Bun / TypeScript examples

```bash
# Full suite: concise progress plus the final summary.
bun test --reporter=dots

# One file, then one named test after the first failure.
bun test tests/foo.test.ts --reporter=dots
bun test tests/foo.test.ts --test-name-pattern "specific behavior" --reporter=dots

# Last resort: filtered diagnostics with pipeline failure preserved.
set -o pipefail
bun test tests/foo.test.ts 2>&1 | rg -i -A 5 'fail|error' | tail -30
```

Never infer PASS from filtered text. Capture and report the command's real exit code. Without
`pipefail`, `grep`/`rg` or `tail` can return zero after the test process failed, producing a false
green.

## Context budget

- Routine green run: summary only, target under 500 tokens.
- First red run: retain the failing assertion and short stack.
- Later red run: retain only the changed failure signature and affected `file:line` anchors.
- Large assertion diffs belong in an artifact or local file; do not paste them repeatedly.

Do not run a full suite again while debugging one assertion. Isolate with
`--test-name-pattern`, apply the test-loop breaker, then return to the full suite once the narrow
case is green.
