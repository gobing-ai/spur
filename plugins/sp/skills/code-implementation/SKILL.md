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
- **Re-launching the task pipeline from inside implement** — see anti-recursion below (bug-742).

## Anti-recursion (pipeline implement step — bug-742)

When this skill is entered via `/sp:dev-run --mode implement <wbs>` (the form
`task-pipeline.yaml` `implement` uses as a **pure slash command** — ADR-043):

1. Work **only** in the current working tree on that WBS. Implement code + author `## Solution`.
2. **NEVER invoke** `spur workflow run` for `task-pipeline.yaml` (or any full task pipeline).
3. **NEVER invoke** `/sp:dev-run` **without** an explicit `--mode implement`. Omitting the mode
   defaults to full pipeline and **recurses** into another `implement` step (bug-742).
4. Do **not** call `/sp:dev-runall`, `/sp:dev-verify`, or other lifecycle stages from inside this
   skill — the pipeline (or `--next` chain) owns those hops.

The structural guard is the slash form itself (`--mode implement`). Prose in the workflow YAML
`agent.run` `input` is the wrong place for this rule; it belongs here and in `dev-run.md`.

## One WBS per implement pass (task 0487 R1)

The target WBS is the **only** task you implement. Sibling tasks in the corpus are context you do
not have and work you were not asked to do.

- **Read** the target task file, the tasks named in its `dependencies`, its `feature_id` feature
  file, and the source files its Requirements / Design / Plan name. That is the whole input set.
- **Ignore every other `todo` / `wip` task in the tree**, including ones whose files changed
  recently. A task that looks half-finished is not an invitation — a freshly *committed* task can
  legitimately still be `status: todo` because its verify/wrap hops have not run yet.
- **Never implement a requirement belonging to another WBS**, even when it looks like a
  prerequisite. If the target genuinely cannot proceed without it, stop and say so — a blocked task
  is a cheap finding; a two-task diff costs the reverts.

Why this is a rule and not a nicety: driving task 0486 lost several hours to exactly this. Task 0485
was committed but still `todo` in the tree, and two different executors (omp run `ca130182`, claude
run `b16bfbf4`) each pulled 0485's observability feature and its tests into 0486's diff, unprompted.
A third agent reproduced it. The scope creep had to be detected and reverted four times.

The pipeline enforces this on the way out: the implement step's `requireDiff` gate also checks diff
*scope* against the files and explicit directory/glob prefixes the task body backticks, and routes
the run to `failed` naming any file outside them (new files beside a declared file are allowed;
bypass: run var `implementScopeGuard: "off"`). It compares snapshots taken immediately before and
after dispatch, so dirt already in the tree is not attributed to this pass. Keeping the diff to one task's
surfaces is what keeps that gate quiet.

## Implement scope: do not run the project quality gate

During implement, the pipeline's `test` hop runs `${vars.qualityGateCmd}` (the full project gate:
`bun run format && bun run spur-check`) immediately after this step and is the gate that actually
decides pass/fail. Running it inside implement is pure redundancy — it cannot change the outcome and
only burns wall clock and context budget.

- **Run only targeted probes** to validate your changes: `bun test <file>`,
  `bun test <file> --test-name-pattern "<test>"`, or `bunx tsc --noEmit` on a single package.
- **NEVER run** `bun run test`, `bun run spur-check`, `bun run check`, or any other full-suite /
  project-gate command from inside implement. These belong to the pipeline's `test` hop.
- **Full-suite budget: at most 2 per task** (task 0436 R2) — counted across the whole task run
  (implement probes + the pipeline `test` hop + verify/recheck), not per step. When a check fails,
  run the narrow target (`bun test <file> --test-name-pattern <test>`) to green before any full
  suite; reach for the second full run only when the narrow target cannot reproduce the failure.
- **Consolidate dogfood runs**: one combined real-data execution that exercises all scenarios,
  not N near-identical `--dry-run`/real invocations of the same script. If you find yourself
  rerunning the same dogfood command with one flag changed, stop and fold the variants into a
  single run — repeated identical commands are loop-detector findings and pure cost.
- If a targeted probe reveals a failure you cannot fix within implement scope, note it in
  `## Solution` and let the `test` hop's fixall handle it — do not pre-empt the gate.

## Changed-path targeted checks (dependency-aware verification, task 0510 R3)

