# Research and Industry-Practice Basis

This skill is synthesized from established testing practice rather than one source document.

## Core traditions reflected

### Behavior-oriented unit testing
Tests should focus on observable behavior and stable contracts rather than mirroring internal implementation structure. This reduces brittleness and makes refactoring safer.

### Test pyramid / test portfolio thinking
Confidence should be distributed across test levels. Unit tests are best for fast local decision logic and invariants; integration, contract, and end-to-end tests should cover concerns that inherently require real boundaries.

### Mutation testing
Mutation testing evaluates whether tests detect injected faults. It is especially useful for exposing weak assertions and green suites that execute code without proving behavior.

Representative tools include PIT (JVM), Stryker (JavaScript/.NET and others), mutmut/cosmic-ray (Python), and language-specific equivalents.

### Property-based testing
Property-based testing (e.g. QuickCheck-family approaches) is useful when correctness is expressed more naturally as invariants over broad input spaces than as a few hand-picked examples.

### FIRST-style test qualities
Fast, isolated/independent, repeatable, self-validating, and timely tests remain useful heuristics, but this skill adds a stronger emphasis on fault sensitivity and delivery risk.

### Testing Trophy / modern test portfolio practice
The right test level depends on the behavior. Do not maximize unit-test count at the expense of realistic boundary confidence.

### Regression testing from escaped defects
Production bugs should become durable regression protections whenever a stable, meaningful automated check can be created.

## Concepts deliberately rejected as primary quality measures
- raw test count,
- 100% line coverage,
- permanently green CI,
- high mock verification density,
- snapshot volume,
- number of assertions.

These metrics can be inputs, but none proves that a suite detects meaningful regressions.

## Central quality thesis
A trustworthy suite must demonstrate **sensitivity to wrong behavior**. The strongest practical evidence is a combination of:
- well-chosen behavior assertions,
- negative and boundary tests,
- bug reproductions,
- representative fault injection or mutation testing,
- low flakiness,
- resilience to behavior-preserving refactors.
