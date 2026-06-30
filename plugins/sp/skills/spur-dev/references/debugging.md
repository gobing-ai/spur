---
name: debugging
description: "Root-cause-first debugging workflow for failed gates, failing tests, runtime defects, and flaky behavior during the sp execution loop."
see_also:
  - spur-dev
  - unit-testing
  - code-verification
---

# Debugging

Use this reference when the execution loop hits an unexplained failure: a test fails for an unclear
reason, a runtime error appears, behavior is intermittent, or repeated fixes expose new failures.
The rule is simple: **root cause before fix**. Do not patch the symptom just to move the pipeline.

## When To Switch Into Debugging

Switch from implementation or testing into debugging when any of these happen:

- a test failure is not explained by the current requirement change
- a command fails differently after a fix attempt
- behavior is intermittent or timing-dependent
- a regression appears after a recent change
- two fix attempts fail to move the same gate
- the observed symptom is far from the code that was changed

If three fixes fail consecutively, stop implementation and reframe. That usually means the defect is
in an assumption, seam, or test setup, not in the line being edited.

## Four-Phase Workflow

1. **Capture the symptom.** Preserve the exact command, error message, stack trace, input, and
   environment. If you cannot reproduce it, you cannot verify the fix.
2. **Trace to origin.** Start where the error appears, then follow the data and call chain backward:
   what called this, what value was passed, where did that value originate?
3. **Test one hypothesis.** State one cause, predict what evidence should change, then run the
   smallest probe. Change one variable at a time.
4. **Fix at the source.** Add or update a regression test first when practical, apply the smallest
   source fix, then run the narrow test and the relevant wider gate.

## Failure Taxonomy

| Pattern | Signal | Debug Strategy |
|---------|--------|----------------|
| Null or undefined propagation | type/null error at a downstream call | Trace return values upward; validate at the boundary that introduced the value. |
| Race or ordering bug | intermittent failure, timing sensitivity | Add deterministic synchronization; avoid sleeps as proof. |
| State corruption | output is wrong after shared mutable state changes | Isolate mutation points; prefer immutable or copied state at seams. |
| Type/shape mismatch | field access fails or logic takes the wrong branch | Resolve the actual type definition; add a parser/guard at input boundaries. |
| Config drift | works locally but not in another environment | Centralize config loading; validate expected keys and paths at startup. |
| Resource leak | degrades over time, hangs, or leaves handles open | Check acquisition/release pairs on every path. |
| N+1 or repeated I/O | slow request or command with repeated calls | Batch, cache, or move lookup outside loops. |

## Evidence Standard

Every debugging handoff or solution note should include:

- failing command or reproduction input
- root cause, not just symptom
- evidence that confirmed it
- fix applied
- verification command and result

Do not claim "fixed" from a green narrow probe alone when the defect class could affect the wider
gate. Run the smallest meaningful wider check before handing back to the pipeline.
