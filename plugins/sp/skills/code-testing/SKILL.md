---
name: code-testing
description: "The testing competency — run tests, measure coverage, categorize gaps, extend the suite with targeted tests across Bun/TS, Python, Go. Triggers: \"write tests\", \"measure coverage\", \"what's untested\", \"coverage gap\", \"extend the test suite\", \"run the tests\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - technique
  competency: testing
  openclaw:
    emoji: "🧪"
---

# code-testing — the testing competency

Run existing tests, measure what is covered, categorize the gaps, and extend the suite with targeted
tests — language-agnostic spine with per-stack adapters. This is the deep competency the
spine (`sp:spur-dev`) dispatches to at its `test` step (via `/sp:dev-unit`). It owns
*how to test and measure coverage well*, not *when* (the spine decides that).

## When to use

- **Run + measure** — execute the suite, read the coverage report, identify untested paths.
- **Gap-fill** — add targeted tests to close a coverage gap on existing code.
- **The pipeline's `test` step** — `/sp:dev-unit <wbs>` dispatches here.

Do **not** use this skill for:

- **Writing the implementation** — that is `sp:code-implementation`.
- **Test-first design (red-green-refactor)** — that is `sp:test-driven-development` (composed with this skill).
- **Functional / requirements verification + review** — that is `sp:code-verification`.
- **Driving the lifecycle** — that is the spine, `sp:spur-dev`.

## Behavior

This skill behaves as a **technique**: detect the stack → load the one matching adapter → run the
suite → parse coverage → categorize gaps (untested branch, missing boundary, absent error path) →
extend with the narrowest tests that close the highest-value gaps. Coverage is a signal, not the
goal: it favors behavior-meaningful tests over line-chasing.

Full procedure: **[references/unit-testing.md](references/unit-testing.md)** — file-focused vs
task-scoped workflows, gap categorization, coverage-vs-quality rules, escalation. Per-stack
mechanics (commands, coverage parsing, idioms, gotchas) live in the adapters:
[references/stacks/](references/stacks/) — `bun-ts.md`, `python.md`, `go.md`.

When a test is red, apply the **[test-loop breaker](references/test-loop-breaker.md)** before
re-running it. Keep command output bounded without hiding the exit status by following
**[test-output discipline](references/test-output-discipline.md)**.

## Targeted-test-first verification loop

When iterating on a red test, run the **narrow** target before any full-suite gate so the loop does
not re-run the entire workspace on every attempt (task 0436 R2). Full-suite re-runs during a fix
loop are the dominant verification cost on a long chain.

1. Run the narrow target: `bun test <file> --test-name-pattern <test>` (or the stack-equivalent
   single-test filter in the matching adapter).
2. Loop on that narrow target until green.
3. **Then** run the single full `spur-check` (or `bun run check`) as the final gate.

Do not re-run the full suite per iteration, and do not run a full gate before the narrow target is
green. Target: full `spur-check` runs ≤2 per task.

## Composition with the discipline + implementation skills

- **`sp:test-driven-development`** — they compose: TDD *designs* the tests (red-green-refactor, behavior naming,
  mock-at-boundary); this skill *runs and extends* the suite for coverage. TDD is the how-to-design;
  this skill is the run/measure/gap-fill.
- **`sp:code-implementation`** — the implement step writes code; this step proves it. The per-stack
  adapters here are also the stack-idiom reference `code-implementation` consults cross-skill.

## Per-stack adapters

| Detected by | Stack | Adapter |
|-------------|-------|---------|
| `bun.lock` / `bunfig.toml` | Bun + TypeScript | [stacks/bun-ts.md](references/stacks/bun-ts.md) |
| `pyproject.toml` / `pytest` | Python | [stacks/python.md](references/stacks/python.md) |
| `go.mod` | Go | [stacks/go.md](references/stacks/go.md) |

## Gotchas

1. **Coverage is a signal, not the target.** A test that survives a business-rule change is the
   wrong test — assert intent, not implementation.
2. **One adapter per run.** Detect the stack, load the single matching adapter; do not mix idioms.
3. **Escalate to debugging when a failure needs root-causing**, not more test authoring
   (`sp:code-implementation`'s debugging reference).

## See also

- **`sp:spur-dev`** — the spine that dispatches this competency at the `test` step.
- **`sp:code-implementation`** — writes the code this skill tests; consults these stack adapters.
- **`sp:test-driven-development`** — the test-first discipline this skill composes with.
- **`sp:code-verification`** — functional/requirements verification + review (a distinct gate).
- **[Verification Before Completion](../spur-dev/references/cross-cutting.md#verification-before-completion)** — no "coverage met / tests pass" claim without fresh, pasted evidence run this turn.

## Platform Notes

### Claude Code

Invoked via `/sp:dev-unit <wbs>` (which the pipeline's `test` step calls), or directly via
`Skill(skill="sp:code-testing", args="<target>")`. Run the test/coverage commands via the Bash tool.

### Codex / OpenClaw / OpenCode / Antigravity

Invoke this skill directly for testing technique; run the stack's test commands via the Bash tool.
The skill is the SSOT; the command and pipeline step are thin wrappers.
