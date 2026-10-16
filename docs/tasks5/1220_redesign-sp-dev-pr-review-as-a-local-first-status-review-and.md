---
schema_version: 1
name: Redesign /sp:dev-pr-review as a local-first status, review and fix command
status: todo
template: feature-impl
created_at: 2026-10-16T18:16:16.610Z
updated_at: "2026-10-16T18:34:35.327Z"
feature_id: L1
priority: P2
tags:
  - plugin
  - command
  - pr-review
estimate_hours: 4

dependencies: ["1218", "1219"]
---

## 1220. Redesign /sp:dev-pr-review as a local-first status, review and fix command

### Background

Implements: R8 — dev-pr-review status mode shows the branch graph and the pull-request state; R9 — dev-pr-review review mode runs a local review of the branch diff by default; R10 — dev-pr-review review --codex requests the GitHub Codex review through the existing spine; R11 — dev-pr-review fix mode triages and fixes findings from either reviewer; R12 — The redesigned command replaces the old mode set with three modes.

The migrated command is Codex-only with seven modes and goes unused. Design: docs/design/builder-branches-and-pr-review.md §3.3.

### Requirements

- [ ] R1. `plugins/sp/commands/dev-pr-review.md` is rewritten from scratch: modes `status` (default), `review` and `fix`; flags `--codex`, `--force`, `--no-wait`, `--base`, `--agent`, plus free-text focus.
- [ ] R2. `status` runs `spur builder show-branches --base <b> --pr` (task 1218) and `spur builder pr-status --json` (task 1219). It is read-only.
- [ ] R3. `review` runs `spur builder pr-check --base <b> --scan-only --json` (BLOCK stops), then the local `/sp:dev-review` over the `base...HEAD` changed files. `review --codex` runs `pr-review.yaml` with `mode=full`, or `mode=rerun` with `--force` and `mode=submit` with `--no-wait`.
- [ ] R4. `fix` validates each current-head finding (from the local review verdict, or from `pr-status --json` `.review` for Codex) before editing, fixes the legitimate ones, verifies, makes one focused commit and pushes without force.
- [ ] R5. Retired modes (full, submit, rerun, collect) print one notice and run their replacement. `rules` prints a notice pointing to `cc:cc-magents`.
- [ ] R6. `sp:pr-reviewing` SKILL.md is slimmed to the three modes with updated `pipeline_steps` and only the four `pr-<verb>` commands. Installed adapters are regenerated through `superskill install sp`, never hand-edited.

### Acceptance Criteria

- [ ] AC1 — dev-pr-review status mode shows the branch graph and the pull-request state
- [ ] AC2 — dev-pr-review review mode runs a local review of the branch diff by default
- [ ] AC3 — dev-pr-review review --codex requests the GitHub Codex review through the existing spine
- [ ] AC4 — dev-pr-review fix mode triages and fixes findings from either reviewer
- [ ] AC5 — The redesigned command replaces the old mode set with three modes

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-16T18:25:26.797Z

- Q: How does the local review target `base...HEAD` when `/sp:dev-review` has no diff-range flag? A: Pass the changed-file list from `git diff --name-only <base>...HEAD` as `--scope`. Closed 2026-10-16.
- Q: Where does `rules` point? A: `cc:cc-magents` (the `cc` plugin). Closed 2026-10-16.

#### Q&A entry — 2026-10-16T18:34:35.326Z

- Q: How does the local review target `base...HEAD` when `/sp:dev-review` has no diff-range flag? A: Pass the changed-file list from `git diff --name-only <base>...HEAD` as `--scope`. Closed 2026-10-16.
- Q: Where does `rules` point? A: `cc:cc-magents` (the `cc` plugin). Closed 2026-10-16.
- Q: Which pull-request commands does the command use? A: Only the four flat verbs from task 1219 (`pr-status`, `pr-check`, `pr-open`, `pr-review` via `pr-review.yaml`). Closed 2026-10-16.

### Design

Feature L1 (child of the `spur builder` umbrella L). Satellite: `docs/design/builder-branches-and-pr-review.md` §3.3. Depends on 1218 (`show-branches`) and 1219 (the four `pr-<verb>` verbs and the four-state `pr-review.yaml`).

