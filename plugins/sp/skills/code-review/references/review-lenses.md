---
name: review-lenses
description: "SECUA review lenses — correctness, security, efficiency, usability, architecture — with per-lens diagnostic questions and finding-severity guidance."
see_also:
  - code-review
  - code-verification
---

# Review Lenses (SECUA)

Five dimensions for structured code review. Each lens has diagnostic questions; answer them against the diff. Findings are severity-graded P1 (blocker) through P4 (advisory).

## Correctness

**Question:** Does this code do what it claims to do?

- Does every code path produce the expected output for the given input?
- Are edge cases handled (empty, null, boundary, error)?
- Are invariants preserved across the changed functions?
- Is there a test that fails if the behavior is wrong?

**Severity guide:** Logic errors that produce wrong output → P1. Missing edge case that could cause wrong output → P2. Unclear control flow that might hide bugs → P3.

## Security

**Question:** Can this code be exploited?

- Is user input validated, sanitized, and bounded?
- Are secrets, tokens, or credentials exposed (in logs, error messages, client code)?
- Are SQL queries parameterized? Is there any string-interpolated SQL?
- Does the change expand the auth/permission surface?
- Is there a path that bypasses authentication or authorization?

**Severity guide:** Exploitable vulnerability (injection, auth bypass, secret leak) → P1. Missing validation that could be exploited → P2. Hardcoded configuration that weakens security → P3.

## Efficiency

**Question:** Will this code perform at scale?

- Are there N+1 queries or unnecessary loops?
- Is data transformed through unnecessary intermediate representations?
- Are large allocations bounded? Is there unbounded memory growth?
- Is there blocking I/O on a hot path?

**Severity guide:** O(n²) or worse on a hot path → P2. Unnecessary allocation on a cold path → P3. Minor optimization opportunity → P4.

## Usability

**Question:** Can a developer understand and use this code?

- Are function and variable names self-documenting?
- Are error messages actionable (what failed, expected, path involved)?
- Is the API surface consistent with surrounding code?
- Are complex algorithms explained with a brief comment?

**Severity guide:** Misleading name that could cause bugs → P2. Missing error context → P3. Inconsistent naming → P4.

## Architecture

**Question:** Does this code fit the system's design?

- Does it respect module boundaries? No cross-cutting imports that bypass the public API?
- Does it follow existing patterns, or introduce a new one with justification?
- Is the right separation of concerns maintained?
- Would this change make future changes harder (coupling, rigidity)?
- **Deep-module check:** does the new/changed module pass the deletion test (would inlining its one
  caller make anything harder)? Is there a **seam** with only one **adapter** — i.e. speculative,
  not yet justified by a second caller? Full vocabulary (module/interface/depth/seam/adapter/
  leverage/locality) and the deletion test: `sp:sys-architecture`'s
  [decision-method.md](../../sys-architecture/references/decision-method.md).

**Severity guide:** Violates module boundary or dependency rule → P1. Introduces a new pattern without justification → P2 (a seam with only one adapter and no stated second-caller plan is this severity). Minor boundary fuzziness → P3.

## Structural Remedies

A finding is worth more when it carries the fix. Do not stop at "this is tangled" — propose the
restructuring: name the deeper module, the extracted seam, the guard-clause flattening, the
collapsed pass-through. State the before/after shape in prose so the author can act without a second
round-trip. A problem without a proposed remedy is half a review.

## Change Sizing

Diff size is a reviewability signal. Flag oversized changes and propose a split:

| Size | Verdict | Action |
|---|---|---|
| ~100 lines | Good | Review normally. |
| ~300 lines | Acceptable | Review, but note if it bundles independent concerns. |
| ~1000 lines | Too large | Ask to split before deep review — a diff this size hides defects and cannot be reviewed honestly. |

**Split strategies:** separate refactor from feature (two commits); slice vertically by behavior, not
by layer; land a mechanical rename/move on its own; extract a shared helper in a preceding change so
the feature diff shrinks to the new logic.

## Honesty in Review (anti-sycophancy)

The diff is under review, not the author. Do not rubber-stamp, do not soften a real finding to spare
feelings, do not pad with praise to cushion a criticism. Quantify impact ("this N+1 query runs once
per row"), state severity plainly, and push back when the change is wrong — once, with reasoning. A
review that makes everyone feel good and lets a defect through has failed. "LGTM" with no specific,
anchored findings is not a review.

## Dead-Code Hygiene

When you spot unreachable branches, unused exports, commented-out blocks, or orphaned helpers:
**identify and list them** — do not silently delete them in the review. Deleting code you do not
fully understand is its own risk (Chesterton's Fence). Confirm it is truly unreachable, list each
item with its location, and ask before removal. Dead code called out and removed deliberately is
hygiene; dead code swept away mid-review is a landmine.

## Dependency Discipline

Prefer the standard library and existing in-repo utilities over a new third-party dependency. Flag
every new dependency a diff introduces: a one-function import rarely justifies the supply-chain,
version-drift, and bundle cost it adds. Ask whether an existing helper covers the need, whether the
dependency is maintained, and whether its footprint matches the value. New top-level dependencies are
an operator decision, not a reviewer's silent pass-through.
