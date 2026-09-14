---
name: taste-refactoring-tests
description: Refactor unit tests for failure sensitivity, deterministic confidence, and regression protection without mock-heavy brittle tests or vanity coverage. Backs test suite quality audits.
---

# taste-refactoring-tests

## Purpose
Use this skill to refactor existing unit tests so they provide **real delivery confidence**, not the illusion of safety created by a permanently green test suite.

The objective is not “more tests”, “higher coverage”, or “make CI green”. The objective is **failure-sensitive tests**: tests that are cheap enough to run continuously, deterministic enough to trust, precise enough to diagnose failures, and strong enough to fail when relevant behavior regresses.

This skill is deliberately skeptical of tests that always pass, mirror implementation details, assert trivialities, overuse mocks, or inflate coverage without protecting user-visible behavior and important engineering invariants.

## Core outcome
Given existing unit tests, production code, coverage reports, mutation reports, CI history, bug/incident history, or a prose description, produce:

1. A concise model of what the tests currently claim to protect.
2. A map of weak, redundant, brittle, misleading, and missing protections.
3. A `Confidence Contract`: the behaviors and delivery qualities that tests must meaningfully defend.
4. A prioritized refactoring plan using the intervention ladder below.
5. Safer replacement tests with stronger assertions and lower coupling to implementation.
6. Validation evidence showing the refactored suite can actually detect plausible regressions.

## Prime directive
**A test earns its place by detecting meaningful regressions.**

A passing test is not evidence of quality unless there is a credible change that would make it fail.

Ask of every test:
- What behavior or invariant does this protect?
- What plausible regression would make it fail?
- Would a broken implementation still pass it?
- Does it verify an observable outcome or merely implementation choreography?
- Is the assertion strong enough to distinguish correct from merely non-crashing behavior?
- Is the test deterministic and repeatable?
- Does its maintenance cost exceed the risk it protects?

## Non-negotiable principles

### 1. Optimize for signal, not green
Never weaken assertions, catch failures, add retries, overmock dependencies, or skip tests simply to stabilize CI.

A red test can be valuable information. A green test that cannot detect regressions is dangerous.

### 2. Coverage is a map, not proof
Line or branch coverage can reveal unexercised code, but high coverage does not prove strong tests. Prefer evidence that tests are sensitive to faults: meaningful assertions, boundary cases, negative cases, mutation testing, bug reproduction, and behavior-oriented review.

### 3. Test observable behavior
Prefer testing externally observable behavior at the unit boundary rather than private methods, internal call order, exact intermediate objects, incidental SQL, or framework choreography.

Implementation details may be asserted only when they are themselves contractual: e.g. security policy, protocol requirements, transactional semantics, side-effect cardinality, or performance-critical behavior.

### 4. Assertions must discriminate
Weak assertions create false confidence. Avoid tests that only assert:
- no exception was thrown,
- object is non-null,
- collection is non-empty,
- HTTP status is success while response semantics are unchecked,
- a mocked method was called without checking the outcome,
- a snapshot changed without validating meaning.

Assert the smallest set of outcomes that proves the behavior and important invariants.

### 5. Mocks are a cost
Mock boundaries that are expensive, nondeterministic, or outside the unit. Do not mock the class under test, simple value objects, domain logic, or collaborators merely to make tests easy.

Prefer fakes/stubs for stateful collaborators when interaction assertions are not the actual contract.

### 6. Determinism is mandatory
Tests must control time, randomness, concurrency, locale, environment, global state, and external I/O when those can affect outcomes.

Retries are not a substitute for determinism.

### 7. Bugs deserve permanent regression tests
When a bug escaped, first capture the smallest reproducing test that fails before the fix and passes after it. Then strengthen nearby tests if the failure reveals a broader gap.

### 8. Test structure should aid diagnosis
One test may contain multiple related assertions if they express one behavior. Split tests when failures would represent different behaviors, different setup, or different root causes.

### 9. Prefer risk-based depth
Spend testing effort where failure cost, change frequency, complexity, and uncertainty are high. Do not give every getter and every critical calculation equal test weight.

