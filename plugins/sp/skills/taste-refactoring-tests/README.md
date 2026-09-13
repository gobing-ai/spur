# taste-refactoring-tests

A reusable agent skill for refactoring existing unit tests so the test suite improves **real delivery quality** instead of creating an “always-pass” illusion.

Its core bias is simple:

> A test earns its place by detecting meaningful regressions.

The skill uses a graded intervention model:

- T0 KEEP
- T1 DIRECT REMOVE
- T2 SUGGEST REMOVE
- T3 STRENGTHEN
- T4 SIMPLIFY / DE-BRITTLE
- T5 ADD MISSING PROTECTION
- T6 RE-DESIGN TEST STRATEGY
- T7 QUARANTINE / INVESTIGATE

The package includes:
- `SKILL.md` — operational agent instructions
- `references/test-refactoring-playbook.md` — detailed techniques and heuristics
- `references/research-basis.md` — industry-practice basis and concepts
- `checklists/daily-test-review.md` — quick daily checklist
- `examples/review-template.md` — reusable assessment format
- `examples/refactor-example.md` — worked example of converting green-but-weak tests into failure-sensitive tests

The skill is intentionally skeptical of vanity coverage, tautological assertions, mock-heavy choreography, flaky retries, and tests that merely prove that the test setup works.
