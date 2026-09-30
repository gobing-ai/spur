---
schema_version: 1
id: "I33"
name: "dev-review target selectors and review-scope correctness: --tasks/--feature/--scope multi-target, honest diff scope, contract hygiene"
status: backlog
priority: P2
tags: []
created_at: "2026-09-30T18:11:48.107Z"
updated_at: "2026-09-30T18:12:13.541Z"
---

# I33: dev-review target selectors and review-scope correctness: --tasks/--feature/--scope multi-target, honest diff scope, contract hygiene

## Goal

`/sp:dev-review` reviews exactly what the operator named — one or many tasks, a feature, or one or many paths — and every review component derives the same honest scope for it. Today the command takes one positional `<wbs|path>`, so reviewing `apps,packages,plugins,scripts` costs four runs; task-mode scope derivation picks the wrong commit and drops non-TS files; path mode has no SECUA scope contract; and the command/agent/skill contracts disagree on flags and on who writes `## Review`.

## Scope

In:
- Target selectors on `/sp:dev-review`: exactly one of `--tasks <selector>` (existing batch selector grammar: comma WBS list, `feature:<id>`), `--feature <id>[,<id>]`, `--scope <path>[,<path>]`. Mixing kinds is rejected (exit 2). The positional `<wbs|path>` stays one release as a deprecated alias with a warning.
- Per-target semantics: `--tasks`/`--feature` run one WBS-mode review per task (each writes its own `## Review`) plus a combined summary; `--feature` freezes the set once and reports `backlog`/`todo` tasks as NOT-STARTED; `--scope` runs one advisory review over the deduplicated union with per-path sub-reviews and one cross-path architecture pass.
- `--worktree` admission and naming for multi-target runs.
- Honest task diff scope (implementation commits by `(<wbs>)` subject tag, not the last task-file commit; no `*.ts/js` filter) and an explicit path-scope step for `sp:code-verification` review mode.
- Contract hygiene: target double-forwarding, coordinator `## Review` ownership in inline mode, `Edit`/`Write` for `--triage`, one `--focus` vocabulary, stale `--fix`/`--next` references, hidden `--auto`/`--json`.
- Pipeline `review` step switches to `--tasks ${vars.wbs}`; parity test, dev-operations row, and flag glossary updated together.

Out:
- New public `spur` nouns/verbs (scope derivation stays in skill prose using `git`/`spur task`).
- Changing review dimensions, severity vocabulary, or the P1–P4 table contract.
- `/sp:dev-review-session` and `/sp:dev-pr-review`.
- Generated per-platform adapters (Superskill owns them).

## Acceptance Criteria

```gherkin
Feature: dev-review target selectors and review-scope correctness

  @core
  Scenario: R1 — task diff scope names the implementation commits
    Given a done task whose implementation commit subject carries "(<wbs>)" and whose task file was touched by a later docs-only commit
    When a WBS-mode review derives its change scope
    Then the scope contains every file changed by the tagged implementation commits, including .md and .yaml files
    And excludes files changed only by unrelated later commits

  @core
  Scenario: R2 — path-mode SECUA review has a defined scope
    Given /sp:dev-review is invoked with a path target
    When sp:code-verification review mode runs
    Then it derives its scope from the path per a documented step instead of a task WBS

  @core
  Scenario: R3 — exactly one target kind per invocation
    Given the operator passes more than one of --tasks, --feature and --scope
    When /sp:dev-review parses its arguments
    Then it stops with exit 2 naming the conflicting selectors before any review runs

  @core
  Scenario: R4 — multi-task and feature targets review each task
    Given --tasks 0962,0963 or --feature <id>
    When the review runs
    Then each implemented task gets its own merged ## Review section and the run ends with a combined summary
    And feature tasks in backlog or todo are reported as NOT-STARTED and not reviewed

  @core
  Scenario: R5 — multi-path scope reviews the union once
    Given --scope apps,packages,plugins,scripts
    When the review runs
    Then overlapping paths are deduplicated, each path gets a sub-review, and one merged advisory report includes a cross-path architecture pass
    And no task file is mutated

  @core
  Scenario: R6 — positional target is a deprecated alias
    Given /sp:dev-review 0962 is invoked
    When arguments are parsed
    Then it behaves as --tasks 0962 and prints a deprecation warning
    And the task pipeline review step invokes --tasks ${vars.wbs}

  @core
  Scenario: R7 — command, agent and skill contracts agree
    Given the dev-review command, super-reviewer agent, review skills, flag glossary and dev-operations row
    When command-flag-parity and plugin structure tests run
    Then the target is forwarded once, one --focus vocabulary is referenced, no live route uses the deprecated --fix or removed --next, and --tasks/--feature/--scope/--auto appear in the argument hint, dev-operations row and glossary
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
<!-- END AUTO-GENERATED -->

## Notes

Source: operator review request on `plugins/sp/commands/dev-review.md` (2026-09-30). Flag names chosen by the operator: `--tasks / --feature / --scope` (reusing existing glossary flags instead of new `--task`/`--path`), which is the public-surface consent for this change. Scope-bug evidence: for task 1020 the current Step 3 derivation selected `a7ef9ba83 docs(tasks)` and returned 1 file, missing implementation commit `bbef13522`.

## History
