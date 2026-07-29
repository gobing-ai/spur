---
name: test-loop-breaker
description: Stop repeated identical failing-test runs and require source inspection, a falsifiable hypothesis, and an edit before retrying.
see_also:
  - code-testing
  - sys-debugging
---

# Test-loop breaker

Treat repeated execution without new information as spinning.

## Protocol

Track the normalized test command, failure signature, and whether relevant source changed.

1. Run the narrowest red-capable test once.
2. On the first failure, read the failing assertion and the component/module under test.
3. State a falsifiable hypothesis: “The test expects X because Y, but the code does Z.”
4. Make one source or test edit that directly tests the hypothesis.
5. Re-run the narrow test once.
6. If the signature is unchanged, discard or refine the hypothesis before another edit.
7. After two identical failure signatures, do not re-run without a relevant source/test change.
8. Hard cap: three executions of the same command without a relevant source/test change. Escalate
   with the command, signature, inspected files, and rejected hypotheses.

A single debugging thread must not exceed five test executions without a source/test change.
Changing flags, output filters, or temporary filenames does not reset the count.

## Required evidence before retry

- Failing assertion inspected with a `file:line` anchor.
- Component/module under test inspected with a `file:line` anchor.
- One written hypothesis and its predicted observation.
- One relevant edit, or a different diagnostic command that can falsify the hypothesis.

Anti-pattern: test → grep → unchanged test → same failure. Grep is context gathering, not progress.
