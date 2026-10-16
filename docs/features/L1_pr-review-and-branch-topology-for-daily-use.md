---
schema_version: 1
id: "L1"
name: "PR review and branch topology for daily use"
status: backlog
priority: P2
tags: []
created_at: "2026-10-16T18:12:23.631Z"
updated_at: "2026-10-16T18:33:18.333Z"
---

# L1: PR review and branch topology for daily use

## Goal

Make PR review and branch state a daily-use surface: a read-only `spur builder show-branches` report (condensed mermaid `gitGraph` by default, `--format markdown|json|text`), four flat pull-request verbs (`pr-status`, `pr-check`, `pr-open`, `pr-review`) in place of the pass-through `pr <op>` layer, and a from-scratch, local-first `/sp:dev-pr-review` built on them with GitHub Codex as an opt-in reviewer.

## Scope

**In scope**

- New `spur builder show-branches` verb: base-relative branch topology (fork point, ahead/behind, contained, last-commit age, worktree binding, optional `gh` PR state); `--format markdown|json|text` (default `markdown`); condensed mermaid `gitGraph` using the operator-referenced syntax subset (`commit id/tag/type`, `branch`, `checkout`, `merge`, optional theme init); filters for base and local/remote.
- Replace `spur builder pr <op>` with four flat verbs that compose the existing service operations: `pr-status` (status + collect), `pr-check` (preflight + hygiene), `pr-open` (push + ensure), `pr-review` (request + wait + collect). Each has its own help and flag validation, `--json`, `--status-file`, and exit codes 0/1/2/3. `pr` stays as a hidden, deprecated alias for one release.
- Shrink `config/workflows/pr-review.yaml` to check → precheck → open → review with the same terminal states (done, pending, failed) and the same `mode` values.
- Redesign `plugins/sp/commands/dev-pr-review.md` and slim `sp:pr-reviewing`: modes `status`, `review` (local multi-dimension review of `base...HEAD`; `--codex` opts into `@codex review`), `fix`; retired modes map to flags or are dropped with a notice.
- Docs: governance consent rows, `sp:spur-cli` builder reference, owning design satellite, `04_DESIGN.md` index.

**Out of scope**

- Deleting, pruning or rewriting branches (report only; git owns mutation).
- Renaming the `builder` noun or moving pull-request verbs to a new noun.
- Full-history commit graphs; Board/web UI for branches.
- Changing the Codex request/collect core logic in `packages/app/src/services/pr-review/index.ts` beyond composing existing operations.

## Acceptance Criteria

