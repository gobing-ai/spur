---
name: secu-review
description: "The SECUA review dimensions and finding-severity rubric for verify/review modes"
see_also:
  - sp:code-verification
---

# SECUA Review

The code-quality lens applied in verify mode (Step 5) and review mode. Five dimensions, selected by
`--focus` (default `all`; comma-separated subset accepted).

| Dim | Name | What it checks |
|-----|------|----------------|
| **S** | Security | Hardcoded secrets/keys/tokens; injection (SQL, shell, path); unsanitized external input; unsafe deserialization; missing authz at boundaries |
| **E** | Efficiency | Needless O(n²) loops, N+1 queries, redundant I/O, unbounded growth, missing pagination |
| **C** | Correctness | Null/undefined handling, off-by-one, unhandled error paths, race conditions, wrong edge-case behavior, logic that contradicts the requirement; **type-fit** — every signature, field access, and "reuse X" claim resolves against the *actual* type's fields, not merely a capability assumed to exist |
| **U** | Usability | Vague error messages (no context), unclear API shapes, missing types, inconsistent naming vs. the surrounding code |
| **A** | Architecture | Shallow modules, misplaced seams, unnecessary coupling, duplicated orchestration, leaky abstractions, and changes that fight the repo's documented boundaries |

## Focus parsing

Split `--focus` by comma, trim, lowercase. Keep only
`security|efficiency|correctness|usability|architecture`. A dimension absent from the focus set is
skipped entirely. `all` expands to all five.

## Finding severity

| Severity | Meaning | Gate effect (verify mode) | `--fix all` repairs? |
|----------|---------|---------------------------|----------------------|
| **blocker** | Ships a vulnerability or breaks a requirement | Contributes to a non-PASS verdict | Yes |
| **major** | Real defect, not requirement-breaking | Advisory; noted in `## Review` | Yes |
| **minor** | Style / polish / non-functional | Advisory only | No (left for the author) |

Each finding records: dimension, severity, `file:line`, one-line description, and a concrete
remediation. Findings land in the task's `## Review` section, ranked severity-first.

## Architecture check

Architecture findings are review findings, not a separate refactor-planning workflow. Use them to
catch design damage introduced by the diff:

- **Depth / deletion test:** flag pass-through modules where deleting the new layer would remove
  indirection rather than move real complexity to callers.
- **Seam placement:** flag behavior added on the wrong side of an existing interface, especially
  when callers must now know implementation details.
- **Coupling and locality:** flag changes that make one concept require edits across many modules or
  leak app-layer concerns into domain/config/contract packages.
- **Boundary drift:** flag violations of project docs, ADRs, package ownership, or established
  dependency direction.
- **Test surface:** flag architecture that can only be tested through excessive mocks instead of
  through the module's real interface.

Do not turn architecture review into speculative redesign. Findings must be tied to changed files
and must include a concrete remediation. If the issue needs a larger refactor than the current task,
recommend a follow-up task instead of broad in-place rewrites.

Architecture severity follows the same table: blocker when the diff violates a binding boundary or
will break a requirement; major when it creates meaningful change-cost or testability damage; minor
for localized depth/naming drift.

## Type-fit check (Correctness)

When a design or plan says "reuse `X`" or types a signature as `f(arg: T)`, resolve `T` against its
**real definition** before accepting it — read the type's fields, not just its name. A capability
existing ("the dry-run walks transitions") does not mean its return type carries the data you need
(`WorkflowRunResult` is terminal — it has no step list). Verify the *fields you will read*, not that
the producer exists. This applies to pre-implementation design review as much as post-implementation
review: a signature that cannot be built against the actual type is a blocker, caught at review, not
at implementation.

## Relationship to requirement traceability

SECUA is the *quality* lens; requirement traceability (Step 4) is the *completeness* lens. A change
can be SECUA-clean yet `FAIL` (a requirement is UNMET), or fully MET yet carry a blocker finding
(insecure implementation of a satisfied requirement). The aggregate verdict reflects requirement
status; blocker-severity SECUA findings are surfaced as gate-relevant in the `checks[]` array of the
verdict artifact.
