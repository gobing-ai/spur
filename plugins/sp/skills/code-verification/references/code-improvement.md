---
name: code-improvement
description: "Architecture-improvement lens for post-review refactoring opportunities: module depth, seam placement, locality, coupling, and testability."
see_also:
  - code-verification
  - secu-review
---

# Code Improvement

Use this reference when review findings reveal architectural friction, or when the user asks how to
make a code area easier to change, test, or navigate. This is not a silent refactor pass. It produces
ranked improvement candidates and asks for a choice before broad implementation.

In verify mode, improvement candidates are an advisory LLM-as-judge lane unless they contradict a
task requirement, core Acceptance Criteria, security boundary, or correctness condition. Do not let a
qualitative improvement candidate alone certify objective completion; pair it with deterministic or
static evidence, or mark the related AC/requirement `PARTIAL`.

## Improvement Lens

Look for changes that increase module depth: more behavior behind a smaller, clearer interface.
Avoid extracting tiny modules for neatness if callers still need to understand all the same details.

| Signal | What To Check |
|--------|---------------|
| Shallow module | If deleting the module removes indirection instead of moving complexity to callers, it is likely shallow. |
| Tight coupling | One concept requires edits across many files or tests need excessive mocks. |
| Wrong seam | Callers know implementation details, ordering rules, config keys, or persistence details they should not know. |
| Weak locality | Bugs cannot be traced to one module because behavior is scattered. |
| Poor test surface | The real behavior can only be tested through private methods or broad mocks. |

## Candidate Format

Present candidates before editing:

```markdown
1. **Candidate name**
   - Files: `path:line`, `path:line`
   - Problem: what friction exists today
   - Proposed shape: the deeper module/seam
   - Benefit: locality, leverage, testability, or deletion of duplication
   - Risk: migration cost or compatibility concern
```

## Severity

- **P1**: current architecture blocks correct implementation or violates a binding project boundary.
- **P2**: meaningful recurring change cost, test fragility, or coupling that should be fixed soon.
- **P3**: localized improvement; useful but not blocking.
- **P4**: naming/vocabulary polish.

## Boundaries

Do not use this lens to relitigate documented ADRs. If the existing design is load-bearing, record
the reason and move on. If the improvement requires more than the current task can safely absorb,
create a follow-up task instead of expanding the implementation silently.
