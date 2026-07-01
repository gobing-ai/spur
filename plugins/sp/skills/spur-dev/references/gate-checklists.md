---
name: gate-checklists
description: "Pre-gate verification checklists for the five corpus-mutating gates in the spur-dev lifecycle. Each checklist is what the agent verifies BEFORE entering the gate — additive to the CLI's schema validation, catching intent errors the CLI cannot."
see_also:
  - spur-dev
  - cross-cutting
  - execution-workflow
  - planning-workflow
---

# Gate Checklists

Each gate below mutates the corpus or commits the operator to a path. Verify every checkbox before
entering the gate. A failed checkbox means stop and fix — do not enter the gate hoping the CLI will
catch it (the CLI catches schema violations, not intent errors).

Run each checklist as an actual command sequence, not a mental confirmation:

1. Read the checklist for the gate you are about to enter.
2. Run each verification command (grep, `spur task check`, `bun run lint`, etc.).
3. If any checkbox fails: stop, fix, re-run. Do not enter the gate.
4. Only when every checkbox passes: enter the gate (run the CLI verb or trigger the workflow state).

## feature-check gate

Entered before `spur feature check <id> --strict` (idea-pipeline `feature-check` state;
planning-pipeline AC validation).

- [ ] Feature file has a non-placeholder `## Goal` and `## Scope` section.
- [ ] Acceptance criteria are R-numbered scenarios in Gherkin `Feature/Scenario` form (see `ac-style-guide.md`).
- [ ] Each scenario has a stable title (renaming after task creation breaks traceability).
- [ ] No `TODO`, `TBD`, or `???` placeholders remain in the feature body.
- [ ] The `## Out of Scope` section is present and non-empty (PRD-shaped features only).
- [ ] If `--auto` is set: the AC schema is locally valid against the BDD validator before the gate runs.

## batch-create gate

Entered before `spur task batch-create --file <json>` (idea-pipeline `batch-create` state;
planning-pipeline decomposition gate).

- [ ] The batch JSON is a bare array (not an object with a `tasks` key).
- [ ] Each entry validates locally against `apps/cli/schemas/task-batch.schema.json` (`additionalProperties: false` — no unknown keys).
- [ ] Each entry has a non-empty `name` (required).
- [ ] `feature_id` matches an existing feature (or is intentionally deferred with operator awareness).
- [ ] `parent_wbs` is set when the task is a child of a decomposition parent.
- [ ] `template` is one of `feature-impl`, `issue`, `review`, `meta` — chosen per task shape.
- [ ] Requirements, AC, Design, and Plan section bodies are filled (not template placeholder comments) — schema permits empty but execution cannot run against empty sections.
- [ ] Dependencies are encoded in Background/Plan prose (the CLI does not expose `dependencies` as a field).
- [ ] If `--auto` is set: a dry-run validation against `task-batch.schema.json` was run locally and passed.

## precheck gate

Entered before `task-pipeline.yaml` `precheck` state runs `spur task check <wbs>`.

- [ ] `spur task check <wbs> --json` returns no `error`-level findings.
- [ ] The task's `feature_id` resolves to an existing feature (or is explicitly deferred with operator awareness).
- [ ] The `## Requirements` section is non-empty and R-numbered.
- [ ] The `## Acceptance Criteria` section has at least one scenario with a verify command.
- [ ] The `## Plan` section is an ordered checklist (not prose).
- [ ] The `## Design` section, if present, does not contradict the parent feature's design.
- [ ] No `TODO`, `TBD`, or `???` placeholders in Requirements, AC, Design, or Plan.

## review gate

Entered before `task-pipeline.yaml` `review` state dispatches `sp:code-verification` (SECUA review).

- [ ] The implementation matches the task's `## Plan` checklist (every checked item maps to a code/test/doc change).
- [ ] `git status` shows only changes traceable to this task's Plan (no drive-by edits).
- [ ] Lint and typecheck pass (`bun run lint`).
- [ ] Tests pass (`bun run test`) — no `.skip`, `xfail`, or commented-out tests.
- [ ] New `biome-ignore` / `eslint-disable` suppressions: none, or each is justified inline.
- [ ] No new `console.*` in scripts (use a project logger if one exists).
- [ ] The `## Solution` section records the file:line change map and rationale.
- [ ] If the change is high-stakes (code/test/infra): raw gate tails are captured for the `## Testing` section.

## verify gate

Entered before `task-pipeline.yaml` `verify` state produces a task verdict.

- [ ] `spur task check <wbs> --strict-core --json` returns PASS.
- [ ] Every AC scenario has a corresponding verify command that exited 0.
- [ ] The `## Solution` section is filled (not the placeholder comment).
- [ ] The `## Testing` section records the commands run and their outcomes.
- [ ] The `## Review` section records findings (or explicitly states "no findings").
- [ ] No gate was bypassed with `--no-verify`, `--force`, or a suppression comment.
- [ ] If `--auto` is set: the verdict is `PASS` (not `PARTIAL` or `FAIL`) — `--auto` does not auto-advance a failed verify.
- [ ] The task is ready for `spur task record <wbs>` and legal transition to `done`.