### 10. Preserve useful tests
Refactoring is not churn. Keep tests that are behavior-focused, deterministic, appropriately scoped, readable, and capable of detecting meaningful regressions.

## The intervention ladder
Classify each test or test cluster into exactly one primary action. Use the least disruptive action that materially improves confidence.

### T0 — KEEP
The test is valuable as-is.

Use when it:
- protects a meaningful behavior or invariant,
- has discriminating assertions,
- is deterministic,
- is not tightly coupled to incidental implementation,
- has reasonable maintenance cost.

Output: `KEEP — <behavior protected and why the test is credible>`

### T1 — DIRECT REMOVE
Delete tests that provide no meaningful protection and have low uncertainty.

Typical candidates:
- tests of language/framework guarantees,
- tests that only verify getters/setters or constant assignments,
- duplicates with no extra behavior coverage,
- tests that assert mocks return what the test configured them to return,
- obsolete tests for removed behavior,
- tautological tests whose assertion repeats setup,
- unreachable/skipped tests with no remaining purpose.

Required check before removal:
- no unique contract is being protected,
- no known escaped bug depends on it,
- no subtle side effect or invariant is hidden in the setup.

### T2 — SUGGEST REMOVE
The test appears low-value or harmful, but removal needs evidence.

Use when:
- it is brittle but may encode undocumented behavior,
- it is redundant but ownership is unclear,
- it depends on legacy behavior with unknown consumers,
- it is flaky and nobody knows whether the flake exposes a real race.

Output must state what evidence would justify deletion.

### T3 — STRENGTHEN
Keep the scenario, improve failure sensitivity.

Typical moves:
- replace weak assertions with semantic assertions,
- assert error type/code/message contract where meaningful,
- assert state transitions, side effects, persistence, or emitted events,
- add boundary and negative cases,
- verify idempotency or invariant preservation,
- introduce mutation-sensitive assertions,
- replace broad snapshots with targeted checks.

Use when the scenario matters but the current test could pass under a broken implementation.

### T4 — SIMPLIFY / DE-BRITTLE
Keep the behavior coverage while reducing implementation coupling or maintenance cost.

Typical moves:
- test through the public unit boundary,
- remove private-method tests,
- replace interaction-heavy mocks with fakes or state assertions,
- use builders/factories for irrelevant setup,
- extract stable fixtures without hiding important inputs,
- remove accidental ordering dependencies,
- control clocks/randomness/environment,
- collapse duplicate parameterized cases,
- use table-driven tests for coherent boundary sets.

### T5 — ADD MISSING PROTECTION
Existing tests leave a material behavior or risk uncovered.

Add tests for:
- core business rules,
- error and rejection paths,
- boundary values,
- previously escaped bugs,
- security/authorization decisions,
- serialization/parsing rules,
- state transitions,
- concurrency/idempotency invariants where unit-testable,
- important null/empty/overflow/rounding/time-zone cases,
- contract changes likely to break consumers.

Do not add tests merely to raise a coverage percentage.

### T6 — RE-DESIGN TEST STRATEGY
The unit tests are structurally incapable of providing trustworthy confidence.

Triggers:
- massive mock choreography,
- tests mirror private structure so closely that every refactor breaks them,
- important behavior can only be tested through dozens of collaborators,
- test fixtures are harder to understand than production code,
- unit tests duplicate integration tests without catching unique faults,
- suites are consistently green despite recurring production regressions,
- mutation testing shows large survivor clusters in critical logic,
- architecture prevents isolation of important domain behavior.

A redesign may include:
- moving pure decision logic into testable units,
- replacing orchestration tests with focused domain tests plus contract/integration tests,
- changing dependency boundaries,
- introducing fakes for stable protocols,
- using property-based or state-machine testing for rule-heavy domains,
- redistributing coverage across unit, integration, contract, and end-to-end levels.

Do not force all confidence into unit tests when another test level is more appropriate.

### T7 — QUARANTINE / INVESTIGATE
Do not normalize uncertainty.

Use when a flaky or suspicious test cannot yet be classified safely.