```gherkin
Feature: PR review and branch topology for daily use

  @core
  Scenario: R1 — show-branches reports every branch relative to a base
    # covers: I4, I7
    Given a repository with a default branch and local and remote branches at different positions
    When the operator runs spur builder show-branches
    Then each branch row carries its name, fork point, commits ahead, commits behind, last-commit date, whether it is fully contained in the base, and its worktree path or none
    And the base defaults to the repository default branch and --base <ref> overrides it
    And branches with zero commits ahead of the base are flagged as contained so stale branches are visible
    And the command reads git state only and never creates, deletes or moves a ref

  @core
  Scenario: R2 — Markdown is the default format and carries a condensed mermaid gitGraph
    # covers: I5, I6
    Given a repository with several branches forked from the base
    When the operator runs spur builder show-branches without --format
    Then the output equals the output of spur builder show-branches --format markdown
    And it contains a summary table and one fenced mermaid block that starts with gitGraph
    And the graph draws the base plus one branch statement per non-contained branch with at most a capped number of commit nodes per branch, summarizing the rest as one commit labelled with the hidden count
    And branches fully contained in the base render as joined back into the base instead of as open lines

  @core
  Scenario: R3 — The gitGraph text uses only the referenced mermaid syntax and stays renderable
    # covers: I5
    Given branch names containing slashes, dots and quotes and tags on base commits
    When the markdown report renders the graph
    Then the block uses only gitGraph, commit with quoted id and tag values and an unquoted type of NORMAL, HIGHLIGHT or REVERSE, branch, checkout and the join statement with an optional tag
    And every branch name and commit label is sanitized so the block parses in mermaid
    And each branch tip renders as a HIGHLIGHT commit and a revert commit renders as a REVERSE commit
    And --theme <name> emits an init directive selecting that mermaid theme, with none emitted by default

  @core
  Scenario: R4 — json and text formats expose the same branch model
    # covers: I6
    Given the same repository state
    When the operator runs spur builder show-branches --format json and then --format text
    Then the json output is one object with the base, the generated time and a branches array whose rows match the markdown table rows
    And the text output is an aligned plain table with no mermaid block
    And an unknown --format value exits 1 with an error naming the three allowed values

  @core
  Scenario: R5 — Pull-request state enriches branches when gh is available and degrades when it is not
    # covers: I7
    Given gh is installed and authenticated for the repository
    When the operator runs spur builder show-branches --pr
    Then each branch with an open pull request shows its number, state and review decision
    And when gh is missing or unauthenticated the report still renders, every pull-request field is none, and one warning line names the reason

  @core
  Scenario: R6 — The pull-request operations are four flat builder verbs with their own help
    # covers: I2, I3
    Given the eight former pr operations preflight, push, ensure, hygiene, request, wait, collect and status
    When the operator runs spur builder --help and spur builder pr-<verb> --help
    Then the builder lists pr-status, pr-check, pr-open and pr-review, each with its own flags and description
    And pr-status covers the former status and collect, pr-check covers preflight and hygiene, pr-open covers push and ensure, and pr-review covers request, wait and collect
    And an unknown flag on any of the four verbs exits 1 naming the flag instead of being ignored
    And spur builder pr remains as a hidden alias for one release that prints a deprecation notice naming the replacement verb

  @core
  Scenario: R7 — The pr-review workflow runs on the four verbs with its verdict contract intact
    # covers: I2, I3
    Given pr-review.yaml shells out to the builder with --json and --status-file
    When the workflow runs check, precheck, open and review
    Then it reaches done on a CLEAN or FINDINGS result, pending on a PENDING result or wait timeout, and failed on any red check, as before
    And each verb's stdout JSON, status-file verdict and exit codes 0, 1, 2 and 3 equal the composition of the former operations it replaces for the same stubbed git and gh responses
    And the workflow's mode values full, submit and rerun keep their meaning

  @core
  Scenario: R8 — dev-pr-review status mode shows the branch graph and the pull-request state
    # covers: I1, I7
    Given a feature branch with an open pull request
    When the operator runs /sp:dev-pr-review status
    Then the command shows the show-branches markdown report scoped to the current branch and its base
    And it shows the pull-request number, CI checks, local changes and the latest review state for the current head from spur builder pr-status
    And it performs no push, request or source edit

  @core
  Scenario: R9 — dev-pr-review review mode runs a local review of the branch diff by default
    # covers: I1
    Given a feature branch whose diff against its base is non-empty
    When the operator runs /sp:dev-pr-review review without --codex
    Then spur builder pr-check scans base...HEAD and blocking findings stop the review
    And the existing local review stack reviews the base...HEAD diff and reports findings by severity with file and line evidence
    And no GitHub comment is posted

  @core
  Scenario: R10 — dev-pr-review review --codex requests the GitHub Codex review through the existing spine
    # covers: I1, I2
    Given a pushed feature branch
    When the operator runs /sp:dev-pr-review review --codex
    Then the pr-review.yaml workflow runs pr-check, the optional project precheck, pr-open and pr-review
    And a review already recorded for the current head is collected instead of requested again unless --force is passed
    And --no-wait returns pending right after the request

  @core
  Scenario: R11 — dev-pr-review fix mode triages and fixes findings from either reviewer
    # covers: I1
    Given current-head findings from the local review or from Codex
    When the operator runs /sp:dev-pr-review fix
    Then each finding is validated against the code before any edit and rejected findings are listed with a reason
    And legitimate findings are fixed, verified and committed in one focused commit
    And the command never force-pushes, rewrites history or discards unrelated changes

  @core
  Scenario: R12 — The redesigned command replaces the old mode set with three modes
    # covers: I1
    Given the previous modes full, submit, collect, fix, rerun, status and rules
    When the operator passes a retired mode to /sp:dev-pr-review
    Then the command prints one notice naming the replacement mode or flag and runs it
    And the command file, the sp:pr-reviewing skill and its pipeline_steps describe only status, review and fix

  @core
  Scenario: R13 — The builder surface is documented where the CLI facade and design index look
    # covers: I2, I4
    Given the new show-branches verb and the four pr verbs
    When an agent reads the sp:spur-cli builder reference and the owning design satellite
    Then both list show-branches with its flags and default format and pr-status, pr-check, pr-open and pr-review with their flags
    And docs/04_DESIGN.md indexes the satellite

  @edge
  Scenario: R14 — show-branches handles empty, detached and large repositories
    # covers: I4
    Given a repository with no branches besides the base, a detached HEAD, or more than 50 branches
    When the operator runs spur builder show-branches
    Then a single-branch repository renders a graph with only the base
    And a detached HEAD is reported as a row named by its short sha
    And --limit <n> caps the branch rows by most recent commit with a footer counting the omitted branches
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1218 | Add spur builder show-branches branch topology report | todo |
| 1219 | Register spur builder pr operations as real Commander subcommands | todo |
| 1220 | Redesign /sp:dev-pr-review as a local-first status, review and fix command | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-16T18:23:10.575Z moved Q → L1 (system)

