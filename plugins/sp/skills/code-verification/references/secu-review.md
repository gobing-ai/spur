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
| **blocker** | Ships a vulnerability, breaks a requirement, or breaks core AC | FAIL | Yes |
| **major** | Real defect, unresolved architecture/correctness risk, or material test gap | PARTIAL unless explicitly deferred/N/A | Yes |
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

## Relationship to requirement traceability and AC

SECUA is the *quality* lens; requirement traceability (Step 4) and the Acceptance Criteria guard
(Step 5) are the *completeness* lenses. A change can be SECUA-clean yet `FAIL` (a requirement or
core AC is UNMET), or fully MET yet carry a blocker finding (insecure implementation of a satisfied
requirement). The aggregate verdict reflects requirement status, AC status, and gate-relevant
review findings. Blocker and major SECUA findings are surfaced in the `checks[]` array of the
verdict artifact so quality failures are not lost behind a requirements-only PASS.

## Pre-Completion Verification

Before declaring a task `done`, run this lightweight checklist. It catches the most common oversights that survive the formal pipeline gates:

- [ ] All tests pass (`bun run test` exits 0).
- [ ] Lint clean (`bun run lint` exits 0).
- [ ] No `TODO` or `FIXME` without a linked task WBS.
- [ ] `git status` shows only intentional changes (no debug artifacts, no temp files).
- [ ] No `console.log` / `console.error` in production code (use the project logger).
- [ ] No `--no-verify`, `--force`, or new suppression comments added to bypass gates.
- [ ] Solution section contains `file:line` citations for every changed file.
- [ ] Review section has P1–P4 findings table (even if all rows are empty — the table itself proves review happened).

This checklist runs as part of the verify step when the task reaches `testing` status. It does not replace the formal gates — it augments them with between-pipeline hygiene checks.