Required output:
- suspected nondeterminism source,
- instrumentation or reproduction plan,
- owner,
- expiration/review date if quarantine is unavoidable,
- explicit warning that quarantine is temporary and not equivalent to passing.

## Confidence Contract
Before refactoring, identify what must remain protected.

Capture:
- critical business rules,
- public behavior and compatibility contracts,
- authorization/security decisions,
- data integrity invariants,
- error semantics,
- financial/rounding calculations,
- state-machine transitions,
- idempotency and duplicate handling,
- concurrency-sensitive invariants,
- serialization/protocol rules,
- incident/bug regressions,
- latency/resource constraints only where unit-level checks are credible.

Unknown protections are risks, not permission to delete tests.

## Test review workflow

### Phase 0 — Establish scope
Identify:
- production units under test,
- test framework and mocking tools,
- CI execution model,
- coverage/mutation data if available,
- recent escaped defects,
- known flaky tests,
- ownership and change hotspots.

### Phase 1 — Inventory tests by protected behavior
For each test or coherent cluster, record:
- behavior/invariant claimed,
- inputs and boundary class,
- observed outputs/side effects,
- mocks/fakes used,
- assertions,
- runtime and flake history,
- production code touched conceptually,
- bug/requirement linkage if known.

Do not organize review only by filename. Organize by behavior.

### Phase 2 — Find false-confidence smells
Look for:
- assert-nothing tests,
- tautological assertions,
- excessive `isNotNull`/`isTrue` assertions,
- mock-verification-only tests,
- tests of private methods,
- one-to-one mirroring of implementation classes,
- overspecified call order,
- snapshots covering large unstable structures,
- golden files nobody reviews,
- broad fixtures with irrelevant setup,
- time/random/environment dependence,
- sleeps and retries,
- shared mutable test state,
- hidden network/database access in “unit” tests,
- duplicate happy paths with no negative cases,
- coverage-driven trivial tests,
- mocks that make impossible states look valid,
- swallowed exceptions,
- assertions after asynchronous work without proper synchronization,
- skipped/disabled tests that CI still reports as green.

### Phase 3 — Challenge tests with plausible faults
For each important test, imagine or introduce small faults such as:
- invert a condition,
- remove validation,
- change a boundary comparison,
- return a default value,
- omit a side effect,
- swap fields,
- alter rounding,
- ignore authorization,
- duplicate an event,
- drop an error mapping.

If the test would still pass, classify it for strengthening or replacement.

Where practical, use mutation testing as automated evidence. Mutation score is diagnostic, not a vanity target.

### Phase 4 — Refactor from behavior outward
Preferred order:
1. Capture escaped bugs and missing critical behavior.
2. Strengthen weak assertions.
3. Remove tautologies and duplicates.
4. Reduce mock/implementation coupling.
5. Make nondeterministic tests deterministic.
6. Simplify setup and fixtures.
7. Re-balance tests across levels if unit tests are carrying the wrong responsibilities.

### Phase 5 — Validate the refactor
A successful refactor should show evidence such as:
- known faults are detected,
- representative mutants are killed,
- critical bug reproductions fail before fixes,
- tests survive internal refactors when behavior is unchanged,
- flaky failures decrease without assertion weakening,
- suite runtime remains acceptable,
- test names and failure messages explain the broken behavior,
- removed tests did not reduce meaningful protection.

## Assertion quality rules

### Prefer semantic assertions
Good:
- exact domain result,
- relevant object fields,
- precise state transition,
- exact error category/code,
- expected persisted record,
- expected emitted event payload,
- absence of forbidden side effect.

Weak unless context justifies them:
- `not null`,
- `true`,
- `count > 0`,
- `status < 400`,
- `mock.verify(...)` alone.

### Assert invariants, not every field
Do not make tests brittle by asserting irrelevant representation details. Assert all fields required to prove the behavior and no more.

### Negative assertions matter
For sensitive operations, verify not only what happened but what must **not** happen:
- unauthorized request did not mutate state,
- rejected payment did not emit fulfillment event,
- duplicate command did not create a second record,
- failed validation did not call persistence.

## Mocking rules

