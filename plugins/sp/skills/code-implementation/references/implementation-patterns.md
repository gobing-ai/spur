---
name: implementation-patterns
description: "Production implementation discipline for the sp execution loop: task-driven scope, branch/worktree hygiene, stack pattern selection, progress persistence, and handoff."
see_also:
  - code-implementation
  - code-testing
---

# Implementation Patterns

This reference is the core of the `code-implementation` competency skill — the discipline the
spine's `implement` step dispatches to. It is not a separate command: deterministic writes still go
through `spur task update`, and the spine (`sp:spur-dev`) owns the lifecycle that invokes this skill.

## Preconditions

Before writing code:

1. Read the task's Background, Acceptance Criteria, Design, and Plan.
2. Confirm the task is small enough to implement as one coherent change. If it is not, split or
   create follow-up tasks before coding.
3. Check the worktree and branch. Avoid mixing unrelated changes into the implementation evidence.
4. Identify the stack and local conventions before adding files.
5. Choose the narrowest verification command that proves the first behavior.
6. **Reuse context from prior chain steps.** When this skill is invoked via a `--next` chain
   (refine → run → verify), the calling session already holds the task file, `spur task check`
   output, and any files read during refinement. Before re-reading a file, check whether it is
   already in context — re-reading the task file or re-running `spur task check` when the prior
   step's result is still valid wastes tokens and drags cache hit rate below 40%. Only re-fetch
   when the underlying state changed (e.g. you just wrote a section and need the updated check).
   Apply the same discipline to skill/command reference files: if the task's own references or
   the refine step already loaded them, reference the in-context copy rather than re-reading.

## Task-Driven Implementation

The task is the source of scope. Implement only behavior that traces to the task's acceptance
criteria or design. If you discover adjacent cleanup, record it as a follow-up unless it directly
unblocks the requirement.

Use this sequence:

1. **Map requirement to files.** Identify the module, seam, config, docs, or tests that must change.
2. **Choose a test strategy.** Use `sp:test-driven-development` for test-first work, or `sp:code-testing` for
   gap-filling coverage on existing code.
3. **Implement in a small slice.** Keep the first slice narrow enough to verify.
4. **Run the narrow check.** Fix root causes, not symptoms.
5. **Update the task Solution.** The `implement` step owns `## Solution`; write a change map through
   `spur task update <wbs> --section Solution --from-file <tmp>`.

## Pattern Selection

Use existing local patterns first. Only introduce a new abstraction when it removes real complexity,
matches an established seam, or gives a second concrete adapter/caller.

| Domain | Default Pattern |
|--------|-----------------|
| API shape | Resource or operation names that match existing route/contract vocabulary; structured errors with context. |
| Persistence | Existing DAO/service boundary; one lock/write domain for corpus changes. |
| Config | Existing zod/config loader; no ad hoc environment reads in feature code. |
| Process/file I/O | Existing runtime/process/file-system seam where the app already has one. |
| Tests | Behavior names, boundary mocks only, fixtures/builders for noisy inputs. |
| Documentation | Authoritative docs only; update `04_DESIGN.md` for command/config/schema changes. |

## Progress Persistence

Long implementation steps should leave resumable evidence:

- code changes stay scoped to the task
- Solution lists changed files and why
- Testing records commands run and result
- Review records open risks or deferred work

If the task ships a partial deliverable, mark it visibly in Solution and Review with the deferred
requirement and follow-up WBS. Do not let a partial implementation look complete.

## Task-Type Awareness

The implement step assumes a standard implementation task (`template: default`). When the task
carries a different template, the implement agent MUST check the task's frontmatter `template`
field and adjust its scope:

| Template | Scope | Primary input |
|----------|-------|---------------|
| `default` | Implement `## Requirements` → code changes | `## Requirements` R-items, `## Design`, `## Plan` |
| `review` | Fix the findings in `#### Review Findings` → code changes | `#### Review Findings` table (under `### Background`), `## Plan` |
| `brainstorm` | Research/ideation → `## Solution` write-up | `## Background` prompt, `## Design` constraints |

The implement agent reads the template field first, then picks the correct input section. For a
`review` task, the `#### Review Findings` table IS the requirements — fix each finding in
severity order (P1 → P2 → P3 → P4), then re-review.

## Handoff To Testing And Review

Implementation is complete only when:

- the relevant narrow checks pass
- the Solution section has a useful change map
- no known requirement is silently deferred
- the next gate can run without needing hidden context from the implementer
