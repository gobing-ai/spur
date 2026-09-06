# D6 ready-depth refinement — 2026-09-06

Command: `/sp-dev-refineall --feature D6 --auto --depth ready`.
Depth: **ready**. Execution: inline. Batch verdict: **clean** (refinement, not implementation).

## Frozen scope and outcomes

Selected once: 0782–0786, all todo. Excluded 0607, 0608, 0609, 0723 and 0781 individually because each is done and outside the default backlog/todo filter. No membership expansion or completed-task edits.

| Task | Outcome | Frozen decision | Dependencies | Task check |
| --- | --- | --- | --- | --- |
| 0782 | refined | Existing-feature consumer; frozen todo roster; one completion check | None | PASS, no findings |
| 0783 | refined | One normalized wrapup input; checked metrics and reached sync target | None | PASS, no findings |
| 0784 | refined | Persist launch source/workdir; honest resume identity; reuse checkpoint contract | 0782, 0783 | PASS, 2 prerequisite warnings |
| 0785 | refined | Shared physical confinement; fresh proof binding before completion | 0781 (done), 0784 | PASS, 3 prerequisite warnings |
| 0786 | refined | Repair three canonical guidance projections; no host installation | 0785 | PASS, 4 prerequisite warnings |

Stable execution order: 0782, 0783, 0784, 0785, 0786.
0782 and 0783 are independent; the default execution remains sequential in this working tree.
Unfinished in-set prerequisites constrain execution order, not completion of their planning.
No failed, blocked, skipped or not-attempted members.

## Ready-depth review

Each task now contains observable requirements, explicit non-goals, frozen seams/names/algorithms, owned files, dependent-task handoffs, ordered requirement-mapped implementation steps and focused regression commands. Q&A decisions are closed. Existing helpers and storage owners are reused; no new engine, registry, dependency or public CLI noun/verb is planned.

Premises were checked against current workflow definitions, action callers, run/resolver/checkpoint services, DAO metadata operations, installed filesystem/persistence interfaces, task-record source, canonical capability text and relevant authority. The inline architecture pass selected task-local repairs under existing decisions rather than introducing a new ADR.

Stable feature-mapped scenario titles were preserved. CLI readback confirmed all five remain todo under D6 and Root Cause/Solution/Testing/Review are unchanged. Only planning sections and dependency metadata were written through `spur task update` / `spur task deps`.

## Verification and limits

- Source-local `bun apps/cli/src/index.ts task check <wbs> --json`: PASS for each selected task. Nine total findings are direct/transitive `L4.prerequisite-not-done` warnings; none were suppressed.
- Source-local `bun apps/cli/src/index.ts feature check D6 --json`: structural PASS with nine `L4.scenario-unverified` warnings for the pending scenarios R10–R18.
- `git diff --check`: PASS.
- Implementation suites, full source gates and runtime verify PASS were not run or produced by this planning-only operation. Prior audit test results are not represented as fresh evidence.
- No corpus sweep: these are ordinary affected-input planning edits, not checker-policy changes (T11).
- No workflow/source implementation, host adapter installation, deployment or external review request.
- Concurrent changes to `apps/server/src/serve.ts` and `apps/server/tests/serve.test.ts` were preserved and excluded from this work.

D6 is specification-ready for ordered implementation, **not release-ready**. Next operation, when requested: `/sp-dev-runall --feature D6 --auto`. This refineall invocation does not chain execution.