Mock when:
- a dependency crosses process/network boundaries,
- the real collaborator is nondeterministic or expensive,
- a failure mode must be induced deliberately,
- interaction itself is the contract.

Prefer a fake/stub when:
- state-based verification is clearer,
- the protocol is stable and simple,
- interaction count/order is not the behavior.

Avoid mocking:
- value objects,
- pure functions,
- the unit under test,
- every internal collaborator by default.

## Property-based and parameterized testing
Use property-based tests when the behavior is best expressed as an invariant across many inputs, such as:
- parsers/serializers,
- ordering/sorting,
- numeric calculations,
- state transitions,
- normalization,
- round trips,
- algebraic/domain invariants.

Use parameterized/table-driven tests for a finite, meaningful set of boundary classes. Do not hide fundamentally different behaviors in one giant data table.

## Flakiness policy
A flaky test is a defect in either the test, product, environment, or synchronization model.

Do not permanently solve flakiness by:
- retries,
- longer sleeps,
- looser assertions,
- disabling the test,
- ignoring failures.

Use retries only as short-lived diagnostic containment when the underlying issue is actively tracked.

## Test naming
Names should describe behavior and condition, not implementation trivia.

Prefer:
`rejects_transfer_when_balance_is_insufficient`

Avoid:
`testProcessTransfer2`

For BDD-style naming, keep the same principle: condition + behavior + outcome.

## Review severity
Rate findings by delivery risk:

- **P0 Critical** — suite can green-light a severe security, financial, data integrity, or availability regression.
- **P1 High** — important production behavior is weakly protected or known bugs can recur unnoticed.
- **P2 Medium** — brittleness, flakiness, or overspecification significantly slows safe delivery.
- **P3 Low** — readability/duplication/fixture quality issue with limited confidence impact.

Priority is based on risk reduction, not cosmetic cleanliness.

## Required output format
When reviewing tests, return sections in this order:

### 1. Confidence summary
- What the suite protects well
- Where confidence is misleading
- Biggest delivery risks

### 2. Confidence Contract
A compact table of required behaviors/invariants and current protection strength.

### 3. Findings
For each finding:
- `ID`
- `Severity`
- `Action` (`T0`–`T7`)
- `Evidence`
- `Why it matters`
- `Proposed change`
- `Expected regression-detection improvement`

### 4. Refactoring plan
Order changes by risk reduction and dependency, not file order.

### 5. Replacement test examples
Show representative before/after tests or pseudocode when useful.

### 6. Validation plan
State how to prove the refactored tests are stronger: fault injection, mutation testing, bug reproduction, flake monitoring, refactor resistance, or other evidence.

## Decision rules

### Do not remove a test only because it is ugly
First determine what protection it provides. Preserve the protection even if the implementation is rewritten.

### Do not preserve a test only because it has existed a long time
Age is not evidence of value.

### Do not add assertions mechanically
Every assertion should make a broken implementation more likely to fail for a meaningful reason.

### Do not chase 100% coverage
Prefer a smaller suite with high fault sensitivity over a larger suite that asserts trivialities.

### Do not convert every unit test into an integration test
Use the narrowest test level that can reliably protect the behavior.

### Do not force behavior through mocks
If testing requires recreating the implementation in mock expectations, reconsider the unit boundary or test level.

## Daily operating heuristic
When time is limited, use this sequence:

1. Find tests around the highest-risk or most-changed code.
2. Identify what regression each test would catch.
3. Remove or mark tests that catch nothing meaningful.
4. Strengthen weak assertions on critical behavior.
5. Add one missing negative/boundary case where risk is highest.
6. Reduce one source of brittleness or nondeterminism.
7. Challenge the suite with a small plausible fault.

If the fault survives, the suite is not done merely because it is green.

## Definition of done
A test refactor is complete only when:
- required behavior remains protected,
- misleading tests are removed or repaired,
- important assertions are discriminating,
- nondeterminism is controlled,
- implementation coupling is reduced where possible,
- critical negative/boundary paths are represented,
- the suite detects representative plausible faults,
- delivery speed is not degraded without a justified risk trade-off.

The goal is **earned confidence**: green means something because the suite has demonstrated that it can turn red when the product is wrong.
