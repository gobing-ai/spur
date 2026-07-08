---
name: code-improvement
description: "Pointer to the sp:code-improvement skill — the SSOT for architectural deepening (5 signals, severity, candidate format). Retained as a reference for code-verification's Step 7 cross-link."
see_also:
  - code-verification
  - secu-review
  - functional-review
---

# Code Improvement (reference pointer)

> **SSOT moved.** The full architecture-deepening lens now lives in the
> [`sp:code-improvement` skill](../../code-improvement/SKILL.md) — 5 deepening signals (shallow
> module, tight coupling, wrong seam, weak locality, poor test surface), severity rubric
> (blocker/major/minor/advisory), the 5-step workflow, and the Candidate Format. This file is
> retained as a thin pointer so `code-verification`'s Step 7 cross-link stays resolvable.

## When to use it (from code-verification Step 7)

When review findings expose broader architecture friction rather than a localized defect, dispatch
[`sp:code-improvement`](../../code-improvement/SKILL.md) to frame follow-up candidates instead of
silently expanding the current fix. In verify mode, improvement candidates are an advisory
LLM-as-judge lane unless they contradict a task requirement, core Acceptance Criteria, security
boundary, or correctness condition. Do not let a qualitative improvement candidate alone certify
objective completion; pair it with deterministic or static evidence, or mark the related
AC/requirement `PARTIAL`.

## The 5 signals (quick reference)

| Signal | One-line diagnostic |
|--------|---------------------|
| Shallow module | Deleting the module removes indirection instead of moving complexity to callers |
| Tight coupling | One concept requires edits across many files; tests need excessive mocks |
| Wrong seam | Callers know implementation details, ordering rules, config keys, or persistence details |
| Weak locality | Bugs cannot be traced to one module because behavior is scattered |
| Poor test surface | Real behavior can only be tested through private methods or broad mocks |

For full diagnostics, deepening directions, code examples, severity guidance, and the Candidate
Format, read the [skill proper](../../code-improvement/SKILL.md).