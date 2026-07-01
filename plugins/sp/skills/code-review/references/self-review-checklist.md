---
name: self-review-checklist
description: "Pre-commit self-review checklist — 6 categories with diagnostic questions. Catches 60-80% of issues before a reviewer sees them."
see_also:
  - code-review
---

# Self-Review Checklist

Run before `git commit`. For each category, answer the diagnostic questions. If any answer is "no" or "I don't know", fix before committing.

## 1. Type Safety

- [ ] Are all function return types explicit (no inferred `any`)?
- [ ] Are `null`/`undefined` handled at every boundary (API responses, user input, DB queries)?
- [ ] Are type assertions (`as`, `!`) justified with a comment or guard, not used to silence the compiler?

## 2. Null Handling

- [ ] Does every `?.` chain have a fallback or explicit null check at the consumer?
- [ ] Are optional parameters handled when `undefined` is passed?
- [ ] Do array accesses (`arr[i]`) guard against out-of-bounds?

## 3. Error Propagation

- [ ] Are errors caught at system boundaries (API calls, file I/O, DB queries)?
- [ ] Do caught errors include context (what failed, what was expected, what path/identifier)?
- [ ] Are there any empty `catch {}` blocks? Each must have a comment justifying why the error is intentionally swallowed.

## 4. Test Coverage

- [ ] Does the changed code have corresponding tests?
- [ ] Do the tests verify behavior, not implementation?
- [ ] Are edge cases covered (empty input, boundary values, error paths)?

## 5. Security Surface

- [ ] Is user input validated and sanitized?
- [ ] Are secrets, tokens, or credentials hardcoded? (They must never be.)
- [ ] Are SQL queries parameterized? (Never string-interpolated.)
- [ ] Does the change touch auth, sessions, or permissions? If yes, re-audit the entire auth flow.

## 6. Performance Regression

- [ ] Does the change add N+1 queries? (Check for queries inside loops.)
- [ ] Is there unnecessary data transformation (serialize → deserialize → serialize)?
- [ ] Are large allocations (buffers, arrays) bounded?

## When to skip

- Docs-only changes → skip categories 1, 4, 5, 6.
- Test-only changes → skip categories 2, 3, 5, 6.
- Config-only changes → skip all except category 5.
