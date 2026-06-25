---
name: unit-testing
description: "SSOT for the `unit` operation procedure (language-agnostic spine) — file-focused and task-scoped test workflows, gap categorization, coverage-vs-quality rules, escalation. Backs `/sp:dev-unit` and dev-operations.md §1. Per-stack commands, coverage parsing, and gotchas live in stacks/<stack>.md adapters."
see_also:
  - spur-dev
  - dev-operations
---

# Unit Testing

The procedure behind the `unit` operation (`/sp:dev-unit`, `dev-operations.md §1`). It extends or
generates tests until the coverage target is met with a fully passing suite. It does **one** thing —
write tests — and yields; it does not implement, review, or verify.

This file is the **coverage half** of the testing surface: how to *fill gaps* on code that already
exists. For the **design half** — how to write a good test test-first (red-green-refactor, AAA,
naming, mock-at-boundary) — use the **`sp:spur-tdd`** skill. They compose: TDD designs the tests,
the unit op proves the coverage.

**This file is the language-agnostic spine.** It owns the *thinking* — workflows, gap analysis,
quality rules, escalation. Each stack's *mechanics* — the test command, how to parse its coverage
report, framework idioms, and stack-specific gotchas — live in a thin adapter under
[`stacks/`](stacks/). The operation runs: **detect stack → load the one matching adapter → run this
spine.**

> **Scope.** The `unit` operation runs against whatever project the agent is working in — which may
> be any stack, not Bun/TS. (Spur's *own* self-build gate is Bun/TS per AGENTS.md, but that is a
> different concern from testing user code.) The spine is universal; the adapter supplies the stack.

## Stack detection → adapter

Detect the project stack from its manifest, then load the matching adapter for all command/parsing
specifics:

| Manifest signal | Stack | Adapter |
|-----------------|-------|---------|
| `bun.lock` / `bunfig.toml` | Bun + TypeScript | [stacks/bun-ts.md](stacks/bun-ts.md) |
| `package.json` with `vitest` / `jest`, no bun lock | Node + TypeScript/JS | [stacks/bun-ts.md](stacks/bun-ts.md) (Node section) |
| `pyproject.toml` / `pytest` | Python | [stacks/python.md](stacks/python.md) |
| `go.mod` | Go | [stacks/go.md](stacks/go.md) |
| `Cargo.toml` | Rust | *adapter not yet authored — see [stacks/](stacks/)* |
| other | — | author a new adapter following the existing pattern |

If no adapter exists for the detected stack, author one (≈40–60 lines: test command, coverage
command + report parsing, framework idioms, known gotchas) rather than inlining stack specifics here.

## Two workflows

The `target` argument selects the workflow:

| Input | Detection | Workflow |
|-------|-----------|----------|
| A source file path or a glob | Source path / file glob | **A — file-focused** |
| A WBS number, a `.md` task file, or any other string | WBS / task ref | **B — task-scoped** |

### Workflow A: file-focused

Use when `target` is a source file path or glob.

1. Resolve the source file(s) and **detect the stack** (load its adapter).
2. Derive or locate the test file(s) — see the adapter for the stack's test-file convention. For a
   loose source file with no matching test, create one with the stack's standard test structure.