"Run the narrow test first" needs a second half: *which* narrow tests, when a change to a shared
surface can break a downstream consumer. The matrix below is dependency-aware — domain → app →
CLI — so a shared change verifies its consumers without recreating the full project check inside
implement. **It augments narrow behavior tests; it never authorizes `bun run spur-check`,
`bun run test`, or another full project check inside implement** — the pipeline's `test` hop owns
that single full gate.

| Changed surface | Required targeted tests | Required typechecks |
| --- | --- | --- |
| `packages/domain/src/**` public type/query | affected domain test; affected app service test; affected CLI command test | `@gobing-ai/spur-domain`, `@gobing-ai/spur-app`, `@gobing-ai/spur` |
| `packages/app/src/**` public service/type | affected app test; affected CLI command test | `@gobing-ai/spur-app`, `@gobing-ai/spur` |
| `apps/cli/src/**` | affected `apps/cli/tests/**` file | `@gobing-ai/spur` |
| shared plugin flag/command/reference | affected plugin structure/contract test; add `flag-contract-parity.test.ts` **only** when the shared flag surface changes | no package typecheck unless TypeScript also changed |

- Apply **only the matching rows** for the surfaces actually changed; a multi-surface change applies
  the union.
- Workspace typechecks run as `bun run --filter <workspace> typecheck` for each listed workspace
  (monorepo; installed/other projects substitute their package-manager surface).
- The shared plugin row is deliberately conditional: a pure reference/prose change needs only the
  affected structure test; `flag-contract-parity.test.ts` is added only when the shared flag surface
  (a flag the plugin layer consumes) actually changes, so an unconditional parity suite does not
  creep into every plugin edit.
- Run the applicable rows, then stop: the single full project check belongs to the pipeline's
  `test` hop (`task-pipeline.yaml` `${vars.qualityGateCmd}`).

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
| --- | --- |
| "The spec is clear — I don't need to read the callers." | Code that looks orthogonal is how regressions ship (R5). Read the exports you touch and their immediate callers before writing. |
| "I'll add the tests in a follow-up." | Untested production code is unverified code. The task's test step is not optional; behavior ships with its test. |
| "This abstraction will be useful later." | Speculative abstraction is complexity without a caller (R2). Build for the requirement in front of you; add the seam when the second use arrives. |
| "Close enough to the AC — the intent is there." | "Close enough" is a FAIL at verify. Implement to the literal AC; if the AC is wrong, fix the AC, don't approximate it. |
| "I'll improve this adjacent code while I'm here." | Drive-by edits widen the diff and the blast radius (R3). Stay in scope; split unrelated cleanup into its own task. |
| "Task 0485 is still `todo` and clearly unfinished — I'll finish it while I'm in here." | It is not your WBS. `todo` often just means the verify/wrap hops have not run yet. Implementing it costs the reverts and fails the scope guard (0487 R1). |
| "It compiles and runs, so it's done." | Compiling is not the bar. Done is the AC met, tests green, and the `## Solution` change-map written. |

## Red Flags

- Writing code without having read the immediate callers of what you're changing.
- A `## Solution` section that lists files but not what changed or why.
- A `## Solution` section with file references that are not in backtick `` `path:line` `` form (L3 requirement: `` `packages/app/src/foo.ts:123` `` or `` `packages/app/src/bar.ts:10-20` ``; paths from repo root).
- A new abstraction with exactly one caller and no second use in sight.
- The diff touches files unrelated to the task's scope.
- The diff touches another WBS's surfaces, or the pass reads sibling `todo` / `wip` task files.
- "Done" claimed with no test run pasted.
- Silently changing an AC's meaning to match what was built.
- From implement mode: launching `spur workflow run …task-pipeline…` or `/sp:dev-run` without
  `--mode implement` (recursive pipeline — bug-742).

## Gotchas

1. **The task is the scope.** Implement only what traces to AC/design; record adjacent cleanup as a
   follow-up WBS rather than expanding the change.
2. **Root cause, not symptom.** A green gate reached by suppressing a check is not done.
3. **Never let a partial deliverable look complete.** Mark deferred requirements visibly in Solution
   and Review with the follow-up WBS.
4. **The spine owns the lifecycle.** This skill writes `## Solution`; status transitions and the
   other sections are the spine's / other competencies' concern.
5. **Implement is not the pipeline driver.** Pipeline YAML may only pass the pure slash
   `/sp:dev-run --mode implement <wbs> …` (ADR-043). If anti-recursion text is missing from the
   skill/command and you are tempted to paste it into YAML `input:`, put it here instead.

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