**Chosen.** `plugins/sp/commands/dev-pr-review.md` is rewritten from scratch as a thin wrapper that calls `Skill(skill="sp:pr-reviewing", args=...)`. `plugins/sp/skills/pr-reviewing/SKILL.md` owns mode routing and is slimmed to three modes. The local review reuses `/sp:dev-review` rather than adding a parallel reviewer. The Codex path runs `config/workflows/pr-review.yaml` as its single source of truth. Reason: reuse, and a local review needs no Codex quota.

**Frozen surface.** `/sp:dev-pr-review [status|review|fix] [--codex] [--force] [--no-wait] [--base <branch>] [--agent <inline|auto|name>] [<focus>]`; the default mode is `status`.

| Mode | Steps |
| --- | --- |
| `status` | `spur builder show-branches --base <b> --pr --format markdown`, with the report filtered to the current branch and its base, plus `spur builder pr-status --json` (PR number, CI, local changes, latest current-head review in `.review`). Read-only. |
| `review` | `spur builder pr-check --base <b> --scan-only --json`; `BLOCK` stops, `WARN` is reported. Then `git diff --name-only <b>...HEAD` → `/sp:dev-review --scope <comma-joined paths> --focus <focus>`. `/sp:dev-review` takes `--scope` paths, not a diff range (`plugins/sp/commands/dev-review.md:31`). An empty diff ends with "nothing to review". Posts nothing to GitHub. |
| `review --codex` | `spur workflow run pr-review.yaml` (or the inline driver) with `mode=full`; `--force` → `mode=rerun`; `--no-wait` → `mode=submit`; `focus`/`baseBranch` passed as vars. States: check → precheck → open → review. `pending` is reported as pending, not failure. |
| `fix` | Takes findings from the latest local review verdict, or from `spur builder pr-status --json` `.review` when the last review was Codex. Validates each finding against the code before editing; rejected findings are listed with a reason. Fixes the legitimate ones, runs the project gate, makes one focused commit and pushes without force (`spur builder pr-open` handles a first push). |

Retired modes print one notice line and run their replacement: `full` → `review --codex`; `submit` → `review --codex --no-wait`; `rerun` → `review --codex --force`; `collect` → `status`. `rules` prints a notice that `AGENTS.md` review-rule authoring belongs to `cc:cc-magents` (in the `cc` plugin, not `sp`) and exits.

**Skill frontmatter.** `pipeline_steps` becomes `[status, check, review, open, triage, fix]`. The description says local-first with Codex opt-in, and the triggers keep "codex review" and "review my PR". Bump `version` to 2.0.0. No `spur builder pr <op>` spellings remain in the skill or command.

**Invariants.** Never force-push, rewrite history, close or integrate the PR, or discard unrelated changes. `review` without `--codex` makes no GitHub writes.

**Anti-patterns.** No hand-edits to generated per-platform adapters; regenerate through `superskill install sp`. No re-implementation of `dev-review` dimensions inside the skill. No new `spur` verbs. No direct `pr-review` calls that bypass the workflow on the Codex path.

**Rejected.** Deleting the command (loses the daily status hook). Keeping seven modes (the reason it went unused).

### Plan

1. Write the failure list first: no PR for the branch; gh missing; empty diff; `pr-check` BLOCK; Codex pending or wait timeout (workflow `pending`); a finding that refers to a stale head; a retired mode passed; `rules` passed.
2. Rewrite `plugins/sp/commands/dev-pr-review.md` with the frozen surface and the retired-mode table (R1, R5).
3. Rewrite the `sp:pr-reviewing` mode table, routes and frontmatter on the four verbs and the four-state workflow; move the Codex-only sections behind `--codex` (R2–R4, R6).
4. Dogfood each mode on a scratch branch of this repo (status, review, review --codex --no-wait, fix on a seeded finding, one retired mode). Save transcripts under `.spur/run/1220-dogfood/` as the repeatable E2E artifact (R2–R5).
5. Run `superskill skill evaluate plugins/sp/skills/pr-reviewing` and `superskill command evaluate plugins/sp/commands/dev-pr-review.md`; run `bun run plugin-smoke`; then `superskill install sp` to regenerate the adapters (R6).
6. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-16T18:23:10.575Z feature_id Q → L1 (system)

