# Daily Test Refactoring Checklist

Use this during code review, test cleanup, or before shipping a risky change.

## Confidence
- [ ] Can I name the behavior each important test protects?
- [ ] Can I name a plausible regression that would make it fail?
- [ ] Are critical rules protected by more than “no exception” / “not null” assertions?
- [ ] Are recent escaped bugs captured by regression tests?

## Assertions
- [ ] Assertions verify semantic outcomes, not just execution.
- [ ] Negative side effects are checked where important.
- [ ] Boundary values are represented where rules have thresholds.
- [ ] Tests are not tautological with their setup.

## Coupling
- [ ] Tests use public unit boundaries where practical.
- [ ] Private-method tests are avoided.
- [ ] Mock call order/count is asserted only when contractual.
- [ ] Fakes/state assertions are preferred when clearer than interaction choreography.

## Determinism
- [ ] Time is controlled.
- [ ] Randomness is seeded/injected.
- [ ] Shared state is isolated.
- [ ] No unexplained sleeps or permanent retries.
- [ ] No hidden network/database access in a unit test.

## Value
- [ ] Duplicate tests are consolidated.
- [ ] Obsolete/tautological tests are removed.
- [ ] Tests are not being added only to raise coverage.
- [ ] High-risk code gets more attention than trivial code.

## Failure sensitivity
- [ ] At least one representative plausible fault would be caught.
- [ ] Mutation survivors in critical logic are reviewed when mutation data exists.
- [ ] A green suite is treated as evidence only if it has demonstrated ability to fail correctly.
