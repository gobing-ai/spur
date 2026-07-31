---
name: code-implementation
description: "The implementation competency — turn a task's requirements, AC, and design into production code: task-driven scope, stack-pattern selection, root-cause debugging, a Solution change-map. Triggers: \"implement\", \"write code\", \"add feature\", \"fix the bug\", \"refactor\", \"code this task\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - technique
  competency: implementation
  openclaw:
    emoji: "⚙️"
---

# code-implementation — the implementation competency

Turn a task's requirements, acceptance criteria, and design into production code. This is the deep
competency the spine (`sp:spur-dev`) dispatches to at its `implement` step — it owns
*how to implement well*, not *when to implement* (the spine decides that). Every deterministic write
to the corpus still goes through `spur task update` (the CLI-gated write contract in
`sp:spur-dev`'s `cross-cutting.md`).

## When to use

- **New implementation** — write the code for a task whose requirements and design are settled.
- **Bug fixes** — reproduce, isolate root cause, fix the cause not the symptom (see debugging).
- **Refactors with test safety** — restructure behind passing tests.
- **The pipeline's `implement` step** — `/sp:dev-run --mode implement <wbs>` dispatches here.

Do **not** use this skill for:

- **Coverage / gap analysis / test extension** — that is `sp:code-testing`.
- **Test-first discipline (red-green-refactor)** — that is `sp:test-driven-development` (composed with this skill).
- **System design / architecture decisions** — that is `sp:sys-architecture` (decide the shape first).
- **Review / verification** — that is `sp:code-verification`.
- **Driving the lifecycle** — that is the spine, `sp:spur-dev`.

## Behavior

This skill behaves as a **technique**: given a task (read its Background, AC, Design, Plan), it maps
requirements to files, picks the narrowest verification, implements in small slices fixing root
causes, and writes a `## Solution` change-map via `spur task update`. It implements **only** behavior
that traces to the task's AC or design — adjacent cleanup is recorded as a follow-up, not folded in.

Full procedure: **[references/implementation-patterns.md](references/implementation-patterns.md)** —
preconditions, task-driven scope, pattern selection, progress persistence, handoff to testing/review.

## Composition with the discipline + test skills

- **`sp:test-driven-development`** — when the work is test-first, this skill composes with the TDD discipline:
  TDD designs the failing test, this skill writes the minimal code to pass it.
- **`sp:code-testing`** — after implementation, coverage/gap work runs there. The per-stack adapters
  (`stacks/<stack>.md`) that name build/test commands and idioms live in `code-testing` (operationally
  loaded by its detect→load→run flow); reference them cross-skill when you need the stack's idioms.

## Debugging

When implementation hits a failing gate, a failing test, a runtime defect, or flaky behavior, switch
to the root-cause-first workflow: **[references/debugging.md](references/debugging.md)** —
reproduce → isolate → minimal fix → regression guard.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The spec is clear — I don't need to read the callers." | Code that looks orthogonal is how regressions ship (R5). Read the exports you touch and their immediate callers before writing. |
| "I'll add the tests in a follow-up." | Untested production code is unverified code. The task's test step is not optional; behavior ships with its test. |
| "This abstraction will be useful later." | Speculative abstraction is complexity without a caller (R2). Build for the requirement in front of you; add the seam when the second use arrives. |
| "Close enough to the AC — the intent is there." | "Close enough" is a FAIL at verify. Implement to the literal AC; if the AC is wrong, fix the AC, don't approximate it. |
| "I'll improve this adjacent code while I'm here." | Drive-by edits widen the diff and the blast radius (R3). Stay in scope; split unrelated cleanup into its own task. |
| "It compiles and runs, so it's done." | Compiling is not the bar. Done is the AC met, tests green, and the `## Solution` change-map written. |

## Red Flags

- Writing code without having read the immediate callers of what you're changing.
- A `## Solution` section that lists files but not what changed or why.
- A new abstraction with exactly one caller and no second use in sight.
- The diff touches files unrelated to the task's scope.
- "Done" claimed with no test run pasted.
- Silently changing an AC's meaning to match what was built.

## Gotchas

1. **The task is the scope.** Implement only what traces to AC/design; record adjacent cleanup as a
   follow-up WBS rather than expanding the change.
2. **Root cause, not symptom.** A green gate reached by suppressing a check is not done.
3. **Never let a partial deliverable look complete.** Mark deferred requirements visibly in Solution
   and Review with the follow-up WBS.
4. **The spine owns the lifecycle.** This skill writes `## Solution`; status transitions and the
   other sections are the spine's / other competencies' concern.

## See also

- **`sp:spur-dev`** — the spine that dispatches this competency at the `implement` step.
- **`sp:code-testing`** — coverage and test extension; owns the per-stack adapters.
- **`sp:test-driven-development`** — the test-first discipline this skill composes with.
- **`sp:sys-architecture`** — decide the design/shape before implementing it.
- **[Verification Before Completion](../spur-dev/references/cross-cutting.md#verification-before-completion)** — no "done / passing / fixed" claim without fresh, pasted evidence run this turn.

## Platform Notes

### Claude Code

Invoked via `/sp:dev-run --mode implement <wbs>` (which the pipeline's `implement` step calls), or
directly via `Skill(skill="sp:code-implementation", args="<wbs>")`. Deterministic writes use the
`spur` CLI via the Bash tool.

### Codex / OpenClaw / OpenCode / Antigravity

Invoke this skill directly for implementation technique; run the `spur` CLI via the Bash tool for
corpus writes. The skill is the SSOT; commands and the pipeline step are thin wrappers.
