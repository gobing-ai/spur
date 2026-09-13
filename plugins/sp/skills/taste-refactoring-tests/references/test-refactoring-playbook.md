# Test Refactoring Playbook

## 1. What “good” means
A unit test is valuable when it has four properties:

1. **Regression sensitivity** — plausible defects cause it to fail.
2. **Behavior relevance** — the failure corresponds to behavior that matters.
3. **Diagnostic clarity** — the failure tells engineers what contract broke.
4. **Maintenance efficiency** — harmless internal refactors do not constantly break it.

A useful mental model is:

`Test Value ≈ (Risk Protected × Fault Sensitivity × Diagnostic Value) / (Maintenance Cost + Flakiness + Runtime Cost)`

This is a reasoning aid, not a numeric scoring formula.

## 2. The Always-Pass illusion
A suite can stay green while quality degrades when tests:
- execute code without proving outcomes,
- assert only happy paths,
- configure mocks to guarantee the expected answer,
- duplicate the implementation in expectations,
- test framework behavior instead of domain behavior,
- ignore negative effects,
- swallow exceptions,
- are skipped or quarantined indefinitely,
- use snapshots nobody reviews,
- optimize for coverage rather than defect detection.

The antidote is to ask: **what plausible bug would this test catch?**

If the answer is unclear, the test is a refactoring candidate.

## 3. Start from risks, not files
Map tests to risks such as:
- authorization bypass,
- incorrect financial calculation,
- invalid state transition,
- duplicate processing,
- stale or corrupt persistence,
- wrong serialization,
- input validation gaps,
- rounding/time-zone boundaries,
- unexpected side effects,
- historical production defects.

Review the highest-risk areas first.

## 4. Weak assertion patterns

### “Does not throw” only
Sometimes valid for idempotent/no-op behavior, but usually incomplete. Add the expected resulting state or side effect.

### `not null`
Often proves only allocation. Assert the semantic value.

### `isTrue`
Can hide what actually matters. Prefer domain-specific assertions.

### count only
`count == 1` may still accept the wrong item. Assert identity/content when relevant.

### status only
For protocol-facing units, status without body/error semantics may miss serious regressions.

### mock call only
A collaborator being called is rarely the user-visible outcome. Assert state/result unless the interaction itself is contractual.

## 5. Mutation mindset
Mutation testing asks whether tests detect small deliberate faults.

Representative mutants:
- `>` to `>=`,
- true to false,
- remove branch,
- remove side effect,
- return null/default,
- change constant,
- skip validation,
- negate authorization result.

A surviving mutant in critical logic is strong evidence of missing or weak tests.

Do not optimize blindly for a mutation score. Some mutants are equivalent or low-risk. Use survivors to drive judgment.

## 6. Refactoring mock-heavy tests

### Smell
A test contains more mock setup and `verify` calls than domain assertions.

### Questions
- Is the unit boundary too large?
- Are we testing orchestration instead of behavior?
- Can a fake preserve useful state and enable clearer assertions?
- Is call order actually contractual?

### Preferred move
Move pure decision logic into a focused unit, test it directly, and leave wiring/protocol coordination to a smaller number of integration/contract tests.

## 7. Boundary-value coverage
For ordered numeric/date/count domains, cover equivalence classes around boundaries:
- just below,
- exactly at,
- just above.

For collections:
- empty,
- one,
- many,
- duplicates where relevant.

For nullable/optional values:
- absent,
- present valid,
- present invalid.

For time:
- clock control,
- timezone transitions,
- expiry boundary,
- leap/day rollover only when domain-relevant.

## 8. Negative-path testing
Critical negative tests often provide more confidence than another happy path.

Examples:
- unauthorized actor is rejected and state is unchanged,
- invalid input does not persist,
- failed payment does not fulfill order,
- duplicate message does not duplicate side effects,
- timeout maps to retriable error rather than success,
- missing required field returns a meaningful rejection.

## 9. Property-based testing
Use when examples are insufficient and invariants are stable.

Candidate properties:
- serialize then deserialize preserves meaning,
- normalized output is idempotent,
- sorting is ordered and permutation-preserving,
- money allocation preserves total,
- state transitions never reach illegal states,
- parser never crashes for arbitrary bytes/strings within a defined domain.

Keep generated counterexamples reproducible by recording seeds or framework-provided replay data.

## 10. Snapshot/golden tests
Snapshots can help for stable, reviewable structures but become dangerous when:
- snapshots are huge,
- updates are rubber-stamped,
- irrelevant formatting dominates diffs,
- assertions are replaced entirely by snapshot acceptance.

Prefer targeted semantic assertions for critical fields. Keep snapshots small and intentional.

## 11. Test fixtures
A fixture should reduce noise, not hide causality.

Good fixture design:
- safe defaults,
- test overrides important values explicitly,
- minimal global state,
- readable builders,
- no hidden network/database work,
- deterministic identifiers and clocks where useful.

Avoid “mystery guests”: fixtures whose invisible defaults determine the outcome.

## 12. Flaky tests
Investigate categories:
- clock/time dependence,
- randomness,
- race/synchronization,
- leaked shared state,
- test ordering,
- environment/locale,
- external I/O,
- resource exhaustion,
- eventual consistency.

A retry can hide the symptom while preserving the defect. Track root cause.

## 13. When unit tests are the wrong level
Move confidence upward when behavior depends essentially on:
- database transaction semantics,
- serialization framework configuration,
- network protocol details,
- schema compatibility,
- distributed coordination,
- real dependency behavior.

Keep unit tests for decision logic and local invariants; add integration/contract tests for the real boundary.

## 14. Bug-driven strengthening
For every escaped defect:
1. Write the smallest reproducer.
2. Prove it fails before the fix.
3. Fix production code.
4. Prove it passes.
5. Check whether the defect reveals a wider missing property.
6. Add the smallest additional protection needed.

## 15. Test deletion safety
Before deleting a test, answer:
- What unique behavior does it protect?
- Is another test stronger and equivalent?
- Is the behavior obsolete?
- Does the test encode a bug regression?
- Is there hidden setup that exercises a real side effect?

Delete only when protection is absent, duplicated, or obsolete.

## 16. Review economics
Prioritize test work by:
- business impact of failure,
- likelihood of change,
- code complexity,
- historical defects,
- ease of fault detection elsewhere,
- test maintenance cost.

Do not spend a day perfecting trivial tests while critical rules remain weakly protected.
