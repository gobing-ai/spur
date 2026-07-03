---
name: code-review
description: "Pre-commit self-review checklist, structured review requests, and processing review findings into tasks. Triggers: \"review this\", \"self-review\", \"pre-commit check\", \"code review\", \"review my changes\", \"check before commit\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
  operations:
    - self-review
    - request-review
    - process-findings
see_also:
  - sp:code-verification
  - sp:code-implementation
---

# sp:code-review — Code Review Workflow

Two workflows: **pre-commit self-review** (catch issues before they leave your machine) and **requesting/receiving agent review** (structured context for deeper review). This skill owns the review *workflow*; `sp:code-verification` owns post-implementation SECUA review within the pipeline.

## Workflow A — Pre-commit self-review

Run before `git commit`. Catches 60-80% of issues that a reviewer would flag.

1. **Diff it:** `git diff --cached` (or `git diff` if unstaged). Read every changed line.
2. **Checklist:** Walk the [self-review-checklist.md](references/self-review-checklist.md) — type-safety, null-handling, error-propagation, test-coverage, security-surface. Each category has diagnostic questions.
3. **Fix:** Anything the checklist flags → fix before committing.
4. **Commit:** Only when the checklist is clean.

## Workflow B — Requesting agent review

When you want a deeper review (SECUA, architectural, or second-opinion):

1. **Prepare a structured brief** and prefer a fresh reviewer context/subagent when available:

   ```markdown
   WHAT_WAS_IMPLEMENTED:
   <one paragraph>

   PLAN_OR_REQUIREMENTS:
   <task WBS, requirements, AC, or design refs>

   DIFF_RANGE:
   <base sha>..<head sha> or "working tree"

   FOCUS_HINTS:
   <security | correctness | architecture | specific concern>
   ```

2. **Attach evidence:** include the relevant `git diff`, self-review results (Workflow A output), and
   any verification commands already run.
3. **Request:** Invoke `sp:code-review` directly or trigger via "review my changes", "review this diff".
4. **Receive:** The reviewer produces a P1–P4 findings table.

## Workflow C — Processing review findings

When you receive review findings:

1. **Verify each finding against the codebase first.** A finding can be stale or based on a misread;
   cite the file/line that proves it before changing code. Reasoned pushback is allowed.
2. **Fix in priority order:** blockers first (P1), then simple P2 fixes, then complex P2 fixes. Keep
   unrelated refactors out of the review-response diff.
3. **Test each fix individually** with the narrowest command that proves it, then run the task gate.
4. **Re-review:** After all P1/P2 fixes, request a follow-up review to confirm resolution.
5. **File follow-up tasks** for deferred P3/P4 items via `spur task create --template review`.

## When to use

- Before committing changes.
- Before creating a PR or merge request.
- After receiving review feedback.
- The operator says "review this" or "check my changes before commit."

Do **not** use this skill for:
- Pipeline verification — that is `sp:code-verification` (`/sp:dev-verify`).
- SECUA review of a completed task — that is `sp:code-verification` (`/sp:dev-review`).
- Architectural review alone — that is `sp:sys-architecture`.

## References

| Reference | Covers |
|-----------|--------|
| [self-review-checklist.md](references/self-review-checklist.md) | Pre-commit checklist: 6 categories with diagnostic questions |
| [review-lenses.md](references/review-lenses.md) | SECUA review lenses: correctness, security, efficiency, usability, architecture |

## See also

- **`sp:code-implementation`** — the implement step that produces the changes being reviewed.
