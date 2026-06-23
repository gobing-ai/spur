---
name: secu-review
description: "The SECU review dimensions and finding-severity rubric for verify/review modes"
see_also:
  - sp:code-verification
---

# SECU Review

The code-quality lens applied in verify mode (Step 5) and review mode. Four dimensions, selected by
`--focus` (default `all`; comma-separated subset accepted).

| Dim | Name | What it checks |
|-----|------|----------------|
| **S** | Security | Hardcoded secrets/keys/tokens; injection (SQL, shell, path); unsanitized external input; unsafe deserialization; missing authz at boundaries |
| **E** | Efficiency | Needless O(n²) loops, N+1 queries, redundant I/O, unbounded growth, missing pagination |
| **C** | Correctness | Null/undefined handling, off-by-one, unhandled error paths, race conditions, wrong edge-case behavior, logic that contradicts the requirement |
| **U** | Usability | Vague error messages (no context), unclear API shapes, missing types, inconsistent naming vs. the surrounding code |

## Focus parsing

Split `--focus` by comma, trim, lowercase. Keep only `security|efficiency|correctness|usability`.
A dimension absent from the focus set is skipped entirely. `all` expands to all four.

## Finding severity

| Severity | Meaning | Gate effect (verify mode) | `--fix all` repairs? |
|----------|---------|---------------------------|----------------------|
| **blocker** | Ships a vulnerability or breaks a requirement | Contributes to a non-PASS verdict | Yes |
| **major** | Real defect, not requirement-breaking | Advisory; noted in `## Review` | Yes |
| **minor** | Style / polish / non-functional | Advisory only | No (left for the author) |

Each finding records: dimension, severity, `file:line`, one-line description, and a concrete
remediation. Findings land in the task's `## Review` section, ranked severity-first.

## Relationship to requirement traceability

SECU is the *quality* lens; requirement traceability (Step 4) is the *completeness* lens. A change
can be SECU-clean yet `FAIL` (a requirement is UNMET), or fully MET yet carry a blocker finding
(insecure implementation of a satisfied requirement). The aggregate verdict reflects requirement
status; blocker-severity SECU findings are surfaced as gate-relevant in the `checks[]` array of the
verdict artifact.
