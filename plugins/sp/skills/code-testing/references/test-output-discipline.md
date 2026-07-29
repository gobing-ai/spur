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

# Last resort when only pass/fail matters: filtered diagnostics with pipeline failure preserved.
set -o pipefail
bun test tests/foo.test.ts 2>&1 | rg -i -A 5 'fail|error' | tail -30

# Recommended when the exact Bun exit status must be returned.
test_log=$(mktemp)
trap 'rm -f "$test_log"' EXIT
test_status=0
bun test tests/foo.test.ts >"$test_log" 2>&1 || test_status=$?
rg -i -A 5 'fail|error' "$test_log" | tail -30 || true
exit "$test_status"
```

Never infer PASS from filtered text. `pipefail` preserves failure semantics, but it does not
necessarily return the test process's exact status: a later `rg` with no matches can make a green
test look red. Prefer the captured-log pattern above when the caller needs the real Bun status. If
a direct pipeline is unavoidable, capture the first stage immediately with `${PIPESTATUS[0]}` in
Bash or `$pipestatus[1]` in zsh, then return that value explicitly.

## Context budget

- Routine green run: summary only, target under 500 tokens.
- First red run: retain the failing assertion and short stack.
- Later red run: retain only the changed failure signature and affected `file:line` anchors.
- Large assertion diffs belong in an artifact or local file; do not paste them repeatedly.

Do not run a full suite again while debugging one assertion. Isolate with
`--test-name-pattern`, apply the test-loop breaker, then return to the full suite once the narrow
case is green.
