---
name: spur-tdd
description: "Test-driven development discipline: red-green-refactor, behavior-first test design, AAA structure, naming, data builders, mock-at-boundary anti-patterns. Triggers: \"write tests first\", \"TDD\", \"red-green-refactor\", \"characterization test\", \"contract test\", \"how to structure/name a test\"."
license: Apache-2.0
version: 1.0.0
created_at: 2026-06-25
updated_at: 2026-06-25
type: technique
platform: sp
tags: [tdd, testing, red-green-refactor, test-design, workflow-core]
metadata:
  author: spur
  platforms: "claude-code,codex,antigravity,opencode,openclaw"
  category: workflow-core
  interactions:
    - knowledge-only
  openclaw:
    emoji: "🧪"
see_also:
  - spur-dev
  - code-testing
  - code-implementation
---

# Spur TDD — Test-Driven Development

Test-first development discipline: the red-green-refactor cycle, behavior-first design, and the
patterns that make a test worth keeping. This is the **how to write a good test** SSOT.

**Where it sits in the testing surface:**

| Concern | Owner |
|---------|-------|
| How to *design/structure/name* a test (this skill) | `sp:spur-tdd` |
| How to *extend coverage / fill gaps* on existing code | `sp:code-testing` → `references/unit-testing.md` |
| Per-stack commands, coverage parsing, idioms, gotchas | `sp:code-testing` → `references/stacks/<stack>.md` |
| Writing the implementation the test drives | `sp:code-implementation` |
| Debugging *why* a test fails | `sp:code-implementation` → `references/debugging.md` |

Use `spur-tdd` when writing code test-first; use `sp:code-testing` when filling coverage on code that
already exists. They compose: TDD designs the tests, `sp:code-testing` proves the coverage.

## When to use

Load this skill when:

- Writing a new feature, component, or endpoint test-first.
- Fixing a bug and want a regression test that reproduces it first.
- Refactoring, or adding to untested legacy code (characterization tests).
- Defining an API contract against an external dependency.
- You know *what* to test but want the right *structure, name, or mock boundary*.

Do **not** use it for routine test execution, coverage measurement, or post-hoc gap filling — that
is `sp:code-testing`.

## The cycle

**Iron Law:** no production code without a failing test first. Wrote code before the test? Delete it,
start over.

1. **RED** — write the minimal test for one behavior → verify it fails *for the expected reason*
   (not a typo or import error).
2. **GREEN** — write the simplest code that passes → verify all tests pass.
3. **REFACTOR** — clean duplication and improve names while tests stay green.
4. **Repeat** for the next behavior.

A test must encode **why** the behavior matters, not just what it returns (AGENTS.md). A test that
still passes after the business rule changes is the wrong test.

## Workflows

Match the situation to a workflow:

| Situation | Workflow |
|-----------|----------|
| New feature/component/endpoint | **Classic TDD** — one test per behavior, red→green→refactor |
| Bug fix | **Regression-first** — write a test that reproduces the bug, watch it fail, then fix |
| Untested legacy code | **Characterization** — write tests capturing *current* behavior first, then change |
| API / service boundary | **Contract-based** — define the consumer's expected request/response, mock the provider to satisfy it |
| Algorithms / data transforms | Property/invariant thinking; deeper tooling is covered by `sp:code-testing` advanced techniques |

### Classic TDD (new feature)

Write one test for the desired behavior → verify RED → simplest code to GREEN → verify all green →
refactor (duplication, names) → repeat for the next behavior. Tests drive the design, so the API
emerges from how it's used, not guessed up front.

### Regression-first (bug fix)

Write a test that reproduces the bug → verify it fails (the bug exists) → write the minimal fix →
verify it passes and nothing else broke → scan for the same defect class elsewhere and add tests.
Investigate the root cause *before* writing the fix — a regression test for a symptom you don't
understand is brittle.

### Characterization (legacy code)

Before modifying untested code, write tests that **capture the current behavior** (even if it's
quirky) and verify they pass. Now you have a safety net: make changes, and the characterization tests
catch any regression. Tighten them toward intended behavior afterward.

### Contract-based (API boundary)

Define the contract from the **consumer's** perspective — the request shape and the response it
expects — then mock the provider to satisfy it. The consumer test is the source of truth for the
boundary; the provider must not drift from it.

## Test design patterns

### AAA — Arrange, Act, Assert

Every test has three clear phases; keep them visually separated.

```typescript
test('doubleValue returns twice the input', () => {
  // Arrange
  const input = 42;
  // Act
  const result = doubleValue(input);
  // Assert
  expect(result).toBe(84);
});
```

### Naming — behavior under a condition

A test name states the behavior and the condition, not the implementation. Format: the thing under
test (`describe`), the specific behavior (`test`/`it`).