3. Run tests with coverage (the adapter's measurement command).
4. Identify gaps ([§ Gap analysis](#gap-analysis)).
5. Add targeted tests for the highest-priority gaps first.
6. Re-run; compare before/after coverage.
7. Repeat until the target is met or the loop escalates (max 3 passes — see [§ Escalation](#escalation)).

The repository coverage signal is not a strict per-source-file proof. For file-focused usage treat
coverage as **target-focused evidence**: combine the coverage output with a direct assertion that
the target file's behavior/path set is exercised by the added tests. Do **not** claim mathematically
exact per-file coverage for the source target unless the toolchain actually reports it.

### Workflow B: task-scoped

Use when `target` is a WBS number or task file path. This workflow moves task status and is gated by
the CLI.

1. Resolve the task reference and **detect the stack** (load its adapter).
2. **Pre-testing guard** (see below) — ensure required sections exist before moving status.
3. `spur task update <wbs> testing`.
4. Run a task-scoped test/coverage pass (the adapter's measurement command).
5. If testing reveals implementation gaps, move the task back: `spur task update <wbs> wip`.
6. Repeat until tests are green and the coverage target is satisfied.

`dev-unit` is a **testing** command, not a completion command — it never marks a task `done`. Final
closure belongs to the pipeline's verify gate.

| Workflow moment | Required status action |
|-----------------|------------------------|
| Start task-scoped testing | Ensure `Solution` + `Plan` exist, backfill `Design` if needed, then `spur task update <wbs> testing` |
| Testing reveals implementation work remains | `spur task update <wbs> wip` |
| Testing pass succeeds | Keep current status — do **not** mark `done` |

#### Pre-testing guard

`spur task check` gates `testing` status on required sections. Task-scoped `dev-unit` must not move a
task to `testing` blindly. Before the transition:

1. Ensure `Solution` describes the implemented behavior being tested.
2. Ensure `Plan` records the concrete execution/testing steps taken.
3. Add minimal real `Design` content if needed to avoid warning-driven `--force` usage.
4. Only then call `spur task update <wbs> testing`.

Never substitute `--force` for honest backfill. The section-editing rules live in
[cross-cutting.md](cross-cutting.md). (This guard governs the Spur task corpus and is stack-agnostic.)

## Coverage target

The default target is **per-file line ≥ 90% and function ≥ 90%** with a fully passing suite.
`--coverage <pct>` may raise or lower the line/function target but never relaxes the "100% passing"
requirement. How each stack reports those numbers is in its adapter.

> **Realistic targets by surface.** 90% is the Spur default; some surfaces justify lower (see
> [§ When to accept lower coverage](#when-to-accept-lower-coverage)). Domain/business logic should run
> high (90–100%); generated code, simple wrappers, and config can run lower with documented rationale.

## Gap analysis

Read the coverage report (via the adapter) and categorize each gap before writing tests — priority
order top to bottom:

| Category | Example | Strategy | Priority |
|----------|---------|----------|----------|
| Error paths | a thrown/raised error in a guard or catch block | Add error-condition tests | High |
| Complex logic | nested conditionals, branch matrices | Add parameterized/table-driven tests covering each branch | High |
| Edge cases | boundary conditions (0, -1, empty, max) | Add boundary-value tests | Medium |
| External deps | network/file/process calls | Add mock-at-boundary tests | Medium |
| Unreachable | defensive checks, impossible states | Document rationale, skip | Skip |

**Branch coverage rule (language-agnostic):** every conditional branch needs at least one test that
takes it. A function with `if vip { if large {A} else {B} } else {C}` needs three tests (large-vip,
small-vip, non-vip) — counting line coverage alone hides the missing branch. The stack adapter shows
the idiomatic way to express parameterized/table-driven branch tests.

## Coverage vs quality

Coverage measures execution, not correctness. A 100%-covered test with no assertion is worthless —
the test must assert observable behavior, not merely call the code. Per AGENTS.md, tests encode
**why** the behavior matters: names describe behavior under a condition; assertions tie to the
requirement, not the implementation.

**Coverage anti-patterns** (do not produce these — they are language-agnostic):

1. **Coverage padding** — tests that touch code without asserting.
2. **Happy-path only** — only success cases, no error/edge branches.
3. **Implementation-detail testing** — asserting internal state instead of observable behavior.
4. **Over-mocking** — mocks that hide the real behavior gap. Mock only at boundaries (network, file,
   process, clock), never internal collaborators.

### When to accept lower coverage

Valid reasons (document the rationale inline, in the stack's idiom):

1. **Generated code** — schema/ORM/OpenAPI output, tested at the contract.
2. **Simple wrappers** — pure delegation, no new logic.
3. **Impossible states** — defensive checks unreachable in production.

The adapter shows each stack's inline-exclusion/rationale syntax.

## Completion criteria

The operation succeeds only when **all** are true:

1. The relevant tests pass with `0` failures.
2. The coverage target is met (`--coverage` when provided, else per-file line/function ≥ 90%).
3. No unresolved blocker remains from the last test pass.

If coverage is still below target after focused extension, **escalate** — do not pretend success.

## Escalation

Escalate when:

- Coverage plateaus after repeated passes (**max 3 gap-filling passes**).
- A failure requires debugging rather than more test authoring.
- Environment or dependency issues block meaningful testing.

Before assuming a real gap, **rule out instrumentation artifacts** — most stacks have coverage
gotchas where the metric understates reality (synthetic constructors, unloaded modules, worker
leaks). The adapter's gotcha table lists them per stack; check it before writing tests that cannot
move the number.

On escalation:

1. **Document the untestable code** — some gaps are unreachable by design.
2. **Report status honestly** — which gaps remain, which are documented-skipped, final coverage achieved.
3. For task-scoped runs, leave the task in `wip` if implementation changes are still required; do not
   force it forward.