```typescript
describe('Calculator', () => {
  test('returns the sum of two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });
  test('throws when dividing by zero', () => {
    expect(() => divide(1, 0)).toThrow('Division by zero');
  });
});
```

| Good | Bad |
|------|-----|
| `throws on invalid input` | `testValidateFunction` (implementation) |
| `returns empty array for no matches` | `testItWorks` (restates the test) |
| `when user is admin, allows delete` | `test1`, `test2` (generic) |

### Test data builders

For objects with many fields, a fluent builder keeps tests readable and resilient to shape changes —
each test sets only what it cares about.

```typescript
class UserBuilder {
  private data = { name: 'Test User', email: 'test@example.com' } as UserData;
  withName(name: string) { this.data.name = name; return this; }
  asAdmin() { this.data.role = 'admin'; return this; }
  build(): UserData { return { ...this.data }; }
}

const admin = new UserBuilder().withName('Alice').asAdmin().build();
```

### Mock at boundaries only

Mock what crosses a process/IO boundary; never mock the code under test or its internal
collaborators.

| Mock | Don't mock |
|------|------------|
| Database queries | Internal utilities |
| Network / API calls | Business logic |
| File system | Pure / deterministic functions |
| Time / clock / randomness | The code under test |

## Anti-patterns

Before writing an assertion, run the gate question:

| Anti-pattern | Gate question |
|--------------|---------------|
| Testing mocks | "Am I asserting real behavior, or just that a mock exists?" |
| Test-only production methods | "Is this only used by tests?" → move to test utilities |
| Mocking without understanding | "What side effects does the real dependency have? Does the test rely on them?" |
| Incomplete mocks | "Does this mock match the real response schema completely?" |
| Over-mocking | "Is this external or internal? Don't mock internal." |
| Testing implementation details | "Would a user/caller care about this?" → assert observable behavior |

```typescript
// BAD — asserts a mock exists
expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
// GOOD — asserts real behavior
expect(screen.getByRole('navigation')).toBeInTheDocument();

// BAD — mock missing fields the real API returns
const mock = { status: 'success', data: { userId: '123' } };
// GOOD — mirrors the real response
const mock = {
  status: 'success',
  data: { userId: '123' },
  metadata: { requestId: 'req-789', timestamp: 1234567890 },
};
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll write the test after the code — same result, faster." | Test-after tests what the code *does*, not what it *should* do; it rubber-stamps bugs. Red-first is the only proof the test can fail. |
| "This code is too obvious to need a test." | "Obvious" code is where off-by-one and null-path bugs hide. If it ships to a production path, it earns a behavior test. |
| "I tested it manually, it works." | Manual checks are not repeatable and vanish at the next change. A regression test is the only durable proof. |
| "The test is red for an unrelated reason — I'll implement anyway." | A test that fails for the wrong reason proves nothing. Make it fail for the *expected* reason before writing code. |
| "Mocking the internal collaborator is easier." | Mocking internals tests the mock, not the system, and freezes the implementation shape. Mock only at true boundaries. |
| "Coverage is high enough; skip the edge case." | Line coverage counts lines run, not behaviors verified. An untested error path is a bug waiting for the input that triggers it. |

## Red Flags

- Writing implementation before a failing test exists for the behavior.
- A test that has never been observed to fail (it may be asserting nothing).
- Editing a test to make it pass instead of fixing the code (or vice-versa without understanding why).
- Assertions on internal calls / mock invocations instead of observable behavior.
- "I'll add tests in a follow-up" on a production path.
- A green suite with an obvious untested error/edge path.

## Verification checklist

Before marking test-first work complete:

- [ ] Watched each test fail before implementing — and fail for the *expected* reason.
- [ ] Wrote the minimal code to pass; refactored with tests green.
- [ ] Every behavior (not every line) has a test; edge cases and error paths covered.
- [ ] Assertions tie to the requirement, not the implementation.
- [ ] Tests are independent and fast; no shared mutable state between them.
- [ ] Mocks sit only at boundaries; no internal collaborator is mocked.

## Why it matters

"Skip TDD just this once" is rationalization. Test-first finds bugs before commit (cheaper than
debugging after), prevents regressions, documents intended usage, and makes refactoring safe. The
shortcut is slower — it just moves the cost to production.

## Notes

- **Knowledge-only skill.** It does not run commands or move task status. The illustrative snippets
  are TypeScript (`bun:test`); for other stacks, the test command, coverage parsing, and framework
  idioms live in the `sp:spur-dev` stack adapters (`references/stacks/<stack>.md`). The TDD discipline
  here is stack-agnostic.
- **Composes with the pipeline.** When a task runs through `sp:spur-dev`, the implement stage can
  apply this discipline to author tests; the `test` stage (`unit` op) then proves coverage. This
  skill is the *design* half, `sp:code-testing` is the *coverage* half.
